# Validation Matrix

Status: **FROZEN FOR OWNER REVIEW**

This matrix defines evidence required before each future task may merge into `reconstruction/canonical-2026-08-07`. It does not assert that any CI system exists or that any validation has already run.

## Status vocabulary

- **REQUIRED** — evidence must be produced and reviewed for the task.
- **NOT REQUIRED** — the validation category does not apply to the bounded task.
- **DEFERRED** — the validation decision or execution waits for the explicit trigger described in the backlog; it is not a pass.

## Matrix

| Task | Unit test | Integration test | Web build | Android lint | Android build | Device validation | Data migration validation | Manual product validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I1 — Reconstruction CI | REQUIRED | NOT REQUIRED | REQUIRED | DEFERRED | DEFERRED | NOT REQUIRED | NOT REQUIRED | NOT REQUIRED |
| V1 — Historical legacy fields | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | REQUIRED |
| V1-F1 — Legacy Identity and Occurrence Compatibility | REQUIRED | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | NOT REQUIRED | REQUIRED | REQUIRED |
| R2 — Safe backup merge | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | REQUIRED |
| R1 — Persistent text anchor | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | REQUIRED |
| R3 — StarDict field compatibility | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | NOT REQUIRED | NOT REQUIRED | REQUIRED |
| R4 — Cancellable dictionary parsing | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | NOT REQUIRED | NOT REQUIRED | REQUIRED |
| R5 — Active study time accuracy | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | NOT REQUIRED | NOT REQUIRED | REQUIRED |
| B1/B2 — Android lint baseline | REQUIRED | NOT REQUIRED | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | NOT REQUIRED | NOT REQUIRED |
| R6 — Arbitrary native hardware key mapping | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED |
| B3 — High-severity npm vulnerability | REQUIRED | DEFERRED | REQUIRED | NOT REQUIRED | REQUIRED | NOT REQUIRED | NOT REQUIRED | DEFERRED |
| B4 — Vite main bundle warning | REQUIRED | REQUIRED | REQUIRED | NOT REQUIRED | REQUIRED | NOT REQUIRED | NOT REQUIRED | REQUIRED |
| O1 — JSON/JSONL converter | DEFERRED | DEFERRED | DEFERRED | NOT REQUIRED | DEFERRED | NOT REQUIRED | DEFERRED | DEFERRED |

## Evidence rules

### Unit tests

- **I1:** validate that pull requests run the current Node automated tests and that a failing test produces a failed check.
- **V1-F1:** cover trusted SHA conversion, `bookKey`-only recovery, mismatched-identity fail-closed behavior, fallback matching, occurrence preservation/resolution, additive repair, unchanged current data, backup round-trip, and reopen persistence.
- Every activated recovery starts with a regression against A's current API and finishes with the complete existing test suite.
- A newly added test must not replace, relax, skip, or disable an existing regression.
- B1/B2 and other non-Web tasks still require the full repository suite through the canonical delivery gate.

### Integration tests

- **V1:** migrate historically representative records and compare source identity, annotation data, and current-model output.
- **V1-F1:** exercise fresh migration, already-migrated additive repair, repair idempotency, missing-legacy-DB no-op, re-import identity continuity, and backup/restore as complete compatibility paths.
- **R2:** exercise decode/preview/build-dataset/merge/atomic-apply/rollback as one restore path.
- **R1:** exercise selection, persistence, simulated restart, lazy EPUB resolution, PDF text-page resolution, and repaint/navigation.
- **R3:** import a complete minimal StarDict fixture and verify normalized lookup output.
- **R4:** connect parser progress/cancellation to import staging, transaction, and stale-controller behavior.
- **R5:** drive timer, interaction, page, visibility, background, and resume transitions with a deterministic clock.
- **R6:** drive settings capture, JS-to-native synchronization, reader-mode forwarding, and restart rehydration across the bridge boundary.
- **B3:** remains DEFERRED until advisory triage identifies the affected runtime surface.

### Web and Android builds

- `npm run build` remains the canonical delivery command and includes the complete tests, offline scan, Web asset rebuild/sync, Android APK assembly, and APK freshness verification.
- Product-code tasks continue to require the canonical delivery command, even when the behavior under test lives primarily on one platform.
- V1-F1 does not require Android build as a separate task-specific validation category; the repository's canonical delivery command remains required and still assembles and verifies the debug APK.
- I1 Phase 1 separately verifies that reconstruction pull requests automatically run the production Web build and fail when it fails. Android build is DEFERRED in I1's initial CI scope and must not be presented as an existing required CI gate.
- The Phase 0 governance draft explicitly forbids running a build before owner review; its current documentation-only state is not product delivery evidence.

### Android lint

- Required for Android-native changes and for the B1/B2 lint-baseline task.
- Required for V1-F1 as a current reconstruction CI gate even though V1-F1 has no Android-native implementation scope.
- I1 Phase 1 records Android lint as DEFERRED while B1/B2 remain known baseline failures; it must not pretend lint is green or make the current failure an ignored required check.
- A lint baseline, suppression, ignored error, `continue-on-error`, reduced severity, or a raised `minSdk` is not an acceptable substitute for fixing B1/B2.
- After B1/B2 correctly resolve `MissingSuperCall` and the API-23 compatibility error, Android lint must be promoted into reconstruction CI as a required check whose failure fails the check.
- R6 cannot use the old B1/B2 failures as an accepted baseline; it requires Android lint and Android build PASS plus physical-device evidence.

### Device validation

- Only R6 has a proven physical-device requirement in the current reconstruction contract.
- R6 requires Bigme hardware evidence for arbitrary-key capture, normal reader-mode forwarding, repeat behavior, printable-key policy, back behavior, and restart rehydration.
- Emulator, simulator, source inspection, or unit tests cannot change R6 from `DEVICE VALIDATION REQUIRED` to `PASS`.

### Data migration validation

- **V1:** validate all three historical fields and all seven contract questions using authentic evidence where available.
- **V1-F1:** validate trusted and mismatched identity conversion, exact legacy fallback comparison, raw occurrence retention/resolution state, fresh and repaired migrations, re-import continuity, unchanged native DB6 data, and backup round-trip.
- **R2:** validate data-only merge, complete-file replacement, safety snapshot, and rollback without loss.
- **R1:** validate new anchor persistence together with old anchorless notes and any V1-approved compatibility result.
- No task may erase an original legacy field merely because the current model does not yet understand it.

### Manual product validation

- Manual validation supplements, never replaces, automated regressions.
- R1 must cover actual note navigation in EPUB and PDF samples.
- V1-F1 must cover representative migration, repair, re-import, reopen, occurrence navigation/removal, and normal/complete backup restore behavior without identity or annotation separation.
- R2 must cover preview wording and normal-versus-complete restore choice.
- R3/R4 must cover representative import, lookup, progress, cancellation, and retry flows.
- R5 must cover visible study, idle, background, and resume behavior.
- R6 manual validation is inseparable from the required Bigme device evidence.
- B3 manual scope remains deferred until the affected dependency and reachable product surface are known.

## CI statement

No existing CI workflow is claimed by this matrix. I1 is now a formal required backlog task, not an implemented workflow. Local commands and evidence artifacts remain the source of validation until I1 is approved, implemented, and truthfully passing.
