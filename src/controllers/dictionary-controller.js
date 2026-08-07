(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangDictionaryController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    class DictionaryRepository {
        constructor(store) { this.store = store; }
        async setEnabled(metadata, enabled) { const next = { ...metadata, enabled: enabled !== false, updatedAt: new Date().toISOString() }; await this.store.put('dictionaries', next); return next; }
        async delete(dictionaryId) {
            const entries = await this.store.getAll('dictionaryEntries'); const files = await this.store.getAll('files');
            return this.store.transaction(['dictionaries', 'dictionaryEntries', 'files'], targets => {
                targets.dictionaries.delete(dictionaryId); entries.filter(item => item.dictionaryId === dictionaryId).forEach(item => targets.dictionaryEntries.delete(item.id)); files.filter(item => item.dictionaryId === dictionaryId).forEach(item => targets.files.delete(item.id));
                return { dictionaryId, entries: entries.filter(item => item.dictionaryId === dictionaryId).length, files: files.filter(item => item.dictionaryId === dictionaryId).length };
            });
        }
    }
    return { DictionaryRepository };
});
