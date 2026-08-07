(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangStudyStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const METRICS = ['minutes', 'interactions', 'wordsKnown', 'wordsReviewed', 'readerMinutes', 'vocabMinutes'];

    function dateKey(date = new Date()) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function emptyDay() {
        return { minutes: 0, interactions: 0, wordsKnown: 0, wordsReviewed: 0, readerMinutes: 0, vocabMinutes: 0 };
    }

    function emptyStats() { return { daily: {}, updatedAt: null }; }

    function normalizeDay(raw = {}) {
        const day = emptyDay();
        METRICS.forEach(key => { day[key] = Math.max(0, Number(raw[key]) || 0); });
        return day;
    }

    function normalizeStats(raw = {}) {
        const output = emptyStats();
        if (raw && typeof raw === 'object' && raw.daily && typeof raw.daily === 'object') {
            Object.entries(raw.daily).forEach(([key, value]) => { output.daily[key] = normalizeDay(value); });
        }
        output.updatedAt = raw?.updatedAt || null;
        return output;
    }

    function recordEvent(rawStats, { minutes = 0, interactions = 0, wordsKnown = 0, wordsReviewed = 0, section = 'vocab' } = {}, when = new Date()) {
        const stats = normalizeStats(rawStats);
        const key = dateKey(when);
        const day = stats.daily[key] || emptyDay();
        day.minutes += Math.max(0, Number(minutes) || 0);
        day.interactions += Math.max(0, Number(interactions) || 0);
        day.wordsKnown += Math.max(0, Number(wordsKnown) || 0);
        day.wordsReviewed += Math.max(0, Number(wordsReviewed) || 0);
        if (Number(minutes) > 0) {
            if (section === 'reader') day.readerMinutes += Number(minutes) || 0;
            else day.vocabMinutes += Number(minutes) || 0;
        }
        stats.daily[key] = day;
        stats.updatedAt = when.toISOString();
        return stats;
    }

    function activity(day) {
        const value = normalizeDay(day);
        return value.minutes > 0 || value.interactions > 0 || value.wordsKnown > 0 || value.wordsReviewed > 0;
    }

    function recentKeys(count, end = new Date()) {
        const keys = [];
        for (let offset = count - 1; offset >= 0; offset -= 1) {
            const date = new Date(end);
            date.setHours(12, 0, 0, 0);
            date.setDate(date.getDate() - offset);
            keys.push(dateKey(date));
        }
        return keys;
    }

    function streak(rawStats, end = new Date()) {
        const stats = normalizeStats(rawStats);
        let cursor = new Date(end);
        cursor.setHours(12, 0, 0, 0);
        let count = 0;
        while (activity(stats.daily[dateKey(cursor)])) {
            count += 1;
            cursor.setDate(cursor.getDate() - 1);
        }
        return count;
    }

    function summary(rawStats, end = new Date()) {
        const stats = normalizeStats(rawStats);
        const todayKey = dateKey(end);
        const today = normalizeDay(stats.daily[todayKey]);
        const week = recentKeys(7, end).reduce((total, key) => total + (stats.daily[key]?.minutes || 0), 0);
        return { today, weekMinutes: week, streak: streak(stats, end), recent: recentKeys(14, end).map(key => ({ key, ...(stats.daily[key] || emptyDay()) })) };
    }

    return { METRICS, dateKey, emptyDay, emptyStats, normalizeDay, normalizeStats, recordEvent, activity, recentKeys, streak, summary };
});
