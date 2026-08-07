(function (root, factory) {
    const api = factory(root?.KangkangCore || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
    const FORMAT = 'kangkang-local-backup';
    const VERSION = 2;
    const SUPPORTED_VERSIONS = new Set([1, VERSION]);

    function buildBackupPayload({ state = {}, settings = {}, aiConfig = {}, books = [], dictionaries = [], dictionaryEntries = [], actions = [], aiCache = [], includeFiles = false, files = [], dictionaryFiles = [] } = {}) {
        const complete = includeFiles === true;
        return {
            format: FORMAT,
            version: VERSION,
            mode: complete ? 'complete' : 'data',
            includesFiles: complete,
            createdAt: new Date().toISOString(),
            state: sanitizeState(state),
            settings: deepClone(settings || {}),
            aiConfig: sanitizeState(aiConfig || {}),
            books: books.map(book => sanitizeBook(book, complete)),
            dictionaries: dictionaries.map(dictionary => {
                const copy = deepClone(dictionary || {});
                delete copy.entries;
                return copy;
            }),
            dictionaryEntries: dictionaryEntries.map(entry => deepClone(entry)),
            aiActions: actions.map(action => deepClone(action)),
            aiCache: (aiCache || []).map(entry => deepClone(entry)),
            files: complete ? files.map(file => sanitizeFile(file)) : [],
            dictionaryFiles: complete ? dictionaryFiles.map(file => sanitizeFile(file)) : []
        };
    }

    function sanitizeState(state) {
        const copy = deepClone(state || {});
        if (copy.aiConfig) delete copy.aiConfig.apiKey;
        delete copy.apiKey;
        return copy;
    }

    function sanitizeBook(book, includeFiles) {
        const copy = deepClone(book || {});
        delete copy.blob;
        delete copy.sourceBlob;
        if (!includeFiles) {
            delete copy.text;
            delete copy.fileData;
            delete copy.fileBytes;
            copy.fileMissing = true;
        }
        return copy;
    }

    function sanitizeFile(file) {
        const copy = deepClone(file || {});
        delete copy.blob;
        return copy;
    }

    function validateBackupPayload(payload) {
        if (!payload || payload.format !== FORMAT || !SUPPORTED_VERSIONS.has(Number(payload.version))) throw new Error('备份格式或版本不受支持');
        if (!Array.isArray(payload.books) || !Array.isArray(payload.dictionaries) || !Array.isArray(payload.files) || !Array.isArray(payload.dictionaryEntries || [])) throw new Error('备份内容不完整');
        if (payload.mode && !['data', 'complete'].includes(payload.mode)) throw new Error('备份模式无效');
        if (hasSensitiveField(payload)) throw new Error('备份中检测到禁止导出的敏感字段');
        return true;
    }

    async function encodeBackup(payload, zipSync) {
        validateBackupPayload(payload);
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        if (zipSync) return zipSync({ 'backup.json': bytes });
        return bytes;
    }

    async function decodeBackup(input, unzipSync) {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer?.() || input);
        let jsonBytes = bytes;
        if (unzipSync) {
            let files;
            try { files = unzipSync(bytes); } catch (_) { throw new Error('备份 ZIP 损坏或无法读取'); }
            if (!files['backup.json']) throw new Error('ZIP 备份缺少 backup.json');
            jsonBytes = files['backup.json'];
        }
        let payload;
        try { payload = JSON.parse(new TextDecoder().decode(jsonBytes)); } catch (_) { throw new Error('备份清单损坏'); }
        validateBackupPayload(payload);
        return normalizeDecodedPayload(payload);
    }

    function normalizeDecodedPayload(payload) {
        const copy = deepClone(payload);
        if (Number(copy.version) === 1) {
            copy.version = VERSION;
            copy.mode = copy.mode || (copy.files?.length || copy.dictionaryFiles?.length ? 'complete' : 'data');
            copy.includesFiles = copy.mode === 'complete';
            copy.aiConfig ||= {};
            copy.aiCache ||= [];
        }
        return copy;
    }

    // Merge rules deliberately preserve local file data unless a complete
    // backup carries a replacement file. A data-only backup can therefore
    // never turn an existing readable book into blob:null.
    function mergeBookRecord(existing, incoming, { complete = false, decodeFile = value => value, now = Date.now() } = {}) {
        const current = existing ? deepClone(existing) : null;
        const next = { ...(current || {}), ...deepClone(incoming || {}), updatedAt: now };
        delete next.blob;
        delete next.sourceBlob;
        const hasFile = complete && typeof incoming?.fileData === 'string' && incoming.fileData.length > 0;
        if (hasFile) {
            next.blob = decodeFile(incoming.fileData, incoming.mime || 'application/octet-stream');
            next.fileMissing = false;
        } else if (current && Object.prototype.hasOwnProperty.call(current, 'blob')) {
            next.blob = current.blob;
            if (current.text !== undefined && incoming?.text === undefined) next.text = current.text;
            next.fileMissing = current.fileMissing === true;
        } else {
            next.blob = incoming?.blob || null;
            next.fileMissing = true;
        }
        delete next.fileData;
        return next;
    }

    function mergeFileRecord(existing, incoming, { complete = false, decodeFile = value => value } = {}) {
        if (!complete || !incoming || !Object.prototype.hasOwnProperty.call(incoming, 'data')) return existing ? deepClone(existing) : null;
        const next = { ...(existing || {}), ...deepClone(incoming) };
        if (typeof incoming.data === 'string') next.data = decodeFile(incoming.data, incoming.mime || 'application/octet-stream');
        return next;
    }

    function backupMode(payload) { return payload?.mode === 'complete' || payload?.includesFiles === true ? 'complete' : 'data'; }
    function backupFileName(complete = false) {
        const stamp = new Date().toISOString().slice(0, 10);
        return `kangkang-backup-${complete ? 'complete-' : ''}${stamp}.zip`;
    }

    function deepClone(value) {
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function hasSensitiveField(value) {
        if (Array.isArray(value)) return value.some(hasSensitiveField);
        if (!value || typeof value !== 'object') return false;
        return Object.entries(value).some(([key, child]) => /^(api[_-]?key|authorization)$/i.test(key) || hasSensitiveField(child));
    }

    return {
        FORMAT, VERSION, SUPPORTED_VERSIONS, buildBackupPayload, sanitizeState,
        sanitizeBook, sanitizeFile, validateBackupPayload, encodeBackup,
        decodeBackup, normalizeDecodedPayload, mergeBookRecord, mergeFileRecord,
        backupMode, backupFileName
    };
});
