(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangTextAnchors = { ...(root.KangkangTextAnchors || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    /**
     * Logical text locations deliberately do not contain a page index.  A page
     * is a view of a document and can change whenever CSS, a font, or a PDF
     * viewport changes.  `spineIndex`/`documentIndex` and the UTF-16 text
     * offset are the durable ordering information.
     */
    const ANCHOR_SCHEMA_VERSION = 1;
    const ANCHOR_FORMAT = 'kangkang-text-anchor';
    const SELECTION_FORMAT = 'kangkang-text-selection';

    function asFiniteInteger(value, fallback = null) {
        if (value === null || value === undefined || value === '') return fallback;
        const number = Number(value);
        return Number.isFinite(number) ? Math.trunc(number) : fallback;
    }

    function clampOffset(value, length = Number.MAX_SAFE_INTEGER) {
        const number = Math.max(0, asFiniteInteger(value, 0));
        return Math.min(number, Math.max(0, asFiniteInteger(length, number)));
    }

    function normalizePath(path) {
        if (Array.isArray(path)) return path.map(value => Math.max(0, asFiniteInteger(value, 0)));
        if (typeof path === 'string') return path.split('/').filter(Boolean).map(value => Math.max(0, asFiniteInteger(value, 0)));
        return [];
    }

    function pathString(path) { return normalizePath(path).join('/'); }

    function cfiFor(path, offset) {
        const steps = normalizePath(path).map(value => Math.max(2, (value + 1) * 2)).join('/');
        return `epubcfi(/6/${steps || '2'}:${Math.max(0, asFiniteInteger(offset, 0))})`;
    }

    function normalizeAnchorText(value) {
        return String(value ?? '')
            .normalize?.('NFKC') || String(value ?? '');
    }

    function collapseWhitespace(value) {
        return normalizeAnchorText(value).replace(/[\t\n\r\f ]+/g, ' ');
    }

    // Returns a mapping from every UTF-16 code unit in the collapsed text to
    // the corresponding UTF-16 offset in the source string.  Keeping UTF-16
    // offsets is important because DOM Range offsets use them too.
    function collapsedTextMap(source) {
        const text = normalizeAnchorText(source);
        const output = [];
        const map = [];
        let inWhitespace = false;
        for (let index = 0; index < text.length; index += 1) {
            const value = text[index];
            if (/[\t\n\r\f ]/.test(value)) {
                if (inWhitespace) continue;
                inWhitespace = true;
                output.push(' ');
                map.push(index);
                continue;
            }
            inWhitespace = false;
            output.push(value);
            map.push(index);
        }
        return { text: output.join(''), map };
    }

    function normalizedOffset(source, offset) {
        const map = collapsedTextMap(source).map;
        const sourceOffset = clampOffset(offset, String(source ?? '').length);
        let result = 0;
        while (result < map.length && map[result] < sourceOffset) result += 1;
        return result;
    }

    function sourceOffsetFromNormalized(source, offset) {
        const value = String(source ?? '');
        const map = collapsedTextMap(value).map;
        const normalized = clampOffset(offset, map.length);
        return normalized >= map.length ? value.length : map[normalized] ?? value.length;
    }

    function stableFingerprint(value) {
        const text = typeof value === 'string' ? value : bytesToBinary(value);
        // Two independent 32-bit FNV streams keep this synchronous in WebView
        // and are sufficient for a book identity/context guard.  This is not a
        // cryptographic signature; callers may supply a stronger fingerprint.
        let first = 0x811c9dc5;
        let second = 0x9e3779b9;
        for (let index = 0; index < text.length; index += 1) {
            const code = text.charCodeAt(index);
            first ^= code;
            first = Math.imul(first, 0x01000193);
            second ^= code + index;
            second = Math.imul(second, 0x85ebca6b);
        }
        return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
    }

    function bytesToBinary(value) {
        if (value instanceof Uint8Array) {
            const bytes = value.subarray(0, Math.min(value.length, 2_000_000));
            let output = '';
            for (let offset = 0; offset < bytes.length; offset += 0x8000) output += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
            return output;
        }
        if (value instanceof ArrayBuffer) return bytesToBinary(new Uint8Array(value));
        return String(value ?? '');
    }

    function createBookIdentity(format, source, options = {}) {
        const suppliedId = String(options.bookId || options.identifier || '').trim();
        const suppliedFingerprint = String(options.fingerprint || options.sourceFingerprint || '').trim();
        const fingerprint = suppliedFingerprint || stableFingerprint(source);
        return {
            bookId: suppliedId || `${String(format || 'text').toLowerCase()}:${fingerprint}`,
            fingerprint,
            sourceFingerprint: fingerprint
        };
    }

    function contextFor(text, offset, windowSize = 48) {
        const source = String(text ?? '');
        const point = clampOffset(offset, source.length);
        const radius = Math.max(8, asFiniteInteger(windowSize, 48));
        const exactStart = point < source.length ? point : Math.max(0, point - radius);
        const exact = source.slice(exactStart, Math.min(source.length, exactStart + radius));
        return {
            exact,
            exactOffset: exactStart,
            prefix: source.slice(Math.max(0, point - radius), point),
            suffix: source.slice(point, Math.min(source.length, point + radius)),
            normalizedExact: collapseWhitespace(exact),
            normalizedExactOffset: normalizedOffset(source, exactStart),
            normalizedPrefix: collapseWhitespace(source.slice(Math.max(0, point - radius), point)),
            normalizedSuffix: collapseWhitespace(source.slice(point, Math.min(source.length, point + radius)))
        };
    }

    function makePosition(input = {}) {
        const format = String(input.documentFormat || input.format || input.type || 'text').toLowerCase();
        const offset = Math.max(0, asFiniteInteger(input.offset ?? input.textOffset ?? input.normalizedOffset, 0));
        const path = normalizePath(input.structuralPath ?? input.path ?? input.domPath);
        const pageNumber = asFiniteInteger(input.pageNumber ?? input.page, null);
        const spineIndex = asFiniteInteger(input.spineIndex ?? input.chapterIndex ?? (input.documentFormat === 'pdf' ? null : input.documentIndex), null);
        const documentIndex = asFiniteInteger(input.documentIndex ?? input.chapterIndex ?? spineIndex, spineIndex);
        const itemIndex = asFiniteInteger(input.itemIndex, null);
        const itemOffset = asFiniteInteger(input.itemOffset, null);
        const position = {
            schemaVersion: ANCHOR_SCHEMA_VERSION,
            format: ANCHOR_FORMAT,
            documentFormat: format,
            bookId: String(input.bookId || ''),
            sourceFingerprint: String(input.sourceFingerprint || input.fingerprint || ''),
            spineIndex,
            documentIndex,
            href: String(input.href || ''),
            pageNumber,
            structuralPath: path,
            cfi: String(input.cfi || input.epubCfi || (format === 'epub' ? cfiFor(path, offset) : '')),
            offset,
            normalizedOffset: Math.max(0, asFiniteInteger(input.normalizedOffset, offset)),
            itemIndex,
            itemOffset,
            exact: String(input.exact || ''),
            exactOffset: Math.max(0, asFiniteInteger(input.exactOffset, offset)),
            prefix: String(input.prefix || ''),
            suffix: String(input.suffix || ''),
            normalizedExact: String(input.normalizedExact || ''),
            normalizedExactOffset: Math.max(0, asFiniteInteger(input.normalizedExactOffset, input.normalizedOffset ?? offset)),
            normalizedPrefix: String(input.normalizedPrefix || ''),
            normalizedSuffix: String(input.normalizedSuffix || '')
        };
        if (input.nodePath && !position.structuralPath.length) position.structuralPath = normalizePath(input.nodePath);
        return position;
    }

    function createPosition(text, offset, metadata = {}) {
        const context = contextFor(text, offset, metadata.contextWindow || 48);
        const source = String(text ?? '');
        const position = makePosition({ ...metadata, offset: clampOffset(offset, source.length), normalizedOffset: normalizedOffset(source, offset), ...context });
        return position;
    }

    function positionUnitOrder(position) {
        const value = position || {};
        if (value.documentFormat === 'pdf' || value.pageNumber !== null && value.pageNumber !== undefined) return asFiniteInteger(value.pageNumber, 1) || 1;
        return asFiniteInteger(value.spineIndex ?? value.documentIndex, 0) ?? 0;
    }

    function comparePaths(left, right) {
        const a = normalizePath(left);
        const b = normalizePath(right);
        for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
            const difference = (a[index] ?? -1) - (b[index] ?? -1);
            if (difference) return difference < 0 ? -1 : 1;
        }
        return 0;
    }

    function comparePositions(left, right) {
        const a = makePosition(left);
        const b = makePosition(right);
        const unitDifference = positionUnitOrder(a) - positionUnitOrder(b);
        if (unitDifference) return unitDifference < 0 ? -1 : 1;
        const aOffset = Math.max(0, asFiniteInteger(a.offset ?? a.normalizedOffset, 0));
        const bOffset = Math.max(0, asFiniteInteger(b.offset ?? b.normalizedOffset, 0));
        if (aOffset !== bOffset) return aOffset < bOffset ? -1 : 1;
        const itemDifference = (a.itemIndex ?? -1) - (b.itemIndex ?? -1);
        if (itemDifference) return itemDifference < 0 ? -1 : 1;
        const itemOffsetDifference = (a.itemOffset ?? 0) - (b.itemOffset ?? 0);
        if (itemOffsetDifference) return itemOffsetDifference < 0 ? -1 : 1;
        return comparePaths(a.structuralPath, b.structuralPath);
    }

    function sameLogicalUnit(left, right) {
        const a = makePosition(left);
        const b = makePosition(right);
        if (a.documentFormat !== b.documentFormat) return false;
        if ((a.documentFormat === 'pdf' || a.pageNumber !== null) && a.pageNumber !== b.pageNumber) return false;
        if (a.href && b.href) return a.href.toLowerCase() === b.href.toLowerCase();
        return positionUnitOrder(a) === positionUnitOrder(b);
    }

    function createSelection(origin, focus, options = {}) {
        const normalizedOrigin = makePosition(origin);
        const normalizedFocus = makePosition(focus);
        const forward = comparePositions(normalizedOrigin, normalizedFocus) <= 0;
        const start = forward ? normalizedOrigin : normalizedFocus;
        const end = forward ? normalizedFocus : normalizedOrigin;
        return {
            schemaVersion: ANCHOR_SCHEMA_VERSION,
            format: SELECTION_FORMAT,
            documentFormat: String(options.documentFormat || start.documentFormat || 'text'),
            bookId: String(options.bookId || start.bookId || focus.bookId || ''),
            sourceFingerprint: String(options.sourceFingerprint || start.sourceFingerprint || focus.sourceFingerprint || ''),
            origin: normalizedOrigin,
            focus: normalizedFocus,
            start,
            end,
            selectedText: String(options.selectedText ?? options.text ?? '')
        };
    }

    function assertSerializedObject(value, expectedFormat) {
        let parsed = value;
        if (typeof value === 'string') {
            try { parsed = JSON.parse(value); } catch (error) { throw new Error('文本锚点无法解析：不是有效 JSON'); }
        }
        if (!parsed || typeof parsed !== 'object') throw new Error('文本锚点无法解析：数据为空');
        if (Number(parsed.schemaVersion) !== ANCHOR_SCHEMA_VERSION) throw new Error(`文本锚点版本不兼容：${parsed.schemaVersion || '未知'}`);
        if (parsed.format !== expectedFormat) throw new Error('文本锚点类型不匹配');
        return parsed;
    }

    function serializePosition(position) { return JSON.stringify(makePosition(position)); }

    function parsePosition(value) { return makePosition(assertSerializedObject(value, ANCHOR_FORMAT)); }

    function serializeSelection(selection) {
        const value = createSelection(selection.origin || selection.start, selection.focus || selection.end, selection);
        return JSON.stringify(value);
    }

    function parseSelection(value) {
        const parsed = assertSerializedObject(value, SELECTION_FORMAT);
        if (!parsed.origin || !parsed.focus || !parsed.start || !parsed.end) throw new Error('文本选区缺少 origin/focus/start/end');
        return createSelection(parsePosition(parsed.origin), parsePosition(parsed.focus), {
            documentFormat: parsed.documentFormat,
            bookId: parsed.bookId,
            sourceFingerprint: parsed.sourceFingerprint,
            selectedText: parsed.selectedText
        });
    }

    function identityMismatch(position, options = {}) {
        const expectedBook = String(options.bookId || '').trim();
        const expectedFingerprint = String(options.sourceFingerprint || options.fingerprint || '').trim();
        if (expectedBook && position.bookId && expectedBook !== position.bookId) return '书籍标识不匹配';
        if (expectedFingerprint && position.sourceFingerprint && expectedFingerprint !== position.sourceFingerprint) return '书籍指纹不匹配';
        return '';
    }

    function contextMatch(text, position, candidate) {
        const source = String(text ?? '');
        const prefix = position.prefix || '';
        const suffix = position.suffix || '';
        const exact = position.exact || '';
        const normalized = collapsedTextMap(source).text;
        if (exact && source.slice(candidate + (position.exactOffset - position.offset), candidate + (position.exactOffset - position.offset) + exact.length) !== exact) return false;
        if (prefix && !source.slice(Math.max(0, candidate - prefix.length), candidate).endsWith(prefix)) return false;
        if (suffix && !source.slice(candidate, candidate + suffix.length).startsWith(suffix)) return false;
        if (!exact && !prefix && !suffix && candidate > source.length) return false;
        return normalized.length >= 0;
    }

    function recoveryCandidates(text, position) {
        const source = String(text ?? '');
        const candidates = [];
        const exact = String(position.exact || '');
        const exactDelta = asFiniteInteger(position.exactOffset, position.offset) - asFiniteInteger(position.offset, 0);
        if (exact) {
            let from = 0;
            while (from <= source.length) {
                const index = source.indexOf(exact, from);
                if (index < 0) break;
                candidates.push(Math.max(0, index - exactDelta));
                from = index + Math.max(1, exact.length);
            }
        }
        if (!candidates.length && (position.prefix || position.suffix)) {
            const needle = `${position.prefix || ''}${position.suffix || ''}`;
            let from = 0;
            while (needle && from <= source.length) {
                const index = source.indexOf(needle, from);
                if (index < 0) break;
                candidates.push(index + String(position.prefix || '').length);
                from = index + 1;
            }
        }
        if (!candidates.length) candidates.push(clampOffset(position.offset, source.length));
        return [...new Set(candidates)].map(value => clampOffset(value, source.length));
    }

    function normalizedContextMatch(text, position, candidate) {
        const normalized = collapsedTextMap(text).text;
        const point = normalizedOffset(text, candidate);
        const exact = position.normalizedExact || collapseWhitespace(position.exact || '');
        const exactDelta = asFiniteInteger(position.normalizedExactOffset, position.normalizedOffset) - asFiniteInteger(position.normalizedOffset, 0);
        const prefix = position.normalizedPrefix || collapseWhitespace(position.prefix || '');
        const suffix = position.normalizedSuffix || collapseWhitespace(position.suffix || '');
        if (exact && normalized.slice(point + exactDelta, point + exactDelta + exact.length) !== exact) return false;
        if (prefix && !normalized.slice(Math.max(0, point - prefix.length), point).endsWith(prefix)) return false;
        if (suffix && !normalized.slice(point, point + suffix.length).startsWith(suffix)) return false;
        return Boolean(exact || prefix || suffix);
    }

    function normalizedRecoveryCandidates(text, position) {
        const normalized = collapsedTextMap(text).text;
        const candidates = [];
        const exact = position.normalizedExact || collapseWhitespace(position.exact || '');
        const exactDelta = asFiniteInteger(position.normalizedExactOffset, position.normalizedOffset) - asFiniteInteger(position.normalizedOffset, 0);
        if (exact) {
            let from = 0;
            while (from <= normalized.length) {
                const index = normalized.indexOf(exact, from);
                if (index < 0) break;
                candidates.push(sourceOffsetFromNormalized(text, Math.max(0, index - exactDelta)));
                from = index + Math.max(1, exact.length);
            }
        }
        if (!candidates.length) {
            const prefix = position.normalizedPrefix || collapseWhitespace(position.prefix || '');
            const suffix = position.normalizedSuffix || collapseWhitespace(position.suffix || '');
            const needle = `${prefix}${suffix}`;
            let from = 0;
            while (needle && from <= normalized.length) {
                const index = normalized.indexOf(needle, from);
                if (index < 0) break;
                candidates.push(sourceOffsetFromNormalized(text, index + prefix.length));
                from = index + 1;
            }
        }
        return [...new Set(candidates)].map(value => clampOffset(value, text.length));
    }

    function recoverPosition(position, source, options = {}) {
        const input = makePosition(position);
        const mismatch = identityMismatch(input, options);
        if (mismatch) return { ok: false, reason: mismatch, position: input };
        const text = typeof source === 'string' ? source : source?.text;
        if (typeof text !== 'string') return { ok: false, reason: '没有可恢复的正文', position: input };
        const candidates = recoveryCandidates(text, input);
        let valid = candidates.filter(candidate => contextMatch(text, input, candidate));
        if (!valid.length) {
            const normalizedCandidates = normalizedRecoveryCandidates(text, input);
            valid = normalizedCandidates.filter(candidate => normalizedContextMatch(text, input, candidate));
        }
        if (!valid.length) return { ok: false, reason: '正文已变化，未找到安全的文本上下文', position: input };
        valid.sort((a, b) => Math.abs(a - input.offset) - Math.abs(b - input.offset));
        const recovered = createPosition(text, valid[0], input);
        return { ok: true, position: recovered, offset: recovered.offset, text };
    }

    function getDocumentText(source, position) {
        if (typeof source === 'string') return source;
        if (Array.isArray(source)) {
            const index = positionUnitOrder(position);
            return source[index]?.text ?? source[index] ?? null;
        }
        if (source && typeof source === 'object') return source.text ?? null;
        return null;
    }

    function documentEntries(source) {
        if (Array.isArray(source)) return source.map((value, index) => ({ ...((value && typeof value === 'object') ? value : { text: String(value ?? '') }), _index: index, text: String(value?.text ?? value ?? '') }));
        if (source && Array.isArray(source.documents)) return documentEntries(source.documents);
        return [{ text: String(source?.text ?? source ?? ''), _index: 0 }];
    }

    function entryIndexForPosition(entries, position) {
        const value = makePosition(position);
        if (value.href) {
            const hrefIndex = entries.findIndex(entry => String(entry.href || '').toLowerCase() === value.href.toLowerCase());
            if (hrefIndex >= 0) return hrefIndex;
        }
        if (value.pageNumber !== null && value.pageNumber !== undefined) {
            const pageIndex = entries.findIndex(entry => Number(entry.pageNumber) === value.pageNumber);
            if (pageIndex >= 0) return pageIndex;
        }
        const spineIndex = asFiniteInteger(value.spineIndex ?? value.documentIndex, null);
        if (spineIndex !== null) {
            const logicalIndex = entries.findIndex(entry => Number(entry.spineIndex ?? entry.documentIndex ?? entry._index) === spineIndex);
            if (logicalIndex >= 0) return logicalIndex;
        }
        return positionUnitOrder(value);
    }

    function extractRange(selection, source, options = {}) {
        const value = selection?.start ? selection : createSelection(selection?.origin, selection?.focus, selection);
        if (!value?.start || !value?.end) return { ok: false, reason: '文本选区缺少边界', text: '' };
        const mismatch = identityMismatch(value.start, options) || identityMismatch(value.end, options);
        if (mismatch) return { ok: false, reason: mismatch, text: '' };
        const entries = documentEntries(source);
        const startUnit = entryIndexForPosition(entries, value.start);
        const endUnit = entryIndexForPosition(entries, value.end);
        if (startUnit < 0 || endUnit < 0 || startUnit >= entries.length || endUnit >= entries.length || startUnit > endUnit) return { ok: false, reason: '选区不在当前正文范围内', text: '' };
        const parts = [];
        for (let index = startUnit; index <= endUnit; index += 1) {
            const text = entries[index].text;
            if (index === startUnit && index === endUnit) {
                const start = recoverPosition(value.start, text, options);
                const end = recoverPosition(value.end, text, options);
                if (!start.ok || !end.ok || end.offset < start.offset) return { ok: false, reason: '选区边界无法安全恢复', text: '' };
                parts.push(text.slice(start.offset, end.offset));
            } else if (index === startUnit) {
                const start = recoverPosition(value.start, text, options);
                if (!start.ok) return { ok: false, reason: start.reason, text: '' };
                parts.push(text.slice(start.offset));
            } else if (index === endUnit) {
                const end = recoverPosition(value.end, text, options);
                if (!end.ok) return { ok: false, reason: end.reason, text: '' };
                parts.push(text.slice(0, end.offset));
            } else parts.push(text);
        }
        return { ok: true, text: parts.join(options.separator ?? '\n\n'), start: value.start, end: value.end };
    }

    function extractRangeText(selection, source, options = {}) { return extractRange(selection, source, options).text; }

    function getTextNodes(root) {
        if (!root) return [];
        if (root.ownerDocument?.createTreeWalker) {
            const nodes = [];
            const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
            let node;
            while ((node = walker.nextNode())) {
                if (!/^(SCRIPT|STYLE|NOSCRIPT)$/i.test(node.parentElement?.tagName || '')) nodes.push(node);
            }
            return nodes;
        }
        const nodes = [];
        const visit = node => {
            if (!node) return;
            if (node.nodeType === 3) { nodes.push(node); return; }
            if (/^(SCRIPT|STYLE|NOSCRIPT)$/i.test(node.tagName || '')) return;
            [...(node.childNodes || [])].forEach(visit);
        };
        visit(root);
        return nodes;
    }

    function domTextMap(root) {
        let offset = 0;
        const entries = getTextNodes(root).map(node => {
            const text = String(node.nodeValue || '');
            const entry = { node, start: offset, end: offset + text.length };
            offset += text.length;
            return entry;
        });
        return { text: entries.map(entry => entry.node.nodeValue || '').join(''), entries };
    }

    function structuralPath(root, node) {
        const path = [];
        let current = node;
        while (current && current !== root) {
            const parent = current.parentNode;
            if (!parent) break;
            path.unshift([...parent.childNodes].indexOf(current));
            current = parent;
        }
        return path;
    }

    function nodeAtPath(root, path) {
        let current = root;
        for (const index of normalizePath(path)) {
            if (!current?.childNodes?.[index]) return null;
            current = current.childNodes[index];
        }
        return current;
    }

    function pointToPosition(nodeOrPoint, offsetOrOptions = 0, maybeOptions = {}) {
        const point = nodeOrPoint && typeof nodeOrPoint === 'object' && nodeOrPoint.node && nodeOrPoint.offset !== undefined ? nodeOrPoint : null;
        const node = point ? point.node : nodeOrPoint;
        const offset = point ? point.offset : offsetOrOptions;
        const options = point ? { ...maybeOptions, ...(point.options || {}) } : maybeOptions;
        const root = options.root || node?.ownerDocument?.body || node;
        if (!node) throw new Error('无法从空节点创建文本锚点');
        const map = domTextMap(root);
        let globalOffset = 0;
        let itemIndex = options.itemIndex ?? null;
        let itemOffset = options.itemOffset ?? null;
        if (node.nodeType === 3) {
            const entry = map.entries.find(item => item.node === node);
            if (!entry) throw new Error('文本节点不属于当前阅读文档');
            globalOffset = entry.start + clampOffset(offset, String(node.nodeValue || '').length);
        } else {
            const childIndex = clampOffset(offset, node.childNodes?.length || 0);
            const child = node.childNodes?.[childIndex];
            const entry = child && map.entries.find(item => item.node === child);
            globalOffset = entry ? entry.start : map.text.length;
        }
        const itemElement = node.parentElement?.closest?.('[data-reader-item-index]');
        const model = options.textModel;
        if (itemElement && model?.items) {
            itemIndex = asFiniteInteger(itemElement.dataset.readerItemIndex, itemIndex);
            const item = model.items.find(value => value.itemIndex === itemIndex) || model.items.find((_value, index) => index === itemIndex);
            if (item) {
                const localMap = domTextMap(itemElement);
                const localEntry = localMap.entries.find(value => value.node === node);
                itemOffset = Math.max(0, (localEntry?.start || 0) + clampOffset(offset, String(node.nodeValue || '').length));
                itemOffset = Math.min(String(item.str || '').length, itemOffset);
                globalOffset = Math.min(String(model.text || '').length, item.start + itemOffset);
            }
        }
        const anchorText = typeof options.logicalText === 'string' ? options.logicalText : (typeof model?.text === 'string' ? model.text : map.text);
        if (!itemElement && anchorText !== map.text) globalOffset = sourceOffsetFromNormalized(anchorText, normalizedOffset(map.text, globalOffset));
        const position = createPosition(anchorText, globalOffset, {
            ...options,
            structuralPath: structuralPath(root, node),
            offset: globalOffset,
            itemIndex,
            itemOffset
        });
        return position;
    }

    function pointForGlobalOffset(map, offset) {
        const point = clampOffset(offset, map.text.length);
        const entry = map.entries.find(item => point >= item.start && point <= item.end) || map.entries[map.entries.length - 1];
        if (!entry) return { node: null, offset: 0 };
        return { node: entry.node, offset: Math.max(0, Math.min(String(entry.node.nodeValue || '').length, point - entry.start)) };
    }

    function positionToDomPoint(position, root, options = {}) {
        const input = makePosition(position);
        const map = domTextMap(root);
        const mismatch = identityMismatch(input, options);
        if (mismatch) return { ok: false, reason: mismatch };
        if (input.itemIndex !== null && input.itemIndex !== undefined && root.querySelector) {
            const itemElement = root.querySelector(`[data-reader-item-index="${String(input.itemIndex).replace(/"/g, '')}"]`);
            if (itemElement) {
                const itemMap = domTextMap(itemElement);
                const itemPoint = pointForGlobalOffset(itemMap, input.itemOffset ?? 0);
                if (itemPoint.node) return { ok: true, ...itemPoint };
            }
        }
        const candidate = nodeAtPath(root, input.structuralPath);
        if (candidate?.nodeType === 3) {
            const local = clampOffset(input.offset, String(candidate.nodeValue || '').length);
            const exactStart = Math.max(0, input.exactOffset - input.offset);
            const probe = String(candidate.nodeValue || '').slice(local + exactStart, local + exactStart + String(input.exact || '').length);
            if (!input.exact || probe === input.exact || (probe && input.exact.startsWith(probe)) || (probe && probe.startsWith(input.exact))) return { ok: true, node: candidate, offset: local };
        }
        const recovered = recoverPosition(input, map.text, options);
        if (!recovered.ok) return recovered;
        const point = pointForGlobalOffset(map, recovered.offset);
        return point.node ? { ok: true, ...point, recovered: true, position: recovered.position } : { ok: false, reason: '当前页面没有可定位的文本节点' };
    }

    function selectionFromRange(range, options = {}) {
        if (!range) throw new Error('无法从空 Range 创建文本选区');
        const origin = pointToPosition(range.startContainer, range.startOffset, options);
        const focus = pointToPosition(range.endContainer, range.endOffset, options);
        return createSelection(origin, focus, { ...options, selectedText: String(range.toString?.() || '') });
    }

    function selectionFromDomSelection(selection, options = {}) {
        if (!selection || selection.rangeCount < 1 || selection.isCollapsed) return null;
        return selectionFromRange(selection.getRangeAt(0), options);
    }

    function rangeForSelection(selection, root, options = {}) {
        const value = selection?.start ? selection : parseSelection(selection);
        const unit = options.positionUnit || {};
        const sameStart = sameLogicalUnit(value.start, { ...value.start, ...unit });
        const sameEnd = sameLogicalUnit(value.end, { ...value.end, ...unit });
        if (!sameStart && comparePositions(value.start, unit) > 0) return null;
        if (!sameEnd && comparePositions(value.end, unit) < 0) return null;
        const map = domTextMap(root);
        const startPoint = sameStart ? positionToDomPoint(value.start, root, options) : { ok: true, ...pointForGlobalOffset(map, 0) };
        const endPoint = sameEnd ? positionToDomPoint(value.end, root, options) : { ok: true, ...pointForGlobalOffset(map, map.text.length) };
        if (!startPoint?.ok || !endPoint?.ok || !startPoint.node || !endPoint.node) return null;
        const range = root.ownerDocument?.createRange?.();
        if (!range) return null;
        range.setStart(startPoint.node, startPoint.offset);
        range.setEnd(endPoint.node, endPoint.offset);
        return range;
    }

    function parseCurrentPageRect(range, options = {}) {
        if (!range) return [];
        const page = options.pageRect || options.rect || null;
        const clientRects = typeof range.getClientRects === 'function' ? [...range.getClientRects()] : Array.isArray(range) ? range : [];
        return clientRects.map(rect => {
            const raw = { left: Number(rect.left) || 0, top: Number(rect.top) || 0, right: Number(rect.right ?? ((Number(rect.left) || 0) + (Number(rect.width) || 0))), bottom: Number(rect.bottom ?? ((Number(rect.top) || 0) + (Number(rect.height) || 0))), width: Number(rect.width) || 0, height: Number(rect.height) || 0 };
            if (!page) return raw;
            const left = Math.max(raw.left, Number(page.left) || 0);
            const top = Math.max(raw.top, Number(page.top) || 0);
            const right = Math.min(raw.right, Number(page.right ?? ((Number(page.left) || 0) + (Number(page.width) || 0))));
            const bottom = Math.min(raw.bottom, Number(page.bottom ?? ((Number(page.top) || 0) + (Number(page.height) || 0))));
            return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
        }).filter(rect => rect.width > 0 && rect.height > 0);
    }

    class SelectionSession {
        constructor(options = {}) { this.options = options; this.active = false; this.selection = null; }
        begin(origin) {
            this.active = true;
            this.selection = createSelection(origin, origin, this.options);
            return this.selection;
        }
        update(focus) {
            if (!this.active) return null;
            this.selection = createSelection(this.selection.origin, focus, this.options);
            return this.selection;
        }
        finish(focus = null) {
            if (focus) this.update(focus);
            this.active = false;
            return this.selection;
        }
        cancel() { this.active = false; this.selection = null; }
        hasMoved() { return Boolean(this.selection && comparePositions(this.selection.origin, this.selection.focus) !== 0); }
    }

    class ContinuousSelectionController extends SelectionSession {
        constructor(options = {}) {
            super(options);
            this.edgeDelay = Math.max(80, Number(options.edgeDelay) || 420);
            this.edgeDebounce = Math.max(80, Number(options.edgeDebounce) || 380);
            this.clock = options.clock || (() => Date.now());
            this.timer = null;
            this.lastEdgeAt = -Infinity;
            this.rendering = false;
            this.edgeToken = 0;
            this.onAdvance = options.onAdvance || (async () => {});
        }
        scheduleEdge(direction) {
            if (!this.active || !this.hasMoved() || this.rendering) return false;
            const normalizedDirection = Number(direction) < 0 ? -1 : 1;
            const now = this.clock();
            if (now - this.lastEdgeAt < this.edgeDebounce) return false;
            clearTimeout(this.timer);
            const token = ++this.edgeToken;
            this.timer = setTimeout(async () => {
                if (!this.active || token !== this.edgeToken || this.rendering) return;
                this.lastEdgeAt = this.clock();
                this.rendering = true;
                try { await this.onAdvance(normalizedDirection, this.selection); } finally { this.rendering = false; }
            }, this.edgeDelay);
            return true;
        }
        cancelEdge() { clearTimeout(this.timer); this.timer = null; this.edgeToken += 1; }
        cancel() { this.cancelEdge(); super.cancel(); }
    }

    return {
        ANCHOR_SCHEMA_VERSION,
        ANCHOR_FORMAT,
        SELECTION_FORMAT,
        stableFingerprint,
        createBookIdentity,
        normalizeAnchorText,
        collapseWhitespace,
        collapsedTextMap,
        sourceOffsetFromNormalized,
        normalizePath,
        pathString,
        cfiFor,
        makePosition,
        createPosition,
        comparePositions,
        sameLogicalUnit,
        createSelection,
        serializePosition,
        parsePosition,
        serializeSelection,
        parseSelection,
        recoverPosition,
        extractRange,
        extractRangeText,
        getTextNodes,
        domTextMap,
        pointToPosition,
        positionToDomPoint,
        selectionFromRange,
        selectionFromDomSelection,
        rangeForSelection,
        parseCurrentPageRect,
        getCurrentPageRects: parseCurrentPageRect,
        SelectionSession,
        ContinuousSelectionController
    };
});
