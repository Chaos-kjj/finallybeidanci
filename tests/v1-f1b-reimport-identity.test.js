const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const compatibility = require('../src/core/legacy-v1-compatibility.js');

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const CURRENT_FALLBACK_A = '1234567890abcdef';
const FALLBACK_A = 'fallback-o72n3x-4-99';

function legacyEnvelope({
  fileHash = null,
  bookKey = null,
  identityKind = 'missing',
  identityValue = null,
  identityReason = 'identity-missing',
  identityConflicts = []
} = {}) {
  return {
    version: 1,
    fileHash,
    bookKey,
    identityKind,
    identityValue,
    identityReason,
    conflicts: {
      identities: identityConflicts,
      highlightedOccurrences: []
    }
  };
}

function functionSource(source, declaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const open = source.indexOf('{', start + declaration.length);
  assert.notEqual(open, -1, `missing body for ${declaration}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated body for ${declaration}`);
}

test('V1-F1B exports the bounded re-import compatibility API', () => {
  assert.equal(typeof compatibility.createLegacyFallbackFileHash, 'function');
  assert.equal(typeof compatibility.resolveLegacyReimportIdentity, 'function');
  assert.equal(typeof compatibility.hydrateLegacyReimportBook, 'function');
});

test('historical fallback comparator reproduces sampled FNV, size and lastModified exactly', () => {
  const small = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(
    compatibility.createLegacyFallbackFileHash(small, { size: 4, lastModified: 99 }),
    FALLBACK_A
  );
  assert.equal(
    compatibility.createLegacyFallbackFileHash(small, { size: 0, lastModified: 0 }),
    'fallback-o72n3x-4-0',
    'historical truthy fallbacks for size and lastModified must remain exact'
  );

  const sampled = Uint8Array.from({ length: 131073 }, (_, index) => index % 251);
  assert.equal(
    compatibility.createLegacyFallbackFileHash(sampled, { size: sampled.length, lastModified: 1700000000123 }),
    'fallback-pr1rog-131073-1700000000123',
    'the historical comparator samples every second byte for this fixture'
  );
  assert.notEqual(
    compatibility.createLegacyFallbackFileHash(small, { size: 4, lastModified: 100 }),
    FALLBACK_A
  );
  assert.notEqual(
    compatibility.createLegacyFallbackFileHash(Uint8Array.from([1, 2, 3, 5]), { size: 4, lastModified: 99 }),
    FALLBACK_A,
    'different source bytes must not match when file metadata is unchanged'
  );
});

test('current, trusted legacy SHA, fallback and stored-content evidence resolve one historical ID', () => {
  const current = { id: 'current-id', fingerprint: SHA_A };
  const currentMatch = compatibility.resolveLegacyReimportIdentity(
    [{ book: current }],
    { fingerprint: SHA_A, fallbackFileHash: FALLBACK_A }
  );
  assert.equal(currentMatch.book.id, 'current-id');
  assert.deepEqual(currentMatch.matchedBy, ['current-fingerprint']);

  const trusted = {
    id: 'trusted-id',
    legacyV1: legacyEnvelope({
      fileHash: SHA_A.toUpperCase(),
      bookKey: `hash:${SHA_A}`,
      identityKind: 'trusted-sha',
      identityValue: SHA_A,
      identityReason: 'sha-file-hash-and-book-key-match'
    })
  };
  const trustedMatch = compatibility.resolveLegacyReimportIdentity(
    [{ book: trusted }],
    { fingerprint: SHA_A, fallbackFileHash: FALLBACK_A }
  );
  assert.equal(trustedMatch.book.id, 'trusted-id');
  assert.deepEqual(trustedMatch.matchedBy, ['trusted-legacy-sha']);

  const fallback = {
    id: 'fallback-id',
    legacyV1: legacyEnvelope({
      fileHash: FALLBACK_A,
      bookKey: `hash:${FALLBACK_A}`,
      identityKind: 'legacy-fallback',
      identityValue: FALLBACK_A,
      identityReason: 'fallback-file-hash-and-book-key-match'
    })
  };
  const fallbackMatch = compatibility.resolveLegacyReimportIdentity(
    [{ book: fallback }],
    { fingerprint: SHA_A, fallbackFileHash: FALLBACK_A }
  );
  assert.equal(fallbackMatch.book.id, 'fallback-id');
  assert.deepEqual(fallbackMatch.matchedBy, ['legacy-fallback']);

  const contentOnly = { id: 'content-id' };
  const contentMatch = compatibility.resolveLegacyReimportIdentity(
    [{ book: contentOnly, contentFingerprint: CURRENT_FALLBACK_A }],
    { fingerprint: CURRENT_FALLBACK_A, fallbackFileHash: FALLBACK_A }
  );
  assert.equal(contentMatch.book.id, 'content-id');
  assert.deepEqual(contentMatch.matchedBy, ['stored-content-fingerprint']);
});

