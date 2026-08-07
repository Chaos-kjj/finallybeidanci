(function (root, factory) {
    const api = factory(root?.KangkangCore || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
    const FORMAT = 'kangkang-local-backup';
    const VERSION = 2;
    const LEGACY_VERSION = 1;
    const INTEGRITY_STATUS = Symbol('integrityStatus');

    function buildBackupPayload({ state = {}, settings = {}, books = [], dictionaries = [], dictionaryEntries = [], actions = [], includeFiles = false, files = [], dictionaryFiles = [] } = {}) {
        const payload = {
            format: FORMAT,
            version: VERSION,
            kind: includeFiles ? 'complete' : 'normal',
            createdAt: new Date().toISOString(),
            state: sanitizeState(state),
            settings: sanitizeSettings(settings),
            books: books.map(book => sanitizeBook(book, includeFiles)),
            dictionaries: dictionaries.map(dictionary => ({ ...dictionary, entries: undefined, entryCount: Number(dictionary.entryCount) || undefined })),
            dictionaryEntries: dictionaryEntries.map(entry => ({ ...entry })),
            aiActions: actions.map(sanitizeAction),
            aiCache: [],
            files: includeFiles ? files.map(file => ({ id: file.id, dictionaryId: file.dictionaryId || '', role: file.role || 'file', family: file.family || '', name: file.name, mime: file.mime, data: file.data })) : [],
            // Keep the relationship fields. A dictionary source file without
            // dictionaryId/role cannot be reconstructed after a clean restore.
            dictionaryFiles: includeFiles ? dictionaryFiles.map(file => ({ id: file.id, dictionaryId: file.dictionaryId, role: file.role, name: file.name, mime: file.mime, data: file.data })) : []
        };
        return payload;
    }

    function sanitizeState(state) {
        return removeSensitiveFields(state || {});
    }

    function sanitizeSettings(settings) { return removeSensitiveFields(settings || {}); }
    function sanitizeAction(action = {}) {
        return Object.fromEntries(Object.entries(removeSensitiveFields(action)).filter(([key]) => !/validation|validated|errorMessage/i.test(key)));
    }

    function sanitizeBook(book, includeFiles) {
        const copy = deepClone(book || {});
        delete copy.blob;
        delete copy.sourceBlob;
        if (!includeFiles) delete copy.text;
        return copy;
    }

    function validateBackupPayload(payload) {
        if (!payload || payload.format !== FORMAT || ![LEGACY_VERSION, VERSION].includes(Number(payload.version))) throw new Error('备份格式或版本不受支持');
        if (!Array.isArray(payload.books) || !Array.isArray(payload.dictionaries) || !Array.isArray(payload.files) || !Array.isArray(payload.dictionaryEntries || [])) throw new Error('备份内容不完整');
        if (hasSensitiveField(payload)) throw new Error('备份中检测到禁止导出的敏感字段');
        return true;
    }

    async function encodeBackup(payload, zipSync) {
        validateBackupPayload(payload);
        const sealed = await attachBackupIntegrity(payload);
        const bytes = new TextEncoder().encode(JSON.stringify(sealed));
        if (zipSync) return zipSync({ 'backup.json': bytes });
        return bytes;
    }

    async function decodeBackup(input, unzipSync) {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer?.() || input);
        let jsonBytes = bytes;
        if (unzipSync) {
            const files = unzipSync(bytes);
            if (!files['backup.json']) throw new Error('ZIP 备份缺少 backup.json');
            jsonBytes = files['backup.json'];
        }
        const rawPayload = JSON.parse(new TextDecoder().decode(jsonBytes));
        validateBackupPayloadShape(rawPayload);
        const integrity = await verifyBackupIntegrity(rawPayload);
        const payload = normalizeBackupPayload(rawPayload);
        validateBackupPayload(payload);
        return markIntegrityStatus(payload, integrity.verified ? 'verified' : 'unverified');
    }

    async function attachBackupIntegrity(payload) {
        const sealed = deepClone(payload);
        delete sealed.integrity;
        sealed.integrity = {
            algorithm: 'SHA-256',
            digest: await sha256Hex(integrityBytes(sealed))
        };
        return sealed;
    }

    async function verifyBackupIntegrity(payload) {
        if (Number(payload?.version) === LEGACY_VERSION) return { verified: false, legacy: true };
        if (!payload?.integrity) throw new Error('v2 备份缺少 SHA-256 完整性摘要，无法安全恢复');
        const algorithm = String(payload.integrity.algorithm || '').toUpperCase();
        const expected = String(payload.integrity.digest || '').toLowerCase();
        if (algorithm !== 'SHA-256' || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('备份完整性摘要格式无效');
        const actual = await sha256Hex(integrityBytes(payload));
        if (!constantTimeEqual(expected, actual)) throw new Error('备份完整性校验失败，文件可能损坏或被修改');
        return { verified: true, legacy: false, algorithm, digest: actual };
    }

    function integrityBytes(payload) {
        const copy = deepClone(payload);
        delete copy.integrity;
        return new TextEncoder().encode(JSON.stringify(canonicalize(copy)));
    }

    async function sha256Hex(bytes) {
        const subtle = globalThis.crypto?.subtle;
        if (!subtle?.digest) throw new Error('当前环境不支持 SHA-256，无法安全导出或恢复备份');
        const digest = await subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
    }

    function constantTimeEqual(first, second) {
        if (first.length !== second.length) return false;
        let mismatch = 0;
        for (let index = 0; index < first.length; index += 1) mismatch |= first.charCodeAt(index) ^ second.charCodeAt(index);
        return mismatch === 0;
    }

    function normalizeBackupPayload(payload) {
        validateBackupPayloadShape(payload);
        if (Number(payload.version) === VERSION) {
            return {
                ...payload,
                dictionaryFiles: Array.isArray(payload.dictionaryFiles) ? payload.dictionaryFiles.map(normalizeDictionaryFile) : [],
                files: Array.isArray(payload.files) ? payload.files : [],
                kind: payload.kind || (payload.dictionaryFiles?.length || payload.files?.length ? 'complete' : 'normal')
            };
        }
        // v1 did not reliably preserve dictionaryId/role on dictionaryFiles.
        // Keep any explicit relation, and mark unassociated files instead of
        // guessing which dictionary they belong to.
        const normalized = {
            ...payload,
            version: VERSION,
            kind: payload.kind || 'normal',
            dictionaryFiles: Array.isArray(payload.dictionaryFiles) ? payload.dictionaryFiles.map(normalizeDictionaryFile) : [],
            files: Array.isArray(payload.files) ? payload.files : []
        };
        // v1 never had an authenticated digest contract. Do not carry a
        // caller-supplied digest into the normalized object or present it as
        // verification evidence in the restore preview.
        delete normalized.integrity;
        return normalized;
    }

    function validateBackupPayloadShape(payload) {
        if (!payload || payload.format !== FORMAT || ![LEGACY_VERSION, VERSION].includes(Number(payload.version))) throw new Error('备份格式或版本不受支持');
        if (!Array.isArray(payload.books) || !Array.isArray(payload.dictionaries) || !Array.isArray(payload.files) || !Array.isArray(payload.dictionaryEntries || [])) throw new Error('备份内容不完整');
    }

    function normalizeDictionaryFile(file = {}) {
        return {
            id: String(file.id || ''),
            dictionaryId: file.dictionaryId ? String(file.dictionaryId) : '',
            role: file.role ? String(file.role) : 'unknown',
            name: String(file.name || ''),
            mime: String(file.mime || 'application/octet-stream'),
            data: file.data || ''
        };
    }

    function previewRestore(payload) {
        const normalized = normalizeBackupPayload(payload);
        return {
            version: VERSION,
            kind: normalized.kind,
            books: normalized.books.length,
            dictionaries: normalized.dictionaries.length,
            dictionaryEntries: (normalized.dictionaryEntries || []).length,
            dictionaryFiles: (normalized.dictionaryFiles || []).length,
            files: (normalized.files || []).length,
            includesBookFiles: normalized.books.some(book => Boolean(book.fileData)),
            includesDictionaryFiles: (normalized.dictionaryFiles || []).some(file => Boolean(file.data)),
            hasUnassociatedDictionaryFiles: (normalized.dictionaryFiles || []).some(file => !file.dictionaryId || file.role === 'unknown'),
            integrityStatus: payload?.[INTEGRITY_STATUS] || 'unverified'
        };
    }

    function buildRestoreDataset(payload, { base64ToBlob = value => value } = {}) {
        const normalized = normalizeBackupPayload(payload);
        const files = [
            ...(normalized.files || []).map(file => ({ ...file, data: file.data ? base64ToBlob(file.data, file.mime) : file.data })),
            ...(normalized.dictionaryFiles || []).filter(file => file.data).map(file => ({ ...file, data: base64ToBlob(file.data, file.mime) }))
        ];
        const books = normalized.books.map(book => ({
            ...book,
            blob: book.fileData ? base64ToBlob(book.fileData, book.mime) : (book.blob || null),
            fileData: undefined,
            updatedAt: Date.now()
        }));
        return {
            state: normalized.state,
            settings: normalized.settings || {},
            actions: Array.isArray(normalized.aiActions) ? normalized.aiActions : [],
            books,
            dictionaries: normalized.dictionaries,
            dictionaryEntries: normalized.dictionaryEntries || [],
            files
        };
    }

    function mergeRestoreState(current = {}, incoming = {}) {
        const words = new Map();
        [...(Array.isArray(current.allWords) ? current.allWords : []), ...(Array.isArray(incoming.allWords) ? incoming.allWords : [])].forEach(item => {
            const key = String(item?.word || '').trim().toLocaleLowerCase();
            if (!key) return;
            const previous = words.get(key);
            const previousTime = Date.parse(previous?.updatedAt || '') || Number(previous?.updatedAt) || 0;
            const nextTime = Date.parse(item?.updatedAt || '') || Number(item?.updatedAt) || 0;
            if (!previous || nextTime >= previousTime) words.set(key, item);
        });
        const errata = { ...(current.errata || {}) };
        Object.entries(incoming.errata || {}).forEach(([group, values]) => { errata[group] = [...new Set([...(errata[group] || []), ...(Array.isArray(values) ? values : [])])]; });
        return { ...current, ...incoming, allWords: [...words.values()], knownWords: [...new Set([...(current.knownWords || []), ...(incoming.knownWords || [])])], reviewWords: [...new Set([...(current.reviewWords || []), ...(incoming.reviewWords || [])])], errata };
    }

    function backupFileName(complete = false) {
        const stamp = new Date().toISOString().slice(0, 10);
        return `kangkang-backup-${complete ? 'complete-' : ''}${stamp}.zip`;
    }

    function deepClone(value) {
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function canonicalize(value) {
        if (value === null || typeof value !== 'object') return value;
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.map(canonicalize);
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
    }

    function markIntegrityStatus(payload, status) {
        Object.defineProperty(payload, INTEGRITY_STATUS, { configurable: true, enumerable: false, value: status });
        return payload;
    }

    function hasSensitiveField(value) {
        if (Array.isArray(value)) return value.some(hasSensitiveField);
        if (!value || typeof value !== 'object') return false;
        return Object.entries(value).some(([key, child]) => /^(api[_-]?key|authorization)$/i.test(key) || hasSensitiveField(child));
    }

    function removeSensitiveFields(value) {
        if (Array.isArray(value)) return value.map(removeSensitiveFields);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(api[_-]?key|authorization)$/i.test(key)).map(([key, child]) => [key, removeSensitiveFields(child)]));
    }

    return {
        FORMAT, VERSION, LEGACY_VERSION, buildBackupPayload, sanitizeState, sanitizeBook,
        validateBackupPayload, sanitizeSettings, sanitizeAction, normalizeBackupPayload, previewRestore, buildRestoreDataset, mergeRestoreState,
        encodeBackup, decodeBackup, attachBackupIntegrity, verifyBackupIntegrity, integrityBytes, sha256Hex, backupFileName
    };
});
