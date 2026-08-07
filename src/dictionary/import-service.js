(function (root, factory) {
    const api = factory(root?.KangkangDictionary || {}, root?.KangkangStarDict || {}, root?.KangkangMdx || {}, root?.KangkangSecurity || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangDictionaryImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (dictionary, stardict, mdx, security) {
    class DictionaryImportService {
        constructor({ store = null, readZip = null } = {}) { this.store = store; this.readZip = readZip; }
        async importFiles(files, { signal, onProgress } = {}) {
            const list = Array.from(files || []);
            if (!list.length) throw new Error('没有选择词典文件');
            if (signal?.aborted) throw abortError();
            const names = list.map(file => String(file.name || '').toLowerCase());
            const id = `dict-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            let provider;
            const sourceFiles = [];
            if (names.some(name => name.endsWith('.ifo'))) {
                const find = suffix => list.find(file => String(file.name).toLowerCase().endsWith(suffix));
                const ifo = find('.ifo');
                const idx = find('.idx');
                const dictFile = find('.dict') || find('.dict.dz');
                if (!ifo || !idx || !dictFile) throw new Error('StarDict 需要 .ifo、.idx 和 .dict/.dict.dz');
                sourceFiles.push({ role: 'ifo', file: ifo }, { role: 'idx', file: idx }, { role: /\.dict\.dz$/i.test(dictFile.name) ? 'dictDz' : 'dict', file: dictFile });
                provider = new stardict.StarDictProvider({ metadata: { id, name: String(ifo.name).replace(/\.ifo$/i, '') }, ifo, idx, dict: /\.dict\.dz$/i.test(dictFile.name) ? null : dictFile, dictDz: /\.dict\.dz$/i.test(dictFile.name) ? dictFile : null });
            } else if (names.some(name => name.endsWith('.mdx'))) {
                const mdxFile = list.find(file => String(file.name).toLowerCase().endsWith('.mdx'));
                const mddFile = list.find(file => String(file.name).toLowerCase().endsWith('.mdd'));
                sourceFiles.push({ role: 'mdx', file: mdxFile });
                if (mddFile) sourceFiles.push({ role: 'mdd', file: mddFile });
                provider = new mdx.MdxProvider({ metadata: { id, name: mdxFile.name.replace(/\.mdx$/i, '') }, mdx: mdxFile, mdd: mddFile });
            } else if (names.some(name => name.endsWith('.zip'))) {
                const packageFile = list.find(file => String(file.name).toLowerCase().endsWith('.zip'));
                sourceFiles.push({ role: 'package', file: packageFile });
                provider = await this.importAppZip(packageFile, { id });
            } else throw new Error('不支持的词典格式');

            await provider.open();
            if (signal?.aborted) throw abortError();
            onProgress?.({ completed: 1, total: 1 });
            const metadata = { ...provider.metadata, id, entryCount: provider.entries?.length || 0, importedAt: new Date().toISOString(), sourceFiles: sourceFiles.map(item => ({ role: item.role, name: item.file.name, mime: item.file.type || 'application/octet-stream' })) };
            if (this.store) {
                const storedFileIds = [];
                try {
                    await this.store.put('dictionaries', metadata);
                    for (const [index, entry] of (provider.entries || []).entries()) await this.store.put('dictionaryEntries', { id: `${id}:${index}`, dictionaryId: id, entry });
                    for (const item of sourceFiles) {
                        const fileId = `${id}:${item.role}`;
                        await this.store.put('files', { id: fileId, dictionaryId: id, role: item.role, name: item.file.name, mime: item.file.type || 'application/octet-stream', data: item.file });
                        storedFileIds.push(fileId);
                    }
                } catch (error) {
                    await this.store.delete('dictionaries', id).catch(() => {});
                    for (const fileId of storedFileIds) await this.store.delete('files', fileId).catch(() => {});
                    const entries = await this.store.getAll('dictionaryEntries').catch(() => []);
                    for (const entry of entries.filter(item => item.dictionaryId === id)) await this.store.delete('dictionaryEntries', entry.id).catch(() => {});
                    throw error;
                }
            }
            return { provider, metadata };
        }
        async importAppZip(file, { id }) {
            if (!this.readZip) throw new Error('ZIP 词典读取器未加载');
            const files = await this.readZip(new Uint8Array(await file.arrayBuffer()));
            const manifestBytes = files['manifest.json'];
            const entriesBytes = files['entries.json'] || files['entries.jsonl'];
            if (!manifestBytes || !entriesBytes) throw new Error('应用词典 ZIP 缺少 manifest.json 或 entries.json');
            const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
            const raw = new TextDecoder().decode(entriesBytes);
            const entries = entriesBytes === files['entries.jsonl']
                ? raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
                : JSON.parse(raw);
            return new dictionary.IndexedDictionaryProvider(entries.map(entry => ({ ...entry, html: security.sanitizeHtml ? security.sanitizeHtml(entry.html || entry.definition || '') : entry.html })), { ...manifest, id, format: 'app-zip' });
        }
    }
    function abortError() { const error = new Error('导入已取消'); error.name = 'AbortError'; return error; }
    return { DictionaryImportService, abortError };
});
