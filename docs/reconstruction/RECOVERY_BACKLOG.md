# Recovery Backlog

Status: **FROZEN FOR OWNER REVIEW**

Base: `reconstruction/canonical-2026-08-07` from commit `eb927192336527d56ce5a018a1d6a41a751b1921`

This backlog describes isolated future work. It does not authorize implementation in Phase 0. Every item requires its own worktree, branch, pull request, regression evidence, and canonical delivery validation.

## Dependency semantics

- **HARD DEPENDENCY**: the prerequisite must be complete before the dependent task can be correctly designed, implemented, or validated.
- **RECOMMENDED SEQUENCING**: the tasks are technically independent; the order is recommended only to reduce file conflicts, repeated edits, or review risk.
- **HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW**: the implementation may have no technical dependency on the gate, but its product-code pull request cannot enter the merge workflow until the gate is complete.
- **HARD GATE FOR FINAL RECONSTRUCTION ACCEPTANCE**: the gated work may proceed independently, but canonical reconstruction cannot receive final acceptance or enter `main` until the gate has an explicit completed result.

## Dependency-driven execution plan

The work is intentionally not ordered by the R-number labels.

| Lane | Classification and sequence | Reason |
| --- | --- | --- |
| Infrastructure gate | I1 before product-code implementation merge workflows | I1 has no recovery hard dependency, but its minimum Node-test and Web-build CI is a hard gate for product-code implementation pull requests. |
| Historical data gate | V1 before R1 is RECOMMENDED SEQUENCING; V1 is a HARD GATE FOR FINAL RECONSTRUCTION ACCEPTANCE | R1 can use A's current fingerprint and annotation model independently. Earlier V1 evidence reduces compatibility rework, while final reconstruction still cannot enter `main` without a V1 conclusion. |
| Data safety and reader | R2 before R1 is RECOMMENDED SEQUENCING | R2 is a small, high-value data-loss fix. Both tasks touch storage, `src/main.js`, and nearby tests, so ordering reduces conflicts; R2 is not a semantic prerequisite for R1. |
| Dictionary | R3 before R4 is RECOMMENDED SEQUENCING | R4 can be designed and validated against A's current StarDict semantics. R3 first merely reduces repeated edits and conflicts in `stardict-provider` and `import-service`. |
| Study timing | R5 independently after I1 | Its primary logic is isolated in study statistics and lifecycle wiring. |
| Android native | I1, then B1/B2, then R6 final validation | B1/B2 must establish a truthful Android lint pass before lint becomes a required CI check and before R6 can complete its required lint evidence. |
| Maintenance | B3 and B4 as isolated tasks after I1 | Dependency/security and bundle-size work can change broad surfaces and must never be folded into a recovery pull request. |
| Optional tooling | O1 only after an explicit decision | O1 is optional/deferred and does not depend on I1 or block canonical reconstruction. |

Parallel work is safe only across separate lanes and separate worktrees. Recommended sequencing is not permission to treat independent tasks as hard dependencies.

## Task inventory

- Before I1 was added, the backlog contained 11 formal task records.
- With I1, the backlog contains 12 formal task records: I1, V1, R1–R6, the combined B1/B2 lint-baseline record, B3, B4, and O1.
- B1 and B2 remain two known finding identifiers represented by one formal **Android lint baseline** task record and one pull-request boundary.
- O1 is a formal optional/deferred task record. It is counted in the 12 records but does not block canonical reconstruction.
- Raw identifiers and formal task-record counts differ: I1, V1, R1–R6, B1, B2, B3, B4, and O1 are 13 identifiers represented by 12 task records because B1/B2 are combined.

## Infrastructure gate

### I1 — Reconstruction CI

**Status:** REQUIRED BEFORE IMPLEMENTATION PRs

**Scope**

- Establish the minimum automated quality gate for pull requests targeting `reconstruction/canonical-2026-08-07`.
- Phase 1 must automatically run the Node automated tests and the production Web build.
- Do not make the currently failing Android lint a required Phase 1 pass condition. Promote Android lint only after B1/B2 are correctly resolved.
- Do not deploy, install an APK, mutate Git history, or change product behavior.

