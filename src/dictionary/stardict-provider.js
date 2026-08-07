(function (root, factory) {
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecurity || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangStarDict = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, security) {
    class StarDictProvider {
        constructor({ metadata = {}, ifo, idx, dict, dictDz, maxEntryCache = 64 } = {}) {
            this.metadata = { format: 'stardict', enabled: true, order: 50, ...metadata };
            this.ifo = ifo;
            this.idx = idx;
            this.dict = dict;
            this.dictDz = dictDz;
            this.entries = [];
            this.entryCache = new Map();
            this.maxEntryCache = Math.max(8, Number(maxEntryCache) || 64);
            this.dictDataPromise = null;
        }
        async open({ signal, onProgress } = {}) {
            const ifoBytes = await readBytes(this.ifo);
            const idxBytes = await readBytes(this.idx);
            if (signal?.aborted) throw abortError();
            this.info = parseIfo(new TextDecoder().decode(ifoBytes));
            this.entries = await parseIdxAsync(idxBytes, Number(this.info.idxoffsetbits || 32), { signal, onProgress, total: Number(this.info.wordcount) || 0 });
            if (this.info.sametypesequence) this.sameTypeSequence = String(this.info.sametypesequence);
            this.metadata = { ...this.metadata, wordCount: Number(this.info.wordcount) || this.entries.length, idxOffsetBits: Number(this.info.idxoffsetbits || 32), sameTypeSequence: this.sameTypeSequence || '' };
            return this;
        }
        async lookup(word, options = {}) {
            if (!this.entries.length) await this.open(options);
            for (const candidate of core.normalizeLookupCandidates(word)) {
                const entry = binaryFind(this.entries, candidate);
                if (!entry) continue;
                const data = await this.readEntry(entry);
                return [{ providerId: this.metadata.id || 'stardict', source: this.metadata.name || 'StarDict', headword: entry.word, ...data }];
            }
            return options.prefix ? this.prefixLookup(word) : [];
        }
        async readEntry(entry) {
            const cacheKey = `${entry.offset}:${entry.size}`;
            if (this.entryCache.has(cacheKey)) {
                const value = this.entryCache.get(cacheKey);
                this.entryCache.delete(cacheKey); this.entryCache.set(cacheKey, value);
                return value;
            }
            const raw = this.dictDz
                ? (await this.readCompressedData()).slice(entry.offset, entry.offset + entry.size)
                : await readSlice(this.dict, entry.offset, entry.size);
            const data = decodeDictionaryRecord(raw, this.sameTypeSequence || this.info?.sametypesequence || 'm', this.info?.sametypesequence);
            const html = security.sanitizeHtml ? security.sanitizeHtml(data.html || data.text || '') : (data.html || data.text || '');
            const result = { ...data, html, text: data.text || html.replace(/<[^>]+>/g, ' ') };
            this.entryCache.set(cacheKey, result);
            while (this.entryCache.size > this.maxEntryCache) this.entryCache.delete(this.entryCache.keys().next().value);
            return result;
        }
        async readCompressedData() {
            if (!this.dictDataPromise) this.dictDataPromise = readBytes(this.dictDz).then(decompressGzip);
            return this.dictDataPromise;
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

    function parseIdx(bytes, offsetBits = 32, { signal, onProgress } = {}) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const entries = [];
        let cursor = 0;
        let completed = 0;
        const offsetBytes = Number(offsetBits) === 64 ? 8 : 4;
        while (cursor < bytes.length) {
            if (signal?.aborted) throw abortError();
            const end = bytes.indexOf(0, cursor);
            if (end < 0) break;
            const word = new TextDecoder('utf-8').decode(bytes.slice(cursor, end));
            cursor = end + 1;
            if (cursor + offsetBytes + 4 > bytes.length) break;
            const offset = Number(offsetBits) === 64 ? toSafeNumber(view.getBigUint64(cursor, false)) : view.getUint32(cursor, false);
            cursor += offsetBytes;
            const size = view.getUint32(cursor, false);
            cursor += 4;
            entries.push({ word: core.normalizeWord(word), offset, size });
            completed += 1;
            if (completed % 2000 === 0) onProgress?.({ phase: 'index', completed, total: 0 });
        }
        const sorted = entries.filter(entry => entry.word).sort((a, b) => a.word.localeCompare(b.word));
        onProgress?.({ phase: 'index', completed: sorted.length, total: sorted.length });
        return sorted;
    }

    async function parseIdxAsync(bytes, offsetBits = 32, { signal, onProgress, total = 0 } = {}) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const entries = [];
        let cursor = 0;
        let completed = 0;
        const offsetBytes = Number(offsetBits) === 64 ? 8 : 4;
        while (cursor < bytes.length) {
            if (signal?.aborted) throw abortError();
            const end = bytes.indexOf(0, cursor);
            if (end < 0) break;
            const word = new TextDecoder('utf-8').decode(bytes.slice(cursor, end));
            cursor = end + 1;
            if (cursor + offsetBytes + 4 > bytes.length) break;
            const offset = Number(offsetBits) === 64 ? toSafeNumber(view.getBigUint64(cursor, false)) : view.getUint32(cursor, false);
            cursor += offsetBytes;
            const size = view.getUint32(cursor, false);
            cursor += 4;
            if (word) entries.push({ word: core.normalizeWord(word), offset, size });
            completed += 1;
            if (completed % 2000 === 0) {
                onProgress?.({ phase: 'index', completed, total: total || 0 });
                await yieldToUi();
            }
        }
        const sorted = entries.filter(entry => entry.word).sort((a, b) => a.word.localeCompare(b.word));
        onProgress?.({ phase: 'index', completed: sorted.length, total: total || sorted.length });
        return sorted;
    }

    function toSafeNumber(value) {
        const number = Number(value);
        if (!Number.isSafeInteger(number)) throw new Error('StarDict 词典偏移超出 JavaScript 安全整数范围');
        return number;
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

    function decodeDictionaryRecord(bytes, sameTypeSequence = 'm', explicitTypes = '') {
        const typeSequence = String(explicitTypes || sameTypeSequence || 'm');
        const fields = {};
        let cursor = 0;
        if (explicitTypes) {
            for (const type of typeSequence) {
                if (cursor >= bytes.length) break;
                const end = bytes.indexOf(0, cursor);
                const value = bytes.slice(cursor, end < 0 ? bytes.length : end);
                cursor = end < 0 ? bytes.length : end + 1;
                fields[type] = decodeField(value, type);
            }
        } else {
            // Without sametypesequence each field is [type][uint32 length][data].
            // A few hand-made dictionaries omit that header; retain a safe
            // plain/HTML fallback for those files.
            let parsedTyped = false;
            while (cursor + 5 <= bytes.length && /^[A-Za-z]$/.test(String.fromCharCode(bytes[cursor]))) {
                const type = String.fromCharCode(bytes[cursor]);
                const size = new DataView(bytes.buffer, bytes.byteOffset + cursor + 1, 4).getUint32(0, false);
                if (size > bytes.length - cursor - 5) break;
                cursor += 5; fields[type] = decodeField(bytes.slice(cursor, cursor + size), type); cursor += size; parsedTyped = true;
            }
            if (!parsedTyped) {
                const end = bytes.indexOf(0);
                fields.m = decodeField(bytes.slice(0, end < 0 ? bytes.length : end), 'm');
            }
        }
        const html = fields.m || fields.t || Object.values(fields).find(Boolean) || '';
        return { fields, html, text: stripMarkup(html), pronunciation: fields.x || fields.k || '' };
    }

    function decodeField(bytes, type) {
        if (['W', 'P'].includes(type)) return '';
        return new TextDecoder('utf-8').decode(bytes).trim();
    }
    function stripMarkup(value) { return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
    function abortError() { const error = new Error('导入已取消'); error.name = 'AbortError'; return error; }
    function yieldToUi() { return new Promise(resolve => setTimeout(resolve, 0)); }

    async function readBytes(value) {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer());
        throw new Error('StarDict 文件缺失');
    }
    async function readSlice(value, offset, size) {
        if (value?.slice) return readBytes(await value.slice(offset, offset + size));
        const bytes = await readBytes(value);
        return bytes.slice(offset, offset + size);
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

    return { StarDictProvider, parseIfo, parseIdx, parseIdxAsync, binaryFind, decompressGzip, decodeDictionaryRecord };
});
