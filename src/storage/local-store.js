(function (root, factory) {
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecure || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangStorage = { ...(root.KangkangStorage || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, secure) {
    const DB_NAME = 'kangkang-local-db';
    const DB_VERSION = 5;
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
        if (oldVersion < 4) ensureStore(db, 'annotations', { keyPath: 'id' });
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
            this._readerSchemaMigrated = false;
            this._readerSchemaMigrating = false;
        }

        async open() {
            if (this.backend) {
                if (!this._readerSchemaMigrated && !this._readerSchemaMigrating) {
                    this._readerSchemaMigrating = true;
                    try { await this.migrateReaderSchema(); this._readerSchemaMigrated = true; }
                    finally { this._readerSchemaMigrating = false; }
                }
                return this;
            }
            if (this.db) return this;
            if (!this.indexedDB) {
                this.backend = new MemoryBackend();
                await this.migrateReaderSchema();
                this._readerSchemaMigrated = true;
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
            await this.migrateReaderSchema();
            this._readerSchemaMigrated = true;
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
            await this.put('state', { id: 'app', schemaVersion: DB_VERSION, data, updatedAt: new Date().toISOString() });
        }

        async migrateReaderSchema() {
            const marker = await this.get('meta', 'reader-schema-v3');
            if (marker?.completedAt) return { migrated: false, alreadyDone: true };
            const books = await this.getAll('books');
            for (const book of books) {
                const progress = normalizeReaderProgress(book.progress, book);
                const migrated = normalizeBookMetadata({ ...book, progress });
                if (JSON.stringify(progress) !== JSON.stringify(book.progress || {}) || metadataChanged(book, migrated)) {
                    await this.put('books', migrated);
                }
            }
            await this.put('meta', { id: 'reader-schema-v3', schemaVersion: DB_VERSION, completedAt: new Date().toISOString(), migratedBooks: books.length });
            return { migrated: true, alreadyDone: false, migratedBooks: books.length };
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

            const normalizedState = oldState && typeof oldState === 'object' ? { ...oldState, schemaVersion: DB_VERSION } : { schemaVersion: DB_VERSION };
            await this.writeState(normalizedState);
            if (oldReaderSettings && typeof oldReaderSettings === 'object') await this.put('meta', { id: 'reader-settings', data: oldReaderSettings });
            if (oldReaderProgress && typeof oldReaderProgress === 'object') await this.put('meta', { id: 'reader-progress', data: oldReaderProgress });
            if (oldDefinitionCache && typeof oldDefinitionCache === 'object') await this.put('meta', { id: 'definition-cache', data: oldDefinitionCache });
            for (const book of oldBooks) await this.put('books', normalizeLegacyBook(book, oldReaderProgress));

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

    function normalizeReaderProgress(progress, book = {}) {
        const source = progress && typeof progress === 'object' ? progress : {};
        if (Number(source.version) >= 2 && source.location) return { ...source, version: 2 };
        const type = String(book.type || 'text').toLowerCase();
        const isPdf = type === 'pdf';
        const percent = Math.max(0, Math.min(100, Number(source.percent) || 0));
        const pageCount = Math.max(1, Number(source.pageCount) || 1);
        const pageIndex = Math.max(0, Number(source.pageIndex) || 0);
        const pdfPage = Math.max(1, Number(source.pdfPage) || pageIndex + 1);
        const fraction = percent / 100;
        return {
            ...source,
            version: 2,
            chapterIndex: Math.max(0, Number(source.chapterIndex) || 0),
            pageIndex,
            pageCount,
            pdfPage,
            location: isPdf
                ? { format: 'pdf', page: pdfPage, progression: fraction }
                : { format: type === 'epub' ? 'epub' : 'text', href: String(source.href || ''), fragment: String(source.fragment || ''), chapterProgression: pageIndex / pageCount, progression: fraction },
            percent,
            updatedAt: source.updatedAt || null
        };
    }

    function normalizeLegacyBook(book, legacyReaderProgress = null) {
        const rawProgress = book.progress || { flow: 'scroll', pageIndex: 0, percent: 0, updatedAt: null };
        const legacyKey = `id:${book.id}`;
        const progressOverride = legacyReaderProgress?.books?.[legacyKey] || legacyReaderProgress?.[legacyKey];
        return normalizeBookMetadata({
            id: String(book.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
            title: String(book.title || book.fileName || '未命名书籍'),
            author: String(book.author || ''),
            type: String(book.type || 'text'),
            format: String(book.format || book.type || 'text').toUpperCase(),
            fileName: String(book.fileName || ''),
            text: String(book.text || ''),
            mime: String(book.mime || ''),
            size: Number(book.size) || 0,
            fingerprint: String(book.fingerprint || ''),
            coverDataUrl: String(book.coverDataUrl || ''),
            blob: null,
            progress: normalizeReaderProgress({ ...rawProgress, ...(progressOverride || {}) }, book),
            notes: Array.isArray(book.notes) ? book.notes : [],
            bookmarks: Array.isArray(book.bookmarks) ? book.bookmarks : [],
            createdAt: Number(book.createdAt) || Date.now(),
            updatedAt: Number(book.updatedAt) || Date.now(),
            lastReadAt: book.lastReadAt || null
        });
    }

    function normalizeBookMetadata(book = {}) {
        const type = ['epub', 'pdf', 'html', 'text'].includes(String(book.type || '').toLowerCase()) ? String(book.type || '').toLowerCase() : 'text';
        const now = Date.now();
        const updatedAt = Number(book.updatedAt) || now;
        const rawProgress = book.progress && typeof book.progress === 'object' ? book.progress : {};
        return {
            ...book,
            id: String(book.id || `book-legacy-${updatedAt}`),
            title: String(book.title || book.fileName || '未命名书籍').replace(/\.(?:epub|pdf|txt|md|html?|mht)$/i, '') || '未命名书籍',
            author: String(book.author || ''),
            type,
            format: String(book.format || (type === 'text' ? 'TXT' : type.toUpperCase())),
            fileName: String(book.fileName || ''),
            mime: String(book.mime || ''),
            size: Number(book.size) || 0,
            fingerprint: String(book.fingerprint || ''),
            coverDataUrl: String(book.coverDataUrl || ''),
            progress: normalizeReaderProgress(rawProgress, { ...book, type }),
            notes: Array.isArray(book.notes) ? book.notes : [],
            bookmarks: Array.isArray(book.bookmarks) ? book.bookmarks : [],
            createdAt: Number(book.createdAt) || updatedAt,
            updatedAt,
            lastReadAt: book.lastReadAt || rawProgress.updatedAt || null
        };
    }

    function metadataChanged(previous = {}, next = {}) {
        return ['title', 'author', 'type', 'format', 'fileName', 'mime', 'size', 'fingerprint', 'coverDataUrl', 'lastReadAt'].some(key => String(previous[key] ?? '') !== String(next[key] ?? ''));
    }

    return { DB_NAME, DB_VERSION, STORES, LocalStore, MemoryBackend, upgradeDatabase, normalizeLegacyBook, normalizeReaderProgress, normalizeBookMetadata };
});
