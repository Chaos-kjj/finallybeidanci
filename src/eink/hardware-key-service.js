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
            this.mapping = { ...DEFAULT_MAPPING, ...mapping };
            this.onKey = onKey;
            this.lastKey = null;
            this.debugCapture = false;
            this.bound = event => this.handleDomKey(event);
        }
        start() {
            this.document?.addEventListener('keydown', this.bound, true);
            this.bridge?.addListener?.('androidKey', event => this.handleNativeKey(event));
        }
        stop() { this.document?.removeEventListener('keydown', this.bound, true); }
        setMapping(mapping) { this.mapping = { ...this.mapping, ...mapping }; }
        setDebugCapture(enabled) {
            this.debugCapture = Boolean(enabled);
            this.bridge?.setDebugCapture?.({ enabled: this.debugCapture }).catch?.(() => {});
        }
        handleNativeKey(event = {}) {
            const keyCode = Number(event.keyCode ?? event.code ?? -1);
            this.lastKey = { keyCode, source: 'native', capture: this.debugCapture, at: new Date().toISOString() };
            this.onKey(this.actionFor(keyCode), this.lastKey);
        }
        handleDomKey(event) {
            const target = event?.target;
            if (target?.matches?.('input, textarea, select, button, [contenteditable="true"]')) return;
            const keyCode = Number(event.keyCode ?? event.which ?? -1);
            this.lastKey = { keyCode, source: 'dom', capture: this.debugCapture, at: new Date().toISOString() };
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
    function getBridge() { return globalThis.Capacitor?.Plugins?.KeyEvents || null; }
    return { DEFAULT_MAPPING, HardwareKeyService };
});