test('multiple evidence paths for one ID deduplicate, but distinct IDs fail closed', () => {
  const same = {
    id: 'same-id',
    fingerprint: SHA_A,
    legacyV1: legacyEnvelope({
      fileHash: SHA_A,
      bookKey: `hash:${SHA_A}`,
      identityKind: 'trusted-sha',
      identityValue: SHA_A,
      identityReason: 'sha-file-hash-and-book-key-match'
    })
  };
  const unique = compatibility.resolveLegacyReimportIdentity(
    [{ book: same, contentFingerprint: SHA_A }],
    { fingerprint: SHA_A, fallbackFileHash: FALLBACK_A }
  );
  assert.equal(unique.book.id, 'same-id');
  assert.deepEqual(unique.matchedBy, ['current-fingerprint', 'trusted-legacy-sha']);

  const fallback = {
    id: 'other-id',
    legacyV1: legacyEnvelope({
      fileHash: FALLBACK_A,
      bookKey: `hash:${FALLBACK_A}`,
      identityKind: 'legacy-fallback',
      identityValue: FALLBACK_A,
      identityReason: 'fallback-file-hash-and-book-key-match'
    })
  };
  assert.throws(
    () => compatibility.resolveLegacyReimportIdentity(
      [{ book: same }, { book: fallback }],
      { fingerprint: SHA_A, fallbackFileHash: FALLBACK_A }
    ),
    error => error?.code === 'LEGACY_REIMPORT_AMBIGUOUS'
      && error.candidateIds.join(',') === 'other-id,same-id'
  );
});

test('matching identity conflicts fail closed while unrelated conflicts do not block a unique match', () => {
  const matchingConflict = {
    id: 'conflict-id',
    fingerprint: SHA_A,
    legacyV1: legacyEnvelope({
      fileHash: SHA_A,
      bookKey: `hash:${SHA_B}`,
      identityKind: 'conflict',
      identityReason: 'legacy-identities-conflict',
      identityConflicts: [
        { source: 'fileHash', value: SHA_A, kind: 'sha', normalizedValue: SHA_A },
        { source: 'bookKey', value: `hash:${SHA_B}`, kind: 'sha', normalizedValue: SHA_B }
      ]
    })
  };
  assert.throws(
    () => compatibility.resolveLegacyReimportIdentity(
      [{ book: matchingConflict }],
      { fingerprint: SHA_A, fallbackFileHash: FALLBACK_A }
    ),
    error => error?.code === 'LEGACY_REIMPORT_CONFLICT'
      && error.candidateIds.join(',') === 'conflict-id'
  );

  const conflictEvidenceOnly = {
    id: 'evidence-conflict-id',
    legacyV1: legacyEnvelope({
      identityKind: 'conflict',
      identityReason: 'current-fingerprint-conflict',
      identityConflicts: [
        { source: 'legacyTrustedSha', value: SHA_A, kind: 'sha', normalizedValue: SHA_A },
        { source: 'currentFingerprint', value: SHA_B, kind: 'sha', normalizedValue: SHA_B }
      ]
    })
  };
  assert.throws(
    () => compatibility.resolveLegacyReimportIdentity(
      [{ book: conflictEvidenceOnly }],
      { fingerprint: SHA_A, fallbackFileHash: FALLBACK_A }
    ),
    error => error?.code === 'LEGACY_REIMPORT_CONFLICT'
  );

  const valid = { id: 'valid-id', fingerprint: SHA_A };
  const unrelatedConflict = {
    id: 'unrelated-id',
    fingerprint: SHA_B,
    legacyV1: legacyEnvelope({
      identityKind: 'conflict',
      identityReason: 'legacy-identities-conflict',
      identityConflicts: [
        { source: 'fileHash', value: SHA_B, kind: 'sha', normalizedValue: SHA_B }
      ]
    })
  };
  assert.equal(
    compatibility.resolveLegacyReimportIdentity(
      [{ book: unrelatedConflict }, { book: valid }],
      { fingerprint: SHA_A, fallbackFileHash: FALLBACK_A }
    ).book.id,
    'valid-id'
  );
});

test('fallback comparison rejects changed metadata and does not hash over declared legacy identity', () => {
  const fallback = {
    id: 'fallback-id',
    legacyV1: legacyEnvelope({
      fileHash: FALLBACK_A,
      bookKey: `hash:${FALLBACK_A}`,
      identityKind: 'legacy-fallback',
      identityValue: FALLBACK_A,
      identityReason: 'fallback-file-hash-and-book-key-match'
    })
  };
  assert.equal(
    compatibility.resolveLegacyReimportIdentity(
      [{ book: fallback, contentFingerprint: SHA_A }],
      { fingerprint: SHA_A, fallbackFileHash: 'fallback-o72n3x-4-100' }
    ),
    null,
    'stored content must not override a declared nonmatching historical fallback identity'
  );
});

