(function (root, factory) {
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecure || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangStorage = { ...(root.KangkangStorage || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, secure) {
    const DB_NAME = 'kangkang-local-db';
    const DB_VERSION = 3;
    const STORES = ['meta', 'state', 'books', 'annotations', 'dictionaries', 'dictionaryEntries', 'files', 'aiCache'];

    function ensureStore(db, name, options) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options);
    }

    function upgradeDatabase(db, oldVersion) {
        if (oldVersion < 1) {
            ensureStore(db, 'meta', { keyPath: 'id' });
            ensureStore(db, 'state', { keyPath: 'id' });
            ensureStore(db, 'books', { keyPath: 'id' });
            ensureStore(db, 'annotations', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
            ensureStore(db, 'dictionaries', { keyPath: 'id' });
            ensureStore(db, 'dictionaryEntries', { keyPath: 'id' });
            ensureStore(db, 'files', { keyPath: 'id' });
        }
        if (oldVersion < 3) ensureStore(db, 'aiCache', { keyPath: 'key' });
    }

    class MemoryBackend {
        constructor() { this.data = new Map(STORES.map(name => [name, new Map()])); }
        async get(store, key) { return this.data.get(store)?.get(key) || null; }
        async put(store, value) {
            const key = value?.id ?? value?.key;
            if (key === undefined) throw new Error(`Missing key for ${store}`);
            this.data.get(store).set(key, structuredCloneSafe(value));
            return value;
        }
        async delete(store, key) { this.data.get(store).delete(key); }
        async getAll(store) { return Array.from(this.data.get(store).values()).map(structuredCloneSafe); }
        async clear(store) { this.data.get(store).clear(); }
        async transaction(storeNames, callback) { return callback(this); }
    }

    class LocalStore {
        constructor({ indexedDBRef = globalThis.indexedDB, legacyStorage = globalThis.localStorage, secureKeyStore = null, backend = null } = {}) {
            this.indexedDB = indexedDBRef;
            this.legacyStorage = legacyStorage;
            this.secureKeyStore = secureKeyStore || secure.createSecureKeyStore?.() || null;
            this.backend = backend;
            this.db = null;
        }

        async open() {
            if (this.backend || this.db) return this;
            if (!this.indexedDB) {
                this.backend = new MemoryBackend();
                return this;
            }
            this.db = await new Promise((resolve, reject) => {
                const request = this.indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = event => upgradeDatabase(request.result, event.oldVersion);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error || new Error('本地数据库打开失败'));
                request.onblocked = () => reject(new Error('本地数据库被旧版本页面占用'));
            });
            this.db.onversionchange = () => this.db.close();
            return this;
        }

        async get(store, key) {
            await this.open();
            if (this.backend) return this.backend.get(store, key);
            return requestResult(this.db.transaction(store, 'readonly').objectStore(store).get(key));
        }

        async put(store, value) {
            await this.open();
            if (this.backend) return this.backend.put(store, value);
            return requestResult(this.db.transaction(store, 'readwrite').objectStore(store).put(value));
        }

        async delete(store, key) {
            await this.open();
            if (this.backend) return this.backend.delete(store, key);
            return requestResult(this.db.transaction(store, 'readwrite').objectStore(store).delete(key));
        }

        async getAll(store) {
            await this.open();
            if (this.backend) return this.backend.getAll(store);
            return requestResult(this.db.transaction(store, 'readonly').objectStore(store).getAll());
        }

        async clear(store) {
            await this.open();
            if (this.backend) return this.backend.clear(store);
            return requestResult(this.db.transaction(store, 'readwrite').objectStore(store).clear());
        }

        async transaction(storeNames, callback) {
            await this.open();
            if (this.backend) return this.backend.transaction(storeNames, callback);
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(storeNames, 'readwrite');
                const stores = Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)]));
                let result;
                Promise.resolve(callback(stores, tx)).then(value => {
                    result = value;
                }).catch(error => {
                    try { tx.abort(); } catch (_) { /* noop */ }
                    reject(error);
                });
                tx.oncomplete = () => resolve(result);
                tx.onerror = () => reject(tx.error || new Error('本地数据库事务失败'));
                tx.onabort = () => reject(tx.error || new Error('本地数据库事务已回滚'));
            });
        }

        async readState() {
            return (await this.get('state', 'app'))?.data || null;
        }

        async writeState(data) {
            await this.put('state', { id: 'app', schemaVersion: 3, data, updatedAt: new Date().toISOString() });
        }

        async migrateLegacy({ legacyStorage = this.legacyStorage, legacyIndexedDB = globalThis.indexedDB } = {}) {
            await this.open();
            const marker = await this.get('meta', 'legacy-migration-v1');
            if (marker?.completedAt) return { migrated: false, alreadyDone: true, apiKeyNeedsMigration: false };

            const oldState = parseStorage(legacyStorage, 'kangkangWordPwa_state_v1');
            const oldAiConfig = parseStorage(legacyStorage, 'mySmartWordBook_aiConfig');
            const oldDefinitionCache = parseStorage(legacyStorage, 'kangkangWordPwa_definitionCache_v1');
            const oldReaderSettings = parseStorage(legacyStorage, 'kangkangWordPwa_readerSettings_v1');
            const oldReaderProgress = parseStorage(legacyStorage, 'kangkangWordPwa_readerProgress_v1');
            const oldBooks = await readLegacyBooks(legacyIndexedDB);
            const apiKey = String(oldAiConfig?.apiKey || '');
            let apiKeyNeedsMigration = false;
            if (apiKey && !this.secureKeyStore?.isNative) apiKeyNeedsMigration = true;

            const snapshot = { oldState, oldAiConfig: { ...oldAiConfig, apiKey: apiKey ? '[redacted]' : '' }, oldDefinitionCache, oldReaderSettings, oldReaderProgress, oldBooks: oldBooks.map(book => ({ id: book.id, title: book.title, type: book.type })) };
            await this.put('meta', { id: 'legacy-snapshot-v1', schemaVersion: 1, createdAt: new Date().toISOString(), snapshot });

            const normalizedState = oldState && typeof oldState === 'object' ? { ...oldState, schemaVersion: 3 } : { schemaVersion: 3 };
            await this.writeState(normalizedState);
            if (oldReaderSettings && typeof oldReaderSettings === 'object') await this.put('meta', { id: 'reader-settings', data: oldReaderSettings });
            if (oldReaderProgress && typeof oldReaderProgress === 'object') await this.put('meta', { id: 'reader-progress', data: oldReaderProgress });
            if (oldDefinitionCache && typeof oldDefinitionCache === 'object') await this.put('meta', { id: 'definition-cache', data: oldDefinitionCache });
            for (const book of oldBooks) await this.put('books', normalizeLegacyBook(book));

            if (apiKey && !apiKeyNeedsMigration) {
                try {
                    await this.secureKeyStore.set(apiKey);
                    if (legacyStorage?.removeItem) legacyStorage.removeItem('mySmartWordBook_aiConfig');
                } catch (_) {
                    apiKeyNeedsMigration = true;
                }
            }
            await this.put('meta', { id: 'legacy-migration-v1', schemaVersion: 1, completedAt: new Date().toISOString(), sourceKeys: ['kangkangWordPwa_state_v1', 'mySmartWordBook_aiConfig', 'kangkangWordPwa_definitionCache_v1', 'kangkangWordPwa_readerSettings_v1', 'kangkangWordPwa_readerProgress_v1', 'kangkangWordPwa_readerDb/books'], apiKeyNeedsMigration });
            return { migrated: true, alreadyDone: false, apiKeyNeedsMigration };
        }
    }

    function requestResult(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('数据库请求失败'));
        });
    }

    function structuredCloneSafe(value) {
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function parseStorage(storage, key) {
        try {
            const raw = storage?.getItem?.(key);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }

    function readLegacyBooks(indexedDBRef) {
        if (!indexedDBRef) return Promise.resolve([]);
        return new Promise(resolve => {
            let request;
            try { request = indexedDBRef.open('kangkangWordPwa_readerDb'); } catch (_) { resolve([]); return; }
            request.onerror = () => resolve([]);
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('books')) { db.close(); resolve([]); return; }
                const get = db.transaction('books', 'readonly').objectStore('books').getAll();
                get.onsuccess = () => { const books = get.result || []; db.close(); resolve(books); };
                get.onerror = () => { db.close(); resolve([]); };
            };
        });
    }

    function normalizeLegacyBook(book) {
        return {
            id: String(book.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
            title: String(book.title || book.fileName || '未命名书籍'),
            type: String(book.type || 'text'),
            fileName: String(book.fileName || ''),
            text: String(book.text || ''),
            blob: null,
            progress: book.progress || { flow: 'scroll', pageIndex: 0, percent: 0, updatedAt: null },
            notes: Array.isArray(book.notes) ? book.notes : [],
            bookmarks: Array.isArray(book.bookmarks) ? book.bookmarks : [],
            createdAt: Number(book.createdAt) || Date.now(),
            updatedAt: Number(book.updatedAt) || Date.now()
        };
    }

    return { DB_NAME, DB_VERSION, STORES, LocalStore, MemoryBackend, upgradeDatabase, normalizeLegacyBook };
});
