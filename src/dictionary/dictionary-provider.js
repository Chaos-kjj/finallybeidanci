(function (root, factory) {
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecurity || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangDictionary = { ...(root.KangkangDictionary || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, security) {
    class DictionaryProvider {
        constructor(metadata = {}) { this.metadata = { enabled: true, order: 0, ...metadata }; }
        async open() { return this; }
        async lookup() { return []; }
        async close() {}
    }

    class BuiltinDictionaryProvider extends DictionaryProvider {
        constructor({ basePath = './dict/', fetchRef = globalThis.fetch, manifest = null } = {}) {
            super({ id: 'builtin-collins', name: '内置 Collins', format: 'builtin', author: 'Collins', enabled: true, order: 0 });
            this.basePath = basePath;
            // `window.fetch` needs its window receiver in Chromium/WebView. Keep
            // the injected fetch seam for tests while binding the native one.
            this.fetch = typeof fetchRef === 'function' ? fetchRef.bind(globalThis) : fetchRef;
            this.manifest = manifest;
            this.shards = new Map();
        }
        async open() {
            if (!this.manifest) {
                const response = await this.fetch(`${this.basePath}manifest.json`, { cache: 'no-store' });
                if (!response.ok) throw new Error(`内置词典不可用：${response.status}`);
                this.manifest = await response.json();
            }
            return this;
        }
        async lookup(word) {
            await this.open();
            for (const candidate of core.normalizeLookupCandidates(word)) {
                const shardId = shardFor(candidate);
                const shard = await this.loadShard(shardId);
                const entry = shard?.[candidate];
                if (entry?.d) return [{ providerId: this.metadata.id, headword: entry.w || candidate, pronunciation: '', html: security.sanitizeHtml ? security.sanitizeHtml(entry.d) : entry.d, text: entry.d, source: this.metadata.name }];
            }
            return [];
        }
        async loadShard(id) {
            if (this.shards.has(id)) return this.shards.get(id);
            const item = this.manifest?.shards?.[id];
            if (!item?.file) return {};
            const response = await this.fetch(`${this.basePath}${item.file}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`词典分片不可用：${response.status}`);
            const data = await response.json();
            this.shards.set(id, data);
            return data;
        }
    }

    class IndexedDictionaryProvider extends DictionaryProvider {
        constructor(entries = [], metadata = {}) {
            super(metadata);
            this.entries = new Map();
            entries.forEach(entry => this.add(entry));
        }
        add(entry) {
            const word = core.normalizeWord(entry?.word || entry?.headword);
            if (!word) return;
            const list = this.entries.get(word) || [];
            list.push({ ...entry, word, html: security.sanitizeHtml ? security.sanitizeHtml(entry.html || entry.definition || '') : String(entry.html || entry.definition || '') });
            this.entries.set(word, list);
        }
        async lookup(word, options = {}) {
            const candidates = core.normalizeLookupCandidates(word);
            for (const candidate of candidates) {
                const exact = this.entries.get(candidate);
                if (exact?.length) return exact.map(item => ({ ...item, providerId: this.metadata.id, source: this.metadata.name }));
            }
            if (options.prefix) {
                const prefix = core.normalizeWord(word);
                return Array.from(this.entries.entries()).filter(([key]) => key.startsWith(prefix)).slice(0, 20).flatMap(([, list]) => list).map(item => ({ ...item, providerId: this.metadata.id, source: this.metadata.name }));
            }
            return [];
        }
    }

    function shardFor(value) {
        let hash = 2166136261;
        for (const char of String(value)) {
            hash ^= char.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).slice(-2).padStart(2, '0');
    }

    class DictionaryManager {
        constructor(providers = []) { this.providers = providers; }
        setProviders(providers) { this.providers = [...providers].sort((a, b) => Number(a.metadata.order || 0) - Number(b.metadata.order || 0)); }
        async lookup(word, options = {}) {
            const result = [];
            for (const provider of this.providers.filter(item => item.metadata.enabled !== false)) {
                try { result.push(...await provider.lookup(word, options)); } catch (error) { result.push({ providerId: provider.metadata.id, source: provider.metadata.name, error: error.message }); }
            }
            return result;
        }
    }

    return { DictionaryProvider, BuiltinDictionaryProvider, IndexedDictionaryProvider, DictionaryManager, shardFor };
});
