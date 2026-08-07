(function (root, factory) {
    const api = factory(root?.KangkangCore || {});
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangReaderSelection = { ...(root.KangkangReaderSelection || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
    const WORD_PATTERN = /[A-Za-z]+(?:['’‑-][A-Za-z]+)*/g;
    const LOGICAL_WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’‑-][\p{L}\p{M}\p{N}]+)*/gu;
    const RANGE_ACTION_IDS = Object.freeze(['explain', 'translate', 'copy', 'note']);

    function normalizeWord(value) {
        if (typeof core.normalizeWord === 'function') return core.normalizeWord(value);
        return String(value || '').normalize('NFKC').toLowerCase().replace(/[’‘`]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '').trim();
    }

    function tokenizeWords(value) {
        const text = String(value || '');
        const tokens = [];
        let match;
        while ((match = WORD_PATTERN.exec(text))) {
            tokens.push({ text: match[0], normalized: normalizeWord(match[0]), start: match.index, end: match.index + match[0].length });
        }
        WORD_PATTERN.lastIndex = 0;
        return tokens;
    }

    function tokenizeLogicalWords(value) {
        const text = String(value || '');
        const tokens = [];
        let match;
        while ((match = LOGICAL_WORD_PATTERN.exec(text))) {
            tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
        }
        LOGICAL_WORD_PATTERN.lastIndex = 0;
        return tokens;
    }

    function isSingleWord(value) {
        const text = String(value || '').trim();
        return Boolean(text && /^[A-Za-z]+(?:['’‑-][A-Za-z]+)*$/.test(text));
    }

    function actionIdsForSelection(kind) {
        return kind === 'range' ? [...RANGE_ACTION_IDS] : [];
    }

    function shouldSkipTextNode(node, includeTextLayer = false) {
        const parent = node?.parentElement;
        if (!parent) return true;
        if (parent.closest?.('.reader-word-token, .reader-word-skip, .reader-selection-overlay, a, button, input, select, textarea, script, style')) return true;
        if (!includeTextLayer && parent.closest?.('.textLayer')) return true;
        return false;
    }

    function wrapWordTokens(rootElement, { documentRef = globalThis.document, includeTextLayer = false } = {}) {
        if (!rootElement?.appendChild || !documentRef?.createTreeWalker) return 0;
        const showText = globalThis.NodeFilter?.SHOW_TEXT || 4;
        const walker = documentRef.createTreeWalker(rootElement, showText);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        let wrapped = 0;
        nodes.forEach(textNode => {
            if (shouldSkipTextNode(textNode, includeTextLayer)) return;
            const tokens = tokenizeWords(textNode.nodeValue || '');
            if (!tokens.length) return;
            const fragment = documentRef.createDocumentFragment();
            let cursor = 0;
            tokens.forEach(token => {
                if (token.start > cursor) fragment.appendChild(documentRef.createTextNode(textNode.nodeValue.slice(cursor, token.start)));
                const span = documentRef.createElement('span');
                span.className = 'reader-word-token';
                span.dataset.readerWord = token.text;
                span.dataset.readerWordNormalized = token.normalized;
                span.textContent = token.text;
                fragment.appendChild(span);
                cursor = token.end;
                wrapped += 1;
            });
            if (cursor < textNode.nodeValue.length) fragment.appendChild(documentRef.createTextNode(textNode.nodeValue.slice(cursor)));
            textNode.parentNode.replaceChild(fragment, textNode);
        });
        return wrapped;
    }

    function elementForNode(node) {
        if (!node) return null;
        return node.nodeType === 1 ? node : node.parentElement || null;
    }

    function selectionInside(rootElement, selection) {
        if (!rootElement || !selection || selection.isCollapsed) return false;
        const anchor = elementForNode(selection.anchorNode);
        const focus = elementForNode(selection.focusNode);
        return Boolean(anchor && focus && rootElement.contains(anchor) && rootElement.contains(focus));
    }

    function paragraphTextForNode(node, fallback = '') {
        return elementForNode(node)?.closest?.('p')?.textContent?.trim() || fallback;
    }

    function logicalUnitKey(format, unit) {
        return `${String(format || '')}:${Number(unit) || 0}`;
    }

    function logicalPoint(format, unit, offset) {
        return { format: String(format || ''), unit: Number(unit) || 0, offset: Math.max(0, Number(offset) || 0) };
    }

    function compareLogicalPoints(left, right) {
        const unitDelta = (Number(left?.unit) || 0) - (Number(right?.unit) || 0);
        if (unitDelta) return unitDelta < 0 ? -1 : 1;
        const offsetDelta = (Number(left?.offset) || 0) - (Number(right?.offset) || 0);
        return offsetDelta === 0 ? 0 : offsetDelta < 0 ? -1 : 1;
    }

    function normalizeLogicalRange(anchorWord, extentWord) {
        if (!anchorWord || !extentWord) return null;
        const anchorStart = anchorWord.start;
        const anchorEnd = anchorWord.end;
        const extentStart = extentWord.start;
        const extentEnd = extentWord.end;
        if (!anchorStart || !anchorEnd || !extentStart || !extentEnd) return null;
        const forward = compareLogicalPoints(extentStart, anchorStart) >= 0;
        return {
            start: forward ? { ...anchorStart } : { ...extentStart },
            end: forward ? { ...extentEnd } : { ...anchorEnd },
            direction: forward ? 1 : -1
        };
    }

    function extractLogicalText(range, textByUnit) {
        if (!range?.start || !range?.end || !textByUnit?.get) return '';
        const normalized = compareLogicalPoints(range.start, range.end) <= 0
            ? range
            : { start: range.end, end: range.start };
        const format = normalized.start.format || normalized.end.format || '';
        const parts = [];
        for (let unit = normalized.start.unit; unit <= normalized.end.unit; unit += 1) {
            const text = String(textByUnit.get(logicalUnitKey(format, unit)) ?? textByUnit.get(unit) ?? '');
            const start = unit === normalized.start.unit ? Math.min(text.length, normalized.start.offset) : 0;
            const end = unit === normalized.end.unit ? Math.min(text.length, normalized.end.offset) : text.length;
            if (end > start) parts.push(text.slice(start, end));
        }
        return parts.join('\n\n').trim();
    }

    function domTextPoint(node, offset, rootElement) {
        if (!node) return null;
        if (node.nodeType === 3) return { node, offset: Math.max(0, Math.min(node.nodeValue?.length || 0, Number(offset) || 0)) };
        if (node.nodeType !== 1) return null;
        const children = node.childNodes || [];
        const childIndex = Math.max(0, Math.min(children.length, Number(offset) || 0));
        const candidates = [children[childIndex], children[childIndex - 1], node];
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (candidate.nodeType === 3) return { node: candidate, offset: candidate === children[childIndex - 1] ? candidate.nodeValue.length : 0 };
            const walker = node.ownerDocument?.createTreeWalker?.(candidate, globalThis.NodeFilter?.SHOW_TEXT || 4);
            const textNode = walker?.nextNode?.();
            if (textNode && (!rootElement || rootElement.contains(textNode))) return { node: textNode, offset: 0 };
        }
        return null;
    }

    class TextUnitIndex {
        constructor(rootElement, { documentRef = rootElement?.ownerDocument || globalThis.document, format = '', unit = 0, separatorBetweenNodes = '' } = {}) {
            this.root = rootElement;
            this.document = documentRef;
            this.format = String(format || '');
            this.unit = Number(unit) || 0;
            this.separatorBetweenNodes = String(separatorBetweenNodes || '');
            this.runs = [];
            this.words = [];
            this.nodeRuns = new WeakMap();
            this.text = '';
            this.rebuild();
        }

        rebuild() {
            this.runs = [];
            this.words = [];
            this.nodeRuns = new WeakMap();
            this.text = '';
            if (!this.root?.contains || !this.document?.createTreeWalker) return this;
            const walker = this.document.createTreeWalker(this.root, globalThis.NodeFilter?.SHOW_TEXT || 4);
            let node;
            while ((node = walker.nextNode())) {
                const parent = node.parentElement;
                if (!parent || parent.closest?.('.reader-word-skip, .reader-selection-overlay, script, style, button, input, select, textarea')) continue;
                const value = String(node.nodeValue || '');
                if (!value) continue;
                if (this.runs.length && this.separatorBetweenNodes && !/\s$/.test(this.text) && !/^\s/.test(value)) this.text += this.separatorBetweenNodes;
                const start = this.text.length;
                this.text += value;
                const run = { node, start, end: this.text.length };
                this.runs.push(run);
                this.nodeRuns.set(node, run);
                tokenizeLogicalWords(value).forEach(token => {
                    const word = {
                        text: token.text,
                        node,
                        localStart: token.start,
                        localEnd: token.end,
                        start: logicalPoint(this.format, this.unit, start + token.start),
                        end: logicalPoint(this.format, this.unit, start + token.end)
                    };
                    word.key = `${logicalUnitKey(this.format, this.unit)}:${word.start.offset}-${word.end.offset}`;
                    this.words.push(word);
                });
            }
            return this;
        }

        containsNode(node) {
            const element = elementForNode(node);
            return Boolean((node?.nodeType === 3 && this.nodeRuns.has(node)) || (element && this.root?.contains?.(element)));
        }

        logicalOffsetForDom(node, offset) {
            const textPoint = domTextPoint(node, offset, this.root);
            const run = textPoint ? this.nodeRuns.get(textPoint.node) : null;
            if (!run) return null;
            return run.start + Math.max(0, Math.min(run.end - run.start, textPoint.offset));
        }

        wordAtOffset(offset) {
            if (!this.words.length) return null;
            const value = Math.max(0, Number(offset) || 0);
            let low = 0;
            let high = this.words.length - 1;
            while (low <= high) {
                const middle = Math.floor((low + high) / 2);
                const word = this.words[middle];
                if (value < word.start.offset) high = middle - 1;
                else if (value > word.end.offset) low = middle + 1;
                else return word;
            }
            const before = this.words[Math.max(0, high)];
            const after = this.words[Math.min(this.words.length - 1, low)];
            return value - before.end.offset <= after.start.offset - value ? before : after;
        }

        rangeForOffsets(startOffset, endOffset) {
            if (!this.document?.createRange || !this.runs.length) return null;
            const start = this.domPointForOffset(startOffset, 1);
            const end = this.domPointForOffset(endOffset, -1);
            if (!start || !end) return null;
            try {
                const range = this.document.createRange();
                range.setStart(start.node, start.offset);
                range.setEnd(end.node, end.offset);
                return range.collapsed ? null : range;
            } catch (_) { return null; }
        }

        domPointForOffset(offset, bias = 1) {
            if (!this.runs.length) return null;
            const value = Math.max(0, Math.min(this.text.length, Number(offset) || 0));
            let candidate = bias < 0 ? this.runs[0] : this.runs[this.runs.length - 1];
            for (const run of this.runs) {
                if (value >= run.start && value <= run.end) { candidate = run; break; }
                if (value < run.start) { candidate = bias < 0 ? this.runs[Math.max(0, this.runs.indexOf(run) - 1)] : run; break; }
            }
            return { node: candidate.node, offset: Math.max(0, Math.min(candidate.end - candidate.start, value - candidate.start)) };
        }

        rangeForWord(word) {
            if (!word || word.start?.unit !== this.unit) return null;
            return this.rangeForOffsets(word.start.offset, word.end.offset);
        }

        rectsForWord(word) {
            const range = this.rangeForWord(word);
            return range ? [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0) : [];
        }

        wordAtClientPoint(x, y, { maximumDistance = 48 } = {}) {
            const caret = this.document?.caretPositionFromPoint?.(x, y);
            const legacyRange = !caret ? this.document?.caretRangeFromPoint?.(x, y) : null;
            const node = caret?.offsetNode || legacyRange?.startContainer;
            const offset = caret?.offset ?? legacyRange?.startOffset;
            if (node && this.containsNode(node)) {
                const logicalOffset = this.logicalOffsetForDom(node, offset);
                const word = logicalOffset === null ? null : this.wordAtOffset(logicalOffset);
                if (word) {
                    const rects = this.rectsForWord(word);
                    if (rects.some(rect => x >= rect.left - 12 && x <= rect.right + 12 && y >= rect.top - 12 && y <= rect.bottom + 12)) return word;
                }
            }
            let nearest = null;
            let nearestDistance = Number.POSITIVE_INFINITY;
            for (const word of this.words) {
                for (const rect of this.rectsForWord(word)) {
                    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
                    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
                    const distance = Math.hypot(dx, dy);
                    if (distance < nearestDistance) { nearest = word; nearestDistance = distance; }
                    if (distance === 0) return word;
                }
            }
            return nearestDistance <= maximumDistance ? nearest : null;
        }

        visibleWords(viewportRect, padding = 2) {
            if (!viewportRect) return [...this.words];
            return this.words.filter(word => this.rectsForWord(word).some(rect => (
                rect.right >= viewportRect.left - padding && rect.left <= viewportRect.right + padding
                && rect.bottom >= viewportRect.top - padding && rect.top <= viewportRect.bottom + padding
            )));
        }

        rangesForLogicalRange(range) {
            if (!range?.start || !range?.end || this.unit < range.start.unit || this.unit > range.end.unit) return [];
            const start = this.unit === range.start.unit ? range.start.offset : 0;
            const end = this.unit === range.end.unit ? range.end.offset : this.text.length;
            const domRange = this.rangeForOffsets(start, end);
            return domRange ? [domRange] : [];
        }
    }

    class SelectionPainter {
        constructor({ documentRef = globalThis.document, highlightName = 'reader-cross-page-selection', forceOverlay = false } = {}) {
            this.document = documentRef;
            this.highlightName = highlightName;
            this.forceOverlay = Boolean(forceOverlay);
            this.overlay = null;
        }

        clear() {
            const cssHighlights = this.document?.defaultView?.CSS?.highlights;
            try { cssHighlights?.delete?.(this.highlightName); } catch (_) { /* unsupported implementation */ }
            if (this.overlay) this.overlay.replaceChildren();
        }

        paint(ranges, viewportElement) {
            this.clear();
            const validRanges = (ranges || []).filter(Boolean);
            if (!validRanges.length) return;
            const view = this.document?.defaultView;
            if (!this.forceOverlay && view?.CSS?.highlights && typeof view.Highlight === 'function') {
                try {
                    view.CSS.highlights.set(this.highlightName, new view.Highlight(...validRanges));
                    return;
                } catch (_) { /* fall through to rectangle overlay */ }
            }
            if (!this.document?.body || !viewportElement?.getBoundingClientRect) return;
            if (!this.overlay) {
                this.overlay = this.document.createElement('div');
                this.overlay.className = 'reader-selection-overlay reader-word-skip';
                this.overlay.setAttribute('aria-hidden', 'true');
                this.document.body.appendChild(this.overlay);
            }
            const viewport = viewportElement.getBoundingClientRect();
            validRanges.forEach(range => [...range.getClientRects()].forEach(rect => {
                const left = Math.max(viewport.left, rect.left);
                const top = Math.max(viewport.top, rect.top);
                const right = Math.min(viewport.right, rect.right);
                const bottom = Math.min(viewport.bottom, rect.bottom);
                if (right <= left || bottom <= top) return;
                const mark = this.document.createElement('span');
                mark.style.left = `${left}px`;
                mark.style.top = `${top}px`;
                mark.style.width = `${right - left}px`;
                mark.style.height = `${bottom - top}px`;
                this.overlay.appendChild(mark);
            }));
        }
    }

    class SelectionDwellGate {
        constructor({ delayMs = 1000, reentryDistance = 56, setTimer = setTimeout, clearTimer = clearTimeout, onCommit = () => {} } = {}) {
            this.delayMs = Math.max(1, Number(delayMs) || 1000);
            this.reentryDistance = Math.max(0, Number(reentryDistance) || 0);
            this.setTimer = setTimer;
            this.clearTimer = clearTimer;
            this.onCommit = onCommit;
            this.timer = null;
            this.key = '';
            this.payload = null;
            this.reentryOrigin = null;
        }

        arm(key, payload) {
            const nextKey = String(key || '');
            if (!nextKey) { this.cancel(); return false; }
            if (this.timer && this.key === nextKey) return false;
            this.cancel();
            this.key = nextKey;
            this.payload = payload;
            // Android WebView's native timer functions reject an arbitrary
            // receiver ("TypeError: Illegal invocation"). Because the timer
            // is stored on this gate, calling `this.setTimer(...)` would use
            // the gate itself as the receiver and silently break the dwell
            // transition after the pointer-move handler aborts. Always invoke
            // host timers with the global object while still supporting fake
            // timers injected by tests.
            this.timer = Reflect.apply(this.setTimer, globalThis, [() => {
                const committed = this.payload;
                this.timer = null;
                this.key = '';
                this.payload = null;
                this.onCommit(committed);
            }, this.delayMs]);
            return true;
        }

        cancel() {
            if (this.timer) Reflect.apply(this.clearTimer, globalThis, [this.timer]);
            this.timer = null;
            this.key = '';
            this.payload = null;
        }

        markTurned(x, y) {
            this.cancel();
            this.reentryOrigin = { x: Number(x) || 0, y: Number(y) || 0 };
        }

        canReenter(x, y, inTerminalWord = false) {
            if (!this.reentryOrigin) return true;
            if (inTerminalWord) return false;
            const distance = Math.hypot((Number(x) || 0) - this.reentryOrigin.x, (Number(y) || 0) - this.reentryOrigin.y);
            if (distance < this.reentryDistance) return false;
            this.reentryOrigin = null;
            return true;
        }

        dispose() {
            this.cancel();
            this.reentryOrigin = null;
        }
    }

    return {
        WORD_PATTERN,
        LOGICAL_WORD_PATTERN,
        RANGE_ACTION_IDS,
        tokenizeWords,
        tokenizeLogicalWords,
        normalizeWord,
        isSingleWord,
        actionIdsForSelection,
        wrapWordTokens,
        selectionInside,
        paragraphTextForNode,
        elementForNode,
        logicalUnitKey,
        logicalPoint,
        compareLogicalPoints,
        normalizeLogicalRange,
        extractLogicalText,
        TextUnitIndex,
        SelectionPainter,
        SelectionDwellGate
    };
});
