(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangReaderUi = { ...(root.KangkangReaderUi || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const TYPOGRAPHY_FIELDS = Object.freeze(['font', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'paragraphSpacing', 'firstLineIndent']);
    const PDF_LAYOUT_FIELDS = Object.freeze(['zoom', 'fitWidth', 'rotate', 'contrast', 'crop', 'invert', 'grayscale', 'pdfView']);

    function normalizeFormat(format) {
        const value = String(format || '').toLowerCase();
        if (['epub', 'pdf', 'html', 'markdown', 'text'].includes(value)) return value;
        return 'text';
    }

    function normalizeFlow(format, flow) {
        const normalizedFormat = normalizeFormat(format);
        const normalizedFlow = String(flow || 'paged');
        if (normalizedFormat === 'pdf') return ['pdf-original', 'pdf-reflow'].includes(normalizedFlow) ? normalizedFlow : 'pdf-original';
        return ['pdf-original', 'pdf-reflow'].includes(normalizedFlow) ? 'paged' : normalizedFlow;
    }

    function settingVisibility(format, flow) {
        const normalizedFormat = normalizeFormat(format);
        const normalizedFlow = normalizeFlow(normalizedFormat, flow);
        const pdfOriginal = normalizedFormat === 'pdf' && normalizedFlow === 'pdf-original';
        return { format: normalizedFormat, typography: normalizedFormat !== 'pdf' || !pdfOriginal, pdfLayout: normalizedFormat === 'pdf' && pdfOriginal, pdfFlow: normalizedFormat === 'pdf', reflow: !pdfOriginal };
    }

    function setVisible(element, visible) {
        if (!element) return Boolean(visible);
        element.classList?.toggle('hidden', !visible);
        return Boolean(visible);
    }

    function toggleReaderMenu(menu, body, visible = null, titleElement = null, title = '') {
        if (!menu) return false;
        const next = visible === null ? menu.classList.contains('hidden') : Boolean(visible);
        menu.classList.toggle('hidden', !next);
        body?.classList?.toggle('reader-menu-open', next);
        if (next && titleElement && title) titleElement.textContent = title;
        return next;
    }

    function toggleReaderPanel(panel, visible, sibling = null) {
        const next = visible === null ? Boolean(panel?.classList.contains('hidden')) : Boolean(visible);
        setVisible(panel, next);
        if (next) setVisible(sibling, false);
        return next;
    }

    function bindReaderMenu({ closeButton, settingsButton, menu, body, settingsPanel, tocPanel, titleElement, getTitle, onClose } = {}) {
        closeButton?.addEventListener('click', () => {
            toggleReaderMenu(menu, body, false);
            setVisible(settingsPanel, false);
            setVisible(tocPanel, false);
            onClose?.();
        });
        settingsButton?.addEventListener('click', () => toggleReaderPanel(settingsPanel, null, tocPanel));
        return { close: () => toggleReaderMenu(menu, body, false), open: () => toggleReaderMenu(menu, body, true, titleElement, getTitle?.() || '') };
    }

    function applyReflowStyles(content, config = {}) {
        if (!content?.style) return;
        content.style.fontFamily = config.font || 'Georgia,serif';
        content.style.fontSize = `${Number(config.fontSize) || 20}px`;
        content.style.fontWeight = String(Number(config.fontWeight) || 400);
        content.style.letterSpacing = `${Number(config.letterSpacing) || 0}px`;
        content.style.lineHeight = String(Number(config.lineHeight) || 1.7);
        content.style.padding = `${Number(config.margin) || 0}px`;
        content.querySelectorAll?.('p').forEach(paragraph => {
            paragraph.style.marginBottom = `${Number(config.paragraphSpacing) || 0}em`;
            paragraph.style.textIndent = `${Number(config.firstLineIndent) || 0}em`;
        });
    }

    function createSettingsStorage(storage, key = 'reader-settings') {
        return {
            load(fallback = {}) {
                try {
                    const raw = storage?.getItem?.(key);
                    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
                } catch (_) { return { ...fallback }; }
            },
            save(value) {
                storage?.setItem?.(key, JSON.stringify(value));
                return value;
            }
        };
    }

    return { TYPOGRAPHY_FIELDS, PDF_LAYOUT_FIELDS, normalizeFormat, normalizeFlow, settingVisibility, setVisible, toggleReaderMenu, toggleReaderPanel, bindReaderMenu, applyReflowStyles, createSettingsStorage };
});