**Source evidence**

- A's recorded baseline shows the Node automated tests and production Web build pass.
- No reconstruction CI workflow currently exists.
- B1/B2 are known Android lint failures, so claiming a required green lint gate before fixing them would be false governance evidence.

**Target files/modules**

- Repository CI workflow configuration selected by the I1 pull request.
- Existing Node-test and production-Web-build command entrypoints, consumed without changing product behavior.
- No `src/**`, Android product code, data schema, deployment, or installation target belongs in I1.

**Tests required**

- Validate that reconstruction pull requests trigger both Phase 1 checks.
- Demonstrate that a Node-test failure fails its CI check.
- Demonstrate that a production Web-build failure fails its CI check.
- Demonstrate that the current canonical baseline truthfully passes both checks.
- Inspect the workflow for skipped failures, `continue-on-error`, swallowed exit codes, deployment, installation, and dangerous Git operations.

**Acceptance criteria**

- Pull requests targeting the reconstruction integration branch automatically run Node tests and a production Web build.
- A failure in either command produces a failed required check.
- The workflow does not use skip rules, `continue-on-error`, ignored exit codes, or equivalent false-green behavior.
- Phase 1 does not require Android lint or Android build while B1/B2 remain unresolved.
- CI changes no product behavior and performs no deployment, APK installation, or dangerous Git operation.

**Dependencies**

- I1 has no recovery hard dependency.
- I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for R1–R6, B1/B2, B3, B4, and any V1 follow-up that modifies product code.
- V1 evidence-only validation may proceed independently; any resulting product-code implementation may not enter its merge workflow before I1.
- O1 remains optional/deferred and does not depend on I1.

**Risk:** HIGH — a missing or false-green gate lets regressions enter the reconstruction integration branch while appearing validated.

**Rollback**

- Revert only the isolated CI workflow pull request.
- A rollback must not alter product code, deployment state, Git history, or existing local validation commands.

**PR boundary:** `infra/reconstruction-ci`; Phase 1 Node tests and production Web build only, with no Android required gate and no product implementation.

**Definition of Done**

1. Pull requests automatically run Node tests.
2. Pull requests automatically run the production Web build.
3. A failure makes the corresponding check fail.
4. The task changes no product behavior.
5. No skip, `continue-on-error`, swallowed failure, or equivalent mechanism manufactures a green result.
6. The current canonical baseline truthfully passes both checks.
7. CI runs no deployment, APK installation, or dangerous Git operation.

## Historical data gate

### V1 — Historical legacy field validation

**Status:** MUST VALIDATE BEFORE FINAL MERGE — NOT STARTED

**Scope**

- Determine the historical semantics and safe disposition of `bookKey`, `fileHash`, and `highlightedOccurrences`.
- Answer all seven questions in the reconstruction contract.
- Validation is the entire PR boundary. Do not add a runtime migration in the validation PR; open a separate approved implementation item if evidence requires one.

**Source evidence**

- Historical production writers that emitted `bookKey`, `fileHash`, and `highlightedOccurrences`.
- A's current `normalizeLegacyBook` path, which does not retain these fields.
- Real production database/backup samples when available; synthetic fixtures must be labeled synthetic.

**Target modules**

- Investigation: `src/storage/local-store.js`, `src/reader/book-library.js`, and current annotation/source-identity paths.
- Regression fixtures and `tests/local-storage-migration.test.js` may be extended to demonstrate proven behavior.
- No runtime target is approved until validation reaches a documented conclusion.

**Tests required**

- Fixture-backed migration tests for each historically written field.
- A before/after record comparison showing whether current models preserve, convert, ignore, or lose the field.
- Duplicate/source-identity tests for `bookKey` and `fileHash` if evidence shows they are functional.
- Annotation behavior tests for `highlightedOccurrences` if evidence shows a current equivalent.

**Acceptance criteria**

