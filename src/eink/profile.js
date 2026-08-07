(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangEink = { ...(root.KangkangEink || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PROFILES = Object.freeze({
        fast: { name: '墨水屏极速', maxRenderPages: 1, progressDebounceMs: 180, sliderDebounceMs: 180, prefetchPages: 0, fullRefreshEvery: 8, updateMode: 'partial' },
        balanced: { name: '墨水屏均衡', maxRenderPages: 2, progressDebounceMs: 300, sliderDebounceMs: 240, prefetchPages: 1, fullRefreshEvery: 5, updateMode: 'partial-balanced' },
        quality: { name: '墨水屏质量', maxRenderPages: 3, progressDebounceMs: 500, sliderDebounceMs: 360, prefetchPages: 2, fullRefreshEvery: 1, updateMode: 'full' }
    });

    function applyEinkProfile(profile = 'balanced', documentRef = globalThis.document) {
        const selected = PROFILES[profile] ? profile : 'balanced';
        documentRef?.documentElement?.setAttribute('data-eink-profile', selected);
        documentRef?.body?.classList.add('eink-mode');
        return PROFILES[selected];
    }

    class EinkRenderScheduler {
        constructor(profile = 'balanced', { now = () => Date.now(), setTimeoutRef = globalThis.setTimeout, clearTimeoutRef = globalThis.clearTimeout } = {}) {
            this.profile = PROFILES[profile] ? profile : 'balanced';
            this.config = PROFILES[this.profile];
            this.now = now;
            // WebView timer methods are receiver-sensitive; storing the bare
            // window.setTimeout function causes "Illegal invocation" on the
            // first reader render.
            this.setTimeout = typeof setTimeoutRef === 'function' ? setTimeoutRef.bind(globalThis) : globalThis.setTimeout.bind(globalThis);
            this.clearTimeout = typeof clearTimeoutRef === 'function' ? clearTimeoutRef.bind(globalThis) : globalThis.clearTimeout.bind(globalThis);
            this.timer = null;
            this.pendingResolve = null;
            this.pendingReject = null;
            this.renderCount = 0;
            this.lastKey = '';
        }
        setProfile(profile) {
            this.profile = PROFILES[profile] ? profile : 'balanced';
            this.config = PROFILES[this.profile];
        }
        schedule(callback, { key = '', urgent = false } = {}) {
            if (this.timer) {
                this.clearTimeout(this.timer);
                this.timer = null;
                this.pendingResolve?.({ skipped: true, cancelled: true, refresh: this.refreshKind(false) });
                this.pendingResolve = null;
                this.pendingReject = null;
            }
            const delay = urgent ? 0 : this.config.progressDebounceMs;
            return new Promise((resolve, reject) => {
                this.pendingResolve = resolve;
                this.pendingReject = reject;
                this.timer = this.setTimeout(async () => {
                    this.timer = null;
                    this.pendingResolve = null;
                    this.pendingReject = null;
                    try {
                        if (key && key === this.lastKey && !urgent) return resolve({ skipped: true, refresh: this.refreshKind(false) });
                        this.lastKey = key;
                        const result = await callback();
                        this.renderCount += 1;
                        resolve({ result, skipped: false, refresh: this.refreshKind(urgent) });
                    } catch (error) { reject(error); }
                }, delay);
            });
        }
        refreshKind(urgent = false) {
            if (urgent || this.config.updateMode === 'full') return 'full';
            return this.renderCount > 0 && this.renderCount % this.config.fullRefreshEvery === 0 ? 'full' : 'partial';
        }
        cancel() {
            if (this.timer) this.clearTimeout(this.timer);
            this.timer = null;
            this.pendingResolve?.({ skipped: true, cancelled: true, refresh: this.refreshKind(false) });
            this.pendingResolve = null;
            this.pendingReject = null;
        }
    }

    return { PROFILES, EinkRenderScheduler, applyEinkProfile };
});
