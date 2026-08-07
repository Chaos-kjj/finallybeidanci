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
            this.resources = new Map();
            this.resourceCache = new Map();
        }
        async open({ signal, onProgress } = {}) {
            if (!this.entries.length && this.mdx) {
                const bytes = await readBytes(this.mdx);
                this.entries = await parseMdxEntries(bytes, { signal, onProgress });
                this.entries.sort((a, b) => core.normalizeWord(a.word).localeCompare(core.normalizeWord(b.word)));
            }
            if (this.mdd && !this.resources.size) {
                const resourceBytes = await readBytes(this.mdd);
                const resourceEntries = await parseMddEntries(resourceBytes, { signal });
                resourceEntries.forEach(entry => this.resources.set(normalizeResourceKey(entry.word), entry));
            }
            this.entryMap = new Map(this.entries.map(entry => [core.normalizeWord(entry.word), entry]));
            return this;
        }
        async lookup(word, options = {}) {
            await this.open(options);
            const map = this.entryMap || new Map(this.entries.map(entry => [core.normalizeWord(entry.word), entry]));
            for (const candidate of core.normalizeLookupCandidates(word)) {
                const entry = map.get(candidate);
                if (entry) {
                    const html = await this.hydrateResources(entry.html || entry.text || '');
                    return [{ ...entry, providerId: this.metadata.id || 'mdx', source: this.metadata.name || 'MDX', html: security.sanitizeHtml ? security.sanitizeHtml(html) : html }];
                }
            }
            if (options.prefix) return this.entries.filter(entry => core.normalizeWord(entry.word).startsWith(core.normalizeWord(word))).slice(0, 20);
            return [];
        }
        async hydrateResources(html) {
            let output = String(html || '');
            const pattern = /\b(src|href)=("|')([^"']+)(\2)/gi;
            const replacements = [];
            let match;
            while ((match = pattern.exec(output))) {
                const resource = await this.readResource(match[3]);
                if (resource) replacements.push({ start: match.index, end: pattern.lastIndex, value: `${match[1]}="${resource}"` });
            }
            for (let index = replacements.length - 1; index >= 0; index -= 1) {
                const item = replacements[index];
                output = output.slice(0, item.start) + item.value + output.slice(item.end);
            }
            return output;
        }
        async readResource(path) {
            const key = normalizeResourceKey(path);
            if (this.resourceCache.has(key)) return this.resourceCache.get(key);
            const entry = this.resources.get(key);
            if (!entry) return '';
            const bytes = entry.bytes || new Uint8Array();
            const dataUrl = `data:${guessMime(key)};base64,${toBase64(bytes)}`;
            this.resourceCache.set(key, dataUrl);
            return dataUrl;
        }
    }

    async function parseMdxEntries(bytes, { signal, onProgress, binary = false } = {}) {
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
            if (signal?.aborted) throw abortError();
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
            if (index > 0 && index % 1000 === 0) {
                onProgress?.({ phase: 'index', completed: index, total: entryCount });
                await yieldToUi();
            }
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
                if (signal?.aborted) throw abortError();
                const key = keyEntries[entryIndex];
                const contentBytes = decoded.slice(key.start, key.end);
                const content = binary ? '' : new TextDecoder('utf-8').decode(contentBytes);
                output.push({ word: key.word, text: content, html: content, bytes: binary ? contentBytes : undefined, version });
                if (entryIndex % 1000 === 0) onProgress?.({ phase: 'index', completed: entryIndex, total: entryCount });
            }
        }
        onProgress?.({ phase: 'index', completed: output.length, total: output.length });
        return output;
    }

    async function parseMddEntries(bytes, options = {}) {
        const entries = await parseMdxEntries(bytes, { ...options, binary: true });
        return entries.map(entry => ({ word: entry.word, bytes: entry.bytes || new Uint8Array() }));
    }

    function normalizeResourceKey(value) { return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase(); }
    function guessMime(path) {
        if (/\.png$/i.test(path)) return 'image/png';
        if (/\.(?:jpe?g)$/i.test(path)) return 'image/jpeg';
        if (/\.gif$/i.test(path)) return 'image/gif';
        if (/\.svg$/i.test(path)) return 'image/svg+xml';
        if (/\.mp3$/i.test(path)) return 'audio/mpeg';
        if (/\.wav$/i.test(path)) return 'audio/wav';
        if (/\.ogg$/i.test(path)) return 'audio/ogg';
        return 'application/octet-stream';
    }
    function toBase64(bytes) {
        let binary = '';
        const chunkSize = 0x7ffe;
        for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
        return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
    }
    function abortError() { const error = new Error('导入已取消'); error.name = 'AbortError'; return error; }
    function yieldToUi() { return new Promise(resolve => setTimeout(resolve, 0)); }

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

    return { MdxProvider, parseMdxEntries, parseMddEntries, decodeUtf16Be, inflateZlib, normalizeResourceKey };
});