- Each field has a documented historical meaning and evidence citation.
- Each field is mapped to one of: safe conversion, one-time compatibility read, proven obsolete, or unresolved.
- Any data-loss decision states its user-visible consequences.
- Any needed implementation is captured as a separate, bounded follow-up; no speculative preservation is merged.

**Dependencies**

- The V1 evidence-validation task has no recovery hard dependency.
- V1 before R1 is RECOMMENDED SEQUENCING because earlier identity/annotation evidence may reduce later compatibility rework; V1 does not block R1 design, implementation, or merge into the reconstruction integration branch.
- Any V1 follow-up that modifies product code has I1 Phase 1 as a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW.
- V1 is a HARD GATE FOR FINAL RECONSTRUCTION ACCEPTANCE and must have an explicit conclusion before reconstruction may enter `main`.

**Risk:** HIGH — an incorrect conclusion can permanently lose historical user data or create false book identity matches.

**Rollback**

- Keep the validation PR non-mutating for production data.
- Revert only its fixtures/documentation if evidence is disproven.
- Any future migration must define its own rollback and retain the original record until conversion succeeds atomically.

**PR boundary:** `validation/v1-legacy-fields`; validation evidence and tests only.

**Definition of Done**

- All seven contract questions are answered for all three fields.
- Data migration validation in the matrix is complete.
- Product-owner review accepts the disposition or explicitly records an unresolved blocker.
- R1 may proceed independently, but final reconstruction acceptance and the final pull request into `main` remain blocked until V1 has an explicit completed conclusion.

## Data safety and reader lane

### R2 — Safe backup merge

**Status:** PROVEN MUST RECOVER — NOT STARTED

**Scope**

- Fix only same-ID book merge semantics.
- Preserve existing `blob` and `text` when a normal data-only backup omits file content or normalizes it to `null`.
- Permit replacement only when a complete backup actually carries `fileData`.
- Preserve all current integrity, preview, safety-snapshot, transaction, and rollback behavior.

**Source evidence:** `rescue/1965-2026-08-07`; use its behavior and tests as evidence, not its complete backup implementation.

**Target modules**

- `src/storage/backup.js` for restore dataset/merge semantics.
- `src/storage/local-store.js` only where atomic application of the merged dataset requires it.
- `src/main.js` restore orchestration only for supplying current books or merge intent.
- `tests/ai-backup.test.js` and/or `tests/diagnosed-regressions.test.js` for current-API regression coverage.

**Tests required**

- Existing same-ID book with non-null `blob` and `text` + normal backup without file data retains both.
- Incoming explicit `null` from a data-only path cannot erase existing content.
- Complete backup with real `fileData` replaces the existing file as intended.
- Integrity verification, preview, complete safety snapshot, one transaction, and rollback tests remain green.
- Failed apply leaves the original book and file content unchanged.

**Acceptance criteria**

- No data-only merge path can downgrade existing book content to `null`.
- Complete restore replacement is still supported and tested.
- Merge is decided before the single atomic write; no post-transaction repair is introduced.
- Backup format and SHA-256 contracts do not change.

**Dependencies**

- I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for R2.
- R2 before R1 is RECOMMENDED SEQUENCING, primarily to reduce overlapping edits and review conflicts in storage, `src/main.js`, and nearby tests; R2 is not a semantic prerequisite for R1.

**Risk:** HIGH — restore code can destroy the only local copy of a book.

**Rollback**

- Revert the isolated R2 pull request.
- Preserve the existing pre-restore safety snapshot contract so user data remains recoverable.
- Do not change backup schema version as part of R2.

**PR boundary:** `recovery/r2-backup-merge`; no backup redesign or unrelated normalization.

**Definition of Done**

- The current API first demonstrates the missing case where constructible.
- Targeted regressions and the complete existing suite pass.
- Required build/manual/data validations in the matrix are recorded.
- Review confirms atomicity, rollback, and integrity were not weakened.

### R1 — Persistent text anchor

**Status:** PROVEN MUST RECOVER — NOT STARTED

**Scope**

