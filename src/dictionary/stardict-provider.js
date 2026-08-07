(function (root, factory) {
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecurity || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangStarDict = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, security) {
    class StarDictProvider {
        constructor({ metadata = {}, ifo, idx, dict, dictDz } = {}) {
            this.metadata = { format: 'stardict', enabled: true, order: 50, ...metadata };
            this.ifo = ifo;
            this.idx = idx;
            this.dict = dict;
            this.dictDz = dictDz;
            this.entries = [];
        }
        async open() {
            const ifoBytes = await readBytes(this.ifo);
            const idxBytes = await readBytes(this.idx);
            this.info = parseIfo(new TextDecoder().decode(ifoBytes));
            this.entries = parseIdx(idxBytes, this.info.idxoffsetbits || 32);
            return this;
        }
        async lookup(word, options = {}) {
            if (!this.entries.length) await this.open();
            for (const candidate of core.normalizeLookupCandidates(word)) {
                const entry = binaryFind(this.entries, candidate);
                if (!entry) continue;
                const data = await this.readEntry(entry);
                return [{ providerId: this.metadata.id || 'stardict', source: this.metadata.name || 'StarDict', headword: entry.word, text: data.text, html: data.html }];
            }
            return options.prefix ? this.prefixLookup(word) : [];
        }
        async readEntry(entry) {
            if (!this.dictDz && this.dict?.slice) {
                const chunk = await readBytes(this.dict.slice(entry.offset, entry.offset + entry.size));
                const html = security.sanitizeHtml ? security.sanitizeHtml(new TextDecoder('utf-8').decode(chunk)) : new TextDecoder('utf-8').decode(chunk);
                return { text: html.replace(/<[^>]+>/g, ' '), html };
            }
            const raw = await readBytes(this.dict || this.dictDz);
            const bytes = this.dictDz ? await decompressGzip(raw) : raw;
            const slice = bytes.slice(entry.offset, entry.offset + entry.size);
            const text = new TextDecoder('utf-8').decode(slice);
            const html = security.sanitizeHtml ? security.sanitizeHtml(text) : text;
            return { text: html.replace(/<[^>]+>/g, ' '), html };
        }
        prefixLookup(word) {
            const prefix = core.normalizeWord(word);
            return this.entries.filter(item => item.word.startsWith(prefix)).slice(0, 20).map(item => ({ providerId: this.metadata.id || 'stardict', source: this.metadata.name || 'StarDict', headword: item.word, text: '点击查阅完整词条' }));
        }
    }

    function parseIfo(text) {
        const info = {};
        String(text || '').split(/\r?\n/).forEach(line => {
            const index = line.indexOf('=');
            if (index > 0) info[line.slice(0, index).trim()] = line.slice(index + 1).trim();
        });
        return info;
    }

    function parseIdx(bytes, offsetBits = 32) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const entries = [];
        let cursor = 0;
        while (cursor < bytes.length) {
            const end = bytes.indexOf(0, cursor);
            if (end < 0) break;
            const word = new TextDecoder('utf-8').decode(bytes.slice(cursor, end));
            cursor = end + 1;
            const offsetBytes = offsetBits === 64 ? 8 : 4;
            if (cursor + offsetBytes + 4 > bytes.length) break;
            const offset = offsetBits === 64 ? Number(view.getBigUint64(cursor, false)) : view.getUint32(cursor, false);
            cursor += offsetBytes;
            const size = view.getUint32(cursor, false);
            cursor += 4;
            entries.push({ word: core.normalizeWord(word), offset, size });
        }
        return entries.sort((a, b) => a.word.localeCompare(b.word));
    }

    function binaryFind(entries, word) {
        const target = core.normalizeWord(word);
        let low = 0;
        let high = entries.length - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            const value = entries[middle].word;
            if (value === target) return entries[middle];
            if (value < target) low = middle + 1; else high = middle - 1;
        }
        return null;
    }

    async function readBytes(value) {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer());
        throw new Error('StarDict 文件缺失');
    }

    async function decompressGzip(bytes) {
        if (typeof module === 'object' && module.exports && typeof require === 'function') {
            const zlib = require('node:zlib');
            return new Uint8Array(zlib.gunzipSync(Buffer.from(bytes)));
        }
        if (typeof DecompressionStream === 'function') {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new Error('当前环境不支持解压 .dict.dz');
    }

    return { StarDictProvider, parseIfo, parseIdx, binaryFind, decompressGzip };
});
