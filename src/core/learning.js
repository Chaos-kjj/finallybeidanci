(function (root, factory) {
    const api = factory(root?.KangkangCore || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangLearning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
    // Intervals are minutes: 5m, 30m, 12h, 1d, 2d, 4d, 7d, 15d, 30d.
    const INTERVALS = [5, 30, 720, 1440, 2880, 5760, 10080, 21600, 43200];
    const DEFAULT_SETTINGS = Object.freeze({ newWordsPerDay: 10, reviewWordsPerDay: 20, mode: 'sentence', updatedAt: null });

    function createWordRecord(word, overrides = {}) {
        const status = ['new', 'learning', 'known'].includes(overrides.status) ? overrides.status : 'new';
        return {
            word: core.normalizeWord(word),
            status,
            srsLevel: status === 'known' ? -1 : Math.max(0, Number(overrides.srsLevel) || 0),
            nextReviewDate: status === 'learning' ? (overrides.nextReviewDate || null) : null,
            updatedAt: overrides.updatedAt || new Date().toISOString()
        };
    }

    function normalizeState(raw = {}) {
        const byWord = new Map();
        (Array.isArray(raw.allWords) ? raw.allWords : []).forEach(item => {
            const word = core.normalizeWord(item?.word);
            if (!word) return;
            byWord.set(word, createWordRecord(word, item));
        });
        const addList = (values, status) => (values || []).forEach(value => {
            const word = core.normalizeWord(value);
            if (word && !byWord.has(word)) byWord.set(word, createWordRecord(word, { status }));
        });
        addList(raw.knownWords, 'known');
        addList(raw.reviewWords, 'learning');
        const allWords = Array.from(byWord.values()).sort((a, b) => a.word.localeCompare(b.word));
        return {
            allWords,
            knownWords: allWords.filter(item => item.status === 'known').map(item => item.word),
            reviewWords: allWords.filter(item => item.status === 'learning').map(item => item.word),
            errata: normalizeErrata(raw.errata),
            studyStats: raw.studyStats && typeof raw.studyStats === 'object' ? raw.studyStats : { daily: {}, updatedAt: null },
            learningSettings: normalizeSettings(raw.learningSettings),
            learningPlanProgress: normalizePlanProgress(raw.learningPlanProgress),
            updatedAt: raw.updatedAt || null
        };
    }

    function normalizeErrata(raw) {
        const output = {};
        if (!raw || typeof raw !== 'object') return output;
        Object.entries(raw).forEach(([group, words]) => {
            const values = core.uniqueStrings(Array.isArray(words) ? words : []).map(core.normalizeWord).filter(Boolean);
            if (group.trim()) output[group.trim()] = [...new Set(values)];
        });
        return output;
    }

    function normalizeSettings(raw = {}) {
        const normalizeCount = (value, fallback) => {
            const number = Number(value);
            return Number.isFinite(number)
                ? Math.min(200, Math.max(0, Math.round(number)))
                : fallback;
        };
        return {
            newWordsPerDay: normalizeCount(raw.newWordsPerDay, DEFAULT_SETTINGS.newWordsPerDay),
            reviewWordsPerDay: normalizeCount(raw.reviewWordsPerDay, DEFAULT_SETTINGS.reviewWordsPerDay),
            mode: ['basic', 'sentence', 'listening'].includes(raw.mode) ? raw.mode : DEFAULT_SETTINGS.mode,
            updatedAt: raw.updatedAt || null
        };
    }

    function dateKey(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function normalizePlanProgress(raw = {}, today = dateKey()) {
        if (!raw || raw.dateKey !== today) return { dateKey: today, newWords: [], reviewWords: [] };
        const unique = values => [...new Set((Array.isArray(values) ? values : []).map(core.normalizeWord).filter(Boolean))];
        return {
            dateKey: today,
            newWords: core.uniqueStrings ? core.uniqueStrings(raw.newWords || []).map(core.normalizeWord).filter(Boolean) : unique(raw.newWords),
            reviewWords: core.uniqueStrings ? core.uniqueStrings(raw.reviewWords || []).map(core.normalizeWord).filter(Boolean) : unique(raw.reviewWords)
        };
    }

    function resetForUnknown(record, now = new Date()) {
        if (!record) return null;
        return {
            ...record,
            status: 'learning',
            srsLevel: 0,
            nextReviewDate: new Date(now.getTime() + INTERVALS[0] * 60_000).toISOString(),
            updatedAt: now.toISOString()
        };
    }

    function markKnown(record, now = new Date()) {
        if (!record) return null;
        return { ...record, status: 'known', srsLevel: -1, nextReviewDate: null, updatedAt: now.toISOString() };
    }

    function completeReview(record, now = new Date()) {
        if (!record) return null;
        const currentLevel = Math.max(0, Number(record.srsLevel) || 0);
        const level = Math.min(INTERVALS.length - 1, currentLevel + 1);
        return {
            ...record,
            status: 'learning',
            srsLevel: level,
            nextReviewDate: new Date(now.getTime() + INTERVALS[level] * 60_000).toISOString(),
            updatedAt: now.toISOString()
        };
    }

    function resetToNew(record, now = new Date()) {
        if (!record) return null;
        return { ...record, status: 'new', srsLevel: 0, nextReviewDate: null, updatedAt: now.toISOString() };
    }

    function applyOutcome(record, outcome, now = new Date()) {
        if (!record) return null;
        if (outcome === 'known') return markKnown(record, now);
        if (outcome === 'complete' || outcome === 'review-complete') return completeReview(record, now);
        // “review” is kept as a compatibility alias for the old UI's
        // “不认识” action. It must not advance the SRS level.
        return resetForUnknown(record, now);
    }

    function buildQueue(words, settings, progress = { newWords: [], reviewWords: [] }, now = Date.now()) {
        const normalizedSettings = normalizeSettings(settings);
        const plan = normalizePlanProgress(progress, dateKey(new Date(now)));
        const due = words.filter(word => word.status === 'learning' && word.nextReviewDate && Date.parse(word.nextReviewDate) <= now && !plan.reviewWords.includes(word.word));
        const fresh = words.filter(word => word.status === 'new' && !plan.newWords.includes(word.word));
        return [...due.slice(0, normalizedSettings.reviewWordsPerDay), ...fresh.slice(0, normalizedSettings.newWordsPerDay)];
    }

    function dueWords(words, now = Date.now()) {
        return (words || []).filter(word => word.status === 'learning' && word.nextReviewDate && Date.parse(word.nextReviewDate) <= now);
    }

    return {
        INTERVALS,
        DEFAULT_SETTINGS,
        createWordRecord,
        normalizeState,
        normalizeSettings,
        normalizePlanProgress,
        applyOutcome,
        resetForUnknown,
        markKnown,
        completeReview,
        resetToNew,
        dueWords,
        buildQueue,
        dateKey
    };
});
