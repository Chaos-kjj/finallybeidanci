(function (root, factory) {
    const api = factory(root?.KangkangCore || {}, root?.KangkangSecurity || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangReader = { ...(root.KangkangReader || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, security) {
    class ReaderEngine {
        constructor(source, options = {}) {
            this.source = source;
            this.options = options;
            this.closed = false;
        }
        async open() { throw new Error('ReaderEngine.open() must be implemented'); }
        async close() { this.closed = true; }
        async getMetadata() { return {}; }
        async getToc() { return []; }
        async search() { return []; }
    }

    class TextEngine extends ReaderEngine {
        async open() {
            const source = this.source;
            const sourceText = source && typeof source === 'object' && typeof source.text === 'string'
                ? source.text
                : source && typeof source === 'object' && typeof source.html === 'string'
                    ? (security.stripHtmlToText ? security.stripHtmlToText(source.html) : htmlToTextFallback(source.html))
                : await readSourceText(source);
            this.text = String(sourceText || '').replace(/\r\n?/g, '\n');
            this.paragraphs = splitParagraphs(this.text);
            const format = String(this.options.format || source?.format || source?.type || getSourceName(source)).toLowerCase();
            const suppliedHtml = source && typeof source === 'object' && typeof source.html === 'string' ? source.html : this.options.html;
            this.html = suppliedHtml
                ? annotateHtmlBlocks(security.sanitizeHtml ? security.sanitizeHtml(suppliedHtml) : suppliedHtml)
                : format.includes('md')
                    ? markdownToHtml(this.text)
                    : textToHtml(this.text);
            this.metadata = {
                title: this.options.title || source?.title || getSourceName(source) || '未命名文本',
                format: format.includes('md') ? 'markdown' : suppliedHtml ? 'html' : 'text',
                hasText: Boolean(this.text.trim()),
                paragraphCount: this.paragraphs.length
            };
            return this;
        }
        async getMetadata() { return this.metadata; }
        async getToc() {
            return this.paragraphs.map((text, index) => ({
                id: `p-${index}`,
                title: text.slice(0, 80),
                paragraphIndex: index
            }));
        }
        async getChapter(index = 0) {
            if (index > 0) return null;
            return {
                index: 0,
                title: this.metadata?.title || '',
                html: this.html || textToHtml(this.text),
                text: this.text,
                paragraphCount: this.paragraphs.length
            };
        }
        async getReflowText() { return this.text; }
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
        async getToc() { return this.book?.toc || []; }
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
                    results.push({ chapterIndex, index, matchText: chapter.text.slice(index, index + needle.length), excerpt: chapter.text.slice(Math.max(0, index - 60), index + needle.length + 100) });
                    from = index + Math.max(1, needle.length);
                    if (results.length >= 500) return;
                }
            });
            return results;
        }
    }

    class PdfEngine extends ReaderEngine {
        constructor(source, options = {}) {
            super(source, options);
            this.pdf = null;
            this.pageCache = new Map();
            this.textCache = new Map();
            this.maxPageCache = Math.max(2, Number(options.maxPageCache) || 4);
            this.maxTextCache = Math.max(4, Number(options.maxTextCache) || 16);
            this.outline = [];
        }
        async open() {
            const pdfjs = this.options.pdfjsLib || globalThis.pdfjsLib;
            if (!pdfjs?.getDocument) throw new Error('PDF 引擎未打包，请重新构建 APK');
            const data = new Uint8Array(await readSourceBuffer(this.source));
            this.pdf = await pdfjs.getDocument({ data, disableWorker: Boolean(this.options.disableWorker) }).promise;
            this.pageCount = this.pdf.numPages;
            this.outline = await this.readOutline();
            // Probe only the first page. Full text is loaded lazily by search/reflow.
            const firstText = this.pageCount ? await this.getText(1) : '';
            this.textStatus = firstText.trim() ? 'available' : 'unknown';
            this.metadata = {
                title: this.options.title || getSourceName(this.source) || '未命名 PDF',
                format: 'pdf',
                pageCount: this.pageCount,
                hasText: this.textStatus === 'available',
                textStatus: this.textStatus,
                outline: this.outline,
                noTextMessage: ''
            };
            return this;
        }
        async getMetadata() { return this.metadata; }
        async getToc() { return this.outline || []; }
        async getPage(pageNumber = 1) {
            if (!this.pdf) throw new Error('PDF 尚未打开');
            const number = Math.min(this.pageCount, Math.max(1, Number(pageNumber) || 1));
            if (this.pageCache.has(number)) {
                const page = this.pageCache.get(number);
                this.pageCache.delete(number);
                this.pageCache.set(number, page);
                return { pageNumber: number, page, text: this.textCache.get(number) || '' };
            }
            const page = await this.pdf.getPage(number);
            this.pageCache.set(number, page);
            this.trimCache(this.pageCache, this.maxPageCache, value => value.cleanup?.());
            return { pageNumber: number, page, text: this.textCache.get(number) || '' };
        }
        async getText(pageNumber = 1) {
            const number = Math.min(this.pageCount, Math.max(1, Number(pageNumber) || 1));
            if (this.textCache.has(number)) {
                const text = this.textCache.get(number);
                this.textCache.delete(number);
                this.textCache.set(number, text);
                return text;
            }
            const entry = await this.getPage(number);
            const content = await entry.page.getTextContent();
            const text = pdfItemsToText(content.items || []);
            this.textCache.set(number, text);
            this.trimCache(this.textCache, this.maxTextCache);
            if (text.trim()) {
                this.textStatus = 'available';
                if (this.metadata) {
                    this.metadata.hasText = true;
                    this.metadata.textStatus = 'available';
                    this.metadata.noTextMessage = '';
                }
            }
            return text;
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
            const textContent = options.textLayer === false ? null : await entry.page.getTextContent();
            if (textContent?.items?.length) await this.getText(pageNumber);
            return { ...entry, viewport, textContent };
        }
        async getReflowText() {
            const pages = [];
            for (let page = 1; page <= this.pageCount; page += 1) pages.push(await this.getText(page));
            return pages.join('\n\n');
        }
        async getReflowPages() {
            const pages = [];
            for (let page = 1; page <= this.pageCount; page += 1) pages.push({ pageNumber: page, text: await this.getText(page) });
            return pages;
        }
        async search(query) {
            const needle = String(query || '').trim().toLocaleLowerCase();
            if (!needle) return [];
            const results = [];
            for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber += 1) {
                const text = await this.getText(pageNumber);
                const haystack = text.toLocaleLowerCase();
                let from = 0;
                while (from < haystack.length) {
                    const position = haystack.indexOf(needle, from);
                    if (position < 0) break;
                    results.push({ pageNumber, index: position, excerpt: text.slice(Math.max(0, position - 60), position + needle.length + 100) });
                    from = position + Math.max(1, needle.length);
                    if (results.length >= 500) return results;
                }
            }
            if (!results.length && this.textStatus !== 'available') {
                this.textStatus = 'unavailable';
                if (this.metadata) {
                    this.metadata.hasText = false;
                    this.metadata.textStatus = 'unavailable';
                    this.metadata.noTextMessage = '本文件没有可选文本，查词和 AI 选择不可用。';
                }
            }
            return results;
        }
        async readOutline() {
            if (!this.pdf?.getOutline) return [];
            const raw = await this.pdf.getOutline().catch(() => []);
            const convert = async (items = []) => Promise.all(items.map(async item => ({
                id: `pdf-outline-${Math.random().toString(36).slice(2)}`,
                title: String(item.title || '未命名章节'),
                pageNumber: await this.resolveDestination(item.dest),
                children: await convert(item.items || [])
            })));
            return convert(raw || []);
        }
        async resolveDestination(destination) {
            if (!destination) return null;
            try {
                const dest = typeof destination === 'string' && this.pdf.getDestination
                    ? await this.pdf.getDestination(destination)
                    : destination;
                const ref = dest?.[0];
                if (typeof ref === 'number') return ref + 1;
                if (this.pdf.getPageIndex && ref) return (await this.pdf.getPageIndex(ref)) + 1;
            } catch (_) { /* an invalid outline entry should not block reading */ }
            return null;
        }
        trimCache(cache, max, cleanup = () => {}) {
            while (cache.size > max) {
                const first = cache.keys().next().value;
                const value = cache.get(first);
                cache.delete(first);
                cleanup(value);
            }
        }
        async close() {
            this.pageCache.forEach(page => page.cleanup?.());
            this.pageCache.clear();
            this.textCache.clear();
            this.pdf?.destroy?.();
            this.pdf = null;
            await super.close();
        }
    }

    class ReaderSession {
        constructor(engine, { documentRef = globalThis.document } = {}) {
            this.engine = engine;
            this.document = documentRef;
        }
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

    function splitParagraphs(text) {
        return String(text || '').replace(/\u000c/g, '\n\n').split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
    }

    function textToHtml(text) {
        return splitParagraphs(text).map((paragraph, index) => `<p data-paragraph-index="${index}">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
    }

    function markdownToHtml(markdown) {
        const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
        const output = [];
        let paragraph = [];
        let listType = '';
        let listItems = [];
        const flushParagraph = () => {
            if (!paragraph.length) return;
            const value = inlineMarkdown(paragraph.join(' '));
            output.push(`<p data-paragraph-index="${output.length}">${value}</p>`);
            paragraph = [];
        };
        const flushList = () => {
            if (!listItems.length) return;
            output.push(`<${listType || 'ul'} data-paragraph-index="${output.length}">${listItems.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</${listType || 'ul'}>`);
            listType = '';
            listItems = [];
        };
        lines.forEach(line => {
            const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
            const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
            const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
            if (!line.trim()) { flushParagraph(); flushList(); return; }
            if (heading) { flushParagraph(); flushList(); output.push(`<h${heading[1].length} id="md-heading-${output.length}" data-paragraph-index="${output.length}">${inlineMarkdown(heading[2])}</h${heading[1].length}>`); return; }
            if (unordered || ordered) {
                flushParagraph();
                const nextType = ordered ? 'ol' : 'ul';
                if (listType && listType !== nextType) flushList();
                listType = nextType; listItems.push((unordered || ordered)[1]); return;
            }
            flushList();
            paragraph.push(line.trim());
        });
        flushParagraph(); flushList();
        return output.join('');
    }

    function inlineMarkdown(value) {
        const source = String(value || '');
        let result = escapeHtml(source);
        result = result.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, href, title) => `<img src="${safeResourceUrl(href)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`);
        result = result.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${safeLinkUrl(href)}">${label}</a>`);
        result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
        result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
        result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>').replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
        return result;
    }

    function safeLinkUrl(value) {
        const href = String(value || '').trim();
        return /^(?:#|\.\.?\/|epub:)/i.test(href) ? escapeHtml(href) : '#';
    }
    function safeResourceUrl(value) {
        const href = String(value || '').trim();
        return /^(?:data:image\/|blob:|epub:)/i.test(href) ? escapeHtml(href) : '';
    }
    function annotateHtmlBlocks(html) {
        let index = 0;
        return String(html || '').replace(/<(p|h[1-6]|li|blockquote|pre|section|article|div)\b([^>]*)>/gi, (match, tag, attributes) => {
            if (/\bdata-paragraph-index\s*=/i.test(attributes)) return match;
            return `<${tag}${attributes} data-paragraph-index="${index++}">`;
        });
    }
    function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
    function stripTags(value) { return String(value || '').replace(/<[^>]+>/g, ' '); }
    function htmlToTextFallback(value) {
        return String(value || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?(?:address|article|aside|blockquote|div|figure|h[1-6]|li|main|ol|p|pre|section|table|ul)\b[^>]*>/gi, match => /^<\//.test(match) ? '\n\n' : '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    function searchParagraphs(paragraphs, query) {
        const needle = String(query || '').trim().toLocaleLowerCase();
        if (!needle) return [];
        return paragraphs.flatMap((text, index) => {
            const lower = text.toLocaleLowerCase();
            const results = [];
            let from = 0;
            while (from < lower.length) {
                const position = lower.indexOf(needle, from);
                if (position < 0) break;
                results.push({ paragraphIndex: index, index: position, paragraphText: text, excerpt: text.slice(Math.max(0, position - 60), position + needle.length + 100) });
                from = position + Math.max(1, needle.length);
                if (results.length >= 500) break;
            }
            return results;
        });
    }
    async function readSourceText(source) { if (source?.text && typeof source.text === 'function') return source.text(); return String(source || ''); }
    async function readSourceBuffer(source) { if (source instanceof ArrayBuffer) return source; if (source instanceof Uint8Array) return source; if (source?.arrayBuffer) return source.arrayBuffer(); return source; }
    function getSourceName(source) { return source?.name || source?.fileName || ''; }
    function pdfItemsToText(items) {
        let previousY = null;
        const lines = [];
        let line = '';
        items.forEach(item => {
            const text = String(item.str || '').trim();
            if (!text) return;
            const y = Number(item.transform?.[5]);
            if (previousY !== null && Number.isFinite(y) && Math.abs(y - previousY) > 4) { if (line) lines.push(line); line = ''; }
            line += `${line ? ' ' : ''}${text}`;
            previousY = Number.isFinite(y) ? y : previousY;
        });
        if (line) lines.push(line);
        return lines.join('\n').replace(/[ \t]+/g, ' ').trim();
    }

    return {
        ReaderEngine, TextEngine, EpubEngine, PdfEngine, ReaderSession,
        paginateHtmlByViewport, paginateTextByViewport, splitParagraphs,
        textToHtml, markdownToHtml, annotateHtmlBlocks, pdfItemsToText
    };
});