test('hydration reuses the historical ID and preserves all compatibility/user data', () => {
  const progress = { version: 2, percent: 71, location: { format: 'epub', href: 'chapter.xhtml' } };
  const notes = [{ id: 'note-1', content: 'keep note' }];
  const bookmarks = [{ id: 'bookmark-1', href: 'chapter.xhtml' }];
  const highlightedOccurrences = ['0:1', ' malformed ', '0:1'];
  const legacyV1 = legacyEnvelope({
    fileHash: FALLBACK_A,
    bookKey: `hash:${FALLBACK_A}`,
    identityKind: 'legacy-fallback',
    identityValue: FALLBACK_A,
    identityReason: 'fallback-file-hash-and-book-key-match'
  });
  const existing = {
    id: 'historical-id',
    title: 'Historical title',
    author: 'Historical author',
    fileName: 'historical.epub',
    type: 'application/epub+zip',
    text: 'historical cleaned text',
    progress,
    notes,
    bookmarks,
    highlightedOccurrences,
    legacyV1,
    annotations: [{ id: 'embedded-annotation' }],
    readerSettings: { fontSize: 29 },
    createdAt: 10,
    updatedAt: 20,
    lastReadAt: '2026-08-01T00:00:00.000Z'
  };
  const blob = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'application/epub+zip' });
  const hydrated = compatibility.hydrateLegacyReimportBook(existing, {
    fingerprint: SHA_A,
    blob,
    text: 'new decoded text',
    title: 'Imported title',
    author: 'Imported author',
    fileName: 'renamed.epub',
    type: 'epub',
    format: 'EPUB',
    mime: 'application/epub+zip',
    size: 4,
    coverDataUrl: 'data:image/png;base64,new'
  });

  assert.equal(hydrated.id, 'historical-id');
  assert.equal(hydrated.fingerprint, SHA_A);
  assert.equal(hydrated.blob, blob);
  assert.equal(hydrated.type, 'epub');
  assert.equal(hydrated.format, 'EPUB');
  assert.equal(hydrated.mime, 'application/epub+zip');
  assert.equal(hydrated.size, 4);
  assert.equal(hydrated.title, 'Historical title');
  assert.equal(hydrated.author, 'Historical author');
  assert.equal(hydrated.fileName, 'historical.epub');
  assert.equal(hydrated.text, 'historical cleaned text');
  for (const field of ['progress', 'notes', 'bookmarks', 'highlightedOccurrences', 'legacyV1', 'annotations', 'readerSettings', 'createdAt', 'updatedAt', 'lastReadAt']) {
    assert.deepEqual(hydrated[field], existing[field], `hydration must preserve ${field}`);
  }
  assert.deepEqual(existing, {
    id: 'historical-id', title: 'Historical title', author: 'Historical author', fileName: 'historical.epub',
    type: 'application/epub+zip', text: 'historical cleaned text', progress, notes, bookmarks,
    highlightedOccurrences, legacyV1, annotations: [{ id: 'embedded-annotation' }], readerSettings: { fontSize: 29 },
    createdAt: 10, updatedAt: 20, lastReadAt: '2026-08-01T00:00:00.000Z'
  }, 'hydration must not mutate the current DB6 record');
});

test('main import candidate collection is read-only and hydration follows identity validation', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const duplicateSource = functionSource(main, 'async function findDuplicateBook');
  assert(!duplicateSource.includes("store.put('books'"), 'candidate collection must not write while scanning');
  assert(duplicateSource.includes('LegacyV1.resolveLegacyReimportIdentity'));

  const importSource = functionSource(main, 'async function importBook');
  const fallbackIndex = importSource.indexOf('LegacyV1.createLegacyFallbackFileHash');
  const resolutionIndex = importSource.indexOf('await findDuplicateBook');
  const inspectionIndex = importSource.indexOf('await inspectImportedBook');
  const hydrationIndex = importSource.indexOf('LegacyV1.hydrateLegacyReimportBook');
  const writeIndex = importSource.indexOf("await store.put('books'");
  assert(fallbackIndex >= 0 && fallbackIndex < resolutionIndex, 'historical fallback must be calculated before resolution');
  assert(resolutionIndex < inspectionIndex, 'identity resolution must precede source inspection');
  assert(inspectionIndex < hydrationIndex && hydrationIndex < writeIndex, 'validated source hydration must precede the one write');
});
