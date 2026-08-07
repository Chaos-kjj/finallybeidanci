(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.parseEpubToText = api.parseEpubToText;
        root.parseEpubBook = api.parseEpubBook;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const UTF8_FLAG = 0x0800;
    const ZIP_STORED = 0;
    const ZIP_DEFLATED = 8;

    async function parseEpubToText(arrayBuffer, options = {}) {
        const book = await parseEpubBook(arrayBuffer, options);
        return book.chapters.map(chapter => chapter.text).join('\n\n');
    }

    async function parseEpubBook(arrayBuffer, options = {}) {
        const zip = await readZipEntries(arrayBuffer);
        const containerXml = await zip.getText('META-INF/container.xml');
        if (!containerXml) throw new Error('EPUB 缺少 META-INF/container.xml');
        const packagePath = getContainerPackagePath(containerXml);
        if (!packagePath) throw new Error('EPUB 未声明 OPF package 文件');
        const packageXml = await zip.getText(packagePath);
        if (!packageXml) throw new Error('EPUB 缺少 OPF package 文件');

        const packageDir = getDirectory(packagePath);
        const manifest = parseManifest(packageXml, packageDir);
        const spine = parseSpine(packageXml);
        const metadata = parsePackageMetadata(packageXml);
        const chapterItems = spine
            .filter(spineItem => spineItem.linear !== 'no')
            .map(spineItem => manifest.byId.get(spineItem.idref))
            .filter(item => item && isHtmlManifestItem(item) && !isSkippableEpubItem(item));
        const chapterByPath = new Map(chapterItems.map((item, index) => [item.path, index]));
        const toc = await parseChapterToc(zip, manifest, chapterByPath);
        const chapters = [];

        for (let index = 0; index < chapterItems.length; index += 1) {
            const item = chapterItems[index];
            const html = await zip.getText(item.path);
            const safeHtml = await rewriteEpubHtml(html, item.path, index, chapterByPath, zip, manifest, options.maxChapterBytes || 2_000_000);
            const text = htmlToReadableText(safeHtml);
            chapters.push({
                id: item.id,
                href: item.path,
                title: findTocLabel(toc, item.path) || item.title || `第 ${index + 1} 章`,
                html: safeHtml,
                text,
                spineIndex: index
            });
        }

        if (!chapters.length || !chapters.some(chapter => chapter.text.trim())) throw new Error('EPUB 没有找到可阅读正文');
        const tocWithIndexes = mapTocToChapterIndexes(toc, chapters);
        const cover = await readCover(zip, manifest, metadata);
        return {
            title: metadata.title || options.title || '',
            author: metadata.author || '',
            language: metadata.language || '',
            identifier: metadata.identifier || '',
            cover,
            chapters,
            toc: tocWithIndexes.length ? tocWithIndexes : chapters.map((chapter, index) => ({ id: chapter.id, title: chapter.title, chapterIndex: index, href: chapter.href, children: [] }))
        };
    }

    function parsePackageMetadata(packageXml) {
        const values = {};
        ['title', 'creator', 'language', 'identifier'].forEach(name => {
            const match = packageXml.match(new RegExp(`<[^:>\\s]*:?${name}\\b[^>]*>([\\s\\S]*?)<\\/[^:>\\s]*:?${name}>`, 'i'));
            if (match) values[name === 'creator' ? 'author' : name] = decodeHtmlEntities(stripTags(match[1])).trim();
        });
        const coverMeta = getTagAttributes(packageXml, 'meta').find(attrs => String(attrs.name || '').toLowerCase() === 'cover');
        if (coverMeta?.content) values.coverId = coverMeta.content;
        return values;
    }

    function sanitizeEpubHtml(html, maxBytes) {
        let safe = String(html || '').slice(0, maxBytes);
        safe = safe
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<\/?(?:script|style|iframe|object|embed|form|base|meta|link|audio|video|source|track)\b[^>]*>[\s\S]*?<\/?(?:script|style|iframe|object|embed|form|base|meta|link|audio|video|source|track)\s*>/gi, '')
            .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/\s(?:src|href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, match => /(?:blob:|data:image\/(?:png|jpeg|gif|webp);base64,|app-dict:|#|\.\.?\/|[\w-]+\.(?:x?html?|png|jpe?g|gif|webp|svg)(?:[#?]|$))/i.test(match) ? match : '')
            .replace(/javascript\s*:/gi, '')
            .slice(0, maxBytes);
        return safe;
    }

    async function rewriteEpubHtml(html, chapterPath, chapterIndex, chapterByPath, zip, manifest, maxBytes) {
        let safe = sanitizeEpubHtml(html, maxBytes);
        const attributePattern = /\s(src|href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
        const replacements = [];
        let match;
        while ((match = attributePattern.exec(safe))) {
            const attribute = match[1].toLowerCase();
            const raw = match[3] ?? match[4] ?? match[5] ?? '';
            const replacement = await rewriteEpubReference(raw, attribute, chapterPath, chapterIndex, chapterByPath, zip, manifest);
            replacements.push({ start: match.index, end: attributePattern.lastIndex, value: replacement ? ` ${attribute}="${escapeAttribute(replacement)}"` : '' });
        }
        for (let index = replacements.length - 1; index >= 0; index -= 1) {
            const item = replacements[index];
            safe = safe.slice(0, item.start) + item.value + safe.slice(item.end);
        }
        return safe.slice(0, maxBytes);
    }

    async function rewriteEpubReference(raw, attribute, chapterPath, chapterIndex, chapterByPath, zip, manifest) {
        const value = safeDecodeUri(String(raw || '').trim());
        if (!value || /^javascript:|^(?:https?:|mailto:|tel:|data:(?!image\/))/i.test(value)) return '';
        const [pathPart, fragment = ''] = value.split('#');
        if (attribute === 'href') {
            if (!pathPart) return `#epub-chapter-${chapterIndex}${fragment ? `-${fragment}` : ''}`;
            const targetPath = resolveZipPath(getDirectory(chapterPath), pathPart);
            const targetChapter = chapterByPath.get(targetPath);
            if (targetChapter === undefined) return '';
            return `#epub-chapter-${targetChapter}${fragment ? `-${fragment}` : ''}`;
        }
        if (/^(?:data:image\/|blob:)/i.test(value)) return value;
        const resourcePath = resolveZipPath(getDirectory(chapterPath), pathPart);
        const item = manifest.items.find(entry => entry.path === resourcePath);
        if (!item || !/^(?:image\/|font\/|application\/font|image)/i.test(item.mediaType || '') && !/\.(?:png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i.test(item.path)) return '';
        const bytes = await zip.getBytes(resourcePath);
        if (!bytes || bytes.length > 2_000_000) return '';
        return `data:${item.mediaType || guessMime(resourcePath)};base64,${toBase64(bytes)}`;
    }

    async function readZipEntries(arrayBuffer) {
        const bytes = arrayBuffer instanceof Uint8Array
            ? arrayBuffer
            : new Uint8Array(arrayBuffer);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const eocdOffset = findEndOfCentralDirectory(view);
        const totalEntries = view.getUint16(eocdOffset + 10, true);
        const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
        const entries = new Map();
        let offset = centralDirectoryOffset;

        for (let index = 0; index < totalEntries; index += 1) {
            if (view.getUint32(offset, true) !== 0x02014b50) {
                throw new Error('EPUB ZIP 中央目录损坏');
            }

            const flags = view.getUint16(offset + 8, true);
            const compressionMethod = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const uncompressedSize = view.getUint32(offset + 24, true);
            const fileNameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const localHeaderOffset = view.getUint32(offset + 42, true);
            const nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
            const name = normalizeZipPath(decodeZipString(nameBytes, flags));

            if (name && !name.endsWith('/')) {
                entries.set(name.toLowerCase(), {
                    name,
                    flags,
                    compressionMethod,
                    compressedSize,
                    uncompressedSize,
                    localHeaderOffset
                });
            }

            offset += 46 + fileNameLength + extraLength + commentLength;
        }

        return {
            async getBytes(path) {
                const entry = entries.get(normalizeZipPath(path).toLowerCase());
                if (!entry) return null;
                return extractZipEntry(bytes, view, entry);
            },
            async getText(path) {
                const entryBytes = await this.getBytes(path);
                if (!entryBytes) return '';
                return new TextDecoder('utf-8').decode(entryBytes);
            }
        };
    }

    function findEndOfCentralDirectory(view) {
        const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
        for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
            if (view.getUint32(offset, true) === 0x06054b50) return offset;
        }
        throw new Error('EPUB ZIP 文件不完整');
    }

    async function extractZipEntry(bytes, view, entry) {
        const offset = entry.localHeaderOffset;
        if (view.getUint32(offset, true) !== 0x04034b50) {
            throw new Error(`EPUB ZIP 本地文件头损坏：${entry.name}`);
        }

        const fileNameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const dataOffset = offset + 30 + fileNameLength + extraLength;
        const compressedData = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);

        if (entry.compressionMethod === ZIP_STORED) {
            return compressedData;
        }

        if (entry.compressionMethod === ZIP_DEFLATED) {
            const inflated = await inflateRaw(compressedData);
            if (entry.uncompressedSize && inflated.length !== entry.uncompressedSize) {
                return inflated.subarray(0, entry.uncompressedSize);
            }
            return inflated;
        }

        throw new Error(`EPUB 使用了暂不支持的 ZIP 压缩方式：${entry.compressionMethod}`);
    }

    async function inflateRaw(data) {
        if (typeof module === 'object' && module.exports && typeof require === 'function') {
            const zlib = require('node:zlib');
            return new Uint8Array(zlib.inflateRawSync(Buffer.from(data)));
        }

        if (typeof DecompressionStream === 'function') {
            const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }

        throw new Error('当前浏览器不支持解压 EPUB 中的压缩章节');
    }

    function getContainerPackagePath(containerXml) {
        const rootfiles = getTagAttributes(containerXml, 'rootfile');
        const rootfile = rootfiles.find(item => /opf|package/i.test(item['media-type'] || '')) || rootfiles[0];
        return normalizeZipPath(rootfile?.['full-path'] || '');
    }

    function parseManifest(packageXml, packageDir) {
        const items = getTagAttributes(packageXml, 'item').map(attrs => {
            const href = attrs.href || '';
            const path = resolveZipPath(packageDir, href);
            return {
                id: attrs.id || '',
                href,
                path,
                mediaType: attrs['media-type'] || '',
                properties: attrs.properties || '',
                title: attrs.title || ''
            };
        });

        return {
            items,
            byId: new Map(items.map(item => [item.id, item]))
        };
    }

    function parseSpine(packageXml) {
        return getTagAttributes(packageXml, 'itemref').map(attrs => ({
            idref: attrs.idref || '',
            linear: (attrs.linear || '').toLowerCase()
        }));
    }

    async function parseChapterLabels(zip, manifest) {
        const labels = new Map();

        for (const item of manifest.items) {
            if (item.mediaType === 'application/x-dtbncx+xml' || /\.ncx$/i.test(item.href)) {
                const ncx = await zip.getText(item.path);
                parseNcxLabels(ncx, item.path).forEach((label, path) => labels.set(path, label));
            }
        }

        for (const item of manifest.items) {
            if (!hasProperty(item, 'nav')) continue;
            const navHtml = await zip.getText(item.path);
            parseNavLabels(navHtml, item.path).forEach((label, path) => labels.set(path, label));
        }

        return labels;
    }

    async function parseChapterToc(zip, manifest, chapterByPath) {
        const trees = [];
        for (const item of manifest.items) {
            if (item.mediaType === 'application/x-dtbncx+xml' || /\.ncx$/i.test(item.href)) {
                const ncx = await zip.getText(item.path);
                trees.push(...parseNcxTree(ncx, item.path));
            }
        }
        for (const item of manifest.items) {
            if (!hasProperty(item, 'nav')) continue;
            const navHtml = await zip.getText(item.path);
            trees.push(...parseNavTree(navHtml, item.path));
        }
        return trees.map(item => normalizeTocItem(item, chapterByPath)).filter(Boolean);
    }

    function normalizeTocItem(item, chapterByPath) {
        const href = String(item.href || '');
        const [pathPart, fragment = ''] = href.split('#');
        const chapterIndex = chapterByPath.get(pathPart);
        const children = (item.children || []).map(child => normalizeTocItem(child, chapterByPath)).filter(Boolean);
        if (chapterIndex === undefined && !children.length) return null;
        return { id: `toc-${Math.random().toString(36).slice(2)}`, title: item.title || '未命名章节', href: pathPart, fragment, chapterIndex: chapterIndex ?? children[0]?.chapterIndex ?? 0, children };
    }

    function parseNcxTree(ncx, ncxPath) {
        const roots = [];
        const stack = [];
        const tokenPattern = /<\/?[^>]*navPoint\b[^>]*>|<[^:>\s]*:?text\b[^>]*>[\s\S]*?<\/[^:>\s]*:?text\s*>|<[^:>\s]*:?content\b[^>]*>/gi;
        let match;
        while ((match = tokenPattern.exec(String(ncx || '')))) {
            const token = match[0];
            if (/^<\/?[^>]*navPoint\b/i.test(token)) {
                if (/^<\//.test(token)) {
                    const item = stack.pop();
                    if (!item) continue;
                    if (stack.length) stack[stack.length - 1].children.push(item);
                    else roots.push(item);
                } else stack.push({ title: '', href: '', children: [] });
                continue;
            }
            const current = stack[stack.length - 1];
            if (!current) continue;
            if (/^<[^:>\s]*:?text\b/i.test(token)) current.title = decodeHtmlEntities(stripTags(token.replace(/^.*?>/, '').replace(/<\/[^>]+>$/, ''))).trim();
            if (/^<[^:>\s]*:?content\b/i.test(token)) current.href = resolveZipPath(getDirectory(ncxPath), parseAttributes(token).src || '');
        }
        while (stack.length) {
            const item = stack.pop();
            if (stack.length) stack[stack.length - 1].children.push(item); else roots.push(item);
        }
        return roots;
    }

    function parseNavTree(navHtml, navPath) {
        const roots = [];
        const stack = [];
        const tokenPattern = /<li\b[^>]*>|<\/li\s*>|<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
        let match;
        while ((match = tokenPattern.exec(String(navHtml || '')))) {
            const token = match[0];
            if (/^<li\b/i.test(token)) {
                const item = { title: '', href: '', children: [] };
                if (stack.length) stack[stack.length - 1].children.push(item); else roots.push(item);
                stack.push(item);
                continue;
            }
            if (/^<\/li/i.test(token)) { stack.pop(); continue; }
            const current = stack[stack.length - 1];
            if (!current) continue;
            const attrs = parseAttributes(match[1] || '');
            current.title = decodeHtmlEntities(stripTags(match[2] || '')).trim();
            current.href = resolveZipPath(getDirectory(navPath), attrs.href || '');
        }
        return roots;
    }

    function findTocLabel(items, path) {
        for (const item of items || []) {
            if (item.href === path && item.title) return item.title;
            const nested = findTocLabel(item.children, path);
            if (nested) return nested;
        }
        return '';
    }

    function mapTocToChapterIndexes(items, chapters) {
        const byPath = new Map(chapters.map((chapter, index) => [chapter.href, index]));
        const map = values => values.map(item => {
            const chapterIndex = byPath.get(item.href);
            return {
                ...item,
                chapterIndex: chapterIndex ?? item.chapterIndex ?? 0,
                children: map(item.children || [])
            };
        });
        return map(items || []);
    }

    async function readCover(zip, manifest, metadata) {
        const coverItem = manifest.items.find(item => hasProperty(item, 'cover-image'))
            || manifest.byId.get(metadata.coverId || '');
        if (!coverItem) return null;
        const bytes = await zip.getBytes(coverItem.path);
        if (!bytes || bytes.length > 4_000_000) return null;
        return { path: coverItem.path, mime: coverItem.mediaType || guessMime(coverItem.path), dataUrl: `data:${coverItem.mediaType || guessMime(coverItem.path)};base64,${toBase64(bytes)}` };
    }

    function toBase64(bytes) {
        let binary = '';
        const chunk = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
        return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
    }
    function guessMime(path) {
        const value = String(path || '').toLowerCase();
        if (value.endsWith('.png')) return 'image/png';
        if (value.endsWith('.jpg') || value.endsWith('.jpeg')) return 'image/jpeg';
        if (value.endsWith('.gif')) return 'image/gif';
        if (value.endsWith('.svg')) return 'image/svg+xml';
        if (value.endsWith('.woff2')) return 'font/woff2';
        if (value.endsWith('.woff')) return 'font/woff';
        return 'application/octet-stream';
    }
    function escapeAttribute(value) { return String(value || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

    function parseNcxLabels(ncx, ncxPath) {
        const labels = new Map();
        const navPointPattern = /<[^:>\s]*:?navPoint\b[^>]*>([\s\S]*?)<\/[^:>\s]*:?navPoint>/gi;
        let match;
        while ((match = navPointPattern.exec(ncx))) {
            const block = match[1];
            const textMatch = block.match(/<[^:>\s]*:?text\b[^>]*>([\s\S]*?)<\/[^:>\s]*:?text>/i);
            const contentAttrs = getFirstTagAttributes(block, 'content');
            const src = contentAttrs?.src;
            const label = decodeHtmlEntities(stripTags(textMatch?.[1] || '')).trim();
            if (src && label) {
                labels.set(resolveZipPath(getDirectory(ncxPath), src), label);
            }
        }
        return labels;
    }

    function parseNavLabels(navHtml, navPath) {
        const labels = new Map();
        const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = anchorPattern.exec(navHtml))) {
            const attrs = parseAttributes(match[1]);
            const href = attrs.href || '';
            const label = decodeHtmlEntities(stripTags(match[2])).trim();
            if (href && label) {
                labels.set(resolveZipPath(getDirectory(navPath), href), label);
            }
        }
        return labels;
    }

    function prependChapterLabel(text, label) {
        const cleanLabel = String(label || '').trim();
        if (!cleanLabel) return text;

        const firstLine = text.split(/\n+/).find(Boolean) || '';
        if (canonicalText(firstLine) === canonicalText(cleanLabel)) return text;
        return `${cleanLabel}\n\n${text}`;
    }

    function isHtmlManifestItem(item) {
        return /application\/xhtml\+xml|text\/html/i.test(item.mediaType)
            || /\.x?html?$/i.test(item.href);
    }

    function isSkippableEpubItem(item) {
        if (hasProperty(item, 'nav')) return true;
        if (hasProperty(item, 'cover-image')) return true;

        const marker = `${item.id} ${item.href}`.toLowerCase();
        return /(^|[\s/_.-])(nav|toc|contents?|cover|titlepage|copyright|rights|license|colophon)([\s/_.-]|$)/i.test(marker);
    }

    function hasProperty(item, propertyName) {
        return String(item.properties || '')
            .split(/\s+/)
            .some(value => value.toLowerCase() === propertyName.toLowerCase());
    }

    function htmlToReadableText(html) {
        let body = String(html || '')
            .replace(/<\?xml[\s\S]*?\?>/gi, '')
            .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<head\b[\s\S]*?<\/head>/gi, '')
            .replace(/<script\b[\s\S]*?<\/script>/gi, '')
            .replace(/<style\b[\s\S]*?<\/style>/gi, '')
            .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
            .replace(/<nav\b[\s\S]*?<\/nav>/gi, '');

        const bodyMatch = body.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) body = bodyMatch[1];

        body = body
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/h[1-6]>/gi, '\n\n')
            .replace(/<h[1-6]\b[^>]*>/gi, '\n\n')
            .replace(/<\/(p|div|section|article|blockquote|li)>/gi, '\n\n')
            .replace(/<(p|div|section|article|blockquote|li|ul|ol)\b[^>]*>/gi, '\n')
            .replace(/<\/(tr|table)>/gi, '\n\n')
            .replace(/<\/(td|th)>/gi, ' ')
            .replace(/<hr\b[^>]*>/gi, '\n\n')
            .replace(/<[^>]+>/g, ' ');

        return decodeHtmlEntities(body)
            .replace(/\u00a0/g, ' ')
            .split('\n')
            .map(line => line.replace(/[ \t]+/g, ' ').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function getTagAttributes(xml, tagName) {
        const pattern = new RegExp(`<[^:>\\s]*:?${tagName}\\b([^>]*)>`, 'gi');
        const attrs = [];
        let match;
        while ((match = pattern.exec(xml))) {
            attrs.push(parseAttributes(match[1]));
        }
        return attrs;
    }

    function getFirstTagAttributes(xml, tagName) {
        return getTagAttributes(xml, tagName)[0] || null;
    }

    function parseAttributes(attributeText) {
        const attrs = {};
        const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let match;
        while ((match = pattern.exec(attributeText || ''))) {
            attrs[match[1]] = decodeHtmlEntities(match[2] ?? match[3] ?? '');
        }
        return attrs;
    }

    function stripTags(text) {
        return String(text || '').replace(/<[^>]+>/g, ' ');
    }

    function decodeHtmlEntities(text) {
        const named = {
            amp: '&',
            apos: "'",
            copy: '(c)',
            gt: '>',
            lt: '<',
            nbsp: ' ',
            ndash: '-',
            mdash: '-',
            quot: '"',
            rsquo: "'",
            lsquo: "'",
            rdquo: '"',
            ldquo: '"'
        };

        return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, value) => {
            const lower = value.toLowerCase();
            if (lower[0] === '#') {
                const codePoint = lower[1] === 'x'
                    ? parseInt(lower.slice(2), 16)
                    : parseInt(lower.slice(1), 10);
                return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
            }
            return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : entity;
        });
    }

    function resolveZipPath(baseDir, href) {
        const withoutFragment = String(href || '').split('#')[0];
        const withoutQuery = withoutFragment.split('?')[0];
        const decodedHref = safeDecodeUri(withoutQuery);
        if (!decodedHref) return normalizeZipPath(baseDir);
        if (/^[a-z]+:/i.test(decodedHref)) return normalizeZipPath(decodedHref);
        return normalizeZipPath(`${baseDir ? `${baseDir}/` : ''}${decodedHref}`);
    }

    function getDirectory(path) {
        const normalized = normalizeZipPath(path);
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
    }

    function normalizeZipPath(path) {
        const parts = String(path || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .split('/');
        const normalized = [];

        parts.forEach(part => {
            if (!part || part === '.') return;
            if (part === '..') normalized.pop();
            else normalized.push(part);
        });

        return normalized.join('/');
    }

    function safeDecodeUri(value) {
        try {
            return decodeURIComponent(value);
        } catch (error) {
            return value;
        }
    }

    function decodeZipString(bytes, flags) {
        if (flags & UTF8_FLAG) return new TextDecoder('utf-8').decode(bytes);
        return new TextDecoder('utf-8').decode(bytes);
    }

    function canonicalText(text) {
        return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    return {
        parseEpubToText,
        parseEpubBook,
        htmlToReadableText,
        sanitizeEpubHtml,
        resolveZipPath,
        parseNavTree,
        parseNcxTree
    };
});
