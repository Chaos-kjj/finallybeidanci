(function (root, factory) {
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecurity || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangMdx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, security) {
    const MAX_MDD_BYTES = 512 * 1024 * 1024;
    const MAX_MDX_BYTES = 512 * 1024 * 1024;
    const MAX_MDX_RECORD_BYTES = 8 * 1024 * 1024;
    const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
    const RESOURCE_TYPES = new Map([
        ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp'], ['svg', 'image/svg+xml'],
        ['mp3', 'audio/mpeg'], ['m4a', 'audio/mp4'], ['ogg', 'audio/ogg'], ['wav', 'audio/wav'], ['flac', 'audio/flac'],
        ['ttf', 'font/ttf'], ['otf', 'font/otf'], ['woff', 'font/woff'], ['woff2', 'font/woff2']
    ]);
    class MdxProvider {
        constructor({ metadata = {}, entries = [], mdx = null, mdd = null } = {}) {
            this.metadata = { format: 'mdx', enabled: true, order: 50, ...metadata };
            this.entries = entries;
            this.mdx = mdx;
            this.mdd = mdd;
            this.entryMap = null;
            this.mddMap = null;
            this.resourceUrls = new Set();
        }
        async open() {
            if (this.entries.length || !this.mdx) return this;
            const bytes = await readBytes(this.mdx);
            this.entries = await parseMdxEntries(bytes);
            this.entryMap = new Map(this.entries.map(entry => [core.normalizeWord(entry.word), entry]));
            return this;
        }
        exportEntries() { return this.entries.map(entry => ({ ...entry })); }
        getEntryCount() { return this.entries.length; }
        async lookup(word, options = {}) {
            await this.open();
            this.entryMap ||= new Map(this.entries.map(entry => [core.normalizeWord(entry.word), entry]));
            for (const candidate of core.normalizeLookupCandidates(word)) {
                const entry = this.entryMap.get(candidate);
                if (entry) return [{ ...entry, providerId: this.metadata.id || 'mdx', source: this.metadata.name || 'MDX', html: await this.renderEntryHtml(entry.html || entry.text || '') }];
            }
            if (options.prefix) return this.entries.filter(entry => core.normalizeWord(entry.word).startsWith(core.normalizeWord(word))).slice(0, 20);
            return [];
        }
        async getResource(path, { maxBytes = MAX_RESOURCE_BYTES } = {}) {
            await this.loadMdd();
            const entry = this.mddMap?.get(normalizeResourcePath(path));
            if (!entry) return null;
            if (entry.data.byteLength > Math.min(MAX_RESOURCE_BYTES, Math.max(1, Number(maxBytes) || MAX_RESOURCE_BYTES))) throw new Error('MDX 资源超过单项大小上限');
            const mime = resourceMime(path);
            if (!mime) throw new Error('MDX 资源类型不允许在阅读器中加载');
            return new Blob([entry.data], { type: mime });
        }
        async renderEntryHtml(html) {
            let output = String(html || '');
            const pattern = /(\s(?:src|href)\s*=\s*["'])(?:(?:file|res|sound):\/\/?)([^"']+)(["'])/gi;
            for (const match of [...output.matchAll(pattern)]) {
                try {
                    const blob = await this.getResource(match[2]);
                    if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') continue;
                    const url = URL.createObjectURL(blob); this.resourceUrls.add(url);
                    output = output.replace(match[0], `${match[1]}${url}${match[3]}`);
                } catch (_) { output = output.replace(match[0], ''); }
            }
            return security.sanitizeHtml ? security.sanitizeHtml(output, { allowExternalLinks: false, allowRelativeLinks: false, allowAppDict: false }) : output;
        }
        async loadMdd() {
            if (this.mddMap || !this.mdd) return this;
            const bytes = await readBytes(this.mdd);
            if (bytes.byteLength > MAX_MDD_BYTES) throw new Error('MDD 文件超过 512 MB 上限');
            const entries = await parseMddEntries(bytes);
            if (entries.length > 2_000_000) throw new Error('MDD 资源索引过大');
            this.mddMap = new Map(entries.map(entry => [normalizeResourcePath(entry.word), entry]));
            return this;
        }
        async close() {
            if (typeof URL !== 'undefined') this.resourceUrls.forEach(url => URL.revokeObjectURL?.(url));
            this.resourceUrls.clear();
        }
    }

    async function parseMdxEntries(bytes) {
        return (await parseMdxRecords(bytes, true)).map(entry => ({ word: entry.word, text: entry.text, html: entry.html, version: entry.version }));
    }
    async function parseMddEntries(bytes) {
        return parseMdxRecords(bytes, false);
    }
    async function parseMdxRecords(bytes, asText) {
        // MDX v1 record blocks use a four-byte compression marker. Support stored and
        // zlib blocks; reject LZO/encrypted data rather than treating binary data as HTML.
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.length < 16) return [];
        let cursor = 0;
        const headerLength = view.getUint32(cursor, false); cursor += 4;
        if (headerLength <= 0 || cursor + headerLength + 4 > bytes.length) return [];
        const headerBytes = bytes.slice(cursor, cursor + headerLength); cursor += headerLength + 4;
        const header = decodeUtf16Be(headerBytes);
        const version = Number(header.match(/version="([0-9.]+)/i)?.[1] || 1);
        const entryCount = view.getUint32(cursor, false); cursor += 4;
        const blockCount = view.getUint32(cursor, false); cursor += 4;
        if (!Number.isFinite(entryCount) || !Number.isFinite(blockCount) || blockCount > 100_000) return [];
        const blocks = [];
        for (let index = 0; index < blockCount; index += 1) {
            if (cursor + 8 > bytes.length) return [];
            const entries = view.getUint32(cursor, false); cursor += 4;
            const compressedSize = view.getUint32(cursor, false); cursor += 4;
            blocks.push({ entries, compressedSize });
        }
        const keyEntries = [];
        for (let index = 0; index < entryCount && cursor + 4 <= bytes.length; index += 1) {
            const keyLength = view.getUint32(cursor, false); cursor += 4;
            if (keyLength > 2_000 || cursor + keyLength + 8 > bytes.length) return [];
            const word = decodeUtf16Be(bytes.slice(cursor, cursor + keyLength)); cursor += keyLength;
            const start = view.getUint32(cursor, false); cursor += 4;
            const end = view.getUint32(cursor, false); cursor += 4;
            keyEntries.push({ word, start, end });
        }
        const dataStart = cursor;
        const output = [];
        let blockOffset = dataStart;
        let entryIndex = 0;
        for (const block of blocks) {
            if (blockOffset + block.compressedSize > bytes.length) break;
            const compression = view.getUint32(blockOffset, false);
            const payload = bytes.slice(blockOffset + 8, blockOffset + block.compressedSize);
            blockOffset += block.compressedSize;
            const decoded = compression === 0
                ? payload
                : compression === 2
                    ? await inflateZlib(payload)
                    : null;
            if (!decoded) return [];
            for (let local = 0; local < block.entries && entryIndex < keyEntries.length; local += 1, entryIndex += 1) {
                const key = keyEntries[entryIndex];
                if (key.start < 0 || key.end < key.start || key.end > decoded.length || key.end - key.start > MAX_MDX_RECORD_BYTES) return [];
                const data = decoded.slice(key.start, key.end);
                if (asText) {
                    const content = new TextDecoder('utf-8').decode(data);
                    output.push({ word: key.word, text: content, html: content, version });
                } else output.push({ word: key.word, data, version });
            }
        }
        return output;
    }

    async function inflateZlib(bytes, maxBytes = MAX_MDX_BYTES) {
        if (typeof module === 'object' && module.exports && typeof require === 'function') {
            const zlib = require('node:zlib');
            return new Uint8Array(zlib.inflateSync(Buffer.from(bytes), { maxOutputLength: maxBytes }));
        }
        if (typeof DecompressionStream === 'function') {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
            const reader = stream.getReader();
            const chunks = [];
            let total = 0;
            try {
                while (true) {
                    const result = await reader.read();
                    if (result.done) break;
                    total += result.value.byteLength;
                    if (total > maxBytes) { try { await reader.cancel(); } catch (_) {} throw new Error('MDX 解压内容超过 512 MB 上限'); }
                    chunks.push(result.value);
                }
            } finally { reader.releaseLock?.(); }
            const output = new Uint8Array(total);
            let offset = 0;
            chunks.forEach(chunk => { output.set(chunk, offset); offset += chunk.byteLength; });
            return output;
        }
        throw new Error('当前环境不支持解压 MDX zlib 数据');
    }

    function decodeUtf16Be(bytes) {
        let value = '';
        for (let index = 0; index + 1 < bytes.length; index += 2) value += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
        return value.replace(/\u0000/g, '');
    }
    function normalizeResourcePath(value) {
        try { return decodeURIComponent(String(value || '')).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase(); }
        catch (_) { return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase(); }
    }
    function resourceMime(path) {
        const extension = normalizeResourcePath(path).split('.').pop();
        return RESOURCE_TYPES.get(extension) || '';
    }
    async function readBytes(value) {
        const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : value?.arrayBuffer ? new Uint8Array(await value.arrayBuffer()) : null;
        if (!bytes) throw new Error('MDX 文件缺失');
        if (bytes.byteLength > MAX_MDX_BYTES) throw new Error('MDX 文件超过 512 MB 上限');
        return bytes;
    }

    return { MdxProvider, parseMdxEntries, parseMddEntries, normalizeResourcePath, resourceMime, decodeUtf16Be, inflateZlib };
});
