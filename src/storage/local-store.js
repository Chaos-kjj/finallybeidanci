(function (root, factory) {
    const compatibility = typeof module === 'object' && module.exports
        ? require('../core/legacy-v1-compatibility.js')
        : root?.KangkangLegacyV1 || {};
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecure || {}, compatibility);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangStorage = { ...(root.KangkangStorage || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, secure, legacyV1) {
    const DB_NAME = 'kangkang-local-db';
    const LEGACY_READER_DB_NAME = 'kangkangWordPwa_readerDb';
    const LEGACY_V1_REPAIR_MARKER_ID = 'legacy-v1-f1-data-preservation-v1';
    // Never lower this number. Android upgrades can leave an IndexedDB v5
    // database behind even when the WebView is loading an older web bundle.
    // Opening with a lower requested version throws VersionError before any
    // application code can run, so every shipped bundle must move forward.
    const DB_VERSION = 6;
    const STORES = ['meta', 'state', 'books', 'annotations', 'dictionaries', 'dictionaryEntries', 'files', 'aiCache'];

    function ensureStore(db, name, options) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options);
    }

    function upgradeDatabase(db, oldVersion, transaction = null) {
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
        // Keep the migrations explicit. v5 is the first schema used by the
        // Android refactor; v6 adds the durable metadata contract used by
        // backup/restore and per-book reader settings. The functions are
        // intentionally synchronous because IndexedDB upgrade transactions
        // must not await promises.
        if (oldVersion < 5) migrateV4ToV5(db, transaction);
        if (oldVersion < 6) migrateV5ToV6(db, transaction);
    }

    function migrateV4ToV5(db) {
        // Older v4 databases may have been created by a partially completed
        // migration. Re-ensure every store rather than assuming the version
        // number tells the whole story. Existing records are left untouched.
        ensureStore(db, 'meta', { keyPath: 'id' });
        ensureStore(db, 'state', { keyPath: 'id' });
        ensureStore(db, 'books', { keyPath: 'id' });
        ensureStore(db, 'annotations', { keyPath: 'id' });
        ensureStore(db, 'dictionaries', { keyPath: 'id' });
        ensureStore(db, 'dictionaryEntries', { keyPath: 'id' });
        ensureStore(db, 'files', { keyPath: 'id' });
        ensureStore(db, 'aiCache', { keyPath: 'key' });
    }

    function migrateV5ToV6(db) {
        // v6 does not delete or rewrite user records. It only guarantees the
        // stores required by the v2 backup contract and font persistence.
        ensureStore(db, 'meta', { keyPath: 'id' });
        ensureStore(db, 'state', { keyPath: 'id' });
        ensureStore(db, 'books', { keyPath: 'id' });
        ensureStore(db, 'annotations', { keyPath: 'id' });
        ensureStore(db, 'dictionaries', { keyPath: 'id' });
        ensureStore(db, 'dictionaryEntries', { keyPath: 'id' });
        ensureStore(db, 'files', { keyPath: 'id' });
        ensureStore(db, 'aiCache', { keyPath: 'key' });
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
        async transaction(storeNames, callback) {
            const names = [...storeNames];
            const snapshot = new Map(names.map(name => [name, new Map(Array.from(this.data.get(name)?.entries() || []).map(([key, value]) => [key, structuredCloneSafe(value)]))]));
            let aborted = false;
            const tx = { abort: () => { aborted = true; } };
            const stores = Object.fromEntries(names.map(name => [name, {
                clear: () => this.data.get(name).clear(),
                put: value => {
                    const key = value?.id ?? value?.key;
                    if (key === undefined) throw new Error(`Missing key for ${name}`);
                    this.data.get(name).set(key, structuredCloneSafe(value));
                },
                delete: key => this.data.get(name).delete(key),
                get: key => this.data.get(name).get(key) || null
            }]));
            try {
                const result = await callback(stores, tx);
                if (aborted) throw new Error('本地数据库事务已回滚');
                return result;
            } catch (error) {
                names.forEach(name => this.data.set(name, new Map(Array.from(snapshot.get(name).entries()).map(([key, value]) => [key, structuredCloneSafe(value)]))));
                throw error;
            }
        }
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
            this.openFailure = null;
        }

        async open() {
            if (this.backend) {
                if (!this._readerSchemaMigrated && !this._readerSchemaMigrating) {
                    this._readerSchemaMigrating = true;
                    try { await this.migrateReaderSchema(); this._readerSchemaMigrated = true; }
                    catch (error) {
                        this.openFailure = classifyOpenFailure(error);
                        const wrapped = new Error(this.openFailure.message); wrapped.name = this.openFailure.code; wrapped.code = this.openFailure.code; wrapped.cause = error; throw wrapped;
                    } finally { this._readerSchemaMigrating = false; }
                }
                return this;
            }
            if (this.db) return this;
            if (!this.indexedDB) {
                this.backend = new MemoryBackend();
                try { await this.migrateReaderSchema(); this._readerSchemaMigrated = true; return this; }
                catch (error) { this.openFailure = classifyOpenFailure(error); const wrapped = new Error(this.openFailure.message); wrapped.name = this.openFailure.code; wrapped.code = this.openFailure.code; wrapped.cause = error; throw wrapped; }
            }
            try {
                this.db = await new Promise((resolve, reject) => {
                    const request = this.indexedDB.open(DB_NAME, DB_VERSION);
                    request.onupgradeneeded = event => upgradeDatabase(request.result, event.oldVersion, request.transaction);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error || new Error('本地数据库打开失败'));
                    request.onblocked = () => reject(new Error('本地数据库被旧版本页面占用'));
                });
                this.db.onversionchange = () => this.db.close();
                await this.migrateReaderSchema();
                this._readerSchemaMigrated = true;
                this.openFailure = null;
                return this;
            } catch (error) {
                this.db = null;
                this.openFailure = classifyOpenFailure(error);
                const wrapped = new Error(this.openFailure.message);
                wrapped.name = this.openFailure.code;
                wrapped.code = this.openFailure.code;
                wrapped.cause = error;
                throw wrapped;
            }
        }

        getRecoveryInfo() { return this.openFailure ? { ...this.openFailure, dbName: DB_NAME, requestedVersion: DB_VERSION } : null; }

        async applyBackupDataset(dataset, { mode = 'overwrite' } = {}) {
            const normalizedMode = mode === 'merge' ? 'merge' : 'overwrite';
            const stores = ['meta', 'state', 'books', 'annotations', 'dictionaries', 'dictionaryEntries', 'files', 'aiCache'];
            return this.transaction(stores, target => {
                if (normalizedMode === 'overwrite') {
                    ['state', 'books', 'annotations', 'dictionaries', 'dictionaryEntries', 'files', 'aiCache'].forEach(name => target[name].clear());
                    // Keep the Keystore-backed AI configuration and migration markers,
                    // but remove metadata that cannot be represented by a backup.
                    ['dictionary-settings', 'reader-progress', 'reader-settings', 'definition-cache'].forEach(key => target.meta.delete(key));
                }
                if (dataset?.state) target.state.put({ id: 'app', schemaVersion: DB_VERSION, data: dataset.state, updatedAt: new Date().toISOString() });
                if (dataset?.settings) target.meta.put({ id: 'settings', data: dataset.settings, updatedAt: new Date().toISOString() });
                if (dataset?.actions) target.meta.put({ id: 'ai-actions', data: dataset.actions, updatedAt: new Date().toISOString() });
                for (const book of dataset?.books || []) target.books.put(book);
                for (const dictionary of dataset?.dictionaries || []) target.dictionaries.put(dictionary);
                for (const entry of dataset?.dictionaryEntries || []) target.dictionaryEntries.put(entry);
                for (const file of dataset?.files || []) target.files.put(file);
                return { mode: normalizedMode, books: (dataset?.books || []).length, dictionaries: (dataset?.dictionaries || []).length };
            });
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
                try {
                    const callbackResult = callback(stores, tx);
                    if (callbackResult && typeof callbackResult.then === 'function') {
                        try { tx.abort(); } catch (_) { /* noop */ }
                        reject(new Error('IndexedDB 事务 callback 必须同步提交；请勿在事务内部 await。'));
                        return;
                    }
                    result = callbackResult;
                } catch (error) {
                    try { tx.abort(); } catch (_) { /* noop */ }
                    reject(error);
                    return;
                }
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
            const marker = await this.get('meta', 'reader-schema-v2');
            if (marker?.completedAt) return { migrated: false, alreadyDone: true };
            const books = await this.getAll('books');
            const migrated = books.map(book => ({ book, progress: normalizeReaderProgress(book.progress, book) })).filter(item => JSON.stringify(item.progress) !== JSON.stringify(item.book.progress || {}));
            await this.transaction(['meta', 'books'], targets => {
                migrated.forEach(({ book, progress }) => targets.books.put({ ...book, progress, updatedAt: Number(book.updatedAt) || Date.now() }));
                targets.meta.put({ id: 'reader-schema-v2', schemaVersion: DB_VERSION, completedAt: new Date().toISOString(), migratedBooks: books.length });
            });
            return { migrated: true, alreadyDone: false, migratedBooks: books.length };
        }

        async migrateLegacy({ legacyStorage = this.legacyStorage, legacyIndexedDB = globalThis.indexedDB } = {}) {
            await this.open();
            const marker = await this.get('meta', 'legacy-migration-v1');
            if (marker?.completedAt) {
                const repair = await this.repairLegacyV1Data({ legacyIndexedDB });
                return { migrated: false, alreadyDone: true, apiKeyNeedsMigration: false, repair };
            }

            const oldState = parseStorage(legacyStorage, 'kangkangWordPwa_state_v1');
            const oldAiConfig = parseStorage(legacyStorage, 'mySmartWordBook_aiConfig');
            const oldDefinitionCache = parseStorage(legacyStorage, 'kangkangWordPwa_definitionCache_v1');
            const oldReaderSettings = parseStorage(legacyStorage, 'kangkangWordPwa_readerSettings_v1');
            const oldReaderProgress = parseStorage(legacyStorage, 'kangkangWordPwa_readerProgress_v1');
            const legacySource = await readLegacyBooksIfExists(legacyIndexedDB);
            const oldBooks = legacySource.books;
            const preparedBooks = oldBooks.map(book => legacyV1.prepareLegacyV1Book(book));
            const apiKey = String(oldAiConfig?.apiKey || '');
            let apiKeyNeedsMigration = false;
            if (apiKey && !this.secureKeyStore?.isNative) apiKeyNeedsMigration = true;

            const migratedAt = new Date().toISOString();
            const snapshot = { oldState, oldAiConfig: { ...oldAiConfig, apiKey: apiKey ? '[redacted]' : '' }, oldDefinitionCache, oldReaderSettings, oldReaderProgress, oldBooks: oldBooks.map(book => ({ id: book.id, title: book.title, type: book.type })) };
            const normalizedState = oldState && typeof oldState === 'object' ? { ...oldState, schemaVersion: DB_VERSION } : { schemaVersion: DB_VERSION };
            const safeAiConfig = oldAiConfig && typeof oldAiConfig === 'object' ? { ...oldAiConfig } : null;
            if (safeAiConfig) delete safeAiConfig.apiKey;
            const migratedBooks = oldBooks.map((book, index) => normalizeLegacyBook(book, oldReaderProgress, preparedBooks[index]));
            const freshRepairMarker = legacySource.exists ? buildLegacyV1RepairMarker({
                processedIds: preparedBooks.map(item => item.id).filter(Boolean),
                repairedIds: migratedBooks.map(book => book.id),
                skipped: preparedBooks.filter(item => !item.id).map(() => ({ id: '', reason: 'invalid-legacy-id' })),
                conflictIds: preparedBooks.filter(hasPreparedIdentityConflict).map(item => item.id).filter(Boolean),
                completedAt: migratedAt
            }) : null;

            // IndexedDB transactions must not await between requests. Keep
            // the complete legacy snapshot, state, metadata and book rows in
            // one synchronous transaction so a quota/write failure cannot
            // leave a half-migrated database behind.
            await this.transaction(['meta', 'state', 'books'], targets => {
                targets.meta.put({ id: 'legacy-snapshot-v1', schemaVersion: 1, createdAt: migratedAt, snapshot });
                targets.state.put({ id: 'app', schemaVersion: DB_VERSION, data: normalizedState, updatedAt: migratedAt });
                if (oldReaderSettings && typeof oldReaderSettings === 'object') targets.meta.put({ id: 'reader-settings', data: oldReaderSettings, updatedAt: migratedAt });
                if (oldReaderProgress && typeof oldReaderProgress === 'object') targets.meta.put({ id: 'reader-progress', data: oldReaderProgress, updatedAt: migratedAt });
                if (oldDefinitionCache && typeof oldDefinitionCache === 'object') targets.meta.put({ id: 'definition-cache', data: oldDefinitionCache, updatedAt: migratedAt });
                if (safeAiConfig) targets.meta.put({ id: 'ai-config', data: safeAiConfig, updatedAt: migratedAt });
                migratedBooks.forEach(book => targets.books.put(book));
                if (freshRepairMarker) targets.meta.put(freshRepairMarker);
            });

            if (apiKey && !apiKeyNeedsMigration) {
                try {
                    await this.secureKeyStore.set(apiKey);
                    if (legacyStorage?.removeItem) legacyStorage.removeItem('mySmartWordBook_aiConfig');
                } catch (_) {
                    apiKeyNeedsMigration = true;
                }
            }
            if (apiKey && apiKeyNeedsMigration) {
                // A browser cannot safely take ownership of a legacy cleartext
                // Key. Keep only the redacted migration snapshot and require a
                // fresh entry in an APK-backed Keystore.
                legacyStorage?.removeItem?.('mySmartWordBook_aiConfig');
            }
            await this.put('meta', { id: 'legacy-migration-v1', schemaVersion: 1, completedAt: new Date().toISOString(), sourceKeys: ['kangkangWordPwa_state_v1', 'mySmartWordBook_aiConfig', 'kangkangWordPwa_definitionCache_v1', 'kangkangWordPwa_readerSettings_v1', 'kangkangWordPwa_readerProgress_v1', 'kangkangWordPwa_readerDb/books'], apiKeyNeedsMigration });
            return { migrated: true, alreadyDone: false, apiKeyNeedsMigration };
        }

        async repairLegacyV1Data({ legacyIndexedDB = globalThis.indexedDB } = {}) {
            await this.open();
            const marker = await this.get('meta', LEGACY_V1_REPAIR_MARKER_ID);
            if (marker?.completedAt) {
                return { repaired: false, alreadyDone: true, legacyDatabaseMissing: false, marker };
            }

            // Phase 1 is entirely outside DB6: probe without creating, read in
            // one readonly transaction, clone, wait for completion, and close.
            const legacySource = await readLegacyBooksIfExists(legacyIndexedDB);
            if (!legacySource.exists) {
                return { repaired: false, alreadyDone: false, legacyDatabaseMissing: true };
            }
            const preparedBooks = legacySource.books.map(book => legacyV1.prepareLegacyV1Book(book));

            // Phase 2 owns one independent DB6 transaction. The real
            // IndexedDB path is request/event driven so it never awaits while
            // the transaction is active.
            const repair = this.backend
                ? await commitMemoryLegacyV1Repair(this, preparedBooks)
                : await commitIndexedDbLegacyV1Repair(this.db, preparedBooks);
            return { repaired: true, alreadyDone: false, legacyDatabaseMissing: false, ...repair };
        }
    }

    function requestResult(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('数据库请求失败'));
        });
    }

    function classifyOpenFailure(error) {
        const name = String(error?.name || '');
        if (name === 'VersionError' || /requested version/i.test(String(error?.message || ''))) {
            return {
                code: 'HIGHER_SCHEMA_VERSION',
                message: '本机数据库来自更新版本，当前应用不会覆盖或降级它。请升级应用后重试；原有学习数据仍保留。',
                recoverable: false,
                causeName: name
            };
        }
        return {
            code: 'MIGRATION_FAILED',
            message: '本机数据迁移未完成，原有数据未主动删除。请重启应用；若仍失败，请先导出系统应用数据后联系支持。',
            recoverable: false,
            causeName: name
        };
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

    async function readLegacyBooksIfExists(indexedDBRef) {
        if (!indexedDBRef) return { exists: false, books: [] };
        if (typeof indexedDBRef.databases === 'function') {
            try {
                const databases = await indexedDBRef.databases();
                if (Array.isArray(databases) && !databases.some(item => item?.name === LEGACY_READER_DB_NAME)) {
                    return { exists: false, books: [] };
                }
            } catch (_) {
                // Older WebViews may expose but not implement databases().
                // The abort-on-upgrade probe below remains non-creating.
            }
        }

        const db = await openExistingLegacyDatabase(indexedDBRef);
        if (!db) return { exists: false, books: [] };
        if (!db.objectStoreNames.contains('books')) {
            db.close();
            return { exists: true, books: [] };
        }

        return new Promise((resolve, reject) => {
            let transaction;
            let books = [];
            let requestError = null;
            let closed = false;
            const close = () => {
                if (closed) return;
                closed = true;
                db.close();
            };
            try {
                transaction = db.transaction('books', 'readonly');
                const request = transaction.objectStore('books').getAll();
                request.onsuccess = () => {
                    try { books = structuredCloneSafe(request.result || []); }
                    catch (error) { requestError = error; try { transaction.abort(); } catch (_) { /* noop */ } }
                };
                request.onerror = () => { requestError = request.error || new Error('旧版书籍读取失败'); };
                transaction.oncomplete = () => { close(); resolve({ exists: true, books }); };
                transaction.onerror = () => { requestError ||= transaction.error || new Error('旧版书籍读取事务失败'); };
                transaction.onabort = () => { close(); reject(requestError || transaction.error || new Error('旧版书籍读取事务已回滚')); };
            } catch (error) {
                close();
                reject(error);
            }
        });
    }

    function openExistingLegacyDatabase(indexedDBRef) {
        return new Promise((resolve, reject) => {
            let request;
            let missing = false;
            let settled = false;
            const finish = (error, db = null) => {
                if (settled) return;
                settled = true;
                if (error) reject(error);
                else resolve(db);
            };
            try { request = indexedDBRef.open(LEGACY_READER_DB_NAME); }
            catch (error) { finish(error); return; }
            request.onupgradeneeded = () => {
                missing = true;
                try { request.transaction?.abort(); }
                catch (error) { finish(error); }
            };
            request.onsuccess = () => {
                if (missing) {
                    request.result?.close?.();
                    finish(null, null);
                    return;
                }
                finish(null, request.result);
            };
            request.onerror = () => {
                if (missing || request.error?.name === 'AbortError') finish(null, null);
                else finish(request.error || new Error('旧版数据库探测失败'));
            };
            request.onblocked = () => finish(new Error('旧版数据库被其他页面占用'));
        });
    }

    function hasPreparedIdentityConflict(prepared) {
        return prepared?.legacyV1?.identityKind === 'conflict'
            || (prepared?.legacyV1?.conflicts?.identities || []).length > 0;
    }

    function createRepairDiagnostics() {
        return { processedIds: [], repairedIds: [], skipped: [], conflictIds: [] };
    }

    function addUniqueId(target, id) {
        if (id && !target.includes(id)) target.push(id);
    }

    function processRepairCandidate(currentBook, prepared, diagnostics, putBook) {
        if (!prepared.id) {
            diagnostics.skipped.push({ id: '', reason: 'invalid-legacy-id' });
            return;
        }
        addUniqueId(diagnostics.processedIds, prepared.id);
        if (!currentBook) {
            diagnostics.skipped.push({ id: prepared.id, reason: 'target-missing' });
            return;
        }
        const outcome = legacyV1.reconcileLegacyV1Book(currentBook, prepared);
        if (outcome.changed) {
            putBook(outcome.book);
            addUniqueId(diagnostics.repairedIds, prepared.id);
        }
        if (outcome.hasConflicts) addUniqueId(diagnostics.conflictIds, prepared.id);
    }

    function normalizedDiagnostics(diagnostics) {
        const byText = (left, right) => String(left).localeCompare(String(right));
        return {
            processedIds: [...new Set(diagnostics.processedIds)].sort(byText),
            repairedIds: [...new Set(diagnostics.repairedIds)].sort(byText),
            skipped: diagnostics.skipped
                .map(item => ({ id: String(item.id || ''), reason: String(item.reason || '') }))
                .sort((left, right) => byText(left.id, right.id) || byText(left.reason, right.reason)),
            conflictIds: [...new Set(diagnostics.conflictIds)].sort(byText)
        };
    }

    function buildLegacyV1RepairMarker({ processedIds = [], repairedIds = [], skipped = [], conflictIds = [], completedAt = new Date().toISOString() } = {}) {
        const diagnostics = normalizedDiagnostics({ processedIds, repairedIds, skipped, conflictIds });
        return {
            id: LEGACY_V1_REPAIR_MARKER_ID,
            schemaVersion: 1,
            completedAt,
            sourceDatabase: LEGACY_READER_DB_NAME,
            ...diagnostics,
            counts: {
                processed: diagnostics.processedIds.length,
                repaired: diagnostics.repairedIds.length,
                skipped: diagnostics.skipped.length,
                conflicts: diagnostics.conflictIds.length
            }
        };
    }

    async function commitMemoryLegacyV1Repair(store, preparedBooks) {
        const diagnostics = createRepairDiagnostics();
        let marker = null;
        await store.transaction(['books', 'meta'], targets => {
            for (const prepared of preparedBooks) {
                const currentBook = prepared.id ? targets.books.get(prepared.id) : null;
                processRepairCandidate(currentBook, prepared, diagnostics, book => targets.books.put(book));
            }
            marker = buildLegacyV1RepairMarker(diagnostics);
            targets.meta.put(marker);
        });
        return { marker };
    }

    function commitIndexedDbLegacyV1Repair(db, preparedBooks) {
        return new Promise((resolve, reject) => {
            const diagnostics = createRepairDiagnostics();
            let transaction;
            let marker = null;
            let failure = null;
            let settled = false;
            const finish = (error, value) => {
                if (settled) return;
                settled = true;
                if (error) reject(error);
                else resolve(value);
            };
            try {
                transaction = db.transaction(['books', 'meta'], 'readwrite');
                const books = transaction.objectStore('books');
                const meta = transaction.objectStore('meta');
                const valid = preparedBooks.filter(prepared => {
                    if (prepared.id) return true;
                    diagnostics.skipped.push({ id: '', reason: 'invalid-legacy-id' });
                    return false;
                });
                let pending = valid.length;
                const queueMarker = () => {
                    marker = buildLegacyV1RepairMarker(diagnostics);
                    meta.put(marker);
                };

                transaction.oncomplete = () => finish(null, { marker });
                transaction.onerror = () => { failure ||= transaction.error || new Error('V1-F1A 修复事务失败'); };
                transaction.onabort = () => finish(failure || transaction.error || new Error('V1-F1A 修复事务已回滚'));

                if (!pending) {
                    queueMarker();
                    return;
                }
                for (const prepared of valid) {
                    const request = books.get(prepared.id);
                    request.onsuccess = () => {
                        try {
                            processRepairCandidate(request.result || null, prepared, diagnostics, book => books.put(book));
                            pending -= 1;
                            if (!pending) queueMarker();
                        } catch (error) {
                            failure = error;
                            try { transaction.abort(); } catch (_) { finish(error); }
                        }
                    };
                    request.onerror = () => { failure = request.error || new Error(`V1-F1A target read failed: ${prepared.id}`); };
                }
            } catch (error) {
                try { transaction?.abort(); } catch (_) { /* noop */ }
                finish(error);
            }
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

    function normalizeLegacyBook(book, legacyReaderProgress = null, preparedLegacyV1 = null) {
        const rawProgress = book.progress || { flow: 'scroll', pageIndex: 0, percent: 0, updatedAt: null };
        const legacyKey = `id:${book.id}`;
        const progressOverride = legacyReaderProgress?.books?.[legacyKey] || legacyReaderProgress?.[legacyKey];
        const prepared = preparedLegacyV1 || legacyV1.prepareLegacyV1Book(book);
        const normalized = {
            id: String(book.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
            title: String(book.title || book.fileName || '未命名书籍'),
            type: String(book.type || 'text'),
            fileName: String(book.fileName || ''),
            text: String(book.text || ''),
            blob: null,
            progress: normalizeReaderProgress({ ...rawProgress, ...(progressOverride || {}) }, book),
            notes: Array.isArray(book.notes) ? book.notes : [],
            bookmarks: Array.isArray(book.bookmarks) ? book.bookmarks : [],
            createdAt: Number(book.createdAt) || Date.now(),
            updatedAt: Number(book.updatedAt) || Date.now(),
            legacyV1: structuredCloneSafe(prepared.legacyV1)
        };
        if (prepared.fingerprint) normalized.fingerprint = prepared.fingerprint;
        if (prepared.occurrences.present) normalized.highlightedOccurrences = structuredCloneSafe(prepared.occurrences.raw);
        return normalized;
    }

    return {
        DB_NAME, DB_VERSION, STORES, LEGACY_V1_REPAIR_MARKER_ID, LocalStore, MemoryBackend, upgradeDatabase,
        migrateV4ToV5, migrateV5ToV6, normalizeLegacyBook, normalizeReaderProgress,
        classifyOpenFailure, readLegacyBooksIfExists
    };
});
