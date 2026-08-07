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
        async getChapter(index = 0) {
            // Reader views consume chapter 0 as the document stream. Returning
            // only the first paragraph made long TXT/PDF reflow documents look
            // like they opened successfully while silently dropping the rest.
            if (index === 0) return { index, title: '', html: textToHtml(this.text || ''), text: this.text || '' };
            return { index, title: '', html: textToHtml(this.paragraphs[index] || ''), text: this.paragraphs[index] || '' };
        }
        async search(query) { return searchParagraphs(this.paragraphs, query); }
    }

    class EpubEngine extends ReaderEngine {
        async open() {
            const parser = this.options.parseEpubBook || globalThis.parseEpubBook;
            if (typeof parser !== 'function') throw new Error('EPUB 解析器未加载');
            const bytes = this.source instanceof ArrayBuffer ? this.source : await readSourceBuffer(this.source);
            this.book = await parser(bytes, this.options);
            this.assetUrls = [];
            for (const chapter of this.book.chapters) chapter.html = await this.rewriteAssets(chapter.html, chapter.href);
            this.metadata = { ...this.book, format: 'epub', hasText: this.book.chapters.some(chapter => chapter.text.trim()) };
            this.chapters = this.book.chapters;
            return this;
        }
        async getMetadata() { return this.metadata; }
        async getToc() { return this.book.toc; }
        async getChapter(index = 0) { return this.chapters[index] || null; }
        async rewriteAssets(html, chapterHref) {
            if (!this.book?.getAsset || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return html;
            const pattern = /\s(src)\s*=\s*("([^"]*)"|'([^']*)')/gi;
            let output = String(html || '');
            const matches = [...output.matchAll(pattern)];
            for (const match of matches) {
                const raw = match[3] ?? match[4] ?? '';
                const path = resolveRelativePath(chapterHref, raw.split('#')[0]);
                const descriptor = this.book.assetManifest?.[path.toLowerCase()];
                if (!descriptor) continue;
                const bytes = await this.book.getAsset(descriptor.path);
                if (!bytes) continue;
                const url = URL.createObjectURL(new Blob([bytes], { type: descriptor.mediaType || 'application/octet-stream' }));
                this.assetUrls.push(url);
                output = output.replace(match[0], ` src="${url}"`);
            }
            return output;
        }
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
                    results.push({ id: `epub-${chapterIndex}-${index}`, chapterIndex, index, matchLength: needle.length, excerpt: chapter.text.slice(Math.max(0, index - 60), index + needle.length + 100), location: { format: 'epub', href: chapter.href, progression: chapter.text.length ? index / chapter.text.length : 0 } });
                    from = index + Math.max(1, needle.length);
                    if (results.length >= 500) return;
                }
            });
            return results;
        }
        async close() {
            this.assetUrls?.forEach(url => URL.revokeObjectURL?.(url));
            this.assetUrls = [];
            await super.close();
        }
    }

    class PdfEngine extends ReaderEngine {
        constructor(source, options = {}) { super(source, options); this.pdf = null; this.pageCache = new Map(); this.textPages = []; this.textPromises = new Map(); this.maxCachedPages = Math.max(2, Number(options.maxCachedPages) || 3); }
        async open() {
            const pdfjs = this.options.pdfjsLib || globalThis.pdfjsLib;
            if (!pdfjs?.getDocument) throw new Error('PDF 引擎未打包，请重新构建 APK');
            const data = new Uint8Array(await readSourceBuffer(this.source));
            this.pdf = await pdfjs.getDocument({ data, disableWorker: Boolean(this.options.disableWorker) }).promise;
            this.pageCount = this.pdf.numPages;
            this.textPages = Array.from({ length: this.pageCount }, () => null);
            const firstText = await this.getTextPage(1);
            let documentInfo = {};
            try { documentInfo = (await this.pdf.getMetadata?.())?.info || {}; } catch (_) { /* malformed metadata does not block reading */ }
            this.metadata = { title: documentInfo.Title || this.options.title || getSourceName(this.source) || '未命名 PDF', author: documentInfo.Author || '', format: 'pdf', pageCount: this.pageCount, hasText: Boolean(firstText.trim()), noTextMessage: '' };
            return this;
        }
        async getMetadata() { return this.metadata; }
        async getToc() {
            if (!this.pdf?.getOutline) return [];
            const outline = await this.pdf.getOutline();
            const output = [];
            const visit = async (items, depth = 0) => {
                for (const item of items || []) {
                    let pageNumber = 1;
                    try {
                        const destination = typeof item.dest === 'string' ? await this.pdf.getDestination(item.dest) : item.dest;
                        const ref = destination?.[0];
                        if (ref) pageNumber = (await this.pdf.getPageIndex(ref)) + 1;
                    } catch (_) { /* malformed outline entries are skipped to page one */ }
                    output.push({ id: `pdf-toc-${output.length}`, title: item.title || `第 ${pageNumber} 页`, pageNumber, depth, location: { format: 'pdf', page: pageNumber, progression: 0 } });
                    await visit(item.items, depth + 1);
                }
            };
            await visit(outline);
            return output;
        }
        async getTextPage(pageNumber) {
            const number = Math.min(this.pageCount, Math.max(1, Number(pageNumber) || 1));
            if (this.textPages[number - 1] !== null) return this.textPages[number - 1];
            if (this.textPromises.has(number)) return this.textPromises.get(number);
            const promise = this.pdf.getPage(number).then(async page => {
                const content = await page.getTextContent();
                const text = pdfItemsToText(content.items || []);
                this.textPages[number - 1] = text;
                page.cleanup?.();
                if (this.metadata) this.metadata.hasText = this.textPages.some(value => Boolean(value?.trim()));
                return text;
            }).finally(() => this.textPromises.delete(number));
            this.textPromises.set(number, promise);
            return promise;
        }
        async getPage(pageNumber = 1) {
            if (!this.pdf) throw new Error('PDF 尚未打开');
            const number = Math.min(this.pageCount, Math.max(1, Number(pageNumber) || 1));
            if (!this.pageCache.has(number)) {
                if (this.pageCache.size >= this.maxCachedPages) {
                    const oldest = this.pageCache.keys().next().value;
                    const oldPage = this.pageCache.get(oldest);
                    oldPage?.cleanup?.();
                    this.pageCache.delete(oldest);
                }
                this.pageCache.set(number, await this.pdf.getPage(number));
            } else {
                const page = this.pageCache.get(number);
                this.pageCache.delete(number);
                this.pageCache.set(number, page);
            }
            return { pageNumber: number, page: this.pageCache.get(number), text: await this.getTextPage(number) };
        }
        async getTextContent(pageNumber = 1) {
            const entry = await this.getPage(pageNumber);
            return entry.page.getTextContent();
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
        async getReflowText() {
            const pages = [];
            for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber += 1) pages.push(await this.getTextPage(pageNumber));
            const text = pages.filter(Boolean).join('\n\n').trim();
            if (this.metadata) {
                this.metadata.hasText = Boolean(text);
                this.metadata.noTextMessage = this.metadata.hasText ? '' : '此 PDF 没有可选文本层，查词、搜索和文本重排不可用。';
            }
            return text;
        }
        async search(query) {
            const needle = String(query || '').trim().toLocaleLowerCase();
            if (!needle) return [];
            const results = [];
            for (let index = 0; index < this.pageCount; index += 1) {
                const text = await this.getTextPage(index + 1);
                const haystack = text.toLocaleLowerCase();
                let position = 0;
                while ((position = haystack.indexOf(needle, position)) >= 0) {
                    results.push({ id: `pdf-${index + 1}-${position}`, pageNumber: index + 1, index: position, matchLength: needle.length, excerpt: text.slice(Math.max(0, position - 60), position + needle.length + 100), location: { format: 'pdf', page: index + 1, progression: 0 } });
                    position += Math.max(needle.length, 1);
                    if (results.length >= 500) return results;
                }
            }
            return results;
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
        const horizontalMargin = Math.max(0, Number(settings.marginLeft) || Number(settings.margin) || 0) + Math.max(0, Number(settings.marginRight) || Number(settings.margin) || 0);
        body.style.columnGap = `${horizontalMargin}px`;
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
    function resolveRelativePath(base, href) {
        const baseParts = String(base || '').replace(/\\/g, '/').split('/');
        baseParts.pop();
        for (const part of String(href || '').replace(/\\/g, '/').split('/')) {
            if (!part || part === '.') continue;
            if (part === '..') baseParts.pop(); else baseParts.push(part);
        }
        return baseParts.filter(Boolean).join('/');
    }
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

    return { ReaderEngine, TextEngine, EpubEngine, PdfEngine, ReaderSession, paginateHtmlByViewport, paginateTextByViewport, splitParagraphs, pdfItemsToText, textToHtml };
});
