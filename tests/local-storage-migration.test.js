const assert = require('node:assert/strict');
const { LocalStore, MemoryBackend, normalizeReaderProgress, DB_VERSION } = require('../src/storage/local-store.js');
const { createSecureKeyStore } = require('../src/storage/secure-key-store.js');

function fakeStorage(values) {
  return {
    values: new Map(Object.entries(values)),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    removeItem(key) { this.values.delete(key); }
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

assert.equal(DB_VERSION, 4);
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
  assert.equal(legacy.getItem('mySmartWordBook_aiConfig').includes('test-secret'), true, 'old cleartext config stays for explicit recovery when no Keystore exists');
  const second = await store.migrateLegacy({ legacyStorage: legacy, legacyIndexedDB: null });
  assert.equal(second.alreadyDone, true);

  const nativeSecure = createSecureKeyStore({ allowTestMemory: true, plugin: { async set({ value }) { this.value = value; }, async get() { return { value: this.value }; }, async remove() {} } });
  const legacy2 = fakeStorage({ mySmartWordBook_aiConfig: JSON.stringify({ apiKey: 'migrated-secret' }) });
  const store2 = new LocalStore({ backend: new MemoryBackend(), legacyStorage: legacy2, secureKeyStore: nativeSecure });
  const result2 = await store2.migrateLegacy({ legacyStorage: legacy2, legacyIndexedDB: null });
  assert.equal(result2.apiKeyNeedsMigration, false);
  assert.equal(await nativeSecure.get(), 'migrated-secret');
  assert.equal(legacy2.getItem('mySmartWordBook_aiConfig'), null);
  console.log('Local migration checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