- Persist and resolve exact note text ranges across restart, safe whitespace/reflow changes, EPUB chapter boundaries, and PDF text-layer page boundaries.
- Reject anchors from a different source fingerprint.
- Keep notes without anchors readable and usable.
- Adapt to A's current reader/index/persistence paths; do not replace old reader or storage files.

**Source evidence:** `rescue/016f-2026-08-07`, especially its anchor behavior and tests; no wholesale source reuse.

**Target modules**

- `src/reader/reader-selection.js` (`TextUnitIndex`, `SelectionPainter`).
- `src/reader/reader-engine.js` (lazy EPUB and `PdfEngine.getTextPage`).
- `src/reader/book-library.js` (existing SHA-256 source identity contract, only if an adapter is required).
- `src/main.js` (`persistBookAnnotations`, note navigation, and reader index orchestration).
- `src/storage/local-store.js` only for backward-compatible DB6 persistence behavior.
- Reader selection/platform and local-storage tests, plus narrowly scoped fixtures.

**Tests required**

- Exact range round-trip through persistence and simulated restart.
- Resolution after whitespace normalization and layout reflow without selecting adjacent text.
- Fingerprint mismatch fails closed and never attaches to another book.
- EPUB selection/resolution across two lazy-loaded chapters.
- PDF selection/resolution across original text-layer pages using `getTextPage`.
- Existing notes with no anchor still load, display, and follow their current fallback behavior.
- Existing `TextUnitIndex` and `SelectionPainter` regression suite remains green.

**Acceptance criteria**

- Every required R1 behavior is represented by a regression against A's current API.
- Anchor data is backward-compatible and does not require whole-file rescue code.
- Resolution is deterministic, source-bound, and safe under ambiguity.
- Lazy EPUB behavior and PDF text-layer semantics remain intact.
- DB6 and `persistBookAnnotations` remain the persistence path.

**Dependencies**

- I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for R1.
- V1 before R1 is RECOMMENDED SEQUENCING. R1 uses A's current SHA-256 fingerprint, DB6, `persistBookAnnotations`, and anchorless-note compatibility and is not blocked from design, implementation, or merge into the reconstruction integration branch while V1 remains open.
- R2 before R1 is RECOMMENDED SEQUENCING to avoid concurrent edits in storage, `src/main.js`, and nearby tests; R2 is not a semantic prerequisite.
- No dependency on deferred Foliate/CFI work.

**Risk:** HIGH — wrong resolution can silently attach user notes to the wrong text or source.

**Rollback**

- Revert the isolated R1 code while retaining backward-compatible extra anchor fields in stored records.
- Never delete old note fields during rollout or rollback.
- Fallback for anchorless notes must remain available.

**PR boundary:** `recovery/r1-persistent-anchor`; no Foliate, CFI, reader-engine replacement, or architecture refactor.

**Definition of Done**

- R1's own behavior and compatibility criteria are complete independently of V1; any open V1 result continues to gate final reconstruction acceptance rather than R1's integration-branch merge.
- All seven R1 user behaviors pass targeted regression tests.
- Full suite, Web build, Android build, data validation, and manual product checks are recorded.
- Review verifies no old current-module file was copied wholesale and no unrelated reader behavior changed.

## Dictionary lane

### R3 — StarDict field compatibility

**Status:** PROVEN MUST RECOVER — NOT STARTED

**Scope**

- Implement only proven text-field semantics declared by `sametypesequence`.
- Keep definition and pronunciation data separate in the current result contract.
- Do not add complete binary/audio `W`/`P`, all untyped records, or all rescue malformed-input behavior.
- Preserve A's 64-bit offsets, bounds, entry limits, decompression limits, sanitization, and import guards.

**Source evidence:** `rescue/1965-2026-08-07`; proven StarDict fixtures and expected field semantics only.

**Target modules**

- `src/dictionary/stardict-provider.js` for IFO/record interpretation.
- `src/dictionary/dictionary-provider.js` only if the current normalized result shape requires a compatible field.
- `src/dictionary/import-service.js` only if exported staged records must retain the proven fields.
- `tests/reader-dictionary.test.js` and focused StarDict fixtures.

