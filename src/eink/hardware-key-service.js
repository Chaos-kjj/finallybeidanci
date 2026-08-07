(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangHardware = { ...(root.KangkangHardware || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULT_MAPPING = Object.freeze({
        next: [24, 93, 22],
        previous: [25, 92, 21],
        back: [4],
        menu: [82]
    });

    class HardwareKeyService {
        constructor({ documentRef = globalThis.document, bridge = getBridge(), mapping = DEFAULT_MAPPING, onKey = () => {} } = {}) {
            this.document = documentRef;
            this.bridge = bridge;
            this.mapping = normalizeMapping({ ...DEFAULT_MAPPING, ...mapping });
            this.onKey = onKey;
            this.lastKey = null;
            this.bound = event => this.handleDomKey(event);
        }
        start() {
            this.document?.addEventListener('keydown', this.bound, true);
            this.bridge?.addListener?.('androidKey', event => this.handleNativeKey(event));
            this.bridge?.setMapping?.(this.mapping).catch?.(() => {});
        }
        stop() { this.document?.removeEventListener('keydown', this.bound, true); }
        setMapping(mapping) {
            this.mapping = normalizeMapping({ ...this.mapping, ...mapping });
            this.bridge?.setMapping?.(this.mapping).catch?.(() => {});
            return this.mapping;
        }
        handleNativeKey(event = {}) {
            const keyCode = Number(event.keyCode ?? event.code ?? -1);
            this.lastKey = { keyCode, source: 'native', at: new Date().toISOString() };
            // Android's system Back must retain the layered app behavior even
            // if a user removes key code 4 from the editable mapping.
            this.onKey(keyCode === 4 ? 'back' : this.actionFor(keyCode), this.lastKey);
        }
        handleDomKey(event) {
            const keyCode = Number(event.keyCode ?? event.which ?? -1);
            this.lastKey = { keyCode, key: event.key || '', source: 'dom', at: new Date().toISOString() };
            this.onKey(this.actionFor(keyCode), this.lastKey, event);
        }
        actionFor(keyCode) {
            if (this.mapping.next.includes(keyCode)) return 'next';
            if (this.mapping.previous.includes(keyCode)) return 'previous';
            if (this.mapping.back.includes(keyCode)) return 'back';
            if (this.mapping.menu.includes(keyCode)) return 'menu';
            return 'unknown';
        }
    }
    function normalizeMapping(mapping = {}) {
        const safe = {};
        ['next', 'previous', 'back', 'menu'].forEach(action => {
            safe[action] = [...new Set((Array.isArray(mapping[action]) ? mapping[action] : []).map(Number).filter(code => Number.isInteger(code) && code >= 0 && code <= 1000))];
        });
        return safe;
    }
    function getBridge() { return globalThis.Capacitor?.Plugins?.KeyEvents || null; }
    return { DEFAULT_MAPPING, HardwareKeyService, normalizeMapping };
});
