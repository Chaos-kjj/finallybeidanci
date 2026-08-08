(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangLegacyV1 = { ...(root.KangkangLegacyV1 || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SHA256_RE = /^[0-9a-fA-F]{64}$/;
    const SHA_BOOK_KEY_RE = /^hash:([0-9a-fA-F]{64})$/;
    const FALLBACK_RE = /^fallback-.+$/;
    const FALLBACK_BOOK_KEY_RE = /^hash:(fallback-.+)$/;
    const OCCURRENCE_RE = /^\d+:\d+$/;

    function hasOwn(value, key) {
        return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
    }

    function clone(value) {
        if (value === undefined || value === null) return value;
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function identityPart(source, value) {
        if (value === undefined || value === null || value === '') {
            return { source, value: value ?? null, kind: 'missing', normalizedValue: null };
        }
        if (typeof value !== 'string') {
            return { source, value: clone(value), kind: 'invalid', normalizedValue: null };
        }
        if (source === 'fileHash' && SHA256_RE.test(value)) {
            return { source, value, kind: 'sha', normalizedValue: value.toLowerCase() };
        }
        if (source === 'bookKey') {
            const shaMatch = value.match(SHA_BOOK_KEY_RE);
            if (shaMatch) return { source, value, kind: 'sha', normalizedValue: shaMatch[1].toLowerCase() };
            const fallbackMatch = value.match(FALLBACK_BOOK_KEY_RE);
            if (fallbackMatch) return { source, value, kind: 'fallback', normalizedValue: fallbackMatch[1] };
        }
        if (FALLBACK_RE.test(value)) {
            return { source, value, kind: 'fallback', normalizedValue: value };
        }
        return { source, value, kind: 'opaque', normalizedValue: value };
    }

    function conflictEvidence(parts) {
        return parts.map(part => ({
            source: part.source,
            value: clone(part.value),
            kind: part.kind,
            normalizedValue: part.normalizedValue
        }));
    }

    function classifyLegacyIdentity({ fileHash, bookKey } = {}) {
        const filePart = identityPart('fileHash', fileHash);
        const bookPart = identityPart('bookKey', bookKey);
        const recognized = part => part.kind === 'sha' || part.kind === 'fallback';

        if (recognized(filePart) && recognized(bookPart)) {
            if (filePart.kind !== bookPart.kind || filePart.normalizedValue !== bookPart.normalizedValue) {
                return {
                    kind: 'conflict',
                    value: null,
                    fingerprint: null,
                    reason: 'legacy-identities-conflict',
                    conflicts: conflictEvidence([filePart, bookPart])
                };
            }
            if (filePart.kind === 'sha') {
                return {
                    kind: 'trusted-sha',
                    value: filePart.normalizedValue,
                    fingerprint: filePart.normalizedValue,
                    reason: 'sha-file-hash-and-book-key-match',
                    conflicts: []
                };
            }
            return {
                kind: 'legacy-fallback',
                value: filePart.normalizedValue,
                fingerprint: null,
                reason: 'fallback-file-hash-and-book-key-match',
                conflicts: []
            };
        }

        if (filePart.kind === 'sha') {
            return {
                kind: 'trusted-sha',
                value: filePart.normalizedValue,
                fingerprint: filePart.normalizedValue,
                reason: 'sha-file-hash',
                conflicts: []
            };
        }
        if (filePart.kind === 'fallback') {
            return {
                kind: 'legacy-fallback',
                value: filePart.normalizedValue,
                fingerprint: null,
                reason: 'fallback-file-hash',
                conflicts: []
            };
        }
        if (filePart.kind === 'missing' && bookPart.kind === 'sha') {
            return {
                kind: 'trusted-sha',
                value: bookPart.normalizedValue,
                fingerprint: bookPart.normalizedValue,
                reason: 'sha-book-key-only',
                conflicts: []
            };
        }
        if (filePart.kind === 'missing' && bookPart.kind === 'fallback') {
            return {
                kind: 'legacy-fallback',
                value: bookPart.normalizedValue,
                fingerprint: null,
                reason: 'fallback-book-key-only',
                conflicts: []
            };
        }

        const availablePart = filePart.kind !== 'missing' ? filePart : bookPart.kind !== 'missing' ? bookPart : null;
        return {
            kind: availablePart ? 'legacy-opaque' : 'missing',
            value: availablePart ? clone(availablePart.value) : null,
            fingerprint: null,
            reason: availablePart ? 'identity-not-trusted' : 'identity-missing',
            conflicts: []
        };
    }

    function classifyLegacyOccurrences(value) {
        if (value === undefined) return { present: false, raw: [], entries: [] };
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
            throw new TypeError('legacy highlightedOccurrences must satisfy the string[] contract');
        }
        const raw = [...value];
        return {
            present: true,
            raw,
            entries: raw.map((item, index) => ({
                index,
                value: item,
                syntax: OCCURRENCE_RE.test(item) ? 'syntactically-valid' : 'syntactically-invalid'
            }))
        };
    }

    function prepareLegacyV1Book(book = {}) {
        const identity = classifyLegacyIdentity({ fileHash: book.fileHash, bookKey: book.bookKey });
        const occurrences = classifyLegacyOccurrences(hasOwn(book, 'highlightedOccurrences') ? book.highlightedOccurrences : undefined);
        const rawId = hasOwn(book, 'id') ? book.id : null;
        const id = rawId === undefined || rawId === null || String(rawId) === '' ? null : String(rawId);
        return {
            id,
            fingerprint: identity.fingerprint,
            occurrences,
            legacyV1: {
                version: 1,
                bookKey: hasOwn(book, 'bookKey') ? clone(book.bookKey) : null,
                fileHash: hasOwn(book, 'fileHash') ? clone(book.fileHash) : null,
                identityKind: identity.kind,
                identityValue: clone(identity.value),
                identityReason: identity.reason,
                conflicts: {
                    identities: clone(identity.conflicts),
                    highlightedOccurrences: []
                }
            }
        };
    }

    function stableSerialize(value) {
        if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
        if (!value || typeof value !== 'object') return JSON.stringify(value);
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
    }

    function appendUnique(values, item) {
        const signature = stableSerialize(item);
        if (!values.some(value => stableSerialize(value) === signature)) values.push(clone(item));
    }

    function mergeEnvelope(existing, incoming) {
        if (!existing || typeof existing !== 'object' || Number(existing.version) !== 1) return clone(incoming);
        const merged = clone(existing);
        merged.version = 1;
        for (const field of ['bookKey', 'fileHash', 'identityKind', 'identityValue', 'identityReason']) {
            if (!hasOwn(merged, field)) merged[field] = clone(incoming[field]);
        }
        const existingConflicts = merged.conflicts && typeof merged.conflicts === 'object' ? merged.conflicts : {};
        merged.conflicts = {
            ...existingConflicts,
            identities: Array.isArray(existingConflicts.identities) ? clone(existingConflicts.identities) : [],
            highlightedOccurrences: Array.isArray(existingConflicts.highlightedOccurrences) ? clone(existingConflicts.highlightedOccurrences) : []
        };
        for (const conflict of incoming.conflicts.identities || []) appendUnique(merged.conflicts.identities, conflict);
        for (const conflict of incoming.conflicts.highlightedOccurrences || []) appendUnique(merged.conflicts.highlightedOccurrences, conflict);
        for (const field of ['bookKey', 'fileHash']) {
            if (hasOwn(existing, field) && !deepEqual(existing[field], incoming[field])) {
                appendUnique(merged.conflicts.identities, {
                    source: `currentLegacyV1.${field}`,
                    value: clone(existing[field]),
                    kind: 'historical-evidence',
                    normalizedValue: null
                });
                appendUnique(merged.conflicts.identities, {
                    source: field,
                    value: clone(incoming[field]),
                    kind: 'historical-evidence',
                    normalizedValue: null
                });
                merged.identityKind = 'conflict';
                merged.identityValue = null;
                merged.identityReason = 'compatibility-evidence-conflict';
            }
        }
        if (incoming.identityKind === 'conflict' || incoming.conflicts.identities?.length) {
            merged.identityKind = 'conflict';
            merged.identityValue = null;
            merged.identityReason = incoming.identityReason;
        }
        return merged;
    }

    function deepEqual(left, right) {
        return stableSerialize(left) === stableSerialize(right);
    }

    function reconcileLegacyV1Book(currentBook, prepared) {
        if (!currentBook || typeof currentBook !== 'object') throw new TypeError('current DB6 book is required');
        if (!prepared || typeof prepared !== 'object' || !prepared.legacyV1) throw new TypeError('prepared legacy V1 evidence is required');

        const next = { ...currentBook };
        const envelope = mergeEnvelope(currentBook.legacyV1, prepared.legacyV1);
        let identityConflict = envelope.identityKind === 'conflict';
        let occurrenceConflict = false;

        if (prepared.fingerprint) {
            const currentFingerprintMissing = currentBook.fingerprint === undefined
                || currentBook.fingerprint === null
                || currentBook.fingerprint === '';
            if (currentFingerprintMissing) {
                next.fingerprint = prepared.fingerprint;
            } else {
                const currentNormalized = typeof currentBook.fingerprint === 'string' && SHA256_RE.test(currentBook.fingerprint)
                    ? currentBook.fingerprint.toLowerCase()
                    : null;
                if (currentNormalized !== prepared.fingerprint) {
                    identityConflict = true;
                    envelope.identityKind = 'conflict';
                    envelope.identityValue = null;
                    envelope.identityReason = 'current-fingerprint-conflict';
                    appendUnique(envelope.conflicts.identities, {
                        source: 'legacyTrustedSha',
                        value: prepared.fingerprint,
                        kind: 'sha',
                        normalizedValue: prepared.fingerprint
                    });
                    appendUnique(envelope.conflicts.identities, {
                        source: 'currentFingerprint',
                        value: clone(currentBook.fingerprint),
                        kind: currentNormalized ? 'sha' : 'opaque',
                        normalizedValue: currentNormalized
                    });
                }
            }
        }

        if (prepared.occurrences.present) {
            const currentOccurrencesMissing = !hasOwn(currentBook, 'highlightedOccurrences')
                || currentBook.highlightedOccurrences === undefined
                || currentBook.highlightedOccurrences === null;
            if (currentOccurrencesMissing) {
                next.highlightedOccurrences = clone(prepared.occurrences.raw);
            } else if (!deepEqual(currentBook.highlightedOccurrences, prepared.occurrences.raw)) {
                occurrenceConflict = true;
                appendUnique(envelope.conflicts.highlightedOccurrences, {
                    reason: 'current-occurrences-differ',
                    values: clone(prepared.occurrences.raw)
                });
            }
        }

        next.legacyV1 = envelope;
        return {
            book: next,
            changed: !deepEqual(currentBook, next),
            identityConflict,
            occurrenceConflict,
            hasConflicts: identityConflict || occurrenceConflict
                || envelope.conflicts.identities.length > 0
                || envelope.conflicts.highlightedOccurrences.length > 0
        };
    }

    return {
        SHA256_RE,
        OCCURRENCE_RE,
        classifyLegacyIdentity,
        classifyLegacyOccurrences,
        prepareLegacyV1Book,
        reconcileLegacyV1Book
    };
});