**Tests required**

- Known `sametypesequence` text-field fixtures map to the correct definition fields.
- Pronunciation is not concatenated into the definition.
- Existing 32-bit and 64-bit index offset tests pass.
- Oversized entry, offset-bounds, decompression-limit, sanitization, and import-count guards remain effective.
- Unsupported/unproven field types fail or fall back according to A's existing safe behavior rather than speculative rescue behavior.

**Acceptance criteria**

- Proven text fields are decoded with deterministic, documented semantics.
- Definition and pronunciation remain separately addressable.
- No unproven binary/audio promise appears in code, tests, or UI.
- Safety limits are unchanged or stronger without rejecting valid proven fixtures.

**Dependencies**

- I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for R3.
- R3 before R4 is RECOMMENDED SEQUENCING only, because both touch parser/provider modules and ordering reduces repeated edits and review conflicts.

**Risk:** MEDIUM-HIGH — incorrect field framing can corrupt definitions; broadened parsing can weaken bounds protection.

**Rollback**

- Revert the isolated R3 pull request.
- Do not migrate or destructively rewrite previously imported dictionaries.
- Reimport remains the recovery path if staged entry shape changes are unavoidable and explicitly approved.

**PR boundary:** `recovery/r3-stardict-fields`; proven text semantics only.

**Definition of Done**

- Targeted fixtures prove the exact included and excluded semantics.
- Full suite and required build/manual validation pass.
- Review confirms every A safety guard and 64-bit offset behavior remains covered.

### R4 — Cancellable dictionary parsing

**Status:** PROVEN MUST RECOVER — NOT STARTED

**Scope**

- Make IDX parsing asynchronous, periodically yield, report progress, and observe `AbortSignal` during parsing.
- Ensure cancel works before parsing finishes.
- Keep staged records, one atomic persistence transaction, stale-controller guard, and size/count limits.
- Do not copy the rescue import service wholesale.

**Source evidence:** `rescue/1965-2026-08-07`; cancellation timing and parser progress behavior.

**Target modules**

- `src/dictionary/stardict-provider.js` for the asynchronous IDX parser/open contract.
- `src/dictionary/import-service.js` for signal and progress propagation while retaining staging/transaction behavior.
- `src/main.js` only for the existing controller/UI progress boundary and stale-controller guard.
- `tests/reader-dictionary.test.js` and dedicated cancellation/progress fixtures.

**Tests required**

- A large deterministic IDX fixture starts parsing, yields, then is cancelled before completion with `AbortError`.
- Progress is monotonic and observable during parsing, not only after provider open completes.
- Cancellation leaves no dictionary, entry, or source-file records behind.
- A completed import commits all staged records in one transaction.
- A stale controller cannot overwrite the status/result of a newer import.
- File size, entry count, offset, entry-size, and decompression limits remain green.

**Acceptance criteria**

- Event-loop yield and cancellation occur inside the parser loop at bounded intervals.
- No partial persistence is possible.
- Existing UI cancellation becomes effective while the parser is active.
- R3 field semantics remain unchanged.

**Dependencies**

- I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for R4.
- R3 before R4 is RECOMMENDED SEQUENCING. R4 can be designed and validated independently against A's current StarDict semantics; doing R3 first only reduces repeated changes and conflicts in the same dictionary modules.

**Risk:** HIGH — asynchronous conversion can introduce partial writes, stale UI updates, or performance regressions.

**Rollback**

- Revert the isolated R4 pull request; stored dictionary schema must remain compatible.
- Atomic transaction tests must prove that cancelled runs require no cleanup migration.

**PR boundary:** `recovery/r4-dictionary-cancel`; parser scheduling/cancellation only.

**Definition of Done**

- A regression proves cancellation before parser completion.
- Progress/yield, stale-controller, atomicity, and limit tests pass.
- Full suite and required builds/manual cancellation check are recorded.

## Independent study timing lane

### R5 — Active study time accuracy

**Status:** PROVEN MUST RECOVER — NOT STARTED

