(function (root, factory) {
    const api = factory(root?.KangkangCore || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangBookLibrary = { ...(root.KangkangBookLibrary || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
    function normalizeWord(value) {
        return core.normalizeWord ? core.normalizeWord(value) : String(value || '').trim().toLocaleLowerCase();
    }

    function normalizeFormat(type) {
        const value = String(type || '').toLowerCase();
        return value === 'epub' || value === 'pdf' || value === 'html' ? value : 'text';
    }

    function formatLabel(type) {
        return { epub: 'EPUB', pdf: 'PDF', html: 'HTML', text: 'TXT' }[normalizeFormat(type)] || 'TXT';
    }

    function stableBookId(fingerprint) {
        const value = String(fingerprint || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        return `book-${value || 'unknown'}`;
    }

    function toBytes(value) {
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return new TextEncoder().encode(String(value || ''));
    }

    async function fingerprintBytes(value, cryptoRef = globalThis.crypto) {
        const bytes = toBytes(value);
        if (cryptoRef?.subtle?.digest) {
            const digest = await cryptoRef.subtle.digest('SHA-256', bytes);
            return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        }
        return fallbackFingerprint(bytes);
    }

    function fallbackFingerprint(bytes) {
        let left = 2166136261;
        let right = 2654435761;
        for (const byte of bytes) {
            left ^= byte;
            left = Math.imul(left, 16777619);
            right ^= byte + 0x9e;
            right = Math.imul(right, 2246822519);
        }
        return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
    }

    function deterministicTextCover({ title = '未命名书籍', author = '', type = 'text' } = {}) {
        const safeTitle = escapeXml(String(title).slice(0, 48));
        const safeAuthor = escapeXml(String(author).slice(0, 32));
        const safeFormat = escapeXml(formatLabel(type));
        const colors = { epub: ['#111', '#f4f0e6'], pdf: ['#111', '#e9edf2'], html: ['#111', '#f0eee9'], text: ['#111', '#fff'] };
        const [ink, paper] = colors[normalizeFormat(type)] || colors.text;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="680" viewBox="0 0 480 680"><rect width="480" height="680" fill="${paper}"/><rect x="28" y="28" width="424" height="624" fill="none" stroke="${ink}" stroke-width="5"/><text x="52" y="94" font-family="sans-serif" font-size="24" font-weight="700" fill="${ink}">${safeFormat}</text><text x="52" y="210" font-family="sans-serif" font-size="34" font-weight="700" fill="${ink}">${safeTitle}</text><text x="52" y="590" font-family="sans-serif" font-size="22" fill="${ink}">${safeAuthor}</text></svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    function normalizeProgress(progress = {}) {
        const source = progress && typeof progress === 'object' ? progress : {};
        const percent = Math.max(0, Math.min(100, Number(source.percent) || 0));
        return { ...source, version: Math.max(2, Number(source.version) || 2), chapterIndex: Math.max(0, Number(source.chapterIndex) || 0), pageIndex: Math.max(0, Number(source.pageIndex) || 0), pageCount: Math.max(1, Number(source.pageCount) || 1), pdfPage: Math.max(1, Number(source.pdfPage) || 1), percent, updatedAt: source.updatedAt || null };
    }

    function normalizeBookRecord(book = {}, { now = Date.now() } = {}) {
        const type = normalizeFormat(book.type || book.format);
        const title = String(book.title || book.fileName || '未命名书籍').replace(/\.(?:epub|pdf|txt|md|html?|mht)$/i, '') || '未命名书籍';
        const updatedAt = Number(book.updatedAt) || now;
        const lastReadAt = book.lastReadAt || book.progress?.updatedAt || (book.percent > 0 ? new Date(updatedAt).toISOString() : null);
        return {
            ...book,
            id: String(book.id || (book.fingerprint ? stableBookId(book.fingerprint) : `book-legacy-${updatedAt}`)),
            title,
            author: String(book.author || ''),
            type,
            format: formatLabel(type),
            fileName: String(book.fileName || ''),
            fingerprint: String(book.fingerprint || ''),
            coverDataUrl: String(book.coverDataUrl || deterministicTextCover({ title, author: book.author, type })),
            progress: normalizeProgress(book.progress),
            notes: Array.isArray(book.notes) ? book.notes : [],
            bookmarks: Array.isArray(book.bookmarks) ? book.bookmarks : [],
            createdAt: Number(book.createdAt) || updatedAt,
            updatedAt,
            lastReadAt
        };
    }

    function sortBooksByRecent(books = []) {
        return [...books].sort((left, right) => {
            const leftTime = Date.parse(left.lastReadAt || '') || Number(left.updatedAt) || Number(left.createdAt) || 0;
            const rightTime = Date.parse(right.lastReadAt || '') || Number(right.updatedAt) || Number(right.createdAt) || 0;
            return rightTime - leftTime;
        });
    }

    function extractWords(selection) {
        const values = String(selection || '').match(/[A-Za-z][A-Za-z'-]*/g) || [];
        return [...new Set(values.map(normalizeWord).filter(Boolean))];
    }

    function mergeErrataWords({ errata = {}, allWords = [], group, words = [] } = {}) {
        const name = String(group || '').trim();
        if (!name) return { errata: clone(errata), allWords: clone(allWords), added: [], duplicates: [...new Set(words.map(normalizeWord).filter(Boolean))], group: '' };
        const nextErrata = clone(errata);
        const nextAllWords = clone(allWords);
        const existing = Array.isArray(nextErrata[name]) ? nextErrata[name].map(normalizeWord).filter(Boolean) : [];
        const existingSet = new Set(existing);
        const added = [];
        const duplicates = [];
        const uniqueWords = [];
        const inputSet = new Set();
        words.map(normalizeWord).filter(Boolean).forEach(word => {
            if (inputSet.has(word)) duplicates.push(word);
            else { inputSet.add(word); uniqueWords.push(word); }
        });
        uniqueWords.forEach(word => {
            if (existingSet.has(word)) duplicates.push(word);
            else { existingSet.add(word); existing.push(word); added.push(word); }
            if (!nextAllWords.some(item => normalizeWord(item?.word) === word)) nextAllWords.push({ word, status: 'new', srsLevel: 0, nextReviewDate: null, updatedAt: new Date().toISOString() });
        });
        nextErrata[name] = existing;
        return { errata: nextErrata, allWords: nextAllWords, added, duplicates, group: name };
    }

    function clone(value) {
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function escapeXml(value) {
        return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    }

    return { normalizeFormat, formatLabel, stableBookId, toBytes, fingerprintBytes, fallbackFingerprint, deterministicTextCover, normalizeProgress, normalizeBookRecord, sortBooksByRecent, extractWords, mergeErrataWords };
});
