(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangCore = { ...(root.KangkangCore || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

    function normalizeWord(value) {
        return String(value || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[’‘`]/g, "'")
            .replace(/^[^a-z]+|[^a-z]+$/g, '')
            .trim();
    }

    function normalizeLookupCandidates(value) {
        const base = normalizeWord(value);
        if (!base) return [];
        const candidates = [];
        const add = candidate => {
            const normalized = normalizeWord(candidate);
            if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
        };
        const irregular = {
            went: 'go', gone: 'go', ran: 'run', running: 'run',
            books: 'book', children: 'child', men: 'man', women: 'woman',
            feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose',
            oxen: 'ox', worse: 'bad', worst: 'bad', better: 'good', best: 'good'
        };
        add(irregular[base] || base);
        add(base);
        if (base.endsWith("'s")) add(base.slice(0, -2));
        if (base.endsWith("s'")) add(base.slice(0, -2));
        if (base.length > 4 && base.endsWith('ies')) add(`${base.slice(0, -3)}y`);
        if (base.length > 4 && base.endsWith('ves')) {
            add(`${base.slice(0, -3)}f`);
            add(`${base.slice(0, -3)}fe`);
        }
        if (base.length > 3 && base.endsWith('es')) add(base.slice(0, -2));
        if (base.length > 3 && base.endsWith('s')) add(base.slice(0, -1));
        if (base.length > 5 && base.endsWith('ying')) add(`${base.slice(0, -4)}ie`);
        if (base.length > 5 && base.endsWith('ing')) {
            const stem = base.slice(0, -3);
            add(stem);
            add(`${stem}e`);
            if (/([bcdfghjklmnpqrstvwxyz])\1$/.test(stem)) add(stem.slice(0, -1));
        }
        if (base.length > 4 && base.endsWith('ied')) add(`${base.slice(0, -3)}y`);
        if (base.length > 4 && base.endsWith('ed')) {
            const stem = base.slice(0, -2);
            add(stem);
            add(`${stem}e`);
            if (/([bcdfghjklmnpqrstvwxyz])\1$/.test(stem)) add(stem.slice(0, -1));
        }
        return candidates;
    }

    function tokenizeWords(value) {
        const text = String(value || '');
        const tokens = [];
        let match;
        while ((match = WORD_RE.exec(text))) {
            tokens.push({ text: match[0], normalized: normalizeWord(match[0]), start: match.index, end: match.index + match[0].length });
        }
        WORD_RE.lastIndex = 0;
        return tokens;
    }

    function stableHash(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function uniqueStrings(values) {
        return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
    }

    return { normalizeWord, normalizeLookupCandidates, tokenizeWords, stableHash, uniqueStrings };
});
