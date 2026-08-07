(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangVocabController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function clampLearningInput(value, { min = 0, max = 200, fallback = min } = {}) { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback; }
    function aiSuccessState({ current, response, onSuccess }) { if (!response || typeof response.text !== 'string' || !response.text.trim()) return current; return onSuccess ? onSuccess(current, response) : current; }
    return { clampLearningInput, aiSuccessState };
});