**Scope**

- Count only active learning time using `activeMs`.
- Add an idle threshold, hidden/background gating, and resume reset that cannot backfill hidden time.
- Do not add custom statistics ranges or reproduce the rescue `touch()`/resume defect.

**Source evidence:** `rescue/1965-2026-08-07`; only proven active-time lifecycle behavior.

**Target modules**

- `src/core/study-stats.js` for duration accounting invariants.
- `src/main.js` for interaction, timer, visibility, background, and resume boundaries.
- `tests/vocab-learning.test.js` and/or a focused study-timer regression test with a fake clock/document lifecycle.

**Tests required**

- Active foreground interactions accumulate the expected `activeMs`.
- Time after the idle threshold is excluded.
- Hidden/background intervals are excluded.
- Resume resets the clock and cannot create phantom duration.
- Page changes and `pagehide` flush only eligible time once.
- Existing minute/section normalization and historical totals remain compatible.

**Acceptance criteria**

- `activeMs` remains the source of truth; displayed minutes derive from it.
- No hidden, idle, or resume-backfilled interval is counted.
- Reader/vocabulary section attribution remains correct.
- No custom range or scheduling feature is introduced.

**Dependencies:** I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for R5; R5 has no recovery hard dependency and otherwise executes independently in its own worktree.

**Risk:** MEDIUM — lifecycle races can double count or silently undercount time.

**Rollback**

- Revert the isolated R5 pull request without rewriting historical totals.
- Never subtract or retroactively recompute imported historical user statistics.

**PR boundary:** `recovery/r5-active-time`; timing accuracy only.

**Definition of Done**

- Fake-clock regressions cover active, idle, hidden, background, and resume transitions.
- Full suite and required build/manual checks pass.
- Review confirms no custom statistics range work entered the PR.

## Android native lane

### B1/B2 — Restore a clean Android lint baseline

**Status:** KNOWN BASELINE ISSUE — NOT STARTED

**Scope**

- Fix only the known `MissingSuperCall` finding and API-23 incompatibility caused by `Map.remove(key, value)` requiring API 24.
- Preserve `minSdk=23`.
- After both findings are correctly fixed, promote Android lint into reconstruction CI as a required check.
- Before both findings are fixed, do not manufacture a PASS with a lint baseline, suppression, ignored error, `continue-on-error`, or reduced severity.
- Do not mix key-mapping behavior or other native refactors into this PR.

**Source evidence:** Recorded baseline findings B1 and B2 on A.

**Target modules:** `android/app/src/main/java/com/kangkang/beidanci/MainActivity.java` for B1, `android/app/src/main/java/com/kangkang/beidanci/NativeAiPlugin.java` for B2, focused Android tests, and the I1 CI workflow only for the required Android-lint gate promotion after both fixes pass.

**Tests required**

- Android lint passes with both findings absent.
- Android compile and unit validation pass at `minSdk=23` compatibility.
- Existing native plugin registration and back handling tests remain green.
- Reconstruction CI runs Android lint as a required check after the fixes, and a lint failure makes the check fail.

**Acceptance criteria**

- No lint baseline or suppression is used to conceal either existing finding.
- `minSdk` is not raised.
- Only B1/B2 are changed.
- Android lint becomes a truthful required reconstruction CI check only after both baseline errors are resolved.

**Dependencies:** I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for B1/B2. B1/B2 are a HARD DEPENDENCY for R6 final lint validation, but have no recovery implementation dependency.

**Risk:** MEDIUM — incorrect lifecycle or compatibility fixes can alter native behavior.

**Rollback:** Revert `fix/android-lint-baseline`, including its Android-lint CI gate promotion if the underlying fixes are reverted; no data or schema migration is permitted, and no false-green lint configuration may remain.

**PR boundary:** `fix/android-lint-baseline`; B1 and B2 plus the post-fix required-lint CI promotion form the single Android lint-baseline objective.

**Definition of Done**

