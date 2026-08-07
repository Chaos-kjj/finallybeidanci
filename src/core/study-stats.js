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

    function trend(rawStats, days = 14, end = new Date()) {
        const count = Math.min(366, Math.max(1, Number(days) || 14));
        const stats = normalizeStats(rawStats);
        return recentKeys(count, end).map(key => ({ key, ...(stats.daily[key] || emptyDay()) }));
    }

    function summary(rawStats, end = new Date(), days = 14) {
        const stats = normalizeStats(rawStats);
        const todayKey = dateKey(end);
        const today = normalizeDay(stats.daily[todayKey]);
        const week = recentKeys(7, end).reduce((total, key) => total + (stats.daily[key]?.minutes || 0), 0);
        const recent = trend(stats, days, end);
        return { today, weekMinutes: week, rangeMinutes: recent.reduce((total, day) => total + day.minutes, 0), streak: streak(stats, end), recent };
    }

    // The UI ticks frequently, but this tracker emits the real active duration
    // since the previous tick. It never emits time while hidden/idle and it
    // caps a single gap so a suspended WebView cannot invent hours of study.
    class ActiveTimeTracker {
        constructor({ now = () => Date.now(), idleMs = 120000, maxGapMs = 30000 } = {}) {
            this.now = now;
            this.idleMs = Math.max(1000, Number(idleMs) || 120000);
            this.maxGapMs = Math.max(1000, Number(maxGapMs) || 30000);
            this.lastTickAt = null;
            this.lastInteractionAt = null;
            this.pendingMs = 0;
        }
        touch(when = this.now()) {
            this.lastInteractionAt = Number(when);
            if (this.lastTickAt === null) this.lastTickAt = Number(when);
        }
        tick({ active = true, visible = true, when = this.now() } = {}) {
            const current = Number(when);
            if (!Number.isFinite(current)) return 0;
            if (this.lastTickAt === null) this.lastTickAt = current;
            const elapsed = Math.max(0, current - this.lastTickAt);
            this.lastTickAt = current;
            const interactive = active && visible && (this.lastInteractionAt === null || current - this.lastInteractionAt <= this.idleMs);
            if (!interactive) {
                this.pendingMs = 0;
                return 0;
            }
            this.pendingMs += Math.min(elapsed, this.maxGapMs);
            const minutes = this.pendingMs / 60000;
            this.pendingMs = 0;
            return minutes;
        }
        reset(when = this.now()) {
            this.lastTickAt = Number(when);
            this.lastInteractionAt = Number(when);
            this.pendingMs = 0;
        }
    }

    function createActiveTimeTracker(options) { return new ActiveTimeTracker(options); }

    return { METRICS, dateKey, emptyDay, emptyStats, normalizeDay, normalizeStats, recordEvent, activity, recentKeys, streak, trend, summary, ActiveTimeTracker, createActiveTimeTracker };
});
