(function (root, factory) {
    const api = factory(root?.KangkangDictionary || {}, root?.KangkangStarDict || {}, root?.KangkangMdx || {}, root?.KangkangSecurity || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangDictionaryImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (dictionary, stardict, mdx, security) {
    const MAX_SOURCE_FILE_BYTES = 512 * 1024 * 1024;
    const MAX_ENTRY_COUNT = 1_000_000;

    function assertFileSafe(file) {
        const size = Number(file?.size || 0);
        if (size > MAX_SOURCE_FILE_BYTES) throw new Error(`词典文件不能超过 ${Math.round(MAX_SOURCE_FILE_BYTES / 1024 / 1024)} MB`);
        return size;
    }

    class DictionaryImportService {
        constructor({ store = null, readZip = null } = {}) { this.store = store; this.readZip = readZip; }
        async importFiles(files, { signal, onProgress } = {}) {
            const list = Array.from(files || []);
            if (!list.length) throw new Error('没有选择词典文件');
            if (signal?.aborted) throw abortError();
            list.forEach(assertFileSafe);
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
                const packaged = await this.importZipPackage(packageFile, { id, signal });
                provider = packaged.provider;
                sourceFiles.push(...packaged.sourceFiles);
            } else throw new Error('不支持的词典格式');

            onProgress?.({ phase: 'parse', completed: 0, total: 1, message: '正在解析词典…' });
            await provider.open();
            if (signal?.aborted) throw abortError();
            if (Number(provider.getEntryCount?.() || provider.entries?.length || 0) > MAX_ENTRY_COUNT) throw new Error(`词典词条数超过 ${MAX_ENTRY_COUNT.toLocaleString()} 条上限`);
            const exportedEntries = typeof provider.exportEntries === 'function'
                ? provider.exportEntries()
                : Array.isArray(provider.entries) ? provider.entries.map(entry => ({ ...entry })) : [];
            if (exportedEntries.length > MAX_ENTRY_COUNT) throw new Error(`词典词条数超过 ${MAX_ENTRY_COUNT.toLocaleString()} 条上限`);
            const total = 1 + exportedEntries.length + sourceFiles.length;
            let completed = 1;
            onProgress?.({ phase: 'index', completed, total });
            const metadata = {
                ...provider.metadata,
                id,
                entryCount: Number(provider.getEntryCount?.() ?? exportedEntries.length),
                importedAt: new Date().toISOString(),
                sourceSize: sourceFiles.reduce((sum, item) => sum + assertFileSafe(item.file), 0),
                sourceFiles: sourceFiles.map(item => ({ role: item.role, name: item.file.name, mime: item.file.type || 'application/octet-stream', size: Number(item.file.size || 0) }))
            };
            if (this.store) {
                const entryRecords = [];
                for (const [index, entry] of exportedEntries.entries()) {
                    if (signal?.aborted) throw abortError();
                    entryRecords.push({ id: `${id}:${index}`, dictionaryId: id, entry: { ...entry } });
                    completed += 1;
                    if (index % 250 === 0 || index === exportedEntries.length - 1) onProgress?.({ phase: 'index', completed, total });
                    if (index > 0 && index % 1000 === 0) await yieldToUi();
                }
                const fileRecords = sourceFiles.map(item => ({ id: `${id}:${item.role}`, dictionaryId: id, role: item.role, name: item.file.name, mime: item.file.type || 'application/octet-stream', size: Number(item.file.size || 0), data: item.file }));
                if (signal?.aborted) throw abortError();
                await this.store.transaction(['dictionaries', 'dictionaryEntries', 'files'], targets => {
                    targets.dictionaries.put(metadata);
                    entryRecords.forEach(entry => targets.dictionaryEntries.put(entry));
                    fileRecords.forEach(file => targets.files.put(file));
                });
                completed += fileRecords.length;
                onProgress?.({ phase: 'complete', completed, total });
            }
            return { provider, metadata };
        }

        async deleteDictionary(dictionaryId) {
            if (!this.store || !dictionaryId) return;
            const dictionaries = await this.store.getAll('dictionaries');
            if (!dictionaries.some(item => item.id === dictionaryId)) return;
            const entries = await this.store.getAll('dictionaryEntries');
            const files = await this.store.getAll('files');
            await this.store.transaction(['dictionaries', 'dictionaryEntries', 'files'], targets => {
                targets.dictionaries.delete(dictionaryId);
                entries.filter(item => item.dictionaryId === dictionaryId).forEach(item => targets.dictionaryEntries.delete(item.id));
                files.filter(item => item.dictionaryId === dictionaryId).forEach(item => targets.files.delete(item.id));
            });
        }
        async importZipPackage(file, { id, signal } = {}) {
            if (!this.readZip) throw new Error('ZIP 词典读取器未加载');
            assertFileSafe(file);
            if (signal?.aborted) throw abortError();
            const files = await this.readZip(new Uint8Array(await file.arrayBuffer()));
            if (signal?.aborted) throw abortError();
            const totalBytes = Object.values(files || {}).reduce((sum, bytes) => sum + Number(bytes?.byteLength || bytes?.length || 0), 0);
            if (totalBytes > MAX_SOURCE_FILE_BYTES) throw new Error('ZIP 解压后的词典内容超过 512 MB 上限');
            const names = Object.keys(files || {});
            const find = suffix => names.find(name => name.toLowerCase().endsWith(suffix));
            const makeFile = (name, bytes) => {
                const mime = /\.ifo$/i.test(name) ? 'text/plain' : 'application/octet-stream';
                if (typeof File === 'function') return new File([bytes], name, { type: mime });
                return { name, type: mime, size: bytes.byteLength || bytes.length || 0, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
            };
            const ifoName = find('.ifo');
            const idxName = find('.idx');
            const dictName = find('.dict') || find('.dict.dz');
            if (ifoName && idxName && dictName) {
                const ifo = makeFile(ifoName, files[ifoName]);
                const idx = makeFile(idxName, files[idxName]);
                const dict = makeFile(dictName, files[dictName]);
                const dictDz = /.dict\.dz$/i.test(dictName);
                return {
                    provider: new stardict.StarDictProvider({ metadata: { id, name: ifoName.replace(/\.ifo$/i, '') }, ifo, idx, dict: dictDz ? null : dict, dictDz: dictDz ? dict : null }),
                    sourceFiles: [{ role: 'ifo', file: ifo }, { role: 'idx', file: idx }, { role: dictDz ? 'dictDz' : 'dict', file: dict }]
                };
            }
            const manifestBytes = files['manifest.json'];
            const entriesBytes = files['entries.json'] || files['entries.jsonl'];
            if (!manifestBytes || !entriesBytes) throw new Error('应用词典 ZIP 缺少 manifest.json 或 entries.json');
            const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
            const raw = new TextDecoder().decode(entriesBytes);
            const entries = entriesBytes === files['entries.jsonl']
                ? raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
                : JSON.parse(raw);
            if (!Array.isArray(entries) || entries.length > MAX_ENTRY_COUNT) throw new Error(`词典词条数超过 ${MAX_ENTRY_COUNT.toLocaleString()} 条上限`);
            return { provider: new dictionary.IndexedDictionaryProvider(entries.map(entry => ({ ...entry, html: security.sanitizeHtml ? security.sanitizeHtml(entry.html || entry.definition || '') : entry.html })), { ...manifest, id, format: 'app-zip' }), sourceFiles: [{ role: 'package', file }] };
        }
        async importAppZip(file, options = {}) { return (await this.importZipPackage(file, options)).provider; }
    }
    async function yieldToUi() {
        if (typeof requestIdleCallback === 'function') {
            await new Promise(resolve => requestIdleCallback(resolve, { timeout: 50 }));
        } else if (typeof setTimeout === 'function') {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    function abortError() { const error = new Error('导入已取消'); error.name = 'AbortError'; return error; }
    return { DictionaryImportService, abortError };
});