- `MissingSuperCall` is correctly resolved without hiding the finding.
- The `minSdk=23` API compatibility failure is correctly resolved without raising `minSdk` or lowering severity.
- Android lint no longer fails on either existing error.
- Android lint is then added to reconstruction CI as a required check.
- No lint baseline, suppression, ignored error, `continue-on-error`, or reduced severity manufactures a green result.
- Compile, unit checks, full suite, and canonical build are green.
- Review confirms API 23 compatibility and no behavior expansion.

### R6 — Arbitrary native hardware key mapping

**Status:** PROVEN MUST RECOVER — NOT STARTED; DEVICE VALIDATION REQUIRED

**Scope**

- Persist a captured non-hard-coded key code, synchronize it to native, exit capture, forward it in normal reader mode, and rehydrate native state after restart.
- Preserve `OnBackInvokedDispatcher`, all current plugin registrations, repeat guards, and printable-key policy.
- Do not replace `MainActivity` or `KeyEventsPlugin` wholesale.

**Source evidence:** `rescue/1965-2026-08-07`; capture-to-native-to-restart behavior only.

**Target modules**

- `src/eink/hardware-key-service.js` for JS mapping/capture bridge behavior.
- `src/main.js` for settings persistence, capture exit, reader-mode synchronization, and boot rehydration.
- `android/app/src/main/java/com/kangkang/beidanci/KeyEventsPlugin.java` for native mapping state/API.
- `android/app/src/main/java/com/kangkang/beidanci/MainActivity.java` for forwarding/consumption policy.
- Reader platform regression tests and focused Android unit/instrumentation coverage.

**Tests required**

- Arbitrary non-printing key code captured in JS is persisted and sent to native.
- Capture mode exits after a successful capture.
- The mapped key is forwarded and consumed during normal reader mode with repeat events guarded.
- Restart/boot settings rehydrate the same native mapping.
- Printable keys remain excluded according to current policy.
- Back dispatcher and every native plugin registration remain intact.
- Android lint, compile, and unit validation pass.
- Bigme physical-device acceptance covers capture, normal-mode forwarding, and restart.

**Acceptance criteria**

- No hard-coded-only native whitelist blocks a saved valid mapping.
- JS and native mapping state converge at boot and after edits.
- Existing back, repeat, printable-key, and plugin contracts remain unchanged.
- Physical Bigme evidence is attached; emulator-only evidence cannot produce PASS.

**Dependencies**

- I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for R6.
- B1/B2 lint baseline is a HARD DEPENDENCY for R6 final validation because R6 requires a truthful Android lint PASS.
- No dependency on `EInkRenderScheduler` or any other deferred E-ink feature.

**Risk:** HIGH — native event consumption can break typing, back navigation, or device controls.

**Rollback**

- Revert the isolated R6 pull request and fall back to A's default hard-coded mapping.
- Stored JS settings must remain readable even if native dynamic forwarding is rolled back.

**PR boundary:** `recovery/r6-native-key-mapping`; arbitrary mapping only.

**Definition of Done**

- Automated JS/native regression and Android validation are green.
- Canonical build succeeds.
- Bigme physical-device evidence passes all capture/forward/restart cases.
- Status is not marked PASS before device evidence exists.

## Isolated maintenance backlog

### B3 — High-severity npm vulnerability

**Status:** KNOWN BASELINE ISSUE — TRIAGE REQUIRED; dependency change NOT AUTHORIZED

**Scope**

- Identify the exact package, dependency path, exploitability in the offline application, and smallest safe remediation.
- Do not run `npm audit fix` and do not change a manifest or lockfile without explicit approval.
- Keep remediation separate from recovery work.

**Source evidence:** A's recorded npm result: one high-severity vulnerability.

**Target modules:** `package.json` and `package-lock.json` only after approval; affected runtime/tests only if the approved upgrade requires adaptation.

**Tests required**

- Reproduce and record the advisory/dependency path.
- Run the complete suite, offline scan, Web production build, and Android APK validation after any approved dependency change.
- Add focused regressions only for behavior changed by the approved remediation.

**Acceptance criteria**

