(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangReaderLocator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const FOLIATE_ENGINE = 'foliate-js';
    const FOLIATE_REVISION = 'df623dbe6610fd98a7c2d5d7a5c23bfcfc7d19f3';

    function finiteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeFraction(value) {
        const number = finiteNumber(value);
        return number === null ? null : Math.min(1, Math.max(0, number));
    }

    function isEpubCfi(value) {
        return /^epubcfi\(/i.test(String(value || '').trim());
    }

    function buildEpubLocator({ cfi, href = '', fraction = null, sectionIndex = null } = {}) {
        const value = String(cfi || '').trim();
        if (!isEpubCfi(value)) return null;
        const locator = {
            engine: FOLIATE_ENGINE,
            revision: FOLIATE_REVISION,
            type: 'epubcfi',
            value,
            href: String(href || ''),
            fraction: normalizeFraction(fraction),
            sectionIndex: finiteNumber(sectionIndex) === null ? null : Math.max(0, Math.floor(Number(sectionIndex)))
        };
        if (locator.fraction === null) delete locator.fraction;
        if (locator.sectionIndex === null) delete locator.sectionIndex;
        if (!locator.href) delete locator.href;
        return locator;
    }

    function normalizeLocator(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const value = String(raw.value || raw.cfi || '').trim();
        if (!isEpubCfi(value)) return null;
        return buildEpubLocator({
            cfi: value,
            href: raw.href,
            fraction: raw.fraction,
            sectionIndex: raw.sectionIndex
        });
    }

    function locatorFromProgress(progress) {
        return normalizeLocator(progress?.locator)
            || normalizeLocator({
                cfi: progress?.cfi,
                href: progress?.href,
                fraction: progress?.fraction,
                sectionIndex: progress?.chapterIndex
            });
    }

    function restoreCandidates(progress = {}) {
        const candidates = [];
        const locator = locatorFromProgress(progress);
        if (locator?.value) candidates.push({ kind: 'cfi', value: locator.value, locator });

        const href = locator?.href || String(progress.href || '').trim();
        const fraction = normalizeFraction(locator?.fraction ?? progress.fraction);
        if (href || fraction !== null) candidates.push({ kind: 'href', href, fraction });

        const chapterIndex = finiteNumber(progress.chapterIndex);
        const pageIndex = finiteNumber(progress.pageIndex);
        if (chapterIndex !== null || pageIndex !== null) {
            candidates.push({
                kind: 'legacy',
                chapterIndex: chapterIndex === null ? 0 : Math.max(0, Math.floor(chapterIndex)),
                pageIndex: pageIndex === null ? 0 : Math.max(0, Math.floor(pageIndex))
            });
        }
        candidates.push({ kind: 'start' });
        return candidates;
    }

    function mergeProgress(previous = {}, next = {}) {
        const merged = { ...(previous || {}), ...(next || {}) };
        if (next.locator === null) delete merged.locator;
        else if (next.locator) merged.locator = normalizeLocator(next.locator) || next.locator;
        return merged;
    }

    return {
        FOLIATE_ENGINE,
        FOLIATE_REVISION,
        isEpubCfi,
        buildEpubLocator,
        normalizeLocator,
        locatorFromProgress,
        restoreCandidates,
        mergeProgress
    };
});
