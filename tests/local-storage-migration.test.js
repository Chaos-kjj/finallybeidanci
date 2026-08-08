const assert = require('node:assert/strict');
const {
  LocalStore,
  MemoryBackend,
  normalizeReaderProgress,
  DB_VERSION,
  LEGACY_V1_REPAIR_MARKER_ID
} = require('../src/storage/local-store.js');
const { createSecureKeyStore } = require('../src/storage/secure-key-store.js');

function fakeStorage(values) {
  return {
    values: new Map(Object.entries(values)),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    removeItem(key) { this.values.delete(key); }
  };
}

function fakeLegacyIndexedDb(books) {
  const state = { openCalls: 0, closeCalls: 0 };
  return {
    state,
    async databases() { return [{ name: 'kangkangWordPwa_readerDb', version: 1 }]; },
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
                  queueMicrotask(() => transaction.oncomplete?.());
                });
                return getRequest;
              }
            });
            return transaction;
          },
          close() { state.closeCalls += 1; }
        };
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    }
  };
}

const legacy = fakeStorage({
  kangkangWordPwa_state_v1: JSON.stringify({ allWords: [{ word: 'alpha', status: 'known' }], knownWords: ['alpha'], reviewWords: [] }),
  mySmartWordBook_aiConfig: JSON.stringify({ url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat', apiKey: 'test-secret' }),
  kangkangWordPwa_definitionCache_v1: JSON.stringify({ alpha: { definition: 'local' } }),
  kangkangWordPwa_readerSettings_v1: JSON.stringify({ fontSize: 24 }),
  kangkangWordPwa_readerProgress_v1: JSON.stringify({ version: 1, books: { 'id:book-1': { percent: 42 } } })
});
const secureKeyStore = createSecureKeyStore({ allowTestMemory: true });
const store = new LocalStore({ backend: new MemoryBackend(), legacyStorage: legacy, secureKeyStore });

assert.equal(DB_VERSION, 6);
const migratedProgress = normalizeReaderProgress({ pageIndex: 4, pageCount: 10, percent: 40 }, { type: 'epub' });
assert.equal(migratedProgress.version, 2);
assert.equal(migratedProgress.location.format, 'epub');
assert.equal(migratedProgress.location.chapterProgression, 0.4);

(async () => {
  const result = await store.migrateLegacy({ legacyStorage: legacy, legacyIndexedDB: null });
  assert.equal(result.migrated, true);
  assert.equal(result.apiKeyNeedsMigration, true, 'non-native tests must not pretend to migrate a Key');
  assert.deepEqual((await store.readState()).allWords[0].word, 'alpha');
  assert.deepEqual((await store.get('meta', 'reader-settings')).data.fontSize, 24);
  assert((await store.get('meta', 'legacy-snapshot-v1')).snapshot.oldAiConfig.apiKey === '[redacted]');
  assert.equal(legacy.getItem('mySmartWordBook_aiConfig'), null, '旧明文 API Key 不得继续留在网页存储');
  assert.equal((await store.get('meta', 'ai-config')).data.apiKey, undefined, '迁移后的 AI 配置不得包含 API Key');
  const second = await store.migrateLegacy({ legacyStorage: legacy, legacyIndexedDB: null });
  assert.equal(second.alreadyDone, true);

  const nativeSecure = createSecureKeyStore({ allowTestMemory: true, plugin: { async set({ value }) { this.value = value; }, async get() { return { value: this.value }; }, async remove() {} } });
  const legacy2 = fakeStorage({ mySmartWordBook_aiConfig: JSON.stringify({ apiKey: 'migrated-secret' }) });
  const store2 = new LocalStore({ backend: new MemoryBackend(), legacyStorage: legacy2, secureKeyStore: nativeSecure });
  const result2 = await store2.migrateLegacy({ legacyStorage: legacy2, legacyIndexedDB: null });
  assert.equal(result2.apiKeyNeedsMigration, false);
  assert.equal(await nativeSecure.get(), 'migrated-secret');
  assert.equal(legacy2.getItem('mySmartWordBook_aiConfig'), null);

  const digest = 'A'.repeat(64);
  const rawOccurrences = ['0:1', ' 0:1 ', 'broken', '0:1'];
  const legacyIndexedDB = fakeLegacyIndexedDb([{
    id: 'historical-book-id',
    title: '历史书籍',
    fileHash: digest,
    bookKey: `hash:${digest.toLowerCase()}`,
    highlightedOccurrences: rawOccurrences,
    progress: { percent: 37 },
    notes: [{ id: 'note-1', content: 'keep' }],
    bookmarks: [{ id: 'bookmark-1' }],
    createdAt: 100,
    updatedAt: 200
  }]);
  const freshStore = new LocalStore({ backend: new MemoryBackend(), legacyStorage: fakeStorage({}), secureKeyStore });
  const fresh = await freshStore.migrateLegacy({ legacyStorage: fakeStorage({}), legacyIndexedDB });
  assert.equal(fresh.migrated, true);
  const migratedBook = await freshStore.get('books', 'historical-book-id');
  assert.equal(migratedBook.id, 'historical-book-id', 'fresh migration must preserve the historical book ID');
  assert.equal(migratedBook.fingerprint, digest.toLowerCase());
  assert.deepEqual(migratedBook.highlightedOccurrences, rawOccurrences, 'fresh migration must preserve raw occurrence order, whitespace, duplicates and malformed strings');
  assert.equal(migratedBook.legacyV1.bookKey, `hash:${digest.toLowerCase()}`);
  assert.equal(migratedBook.legacyV1.fileHash, digest);
  assert.equal(migratedBook.legacyV1.identityKind, 'trusted-sha');
  assert.deepEqual(migratedBook.notes, [{ id: 'note-1', content: 'keep' }]);
  assert.deepEqual(migratedBook.bookmarks, [{ id: 'bookmark-1' }]);
  assert.equal(migratedBook.progress.percent, 37);
  assert((await freshStore.get('meta', LEGACY_V1_REPAIR_MARKER_ID))?.completedAt, 'fresh preservation must atomically write the narrowly scoped F1A marker');
  assert.equal(legacyIndexedDB.state.openCalls, 1);
  assert.equal(legacyIndexedDB.state.closeCalls, 1, 'legacy DB must close only after its readonly transaction completes');
  console.log('Local migration checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
