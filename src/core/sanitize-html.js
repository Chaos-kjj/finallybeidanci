(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangSecurity = { ...(root.KangkangSecurity || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const BLOCKED_TAG_PATTERN = 'script|style|iframe|object|embed|form|base|meta|link|audio|video|source|track';
    const BLOCKED_TAG_SELECTOR = 'script,style,iframe,object,embed,form,base,meta,link,audio,video,source,track';
    const SAFE_TAGS = new Set([
        'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'code', 'dd', 'div', 'dl',
        'dt', 'em', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
        'img', 'li', 'main', 'mark', 'ol', 'p', 'pre', 'q', 'section', 'small', 'span', 'strong',
        'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
    ]);

    function safeUrl(value, { allowImages = true } = {}) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^(blob:|app-dict:)/i.test(raw)) return raw;
        if (allowImages && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(raw) && raw.length < 2_000_000) return raw;
        return '';
    }

    function sanitizeHtml(input, options = {}) {
        const maxLength = Number(options.maxLength) > 0 ? Number(options.maxLength) : 2_000_000;
        const source = String(input || '').slice(0, maxLength);
        if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
            return source
                .replace(new RegExp(`<\\/?(?:${BLOCKED_TAG_PATTERN})\\b[^>]*>[\\s\\S]*?<\\/?(?:${BLOCKED_TAG_PATTERN})\\s*>`, 'gi'), '')
                .replace(/<\s*(?:script|style|iframe|object|embed|form|base|meta|link)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|iframe|object|embed|form|base|meta|link)\s*>/gi, '')
                .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
                .replace(/\s(?:src|href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, match => /(?:blob:|app-dict:|data:image\/(?:png|jpeg|gif|webp);base64:)/i.test(match) ? match : '')
                .replace(/(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '')
                .replace(/javascript\s*:/gi, '')
                .slice(0, maxLength);
        }
        const parsed = new DOMParser().parseFromString(source, 'text/html');
        parsed.querySelectorAll(BLOCKED_TAG_SELECTOR).forEach(node => node.remove());
        const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_ELEMENT);
        const elements = [];
        let current;
        while ((current = walker.nextNode())) elements.push(current);
        elements.forEach(element => {
            const tag = element.tagName.toLowerCase();
            if (!SAFE_TAGS.has(tag)) {
                element.replaceWith(...Array.from(element.childNodes));
                return;
            }
            Array.from(element.attributes).forEach(attribute => {
                const name = attribute.name.toLowerCase();
                if (name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'integrity') {
                    element.removeAttribute(attribute.name);
                    return;
                }
                if (name === 'href' || name === 'src') {
                    const url = safeUrl(attribute.value, { allowImages: name === 'src' });
                    if (url) element.setAttribute(name, url);
                    else element.removeAttribute(name);
                }
            });
            if (tag === 'a') {
                element.setAttribute('rel', 'noreferrer noopener');
                element.setAttribute('target', '_blank');
            }
        });
        return parsed.body.innerHTML.slice(0, maxLength);
    }

    function stripHtmlToText(input) {
        const clean = sanitizeHtml(input, { maxLength: 2_000_000 });
        if (typeof DOMParser === 'undefined') return clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const doc = new DOMParser().parseFromString(clean, 'text/html');
        return (doc.body?.innerText || '').replace(/\s+/g, ' ').trim();
    }

    return { sanitizeHtml, safeUrl, stripHtmlToText };
});
