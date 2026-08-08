const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyLegacyIdentity,
  classifyLegacyOccurrences
} = require('../src/core/legacy-v1-compatibility.js');
const {
  LocalStore,
  MemoryBackend,
  LEGACY_V1_REPAIR_MARKER_ID
} = require('../src/storage/local-store.js');

const SHA_A = 'A'.repeat(64);
const SHA_A_LOWER = SHA_A.toLowerCase();
const SHA_B = 'b'.repeat(64);

function fakeLegacyIndexedDb(books, { exists = true } = {}) {
  const state = { databasesCalls: 0, openCalls: 0, closeCalls: 0, transactionCompleted: false };
  return {
    state,
    async databases() {
      state.databasesCalls += 1;
      return exists ? [{ name: 'kangkangWordPwa_readerDb', version: 1 }] : [];
    },
    open(name) {
      state.openCalls += 1;
      assert.equal(name, 'kangkangWordPwa_readerDb');
      const request = {};
      queueMicrotask(() => {
        const db = {
          objectStoreNames: { contains: store => store === 'books' },
          transaction(storeName, mode) {
            assert.equal(storeName, 'books');
            assert.equal(mode, 'readonly');
            const transaction = {};
            transaction.objectStore = () => ({
              getAll() {
                const getRequest = {};
                queueMicrotask(() => {
                  getRequest.result = structuredClone(books);
                  getRequest.onsuccess?.();
                  queueMicrotask(() => {
                    state.transactionCompleted = true;
                    transaction.oncomplete?.();
                  });
                });
                return getRequest;
              }
            });
            return transaction;
          },
          close() {
            assert.equal(state.transactionCompleted, true, 'legacy DB must not close before the readonly transaction completes');
            state.closeCalls += 1;
          }
        };
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    }
  };
}

function fakeDb6(initialBooks, { failNextBookPut = false } = {}) {
  const data = {
    books: new Map(initialBooks.map(book => [book.id, structuredClone(book)])),
    meta: new Map()
  };
  const state = { failNextBookPut };
  return {
    data,
    state,
    transaction(storeNames, mode) {
      assert.deepEqual(storeNames, ['books', 'meta']);
      assert.equal(mode, 'readwrite');
      const staged = {
        books: new Map([...data.books].map(([key, value]) => [key, structuredClone(value)])),
        meta: new Map([...data.meta].map(([key, value]) => [key, structuredClone(value)]))
      };
      const transaction = {};
      let pending = 0;
      let aborted = false;
      let completionQueued = false;

      const abort = error => {
        if (aborted) return;
        aborted = true;
        transaction.error = error;
        queueMicrotask(() => {
          transaction.onerror?.();
          transaction.onabort?.();
        });
      };
      const scheduleCompletion = () => {
        if (aborted || pending || completionQueued) return;
        completionQueued = true;
        queueMicrotask(() => {
          completionQueued = false;
          if (aborted || pending) return;
          data.books = staged.books;
          data.meta = staged.meta;
          transaction.oncomplete?.();
        });
      };
      const request = operation => {
        const result = {};
        pending += 1;
        queueMicrotask(() => {
          if (aborted) { pending -= 1; return; }
          try {
            result.result = operation();
            result.onsuccess?.();
          } catch (error) {
            result.error = error;
            result.onerror?.();
            abort(error);
          } finally {
            pending -= 1;
            scheduleCompletion();
          }
        });
        return result;
      };

      transaction.abort = () => abort(new Error('transaction aborted'));
      transaction.objectStore = name => ({
        get(key) {
          return request(() => staged[name].has(key) ? structuredClone(staged[name].get(key)) : undefined);
        },
        put(value) {
          return request(() => {
            if (name === 'books' && state.failNextBookPut) {
              state.failNextBookPut = false;
              throw new Error('synthetic IndexedDB quota failure');
            }
            const key = value?.id ?? value?.key;
            staged[name].set(key, structuredClone(value));
            return key;
          });
        }
      });
      return transaction;
    }
  };
}

class TrackingBackend extends MemoryBackend {
  constructor() {
    super();
    this.writeCount = 0;
    this.transactionCount = 0;
    this.beforeTransaction = null;
    this.failNextRepairBookPut = false;
  }

  resetTracking() {
    this.writeCount = 0;
    this.transactionCount = 0;
  }

  async put(store, value) {
    this.writeCount += 1;
    return super.put(store, value);
  }

  async transaction(storeNames, callback) {
    this.transactionCount += 1;
    return super.transaction(storeNames, (stores, transaction) => {
      this.beforeTransaction?.(storeNames);
      const wrappedStores = Object.fromEntries(Object.entries(stores).map(([name, store]) => [name, { ...store }]));
      for (const store of Object.values(wrappedStores)) {
        const put = store.put;
        store.put = value => { this.writeCount += 1; return put(value); };
      }
      if (this.failNextRepairBookPut && storeNames.includes('books') && storeNames.includes('meta')) {
        const put = wrappedStores.books.put;
        wrappedStores.books.put = value => {
          put(value);
          this.failNextRepairBookPut = false;
          throw new Error('synthetic quota failure');
        };
      }
      return callback(wrappedStores, transaction);
    });
  }
}

async function createAlreadyMigratedStore(book, Backend = TrackingBackend) {
  const backend = new Backend();
  const store = new LocalStore({ backend });
  await store.open();
  if (book) await store.put('books', book);
  await store.put('meta', { id: 'legacy-migration-v1', completedAt: '2026-08-01T00:00:00.000Z' });
  backend.resetTracking();
  return { store, backend };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

test('T1-T4 classify trusted SHA, bookKey-only, mismatch and fallback identities', () => {
  const trusted = classifyLegacyIdentity({ fileHash: SHA_A, bookKey: `hash:${SHA_A_LOWER}` });
  assert.equal(trusted.kind, 'trusted-sha');
  assert.equal(trusted.fingerprint, SHA_A_LOWER);

  const bookKeyOnly = classifyLegacyIdentity({ bookKey: `hash:${SHA_A}` });
  assert.equal(bookKeyOnly.kind, 'trusted-sha');
  assert.equal(bookKeyOnly.fingerprint, SHA_A_LOWER);
  assert.equal(bookKeyOnly.reason, 'sha-book-key-only');

  const mismatch = classifyLegacyIdentity({ fileHash: SHA_A, bookKey: `hash:${SHA_B}` });
  assert.equal(mismatch.kind, 'conflict');
  assert.equal(mismatch.fingerprint, null);
  assert.deepEqual(mismatch.conflicts.map(item => item.source), ['fileHash', 'bookKey']);

  const fallback = classifyLegacyIdentity({ fileHash: 'fallback-abc-42-99', bookKey: 'hash:fallback-abc-42-99' });
  assert.equal(fallback.kind, 'legacy-fallback');
  assert.equal(fallback.value, 'fallback-abc-42-99');
  assert.equal(fallback.fingerprint, null, 'fallback identities must never populate the current fingerprint');
});

test('T5 occurrence syntax classification preserves every raw string exactly', () => {
  const raw = ['12:3', '12:3', ' 12:3', 'bad', '0:00', '1:2 '];
  const classified = classifyLegacyOccurrences(raw);
  assert.deepEqual(classified.raw, raw);
  assert.deepEqual(classified.entries.map(entry => entry.syntax), [
    'syntactically-valid',
    'syntactically-valid',
    'syntactically-invalid',
    'syntactically-invalid',
    'syntactically-valid',
    'syntactically-invalid'
  ]);
  assert.throws(() => classifyLegacyOccurrences(['0:1', 2]), /string\[\]/i);
});

test('T7, T11, T13 and T14 repair is additive, exact-ID only, and escrows conflicts', async () => {
  const rawCurrentOccurrences = ['9:9'];
  const current = {
    id: 'historical-id',
    title: 'Current title',
    author: 'Current author',
    type: 'epub',
    format: 'EPUB',
    fileName: 'current.epub',
    fingerprint: SHA_B,
    progress: { version: 2, percent: 88, location: { format: 'epub', href: 'chapter.xhtml' } },
    notes: [{ id: 'new-note', content: 'current' }],
    bookmarks: [{ id: 'new-bookmark', href: 'chapter.xhtml' }],
    annotations: [{ id: 'annotation-1' }],
    readerSettings: { fontSize: 30 },
    metadata: { custom: 'current' },
    highlightedOccurrences: rawCurrentOccurrences,
    createdAt: 1000,
    updatedAt: 2000,
    lastReadAt: '2026-08-08T00:00:00.000Z'
  };
  const legacyRaw = ['0:1', ' malformed ', '0:1'];
  const legacyDb = fakeLegacyIndexedDb([{
    id: 'historical-id',
    title: 'Old title',
    fileHash: SHA_A,
    bookKey: `hash:${SHA_A_LOWER}`,
    highlightedOccurrences: legacyRaw,
    progress: { percent: 5 },
    notes: [{ id: 'old-note' }],
    bookmarks: [{ id: 'old-bookmark' }],
    updatedAt: 5
  }]);
  const { store, backend } = await createAlreadyMigratedStore(current);
  backend.beforeTransaction = storeNames => {
    if (storeNames.includes('books') && storeNames.includes('meta')) {
      assert.equal(legacyDb.state.closeCalls, 1, 'phase 1 must close before phase 2 begins');
    }
  };

  const result = await store.migrateLegacy({ legacyIndexedDB: legacyDb });
  assert.equal(result.alreadyDone, true);
  assert.equal(result.repair.repaired, true);
  const repaired = await store.get('books', current.id);

  for (const field of ['id', 'title', 'author', 'type', 'format', 'fileName', 'fingerprint', 'progress', 'notes', 'bookmarks', 'annotations', 'readerSettings', 'metadata', 'highlightedOccurrences', 'createdAt', 'updatedAt', 'lastReadAt']) {
    assert.deepEqual(repaired[field], current[field], `repair must preserve current ${field}`);
  }
  assert.equal(repaired.legacyV1.identityKind, 'conflict');
  assert.equal(repaired.legacyV1.identityReason, 'current-fingerprint-conflict');
  assert(repaired.legacyV1.conflicts.identities.some(item => item.source === 'currentFingerprint' && item.value === SHA_B));
  assert.deepEqual(repaired.legacyV1.conflicts.highlightedOccurrences[0].values, legacyRaw);
  const marker = await store.get('meta', LEGACY_V1_REPAIR_MARKER_ID);
  assert.deepEqual(marker.processedIds, ['historical-id']);
  assert.deepEqual(marker.repairedIds, ['historical-id']);
  assert.deepEqual(marker.conflictIds, ['historical-id']);
});

test('T7 trusted repair fills only missing compatibility fields', async () => {
  const current = {
    id: 'repair-me',
    title: 'Keep',
    progress: { version: 2, percent: 40 },
    notes: [],
    bookmarks: [],
    updatedAt: 77
  };
  const occurrences = ['1:2', 'broken', '1:2'];
  const legacyDb = fakeLegacyIndexedDb([{
    id: 'repair-me',
    fileHash: SHA_A,
    bookKey: `hash:${SHA_A_LOWER}`,
    highlightedOccurrences: occurrences
  }]);
  const { store } = await createAlreadyMigratedStore(current);
  await store.migrateLegacy({ legacyIndexedDB: legacyDb });
  const repaired = await store.get('books', 'repair-me');
  assert.equal(repaired.fingerprint, SHA_A_LOWER);
  assert.deepEqual(repaired.highlightedOccurrences, occurrences);
  assert.equal(repaired.id, 'repair-me');
  assert.equal(repaired.updatedAt, 77, 'repair must not manufacture a new current timestamp');
});

test('T8 repair marker makes the complete DB6 result idempotent', async () => {
  const legacyDb = fakeLegacyIndexedDb([{ id: 'same', fileHash: SHA_A, highlightedOccurrences: ['0:1'] }]);
  const { store, backend } = await createAlreadyMigratedStore({ id: 'same', title: 'Same', updatedAt: 1 });
  await store.migrateLegacy({ legacyIndexedDB: legacyDb });
  const once = stable({ books: await store.getAll('books'), meta: await store.getAll('meta') });
  backend.resetTracking();
  await store.migrateLegacy({ legacyIndexedDB: legacyDb });
  await store.migrateLegacy({ legacyIndexedDB: legacyDb });
  const thrice = stable({ books: await store.getAll('books'), meta: await store.getAll('meta') });
  assert.deepEqual(thrice, once);
  assert.equal(backend.writeCount, 0);
  assert.equal(backend.transactionCount, 0);
  assert.equal(legacyDb.state.openCalls, 1, 'completed marker must avoid reading the legacy DB again');
});

test('T9 a missing legacy DB creates nothing and writes nothing to DB6', async () => {
  const missing = fakeLegacyIndexedDb([], { exists: false });
  const current = { id: 'native-db6', title: 'Untouched', progress: { percent: 12 }, updatedAt: 5 };
  const { store, backend } = await createAlreadyMigratedStore(current);
  const before = stable({ books: await store.getAll('books'), meta: await store.getAll('meta') });
  backend.resetTracking();
  const result = await store.migrateLegacy({ legacyIndexedDB: missing });
  const after = stable({ books: await store.getAll('books'), meta: await store.getAll('meta') });
  assert.equal(result.repair.legacyDatabaseMissing, true);
  assert.deepEqual(after, before);
  assert.equal(await store.get('meta', LEGACY_V1_REPAIR_MARKER_ID), null);
  assert.equal(backend.writeCount, 0);
  assert.equal(backend.transactionCount, 0);
  assert.equal(missing.state.openCalls, 0, 'existence probing must not open/create an absent database');
});

test('T10 missing exact target is skipped without filename/title guessing or resurrection', async () => {
  const legacyDb = fakeLegacyIndexedDb([{ id: 'deleted-id', title: 'Same title', fileName: 'same.txt', fileHash: SHA_A }]);
  const { store } = await createAlreadyMigratedStore({ id: 'other-id', title: 'Same title', fileName: 'same.txt', updatedAt: 1 });
  await store.migrateLegacy({ legacyIndexedDB: legacyDb });
  assert.equal(await store.get('books', 'deleted-id'), null);
  assert.equal((await store.getAll('books')).length, 1);
  const marker = await store.get('meta', LEGACY_V1_REPAIR_MARKER_ID);
  assert.deepEqual(marker.skipped, [{ id: 'deleted-id', reason: 'target-missing' }]);
});

test('T12 a DB6 transaction failure rolls back compatibility and marker, then retry succeeds', async () => {
  const legacyDb = fakeLegacyIndexedDb([{ id: 'rollback-id', fileHash: SHA_A, highlightedOccurrences: ['0:1'] }]);
  const { store, backend } = await createAlreadyMigratedStore({ id: 'rollback-id', title: 'Rollback', updatedAt: 3 });
  backend.failNextRepairBookPut = true;
  await assert.rejects(() => store.migrateLegacy({ legacyIndexedDB: legacyDb }), /synthetic quota failure/);
  const rolledBack = await store.get('books', 'rollback-id');
  assert.equal(rolledBack.legacyV1, undefined);
  assert.equal(rolledBack.fingerprint, undefined);
  assert.equal(await store.get('meta', LEGACY_V1_REPAIR_MARKER_ID), null);

  await store.migrateLegacy({ legacyIndexedDB: legacyDb });
  assert.equal((await store.get('books', 'rollback-id')).fingerprint, SHA_A_LOWER);
  assert((await store.get('meta', LEGACY_V1_REPAIR_MARKER_ID)).completedAt);
});

test('T12 real IndexedDB path is request-driven, atomic, and retryable after abort', async () => {
  const db = fakeDb6([{ id: 'real-idb', title: 'Current', updatedAt: 9 }], { failNextBookPut: true });
  const store = new LocalStore({ indexedDBRef: {} });
  store.db = db;
  store._readerSchemaMigrated = true;
  store.get = async (storeName, key) => db.data[storeName].has(key) ? structuredClone(db.data[storeName].get(key)) : null;
  const legacyDb = fakeLegacyIndexedDb([{ id: 'real-idb', fileHash: SHA_A, highlightedOccurrences: ['0:1'] }]);

  await assert.rejects(() => store.repairLegacyV1Data({ legacyIndexedDB: legacyDb }), /synthetic IndexedDB quota failure/);
  assert.equal(db.data.books.get('real-idb').legacyV1, undefined);
  assert.equal(db.data.meta.has(LEGACY_V1_REPAIR_MARKER_ID), false);

  await store.repairLegacyV1Data({ legacyIndexedDB: legacyDb });
  assert.equal(db.data.books.get('real-idb').fingerprint, SHA_A_LOWER);
  assert.equal(db.data.meta.get(LEGACY_V1_REPAIR_MARKER_ID).counts.repaired, 1);
});
