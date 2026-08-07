(function (root, factory) {
    const api = factory(root?.KangkangCore || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
    const FORMAT = 'kangkang-local-backup';
    const VERSION = 1;

    function buildBackupPayload({ state = {}, settings = {}, books = [], dictionaries = [], dictionaryEntries = [], actions = [], includeFiles = false, files = [], dictionaryFiles = [] } = {}) {
        const payload = {
            format: FORMAT,
            version: VERSION,
            createdAt: new Date().toISOString(),
            state: sanitizeState(state),
            settings: { ...settings },
            books: books.map(book => sanitizeBook(book, includeFiles)),
            dictionaries: dictionaries.map(dictionary => ({ ...dictionary, entries: undefined })),
            dictionaryEntries: dictionaryEntries.map(entry => ({ ...entry })),
            aiActions: actions.map(action => ({ ...action })),
            aiCache: [],
            files: includeFiles ? files.map(file => ({ id: file.id, name: file.name, mime: file.mime, data: file.data })) : [],
            dictionaryFiles: includeFiles ? dictionaryFiles.map(file => ({ id: file.id, name: file.name, mime: file.mime, data: file.data })) : []
        };
        return payload;
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
        if (!includeFiles) delete copy.text;
        return copy;
    }

    function validateBackupPayload(payload) {
        if (!payload || payload.format !== FORMAT || Number(payload.version) !== VERSION) throw new Error('备份格式或版本不受支持');
        if (!Array.isArray(payload.books) || !Array.isArray(payload.dictionaries) || !Array.isArray(payload.files) || !Array.isArray(payload.dictionaryEntries || [])) throw new Error('备份内容不完整');
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
            const files = unzipSync(bytes);
            if (!files['backup.json']) throw new Error('ZIP 备份缺少 backup.json');
            jsonBytes = files['backup.json'];
        }
        const payload = JSON.parse(new TextDecoder().decode(jsonBytes));
        validateBackupPayload(payload);
        return payload;
    }

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

    return { FORMAT, VERSION, buildBackupPayload, sanitizeState, sanitizeBook, validateBackupPayload, encodeBackup, decodeBackup, backupFileName };
});
