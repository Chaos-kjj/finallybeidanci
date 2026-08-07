(function (root, factory) {
    const api = factory(root?.KangkangAi || {}, root?.KangkangSecure || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangAi = { ...(root.KangkangAi || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (templates, secure) {
    class AiError extends Error {
        constructor(message, code, status = 0) { super(message); this.name = 'AiError'; this.code = code; this.status = status; }
    }

    class AiClient {
        constructor({ config = {}, secureKeyStore = secure.createSecureKeyStore?.(), nativeBridge = getNativeBridge(), transport = null, cache = null } = {}) {
            this.config = normalizeConfig(config);
            this.secureKeyStore = secureKeyStore;
            this.nativeBridge = nativeBridge;
            this.transport = transport;
            this.cache = cache;
            this.inFlight = new Map();
        }
        setConfig(config) { this.config = normalizeConfig({ ...this.config, ...config }); }
        async testConnection({ signal } = {}) {
            const body = { model: this.config.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0, stream: false };
            const response = await this.send(body, { signal, baseUrl: this.config.baseUrl, timeoutMs: this.config.timeoutMs });
            return { ok: true, response };
        }
        async request(action, context = {}, { signal, bypassCache = false } = {}) {
            if (!action || !action.enabled) throw new AiError('该 AI 操作已停用', 'DISABLED');
            const rendered = {
                system: templates.renderTemplate(action.systemPrompt, context),
                user: templates.renderTemplate(action.userPrompt, context)
            };
            const cacheKey = await createCacheKey(action.id, rendered, this.config.model, this.config.baseUrl);
            if (!bypassCache && this.cache) {
                const cached = await this.cache.get(cacheKey);
                if (cached) return { ...cached, cached: true };
            }
            if (signal?.aborted) throw abortError();
            const request = {
                model: this.config.model,
                messages: [{ role: 'system', content: rendered.system }, { role: 'user', content: rendered.user }],
                temperature: this.config.temperature,
                max_tokens: this.config.maxTokens,
                stream: false
            };
            const response = await this.send(request, { signal, baseUrl: this.config.baseUrl, timeoutMs: this.config.timeoutMs });
            const text = extractResponseText(response);
            // Persist the lookup key on the value as well as in the return shape.  The
            // IndexedDB cache adapter stores values directly and needs a stable primary
            // key when the app is restarted.
            const result = { key: cacheKey, text, actionId: action.id, cacheKey, createdAt: new Date().toISOString(), cached: false };
            if (this.cache) await this.cache.put(cacheKey, result);
            return result;
        }
        async send(body, { signal, baseUrl, timeoutMs }) {
            if (!/^https:\/\//i.test(baseUrl) && !(this.config.allowHttp && /^http:\/\//i.test(baseUrl))) throw new AiError('AI Base URL 必须使用 HTTPS', 'INVALID_URL');
            const timeout = new AbortController();
            const timer = setTimeout(() => timeout.abort(), timeoutMs);
            const combinedSignal = combineSignals(signal, timeout.signal);
            const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            let cancelListener;
            try {
                if (this.nativeBridge?.request) {
                    cancelListener = () => this.nativeBridge.cancel?.({ requestId }).catch?.(() => {});
                    combinedSignal.addEventListener('abort', cancelListener, { once: true });
                    // Do not rely on a native plugin to reject its original
                    // Capacitor call after cancellation. The JS-side race
                    // makes AbortController cancellation deterministic even
                    // when a platform bridge only stops its worker.
                    const result = await abortable(this.nativeBridge.request({ baseUrl, body, timeoutMs, requestId }), combinedSignal);
                    if (result?.status && result.status >= 400) throw mapHttpError(result.status, result.body);
                    return result?.body || result;
                }
                if (this.transport) return this.transport({ baseUrl, body, signal: combinedSignal });
                throw new AiError('当前环境没有原生安全网络桥；AI 操作在浏览器测试模式外不可用', 'NO_NATIVE_BRIDGE');
            } catch (error) {
                if (error?.name === 'AbortError') throw new AiError(signal?.aborted ? 'AI 请求已取消' : 'AI 请求超时', signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
                throw error instanceof AiError ? error : new AiError(error.message || 'AI 请求失败', 'NETWORK');
            } finally {
                clearTimeout(timer);
                if (cancelListener) combinedSignal.removeEventListener('abort', cancelListener);
            }
        }
    }

    function normalizeConfig(config = {}) {
        return {
            baseUrl: String(config.baseUrl || 'https://api.deepseek.com/v1/chat/completions').trim(),
            model: String(config.model || 'deepseek-chat').trim(),
            temperature: Math.min(2, Math.max(0, Number(config.temperature) || 0.2)),
            maxTokens: Math.min(8192, Math.max(32, Number(config.maxTokens) || 512)),
            timeoutMs: Math.min(120000, Math.max(5000, Number(config.timeoutMs) || 30000)),
            allowHttp: config.allowHttp === true
        };
    }

    function getNativeBridge() {
        const plugin = globalThis.Capacitor?.Plugins?.NativeAi || globalThis.Capacitor?.Plugins?.KangkangAi;
        return plugin ? { request: args => plugin.request(args) } : null;
    }

    function extractResponseText(response) {
        const content = response?.choices?.[0]?.message?.content ?? response?.choices?.[0]?.text ?? response?.text;
        if (typeof content !== 'string' || !content.trim()) throw new AiError('AI 返回内容为空或格式异常', 'MALFORMED_RESPONSE');
        return content.trim();
    }

    function mapHttpError(status, body) {
        const message = body?.error?.message || body?.message || `AI 服务返回 ${status}`;
        if (status === 401) return new AiError('API Key 无效或已过期', 'UNAUTHORIZED', status);
        if (status === 429) return new AiError('AI 请求过于频繁，请稍后重试', 'RATE_LIMITED', status);
        if (status >= 500) return new AiError('AI 服务暂时不可用', 'SERVER_ERROR', status);
        return new AiError(message, 'HTTP_ERROR', status);
    }

    async function createCacheKey(actionId, rendered, model, baseUrl = '') {
        const input = `${baseUrl}\n${actionId}\n${model}\n${rendered.system}\n${rendered.user}`;
        if (globalThis.crypto?.subtle) {
            const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
            return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
        }
        let hash = 2166136261;
        for (const char of input) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
        return `fallback-${(hash >>> 0).toString(16)}`;
    }

    function combineSignals(first, second) {
        if (!first) return second;
        if (typeof AbortSignal?.any === 'function') return AbortSignal.any([first, second]);
        const controller = new AbortController();
        [first, second].forEach(signal => signal.addEventListener('abort', () => controller.abort(), { once: true }));
        return controller.signal;
    }
    function abortable(promise, signal) {
        if (!signal) return promise;
        if (signal.aborted) return Promise.reject(abortError());
        return new Promise((resolve, reject) => {
            const onAbort = () => reject(abortError());
            signal.addEventListener('abort', onAbort, { once: true });
            Promise.resolve(promise).then(value => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            }, error => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            });
        });
    }
    function abortError() { return new AiError('AI 请求已取消', 'CANCELLED'); }
    return { AiClient, AiError, normalizeConfig, extractResponseText, mapHttpError, createCacheKey, abortError };
});