- Triage distinguishes reachable runtime risk from development-only exposure.
- Owner approves the exact dependency change.
- The vulnerability is removed or an explicit risk acceptance is documented without weakening offline/security controls.

**Dependencies:** I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for B3; explicit product-owner/dependency-upgrade approval is a HARD DEPENDENCY for remediation.

**Risk:** HIGH — broad dependency updates can change runtime behavior, bundle output, or lockfile integrity.

**Rollback:** Revert the isolated approved dependency PR and restore the prior lockfile as one unit; never hand-edit a partial lockfile rollback.

**PR boundary:** A dedicated security/dependency branch; never `npm audit fix`, never bundled with R1–R6.

**Definition of Done**

- Advisory triage and approval are documented.
- Approved validation matrix evidence passes.
- No unrelated dependency changed.

### B4 — Vite main bundle larger than 500 kB

**Status:** KNOWN BASELINE ISSUE — NOT STARTED

**Scope**

- Measure the current bundle composition and determine whether the warning causes an actual product problem.
- Any optimization requires a separate approved implementation task.
- Do not redesign modules, change architecture, or mix bundle work into recovery.

**Source evidence:** A's recorded Vite production-build warning.

**Target modules:** Measurement/build output first; implementation targets remain unapproved until the composition report identifies them.

**Tests required**

- Reproducible before/after bundle measurements.
- Complete suite, production Web build, offline scan, Android build, and relevant lazy-load/manual startup checks for any approved change.

**Acceptance criteria**

- Baseline composition and user impact are documented.
- Any change has a specific size target and preserves offline behavior.
- No architecture refactor is smuggled into the optimization.

**Dependencies:** I1 Phase 1 is a HARD GATE FOR PRODUCT-CODE MERGE WORKFLOW for B4; complete measurement and explicit approval of an implementation scope are HARD DEPENDENCIES for remediation.

**Risk:** MEDIUM-HIGH — chunking changes can break offline loading or move failures to runtime.

**Rollback:** Revert the isolated bundle PR; preserve the last known offline-complete asset graph.

**PR boundary:** Dedicated performance task only; never part of a recovery PR.

**Definition of Done**

- Measurement exists and the owner accepts either remediation or an explicit no-change decision.
- If changed, all matrix evidence and offline behavior pass.

## Optional tooling

### O1 — JSON/JSONL to app-ZIP converter

**Status:** PROVEN OPTIONAL / MIGRATION TOOL — DEFERRED

**Scope:** Decide independently whether to recover `scripts/convert-dictionary.js`; it cannot block reconstruction.

**Source evidence:** `rescue/1965-2026-08-07` converter and fixtures.

**Target modules:** A future dedicated script and fixtures only after explicit approval; no app import-service changes by default.

**Tests required:** Deterministic JSON and JSONL conversion, manifest/entry validation, size/error handling, and successful import of generated app-ZIP through A's current importer.

**Acceptance criteria:** Tool output matches A's documented app-ZIP contract without a new runtime dependency or app behavior change.

**Dependencies:** Explicit optional-tool decision; R1–R6 and final reconstruction do not depend on it.

**Risk:** LOW-MEDIUM — malformed conversion can create apparently valid but unusable dictionaries.

**Rollback:** Remove/revert only the optional converter PR; generated user files remain external artifacts.

**PR boundary:** Dedicated optional tooling branch; no recovery code.

**Definition of Done:** Only if activated: converter tests, importer integration test, full suite, and canonical build pass. Otherwise status remains deferred without blocking reconstruction.

## Deliberate non-tasks

- Do not create an E rich-metadata migration task without new production database/backup evidence.
- Do not create tasks for Foliate EPUB, CFI/Foliate locator, FSRS shadow, `stableShuffle`, custom statistics ranges, local dictionary audio, or `EInkRenderScheduler` without explicit product-owner authorization.
- No CI system is claimed to exist. I1 is the formal required but unimplemented infrastructure task; `infra/reconstruction-ci` is reserved for its isolated pull request and must not be bundled with behavior recovery.
