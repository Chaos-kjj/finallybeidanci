# Reconstruction Contract

Status: **FROZEN FOR OWNER REVIEW**

Phase: **Reconstruction Phase 0 — governance only**

Implementation authorization: **NONE**

This document freezes the evidence boundary, recovery obligations, exclusions, and engineering rules for canonical reconstruction. It is a behavior contract, not an instruction to reuse old code.

## Canonical Reconstruction Base

| Field | Frozen value |
| --- | --- |
| Branch | `rescue/current-a31a-2026-08-07` |
| Commit | `eb927192336527d56ce5a018a1d6a41a751b1921` |
| Tree | `cb8e4a9468528847803dd9c89ef4f7bee89cd2ac` |
| Integration branch | `reconstruction/canonical-2026-08-07` |

In this contract, **A** means the current implementation at the frozen canonical base above.

## Branch model

- `main` is the frozen legacy production release. Before final reconstruction acceptance, no development may occur directly on `main`, no recovery pull request may target `main`, and no intermediate reconstruction result may enter `main`.
- `rescue/*` branches are immutable evidence. They may not be developed on or modified, merged as whole snapshots, or used as the source of a rescue snapshot commit cherry-pick.
- `reconstruction/canonical-2026-08-07` is the reconstruction integration branch.
- Every task must follow this flow: `reconstruction/canonical-2026-08-07` → dedicated worktree → dedicated task branch → dedicated pull request → `reconstruction/canonical-2026-08-07`.
- A final pull request into `main` may be created only after R1–R6 are complete, V1 has reached an explicit final-gate conclusion, required baseline and quality gates are complete, reconstruction validation is complete, and the product owner explicitly approves the transition.

## Evidence and integration rules

Rescue branches are immutable evidence. They must never be used as continuing development branches or modified in place.

The following actions are permanently forbidden during reconstruction:

- Developing on a `rescue/*` branch.
- Merging an entire rescue snapshot into reconstruction.
- Cherry-picking manually created Rescue Phase 1B snapshot commits.
- Replacing a current implementation file wholesale with an old version.

Old versions may be used only as:

- Reference implementation.
- Test semantics.
- Behavior evidence.

Recovery means adapting the smallest proven behavior to A's current APIs, safety properties, and data contracts.

## Classification rules

- **PROVEN MUST RECOVER**: behavior is supported by rescue evidence and is mandatory for canonical reconstruction.
- **MUST VALIDATE BEFORE FINAL MERGE**: a real historical compatibility risk exists, but the correct product behavior is not yet proven.
- **NOT PROVEN / DO NOT RECOVER**: evidence is insufficient; no implementation task may be created from the claim.
- **PROVEN OPTIONAL / MIGRATION TOOL**: useful evidence exists, but it cannot block canonical reconstruction.
- **DEFERRED PRODUCT DECISION**: outside reconstruction unless the product owner explicitly opens a dedicated task.

## Proven MUST RECOVER

### R1 — Persistent Text Anchor

Source evidence: `rescue/016f-2026-08-07`

Required user behavior:

- A note persists the exact selected text range.
- After restart, selecting the note locates the original text.
- Anchors recover safely after whitespace changes or text reflow.
- A source fingerprint prevents an anchor from attaching to the wrong book.
- EPUB anchors support ranges that cross chapters.
- PDF anchors support ranges across pages in the original text layer.
- Existing notes without anchors remain compatible.

Required adaptation constraints:

- Do not copy the old `reader-engine`, `main`, or `local-store` implementation wholesale.
- Integrate with A's `TextUnitIndex` and `SelectionPainter`.
- Preserve A's lazy EPUB loading model.
- Integrate PDF resolution through A's `PdfEngine.getTextPage` text layer.
- Use A's SHA-256 book fingerprint as source identity.
- Persist through A's DB6 and `persistBookAnnotations` path.

### R2 — Safe Backup Merge

Source evidence: `rescue/1965-2026-08-07`

Required behavior:

- When a normal data-only backup is merged with an existing book having the same ID, absent or `null` incoming file content must not replace an existing `blob` or `text` with `null`.
- A complete backup that actually carries `fileData` may replace the existing book file.

Properties of A that must remain intact:

- SHA-256 integrity verification.
- Restore preview.
- Pre-restore safety snapshot.
- One atomic transaction.
- Rollback on failure.

The backup implementation from the rescue branch must not be copied wholesale.

### R3 — StarDict Field Compatibility

Source evidence: `rescue/1965-2026-08-07`

The only currently proven field recovery is:

- Text-field semantics proven by `sametypesequence`.
- Separation of definition content from pronunciation content.

The following claims are not proven and must not be added to R3 automatically:

- Complete binary/audio `W`/`P` support.
- Every typed record without `sametypesequence`.
- All malformed-input handling from the rescue implementation.

Properties of A that must remain intact:

- 64-bit offset support.
- Per-entry size limits.
- Decompression limits.
- Import safety guards.

### R4 — Cancellable Dictionary Parsing

Source evidence: `rescue/1965-2026-08-07`

Required behavior:

- IDX parsing is asynchronous.
- Parsing yields to the event loop periodically.
- Parsing reports progress.
- Parsing accepts and observes an `AbortSignal`.
- Cancellation takes effect while the parser is still running, not only after it returns.

Properties of A that must remain intact:

- Records are staged before persistence.
- Persistence uses one atomic transaction.
- The stale-controller guard remains effective.
- File-size and entry-count limits remain enforced.

The rescue import service must not be copied wholesale.

### R5 — Active Study Time Accuracy

Source evidence: `rescue/1965-2026-08-07`

Objective: count only genuine study time.

Required behavior:

- Enforce an idle threshold.
- Gate time while the document is hidden or the app is backgrounded.
- Resume must not create phantom duration.

A's `activeMs` remains the statistical source of truth. Do not reproduce the rescue implementation's `touch()`/resume backfill bug. Custom statistics ranges are outside this task.

### R6 — Arbitrary Native Hardware Key Mapping

Source evidence: `rescue/1965-2026-08-07`

After the user captures an Android key code that is not hard-coded, the system must:

- Save the mapping.
- Pass the mapping to native code.
- Exit capture mode.
- Continue forwarding that key during normal reader mode.
- Rehydrate the native mapping from JavaScript settings after restart.

Properties of A that must remain intact:

- `OnBackInvokedDispatcher` behavior.
- Every currently registered native plugin.
- Repeat-event guards.
- Printable-key policy.

Do not replace `MainActivity` or `KeyEventsPlugin` wholesale.

Final status requires **Bigme physical-device validation**. Until that evidence exists, the item must remain `DEVICE VALIDATION REQUIRED`, never `PASS`.

## Legacy v1 Migration Gap

### V1 — Historical Legacy Migration Validation

Status: **MUST VALIDATE BEFORE FINAL MERGE**

Classification: **not recovery evidence from E**

Historical production writers are proven to have stored:

- `bookKey`
- `fileHash`
- `highlightedOccurrences`

Both A and E currently discard those values in legacy migration.

Known risk:

- `bookKey` and `fileHash` may participate in source identity, duplicate recognition, or other functional behavior.
- `highlightedOccurrences` is a real historical user field and is currently lost irreversibly during migration.

Do not assume that any field should be preserved verbatim forever. Before final reconstruction merge, a dedicated validation task must determine:

1. The real historical product semantics of each field.
2. Whether A has an equivalent current data model.
3. Whether safe conversion is possible.
4. Whether the field is completely obsolete.
5. Whether deletion changes user data or behavior.
6. Whether a migration is required.
7. Whether a one-time compatibility read is sufficient.

Any implementation implied by the result requires its own approved task and regression evidence.

## Explicitly NOT RECOVER

Source examined: `rescue/d7a4-2026-08-07`

The following rich legacy metadata migration is **NOT PROVEN**:

- `author`
- `format`
- `mime`
- `size`
- `fingerprint`
- `coverDataUrl`
- `lastReadAt`

The historical mac1–mac5 production writer has not been shown to write this rich metadata. A's DB5-to-DB6 migration also does not delete these values when they already exist in a newer database.

Therefore no E metadata recovery task may be created. Validation may reopen only if a real production database or backup proves that these fields existed in the historical writer's output.

## Optional evidence

### O1 — JSON/JSONL to app-ZIP dictionary converter

Source evidence: `rescue/1965-2026-08-07`, `scripts/convert-dictionary.js`

Status: **PROVEN OPTIONAL / MIGRATION TOOL**

This tool cannot block canonical reconstruction. Recovery, design, and validation require a separate future decision and pull request.

## Deferred product decisions

The following items are outside reconstruction and must not be implemented incidentally:

- Foliate EPUB.
- CFI/Foliate locator.
- FSRS shadow.
- `stableShuffle`.
- Custom statistics ranges.
- Local dictionary audio.
- `EInkRenderScheduler`.

Only an explicit product-owner task may reopen one of these decisions.

## Known baseline

The following results are recorded evidence for A; they are not claims that Phase 0 reran validation:

| Check | Recorded result |
| --- | --- |
| Dependency installation | PASS |
| Existing automated tests | 11 passed, 0 failed |
| Web production build | PASS |
| Android assemble | PASS |
| APK freshness/fingerprint | PASS |
| Tracked file integrity after validation | clean |

Known unresolved baseline issues:

- **B1 — Android lint:** `MissingSuperCall`.
- **B2 — Android lint / API 23:** `Map.remove(key, value)` requires API 24 while project `minSdk` is 23.
- **B3 — Dependency security:** npm reports one high-severity vulnerability.
- **B4 — Bundle size:** Vite reports a main bundle larger than 500 kB.

These issues belong in the reconstruction backlog. Phase 0 must not fix them.

## Phase 0 boundary

Phase 0 persists governance only. It does not recover functionality, fix defects, change architecture, install or upgrade dependencies, run synchronization, or produce a build. The only authorized repository paths are:

- `AGENTS.md`
- `docs/reconstruction/**`

The documents must be reviewed by the owner before commit. Phase 0 itself must not commit or push.
