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

    class MarkupEngine extends ReaderEngine {
        constructor(source, options = {}) { super(source, options); this.format = options.format || 'html'; }
        async open() {
            this.raw = typeof this.source === 'string' ? this.source : await readSourceText(this.source);
            this.html = this.format === 'markdown' ? markdownToHtml(this.raw) : (security.sanitizeHtml ? security.sanitizeHtml(this.raw) : this.raw);
            this.text = stripTags(this.html).replace(/\s+/g, ' ').trim();
            this.headings = extractHeadings(this.html);
            this.paragraphs = splitParagraphs(this.text);
            this.metadata = { title: this.options.title || getSourceName(this.source) || '未命名文档', format: this.format, hasText: Boolean(this.text) };
            return this;
        }
        async getMetadata() { return this.metadata; }
        async getToc() { return this.headings.map((heading, index) => ({ ...heading, id: heading.id || `heading-${index}`, chapterIndex: 0 })); }
        async getChapter(index = 0) { return index === 0 ? { index: 0, title: this.metadata.title, html: this.html, text: this.text } : null; }
        async search(query) {
            const needle = String(query || '').trim().toLocaleLowerCase();
            if (!needle) return [];
            const results = [];
            let from = 0;
            const haystack = this.text.toLocaleLowerCase();
            while (from < haystack.length) {
                const index = haystack.indexOf(needle, from);
                if (index < 0) break;
                results.push({ id: `${this.format}-0-${index}`, chapterIndex: 0, index, matchLength: needle.length, excerpt: this.text.slice(Math.max(0, index - 80), index + needle.length + 120), location: { format: this.format, progression: this.text.length ? index / this.text.length : 0 } });
                from = index + Math.max(1, needle.length);
                if (results.length >= 500) break;
            }
            return results;
        }
    }

    class HtmlEngine extends MarkupEngine { constructor(source, options = {}) { super(source, { ...options, format: 'html' }); } }
    class MarkdownEngine extends MarkupEngine { constructor(source, options = {}) { super(source, { ...options, format: 'markdown' }); } }

    class EpubEngine extends ReaderEngine {
        async open() {
            const parser = this.options.parseEpubBook || globalThis.parseEpubBook;
            if (typeof parser !== 'function') throw new Error('EPUB 解析器未加载');
            const bytes = this.source instanceof ArrayBuffer ? this.source : await readSourceBuffer(this.source);
            this.book = await parser(bytes, this.options);
            // Keep chapter HTML and assets lazy. Loading every image in every
            // chapter during open made large EPUBs consume several copies of
            // the book in WebView memory before the first page was visible.
            this.chapterHtmlCache = new Map();
            this.metadata = { ...this.book, format: 'epub', hasText: false };
            this.chapters = this.book.chapters;
            // Validate the first readable chapter during import/open without
            // eagerly decoding the rest of a large EPUB.
            const firstChapter = await this.getChapter(0);
            if (!firstChapter?.text?.trim()) throw new Error('EPUB 没有找到可阅读正文');
            this.metadata.hasText = true;
            return this;
        }
        async getMetadata() { return this.metadata; }
        async getToc() { return this.book.toc; }
        async getChapter(index = 0) {
            const chapter = this.chapters[index];
            if (!chapter) return null;
            if (!this.chapterHtmlCache.has(index)) {
                const sourceHtml = chapter.html || await this.book.loadChapterHtml?.(index) || '';
                const rewritten = await this.rewriteAssets(sourceHtml, chapter.href);
                if (!chapter.text) chapter.text = stripTags(rewritten.html).replace(/\s+/g, ' ').trim();
                this.chapterHtmlCache.set(index, rewritten);
            }
            for (const [cachedIndex, cached] of this.chapterHtmlCache.entries()) {
                if (Math.abs(cachedIndex - index) > 1) {
                    cached.urls.forEach(url => URL.revokeObjectURL?.(url));
                    this.chapterHtmlCache.delete(cachedIndex);
                }
            }
            const cached = this.chapterHtmlCache.get(index);
            return { ...chapter, html: cached.html };
        }
        async rewriteAssets(html, chapterHref) {
            if (!this.book?.getAsset || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return { html, urls: [] };
            const pattern = /\s(src)\s*=\s*("([^"]*)"|'([^']*)')/gi;
            let output = String(html || '');
            const urls = [];
            const matches = [...output.matchAll(pattern)];
            for (const match of matches) {
                const raw = match[3] ?? match[4] ?? '';
                const path = resolveRelativePath(chapterHref, raw.split('#')[0]);
                const descriptor = this.book.assetManifest?.[path.toLowerCase()];
                if (!descriptor) continue;
                const bytes = await this.book.getAsset(descriptor.path);
                if (!bytes) continue;
                const url = URL.createObjectURL(new Blob([bytes], { type: descriptor.mediaType || 'application/octet-stream' }));
                urls.push(url);
                output = output.replace(match[0], ` src="${url}"`);
            }
            return { html: output, urls };
        }
        async search(query) {
            const needle = String(query || '').trim().toLocaleLowerCase();
            if (!needle) return [];
            const results = [];
            for (let chapterIndex = 0; chapterIndex < this.chapters.length; chapterIndex += 1) {
                const chapter = this.chapters[chapterIndex];
                if (!chapter.text) {
                    const loaded = await this.getChapter(chapterIndex);
                    chapter.text = loaded?.text || '';
                }
                const haystack = chapter.text.toLocaleLowerCase();
                let from = 0;
                while (from < haystack.length) {
                    const index = haystack.indexOf(needle, from);
                    if (index < 0) break;
                    results.push({ id: `epub-${chapterIndex}-${index}`, chapterIndex, index, matchLength: needle.length, excerpt: chapter.text.slice(Math.max(0, index - 60), index + needle.length + 100), location: { format: 'epub', href: chapter.href, progression: chapter.text.length ? index / chapter.text.length : 0 } });
                    from = index + Math.max(1, needle.length);
                    if (results.length >= 500) return results;
                }
            }
            return results;
        }
        async close() {
            this.chapterHtmlCache?.forEach(cached => cached.urls.forEach(url => URL.revokeObjectURL?.(url)));
            this.chapterHtmlCache?.clear();
            await super.close();
        }
    }

    class PdfEngine extends ReaderEngine {
        constructor(source, options = {}) { super(source, options); this.pdf = null; this.pageCache = new Map(); this.textCache = new Map(); this.textPromises = new Map(); this.maxCachedPages = Math.max(2, Number(options.maxCachedPages) || 3); this.maxCachedTextPages = Math.max(8, Number(options.maxCachedTextPages) || 64); this.hasTextPage = false; }
        async open() {
            const pdfjs = this.options.pdfjsLib || globalThis.pdfjsLib;
            if (!pdfjs?.getDocument) throw new Error('PDF 引擎未打包，请重新构建 APK');
            // PDF.js transfers `data.buffer` to its worker. Passing a view over
            // the importer's ArrayBuffer therefore detaches the caller-owned
            // bytes and makes the later Blob/IndexedDB structured clone fail.
            // Keep the source immutable and give each worker attempt its own
            // owned copy (the retry also cannot reuse a buffer transferred by
            // the failed first attempt).
            const sourceBuffer = await readSourceBuffer(this.source);
            const loadingOptionsFor = disableWorker => {
                const loadingOptions = { data: copySourceBytes(sourceBuffer), disableWorker: Boolean(disableWorker) };
                if (this.options.standardFontDataUrl) loadingOptions.standardFontDataUrl = this.options.standardFontDataUrl;
                return loadingOptions;
            };
            const loadingOptions = loadingOptionsFor(this.options.disableWorker);
            try {
                this.pdf = await pdfjs.getDocument(loadingOptions).promise;
            } catch (error) {
                if (loadingOptions.disableWorker || this.options.fallbackToMainThread === false) throw error;
                // Older Android WebViews can reject a local module Worker even
                // when the resource is packaged. Retry on the main thread so a
                // readable document is not lost solely because of the runtime.
                this.pdf = await pdfjs.getDocument(loadingOptionsFor(true)).promise;
            }
            this.pageCount = this.pdf.numPages;
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
            if (this.textCache.has(number)) {
                const cached = this.textCache.get(number);
                this.textCache.delete(number);
                this.textCache.set(number, cached);
                return cached;
            }
            if (this.textPromises.has(number)) return this.textPromises.get(number);
            const promise = this.pdf.getPage(number).then(async page => {
                const content = await page.getTextContent();
                const text = pdfItemsToText(content.items || []);
                this.textCache.set(number, text);
                while (this.textCache.size > this.maxCachedTextPages) this.textCache.delete(this.textCache.keys().next().value);
                this.hasTextPage ||= Boolean(text.trim());
                page.cleanup?.();
                if (this.metadata) this.metadata.hasText = this.hasTextPage;
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
            this.textCache.clear();
            this.textPromises.clear();
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
    function inlineMarkdown(value) {
        let output = escapeHtml(value);
        output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
        output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
        output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/_([^_]+)_/g, '<em>$1</em>');
        output = output.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>');
        return output;
    }
    function markdownToHtml(markdown) {
        const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
        const output = [];
        let paragraph = [];
        let listType = null;
        let code = null;
        let headingIndex = 0;
        const flushParagraph = () => { if (paragraph.length) { output.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`); paragraph = []; } };
        const closeList = () => { if (listType) { output.push(`</${listType}>`); listType = null; } };
        for (const line of lines) {
            if (/^\s*```/.test(line)) {
                flushParagraph(); closeList();
                if (code === null) code = []; else { output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = null; }
                continue;
            }
            if (code !== null) { code.push(line); continue; }
            const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
            if (heading) { flushParagraph(); closeList(); const level = heading[1].length; output.push(`<h${level} id="heading-${headingIndex++}">${inlineMarkdown(heading[2])}</h${level}>`); continue; }
            const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
            const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
            if (unordered || ordered) {
                flushParagraph(); const nextType = ordered ? 'ol' : 'ul'; if (listType && listType !== nextType) closeList(); if (!listType) { listType = nextType; output.push(`<${listType}>`); } output.push(`<li>${inlineMarkdown((ordered || unordered)[1])}</li>`); continue;
            }
            if (/^\s*>\s?/.test(line)) { flushParagraph(); closeList(); output.push(`<blockquote>${inlineMarkdown(line.replace(/^\s*>\s?/, ''))}</blockquote>`); continue; }
            if (!line.trim()) { flushParagraph(); closeList(); continue; }
            paragraph.push(line);
        }
        if (code !== null) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        flushParagraph(); closeList();
        return security.sanitizeHtml ? security.sanitizeHtml(output.join('')) : output.join('');
    }
    function extractHeadings(html) {
        const headings = [];
        const pattern = /<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;
        let match;
        while ((match = pattern.exec(String(html || '')))) headings.push({ title: stripTags(match[2]).trim(), depth: Number(match[1]), fragment: (match[0].match(/\sid=["']([^"']+)["']/i)?.[1] || `heading-${headings.length}`) });
        return headings;
    }
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
    function copySourceBytes(source) {
        if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
        if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
        return new Uint8Array(source).slice();
    }
    function getSourceName(source) { return source?.name || source?.fileName || ''; }
    function pdfItemsToText(items) {
        return items.map(item => String(item.str || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }

    return { ReaderEngine, TextEngine, MarkupEngine, HtmlEngine, MarkdownEngine, EpubEngine, PdfEngine, markdownToHtml, extractHeadings, ReaderSession, paginateHtmlByViewport, paginateTextByViewport, splitParagraphs, pdfItemsToText, textToHtml };
});
