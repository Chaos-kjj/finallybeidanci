(function (root, factory) {
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecurity || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangMdx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, security) {
    class MdxProvider {
        constructor({ metadata = {}, entries = [], mdx = null, mdd = null } = {}) {
            this.metadata = { format: 'mdx', enabled: true, order: 50, ...metadata };
            this.entries = entries;
            this.mdx = mdx;
            this.mdd = mdd;
        }
        async open() {
            if (this.entries.length || !this.mdx) return this;
            const bytes = await readBytes(this.mdx);
            this.entries = await parseMdxEntries(bytes);
            return this;
        }
        async lookup(word, options = {}) {
            await this.open();
            const map = new Map(this.entries.map(entry => [core.normalizeWord(entry.word), entry]));
            for (const candidate of core.normalizeLookupCandidates(word)) {
                const entry = map.get(candidate);
                if (entry) return [{ ...entry, providerId: this.metadata.id || 'mdx', source: this.metadata.name || 'MDX', html: security.sanitizeHtml ? security.sanitizeHtml(entry.html || entry.text || '') : entry.html || entry.text || '' }];
            }
            if (options.prefix) return this.entries.filter(entry => core.normalizeWord(entry.word).startsWith(core.normalizeWord(word))).slice(0, 20);
            return [];
        }
    }

    async function parseMdxEntries(bytes) {
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
                const content = new TextDecoder('utf-8').decode(decoded.slice(key.start, key.end));
                output.push({ word: key.word, text: content, html: content, version });
            }
        }
        return output;
    }

    async function inflateZlib(bytes) {
        if (typeof module === 'object' && module.exports && typeof require === 'function') {
            const zlib = require('node:zlib');
            return new Uint8Array(zlib.inflateSync(Buffer.from(bytes)));
        }
        if (typeof DecompressionStream === 'function') {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new Error('当前环境不支持解压 MDX zlib 数据');
    }

    function decodeUtf16Be(bytes) {
        let value = '';
        for (let index = 0; index + 1 < bytes.length; index += 2) value += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
        return value.replace(/\u0000/g, '');
    }
    async function readBytes(value) { if (value instanceof Uint8Array) return value; if (value instanceof ArrayBuffer) return new Uint8Array(value); if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer()); throw new Error('MDX 文件缺失'); }

    return { MdxProvider, parseMdxEntries, decodeUtf16Be, inflateZlib };
});
