(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangClipboard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    async function writeText(text, { navigatorRef = globalThis.navigator, documentRef = globalThis.document, nativeClipboard = null } = {}) {
        const value = String(text || '');
        if (!value) throw new Error('没有可复制的内容');
        if (nativeClipboard?.writeText) {
            try { await nativeClipboard.writeText({ text: value }); return { method: 'native' }; } catch (_) { /* fall through to WebView-safe paths */ }
        }
        try {
            if (navigatorRef?.clipboard?.writeText) { await navigatorRef.clipboard.writeText(value); return { method: 'clipboard' }; }
        } catch (_) { /* Android WebView may reject with NotAllowedError */ }
        if (!documentRef?.createElement || !documentRef.body || typeof documentRef.execCommand !== 'function') throw new Error('系统剪贴板不可用，请长按文本复制');
        const textarea = documentRef.createElement('textarea'); textarea.value = value; textarea.setAttribute('readonly', ''); textarea.style.position = 'fixed'; textarea.style.opacity = '0'; textarea.style.pointerEvents = 'none';
        documentRef.body.appendChild(textarea); textarea.select(); textarea.setSelectionRange(0, textarea.value.length);
        let ok = false; try { ok = Boolean(documentRef.execCommand('copy')); } finally { textarea.remove(); }
        if (!ok) throw new Error('系统剪贴板不可用，请长按文本复制');
        return { method: 'execCommand' };
    }
    return { writeText };
});
