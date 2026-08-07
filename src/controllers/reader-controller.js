(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangReaderController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const STATES = Object.freeze(['idle', 'opening', 'reading', 'menu', 'feedback', 'closed', 'error']);
    const TRANSITIONS = {
        idle: ['opening', 'closed'], opening: ['reading', 'error', 'closed'], reading: ['menu', 'feedback', 'closed', 'error'], menu: ['reading', 'feedback', 'closed'], feedback: ['reading', 'menu', 'closed'], error: ['opening', 'closed'], closed: ['opening', 'idle']
    };
    class ReaderStateMachine {
        constructor(initial = 'idle') { this.state = STATES.includes(initial) ? initial : 'idle'; }
        transition(next) { if (!STATES.includes(next)) throw new Error(`未知阅读状态：${next}`); if (next !== this.state && !TRANSITIONS[this.state]?.includes(next)) throw new Error(`阅读状态不能从 ${this.state} 转为 ${next}`); this.state = next; return this.state; }
        reset() { this.state = 'idle'; return this.state; }
    }
    function normalizeProgression(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0; }
    function scrollProgression(scrollTop, scrollHeight, clientHeight) { return normalizeProgression(Number(scrollTop) / Math.max(1, Number(scrollHeight) - Number(clientHeight))); }
    function restoreScrollTop(progression, scrollHeight, clientHeight) { return Math.round(normalizeProgression(progression) * Math.max(0, Number(scrollHeight) - Number(clientHeight))); }
    function pageProgression(page, pageCount) { return normalizeProgression(Number(page) / Math.max(1, Number(pageCount) - 1)); }
    return { STATES, TRANSITIONS, ReaderStateMachine, normalizeProgression, scrollProgression, restoreScrollTop, pageProgression };
});
