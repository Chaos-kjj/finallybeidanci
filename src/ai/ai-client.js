(function (root, factory) {
    const api = factory(root?.KangkangAi || {}, root?.KangkangSecure || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangAi = { ...(root.KangkangAi || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (templates, secure) {
    let requestSequence = 0;

    class AiError extends Error {
        constructor(message, code, status = 0) { super(message); this.name = 'AiError'; this.code = code; this.status = status; }
    }

    class AiClient {
        constructor({ config = {}, secureKeyStore = secure.createSecureKeyStore?.(), nativeBridge = getNativeBridge(), transport = null, cache = null, sleep = defaultSleep, random = Math.random } = {}) {
            this.config = normalizeConfig(config);
            this.secureKeyStore = secureKeyStore;
            this.nativeBridge = nativeBridge;
            this.transport = transport;
            this.cache = cache;
            this.sleep = sleep;
            this.random = random;
            this.inFlight = new Map();
        }
        setConfig(config) { this.config = normalizeConfig({ ...this.config, ...config }); }
        async request(action, context = {}, { signal, bypassCache = false } = {}) {
            if (!action || !action.enabled) throw new AiError('该 AI 操作已停用', 'DISABLED');
            const rendered = {
                system: templates.renderTemplate(action.systemPrompt, context),
                user: templates.renderTemplate(action.userPrompt, context)
            };
            const cacheKey = await createCacheKey(action.id, rendered, this.config.model, this.config, context);
            if (!bypassCache && this.cache) {
                let cached = null;
                try { cached = await this.cache.get(cacheKey); } catch (_) { /* cache corruption must not block an AI request */ }
                // Never let an old/partial cache entry advance a learning flow.
                // Older builds could have stored a response marked truncated.
                if (cached && !cached.truncated && typeof cached.text === 'string' && cached.text.trim()) return { ...cached, cached: true };
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
            const extracted = extractResponse(response);
            const result = {
                text: extracted.text,
                truncated: extracted.truncated,
                reasoningTokens: extracted.reasoningTokens,
                finishReason: extracted.finishReason,
                actionId: action.id,
                bookId: String(context.bookId || ''),
                cacheKey,
                createdAt: new Date().toISOString(),
                cached: false
            };
            if (this.cache) { try { await this.cache.put(cacheKey, result); } catch (_) { /* cache quota/errors must not discard a valid response */ } }
            return result;
        }
        async send(body, { signal, baseUrl, timeoutMs }) {
            validateBaseUrl(baseUrl, this.config.allowHttp);
            for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
                try { return await this.sendOnce(body, { signal, baseUrl, timeoutMs }); }
                catch (error) {
                    if (!(error instanceof AiError) || !isRetryableError(error) || attempt >= this.config.maxRetries) throw error;
                    const delay = Math.min(8000, 500 * (2 ** attempt)) + Math.round(this.random() * 250);
                    await abortableSleep(delay, signal, this.sleep);
                }
            }
            throw new AiError('AI 请求失败', 'NETWORK');
        }
        async sendOnce(body, { signal, baseUrl, timeoutMs }) {
            const timeout = new AbortController();
            const timer = setTimeout(() => timeout.abort(), timeoutMs);
            const combinedSignal = combineSignals(signal, timeout.signal);
            try {
                if (combinedSignal.aborted) throw abortError();
                if (this.nativeBridge?.request) {
                    const requestId = `ai-${Date.now()}-${++requestSequence}`;
                    // AbortSignal is not JSON-serializable across the Capacitor
                    // bridge. Cancellation is carried by requestId + cancel;
                    // the signal still governs the JS-side race immediately.
                    const requestPromise = this.nativeBridge.request({ baseUrl, body, timeoutMs, requestId });
                    const result = await awaitAbortable(requestPromise, combinedSignal, () => this.nativeBridge.cancel?.({ requestId }));
                    if (result?.status && result.status >= 400) throw mapHttpError(result.status, result.body);
                    return result?.body || result;
                }
                if (this.transport) {
                    const result = await awaitAbortable(this.transport({ baseUrl, body, signal: combinedSignal }), combinedSignal);
                    if (result?.status && result.status >= 400) throw mapHttpError(result.status, result.body);
                    return result?.body || result;
                }
                throw new AiError('当前环境没有原生安全网络桥；AI 操作在浏览器测试模式外不可用', 'NO_NATIVE_BRIDGE');
            } catch (error) {
                if (error?.name === 'AbortError' || combinedSignal.aborted) throw new AiError(signal?.aborted ? 'AI 请求已取消' : 'AI 请求超时', signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
                throw error instanceof AiError ? error : new AiError(error.message || 'AI 请求失败', 'NETWORK');
            } finally { clearTimeout(timer); }
        }
        async testConnection({ signal } = {}) {
            const response = await this.send({
                model: this.config.model,
                messages: [{ role: 'user', content: '只回复 OK。' }],
                temperature: 0,
                max_tokens: Math.max(128, Math.min(512, this.config.maxTokens)),
                stream: false
            }, { signal, baseUrl: this.config.baseUrl, timeoutMs: this.config.timeoutMs });
            try { return extractResponse(response); }
            catch (error) {
                // Reasoning models may prove connectivity while exhausting the
                // response budget before producing final content. Surface that
                // as a successful-but-truncated self-check, never as usable
                // learning output.
                if (error instanceof AiError && error.code === 'TRUNCATED_RESPONSE') {
                    return { text: '', truncated: true, reasoningOnly: true, reasoningTokens: error.reasoningTokens || 0, finishReason: 'length' };
                }
                throw error;
            }
        }
    }

    function normalizeConfig(config = {}) {
        const requestedTemperature = Number(config.temperature);
        return {
            baseUrl: String(config.baseUrl || 'https://tokenrhythm.studio/v1/chat/completions').trim(),
            model: String(config.model || 'deepseek-v4-flash-0731').trim(),
            temperature: Math.min(2, Math.max(0, Number.isFinite(requestedTemperature) ? requestedTemperature : 0.2)),
            maxTokens: Math.min(8192, Math.max(64, Number(config.maxTokens) || 512)),
            timeoutMs: Math.min(120000, Math.max(5000, Number(config.timeoutMs) || 60000)),
            maxRetries: Math.min(3, Math.max(0, Number.isFinite(Number(config.maxRetries)) ? Math.round(Number(config.maxRetries)) : 2)),
            allowHttp: config.allowHttp === true
        };
    }

    function getNativeBridge() {
        const plugin = globalThis.Capacitor?.Plugins?.NativeAi || globalThis.Capacitor?.Plugins?.KangkangAi;
        return plugin ? { request: args => plugin.request(args), cancel: args => plugin.cancel?.(args) } : null;
    }

    function extractResponse(response) {
        const choice = response?.choices?.[0] || {};
        const message = choice?.message || {};
        const content = message?.content ?? choice?.text ?? response?.text;
        const text = Array.isArray(content) ? content.map(item => typeof item === 'string' ? item : item?.text || '').join('') : content;
        const reasoning = message?.reasoning_content ?? message?.reasoning ?? choice?.reasoning_content ?? response?.reasoning_content;
        const finishReason = String(choice?.finish_reason || '').toLowerCase();
        const reasoningTokens = Number(response?.usage?.completion_tokens_details?.reasoning_tokens || response?.usage?.reasoning_tokens || 0);
        if (finishReason === 'length') {
            const error = new AiError('AI 已响应，但输出被截断或推理耗尽了额度；请提高 Max tokens 后重试', 'TRUNCATED_RESPONSE');
            error.reasoningTokens = reasoningTokens;
            throw error;
        }
        if (typeof text !== 'string' || !text.trim()) {
            if ((typeof reasoning === 'string' && reasoning.trim()) || (finishReason === 'length' && reasoningTokens > 0)) {
                const error = new AiError('AI 已响应，但推理耗尽了输出额度；请提高 Max tokens 后重试', 'TRUNCATED_RESPONSE');
                error.reasoningTokens = reasoningTokens;
                throw error;
            }
            throw new AiError('AI 返回内容为空或格式异常', 'MALFORMED_RESPONSE');
        }
        return { text: text.trim(), truncated: finishReason === 'length', reasoningTokens, finishReason };
    }
    function extractResponseText(response) { return extractResponse(response).text; }

    function mapHttpError(status, body) {
        const message = body?.error?.message || body?.message || `AI 服务返回 ${status}`;
        if (status === 401) return new AiError('API Key 无效或已过期', 'UNAUTHORIZED', status);
        if (status === 429) return new AiError('AI 请求过于频繁，请稍后重试', 'RATE_LIMITED', status);
        if (status >= 500) return new AiError('AI 服务暂时不可用', 'SERVER_ERROR', status);
        return new AiError(message, 'HTTP_ERROR', status);
    }

    function isRetryableError(error) {
        return ['RATE_LIMITED', 'SERVER_ERROR', 'NETWORK', 'TIMEOUT'].includes(error?.code);
    }

    async function createCacheKey(actionId, rendered, model, config = {}, context = {}) {
        const input = `${actionId}\n${model}\n${config.baseUrl || ''}\n${config.temperature ?? ''}\n${config.maxTokens ?? ''}\n${context.bookId || ''}\n${rendered.system}\n${rendered.user}`;
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
    function validateBaseUrl(baseUrl, allowHttp = false) {
        let parsed;
        try { parsed = new URL(String(baseUrl || '')); } catch (_) { throw new AiError('AI Base URL 必须是有效的 HTTPS 地址', 'INVALID_URL'); }
        const protocolAllowed = parsed.protocol === 'https:' || (allowHttp && parsed.protocol === 'http:');
        if (!protocolAllowed || !parsed.hostname || parsed.username || parsed.password) throw new AiError('AI Base URL 必须使用 HTTPS 且不能携带凭证', 'INVALID_URL');
        return true;
    }
    function defaultSleep(delay) { return new Promise(resolve => setTimeout(resolve, delay)); }
    async function abortableSleep(delay, signal, sleep = defaultSleep) {
        if (signal?.aborted) throw abortError();
        if (sleep !== defaultSleep) { await sleep(delay, signal); if (signal?.aborted) throw abortError(); return; }
        await new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => { settled = true; signal?.removeEventListener?.('abort', onAbort); resolve(); }, delay);
            const onAbort = () => { if (settled) return; clearTimeout(timer); settled = true; signal?.removeEventListener?.('abort', onAbort); reject(abortError()); };
            signal?.addEventListener?.('abort', onAbort, { once: true });
        });
    }
    function awaitAbortable(promise, signal, onAbort = null) {
        if (!signal) return promise;
        if (signal.aborted) { onAbort?.(); return Promise.reject(abortError()); }
        return new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => signal.removeEventListener?.('abort', abort);
            const finish = (callback, value) => { if (settled) return; settled = true; cleanup(); callback(value); };
            const abort = () => {
                if (settled) return;
                try {
                    const cancellation = onAbort?.();
                    cancellation?.catch?.(() => {});
                } catch (_) { /* cancellation is best effort */ }
                finish(reject, abortError());
            };
            signal.addEventListener?.('abort', abort, { once: true });
            Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
        });
    }
    function abortError() { return new AiError('AI 请求已取消', 'CANCELLED'); }
    return { AiClient, AiError, normalizeConfig, validateBaseUrl, extractResponse, extractResponseText, mapHttpError, isRetryableError, createCacheKey, abortError };
});
