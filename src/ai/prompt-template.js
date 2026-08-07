(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangAi = { ...(root.KangkangAi || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const VARIABLES = ['selection', 'sentence', 'paragraph', 'chapterTitle', 'bookTitle', 'sourceLanguage', 'targetLanguage'];

    function renderTemplate(template, context = {}) {
        return String(template || '').replace(/{{\s*([a-zA-Z][\w]*)\s*}}/g, (match, name) => Object.prototype.hasOwnProperty.call(context, name) ? String(context[name] ?? '') : match);
    }

    function normalizeAction(raw = {}, fallback = {}) {
        return {
            id: String(raw.id || fallback.id || `action-${Date.now()}`),
            label: String(raw.label || fallback.label || '自定义操作').slice(0, 40),
            systemPrompt: String(raw.systemPrompt || fallback.systemPrompt || '你是一个简洁的阅读助手。'),
            userPrompt: String(raw.userPrompt || fallback.userPrompt || '{{selection}}'),
            resultMode: ['text', 'json'].includes(raw.resultMode) ? raw.resultMode : (fallback.resultMode || 'text'),
            enabled: raw.enabled !== false,
            auto: raw.auto === true,
            order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 100
        };
    }

    function defaultActions() {
        return [
            normalizeAction({ id: 'lookup', label: '查词', systemPrompt: '你是一个英汉词典。返回简洁中文释义。', userPrompt: '{{selection}}', resultMode: 'text', order: 10 }),
            normalizeAction({ id: 'explain', label: 'AI 解释', systemPrompt: '你是英语阅读老师，请用中文解释选中文本在上下文中的含义。', userPrompt: '选中文本：{{selection}}\n上下文：{{paragraph}}\n书名：{{bookTitle}}\n章节：{{chapterTitle}}', order: 20 }),
            normalizeAction({ id: 'translate', label: 'AI 翻译', systemPrompt: '你是英译中助手，请给出自然准确的中文翻译。', userPrompt: '{{selection}}', order: 30 }),
            normalizeAction({ id: 'copy', label: '复制', order: 40 }),
            normalizeAction({ id: 'note', label: '做笔记', order: 50 })
        ];
    }

    return { VARIABLES, renderTemplate, normalizeAction, defaultActions };
});
