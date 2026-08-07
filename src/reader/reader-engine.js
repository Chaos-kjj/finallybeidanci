(function (root, factory) {
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecurity || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangReader = { ...(root.KangkangReader || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, security) {
    class ReaderEngine {
        constructor(source, options = {}) { this.source = source; this.options = options; this.closed = false; }
        async open() { throw new Error('ReaderEngine.open() must be implemented'); }
        async close() { this.closed = true; }
        async getMetadata() { return {}; }
        async getToc() { return []; }
        async search() { return []; }
    }

    class TextEngine extends ReaderEngine {
        async open() {
            const text = typeof this.source === 'string' ? this.source : await readSourceText(this.source);
            this.text = text.replace(/\r\n?/g, '\n');
            this.paragraphs = splitParagraphs(this.text);
            this.metadata = { title: this.options.title || getSourceName(this.source) || '未命名文本', format: 'text', hasText: Boolean(this.text.trim()) };
            return this;
        }
        async getMetadata() { return this.metadata; }
        async getToc() { return this.paragraphs.map((text, index) => ({ id: `p-${index}`, title: text.slice(0, 80), paragraphIndex: index })); }
        async getChapter(index = 0) { return { index, title: '', html: textToHtml(this.paragraphs[index] || ''), text: this.paragraphs[index] || '' }; }
        async search(query) { return searchParagraphs(this.paragraphs, query); }
    }

    class EpubEngine extends ReaderEngine {
        async open() {
            const parser = globalThis.parseEpubBook;
            if (typeof parser !== 'function') throw new Error('EPUB 解析器未加载');
            const bytes = this.source instanceof ArrayBuffer ? this.source : await readSourceBuffer(this.source);
            this.book = await parser(bytes, this.options);
            this.metadata = { ...this.book, format: 'epub', hasText: this.book.chapters.some(chapter => chapter.text.trim()) };
            this.chapters = this.book.chapters;
            return this;
        }
        async getMetadata() { return this.metadata; }
        async getToc() { return this.book.toc; }
        async getChapter(index = 0) { return this.chapters[index] || null; }
        async search(query) {
            const needle = String(query || '').trim().toLocaleLowerCase();
            if (!needle) return [];
            const results = [];
            this.chapters.forEach((chapter, chapterIndex) => {
                const haystack = chapter.text.toLocaleLowerCase();
                let from = 0;
                while (from < haystack.length) {
                    const index = haystack.indexOf(needle, from);
                    if (index < 0) break;
                    results.push({ chapterIndex, index, excerpt: chapter.text.slice(Math.max(0, index - 60), index + needle.length + 100) });
                    from = index + Math.max(1, needle.length);
                    if (results.length >= 500) return;
                }
            });
            return results;
        }
    }

    class PdfEngine extends ReaderEngine {
        constructor(source, options = {}) { super(source, options); this.pdf = null; this.pageCache = new Map(); }
        async open() {
            const pdfjs = this.options.pdfjsLib || globalThis.pdfjsLib;
            if (!pdfjs?.getDocument) throw new Error('PDF 引擎未打包，请重新构建 APK');
            const data = new Uint8Array(await readSourceBuffer(this.source));
            this.pdf = await pdfjs.getDocument({ data, disableWorker: Boolean(this.options.disableWorker) }).promise;
            this.pageCount = this.pdf.numPages;
            this.textPages = [];
            let hasText = false;
            for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber += 1) {
                const page = await this.pdf.getPage(pageNumber);
                const content = await page.getTextContent();
                const text = pdfItemsToText(content.items || []);
                this.textPages.push(text);
                hasText = hasText || Boolean(text.trim());
                page.cleanup?.();
            }
            this.metadata = { title: this.options.title || getSourceName(this.source) || '未命名 PDF', format: 'pdf', pageCount: this.pageCount, hasText, noTextMessage: hasText ? '' : '本文件没有可选文本，查词和 AI 选择不可用。' };
            return this;
        }
        async getMetadata() { return this.metadata; }
        async getToc() { return []; }
        async getPage(pageNumber = 1) {
            if (!this.pdf) throw new Error('PDF 尚未打开');
            const number = Math.min(this.pageCount, Math.max(1, Number(pageNumber) || 1));
            if (!this.pageCache.has(number)) this.pageCache.set(number, await this.pdf.getPage(number));
            return { pageNumber: number, page: this.pageCache.get(number), text: this.textPages[number - 1] || '' };
        }
        async renderPage(pageNumber, canvas, options = {}) {
            const entry = await this.getPage(pageNumber);
            const rotation = Number(options.rotation) || 0;
            let scale = Number(options.scale) || 1;
            if (options.fitWidth && Number(options.containerWidth) > 0) {
                const natural = entry.page.getViewport({ scale: 1, rotation });
                scale = Math.max(0.1, Number(options.containerWidth) / natural.width);
            }
            const viewport = entry.page.getViewport({ scale, rotation });
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const context = canvas.getContext('2d', { alpha: false });
            await entry.page.render({ canvasContext: context, viewport }).promise;
            return { ...entry, viewport };
        }
        async getReflowText() { return this.textPages.join('\n\n'); }
        async search(query) {
            const needle = String(query || '').trim().toLocaleLowerCase();
            if (!needle) return [];
            return this.textPages.flatMap((text, index) => {
                const position = text.toLocaleLowerCase().indexOf(needle);
                return position < 0 ? [] : [{ pageNumber: index + 1, excerpt: text.slice(Math.max(0, position - 60), position + needle.length + 100) }];
            });
        }
        async close() {
            this.pageCache.forEach(page => page.cleanup?.());
            this.pageCache.clear();
            this.pdf?.destroy?.();
            this.pdf = null;
            await super.close();
        }
    }

    class ReaderSession {
        constructor(engine, { documentRef = globalThis.document } = {}) { this.engine = engine; this.document = documentRef; }
        async paginateChapter(chapter, viewport, settings = {}) {
            return paginateHtmlByViewport(chapter.html || textToHtml(chapter.text || ''), viewport, settings, this.document);
        }
    }

    function paginateHtmlByViewport(html, viewport, settings = {}, documentRef = globalThis.document) {
        const width = Math.max(1, Number(viewport?.width) || 640);
        const height = Math.max(1, Number(viewport?.height) || 900);
        const content = security.sanitizeHtml ? security.sanitizeHtml(html) : String(html || '');
        if (!documentRef?.createElement) return paginateTextByViewport(stripTags(content), { width, height }, settings);
        const host = documentRef.createElement('div');
        host.style.cssText = `position:absolute;left:-100000px;top:0;width:${width}px;height:${height}px;overflow:hidden;visibility:hidden;`;
        const body = documentRef.createElement('div');
        applyTextSettings(body, settings);
        body.style.width = `${width}px`;
        body.style.height = `${height}px`;
        body.style.columnWidth = `${width}px`;
        body.style.columnGap = '0px';
        body.style.columnFill = 'auto';
        body.innerHTML = content;
        host.appendChild(body);
        (documentRef.body || documentRef.documentElement).appendChild(host);
        const totalWidth = Math.max(width, body.scrollWidth, body.getBoundingClientRect?.().width || width);
        const pageCount = Math.max(1, Math.ceil(totalWidth / width));
        const pages = Array.from({ length: pageCount }, (_, index) => ({ index, offset: index * width, width, height }));
        host.remove();
        return { pages, pageCount, html: content, viewport: { width, height }, measured: true };
    }

    function paginateTextByViewport(text, viewport, settings = {}) {
        const fontSize = Math.max(10, Number(settings.fontSize) || 20);
        const lineHeight = fontSize * (Number(settings.lineHeight) || 1.6);
        const usableWidth = Math.max(80, viewport.width - (Number(settings.marginLeft) || 0) - (Number(settings.marginRight) || 0));
        const usableHeight = Math.max(lineHeight, viewport.height - (Number(settings.marginTop) || 0) - (Number(settings.marginBottom) || 0));
        const charsPerLine = Math.max(8, Math.floor(usableWidth / (fontSize * 0.55 + (Number(settings.letterSpacing) || 0))));
        const linesPerPage = Math.max(1, Math.floor(usableHeight / lineHeight));
        const pageSize = charsPerLine * linesPerPage;
        const pages = [];
        for (let offset = 0; offset < text.length || !pages.length; offset += pageSize) pages.push({ index: pages.length, offset, text: text.slice(offset, offset + pageSize), width: viewport.width, height: viewport.height });
        return { pages, pageCount: pages.length, html: textToHtml(text), viewport, measured: false };
    }

    function applyTextSettings(element, settings) {
        const style = element.style;
        if (settings.fontFamily) style.fontFamily = settings.fontFamily;
        if (settings.fontSize) style.fontSize = `${settings.fontSize}px`;
        if (settings.fontWeight) style.fontWeight = String(settings.fontWeight);
        if (settings.letterSpacing !== undefined) style.letterSpacing = `${settings.letterSpacing}px`;
        if (settings.lineHeight) style.lineHeight = String(settings.lineHeight);
        if (settings.paragraphSpacing !== undefined) style.setProperty('--paragraph-spacing', `${settings.paragraphSpacing}em`);
        if (settings.firstLineIndent !== undefined) style.setProperty('--first-line-indent', `${settings.firstLineIndent}em`);
    }

    function splitParagraphs(text) { return String(text || '').split(/\n{2,}/).map(value => value.trim()).filter(Boolean); }
    function textToHtml(text) { return splitParagraphs(text).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join(''); }
    function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
    function stripTags(value) { return String(value || '').replace(/<[^>]+>/g, ' '); }
    function searchParagraphs(paragraphs, query) {
        const needle = String(query || '').trim().toLocaleLowerCase();
        if (!needle) return [];
        return paragraphs.flatMap((text, index) => text.toLocaleLowerCase().includes(needle) ? [{ paragraphIndex: index, excerpt: text }] : []);
    }
    async function readSourceText(source) { if (source?.text) return source.text(); return String(source || ''); }
    async function readSourceBuffer(source) { if (source instanceof ArrayBuffer) return source; if (source?.arrayBuffer) return source.arrayBuffer(); return source; }
    function getSourceName(source) { return source?.name || source?.fileName || ''; }
    function pdfItemsToText(items) {
        return items.map(item => String(item.str || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    return { ReaderEngine, TextEngine, EpubEngine, PdfEngine, ReaderSession, paginateHtmlByViewport, paginateTextByViewport, splitParagraphs, pdfItemsToText };
});
