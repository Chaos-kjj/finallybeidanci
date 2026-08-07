(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangEink = { ...(root.KangkangEink || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PROFILES = Object.freeze({
        fast: { name: '墨水屏极速', maxRenderPages: 1, progressDebounceMs: 180, sliderDebounceMs: 180 },
        balanced: { name: '墨水屏均衡', maxRenderPages: 2, progressDebounceMs: 300, sliderDebounceMs: 240 },
        quality: { name: '墨水屏质量', maxRenderPages: 3, progressDebounceMs: 500, sliderDebounceMs: 360 }
    });

    function applyEinkProfile(profile = 'balanced', documentRef = globalThis.document) {
        const selected = PROFILES[profile] ? profile : 'balanced';
        const values = PROFILES[selected];
        documentRef?.documentElement?.setAttribute('data-eink-profile', selected);
        documentRef?.documentElement?.style?.setProperty('--eink-progress-debounce', `${values.progressDebounceMs}ms`);
        documentRef?.documentElement?.style?.setProperty('--eink-slider-debounce', `${values.sliderDebounceMs}ms`);
        documentRef?.documentElement?.style?.setProperty('--eink-max-render-pages', String(values.maxRenderPages));
        documentRef?.body?.classList.add('eink-mode');
        return values;
    }

    return { PROFILES, applyEinkProfile };
});
