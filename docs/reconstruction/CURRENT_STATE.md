# Reconstruction Current Operational State

This document is the reconstruction operational index. It is not a replacement for the contract, backlog, validation matrix, repository rules, or operator instructions. It summarizes current navigation facts and points to their authoritative sources.

## Authoritative Sources

Read these sources before acting:

1. [`AGENTS.md`](../../AGENTS.md)
2. [`RECONSTRUCTION_CONTRACT.md`](./RECONSTRUCTION_CONTRACT.md)
3. [`RECOVERY_BACKLOG.md`](./RECOVERY_BACKLOG.md)
4. [`VALIDATION_MATRIX.md`](./VALIDATION_MATRIX.md)
5. [`reconstruction-operator/SKILL.md`](../../.agents/skills/reconstruction-operator/SKILL.md)

Engineering facts use this priority:

1. Live Git, GitHub, CI, and ruleset state.
2. `AGENTS.md`.
3. `RECONSTRUCTION_CONTRACT.md`.
4. `RECOVERY_BACKLOG.md`.
5. `VALIDATION_MATRIX.md`.
6. Committed evidence and reports.
7. This operational index.
8. Conversation memory.

If this file conflicts with live state or frozen governance/evidence, report `DURABLE STATE CONFLICT` and stop. Do not silently select one version.

## Repository State

| Field | Current operational record |
| --- | --- |
| Repository | `Chaos-kjj/finallybeidanci` |
| Reconstruction integration branch | `reconstruction/canonical-2026-08-07` |
| Last verified integration SHA | `533119d74d7a48028266100c3e8b06e1f7007fbc` |
| Last verified at | `2026-08-09T12:33:05+08:00` |
| Verification source | Fresh `git fetch origin`, `origin/reconstruction/canonical-2026-08-07`, merged PR and exact-SHA CI inspection |
| `main` | Frozen legacy production release; live ref last verified at `16dab7914bf9cfa600a84bb7baca1d9fe89dbd3d` |
| `rescue/*` | Immutable evidence; live remote rescue refs were present and unchanged at the verification time |

The recorded SHAs are timestamped observations, not permanent expected tips. Always fetch and resolve the live refs. A later integration fast-forward is not by itself a conflict; inspect its PRs and CI to determine whether it contradicts an operational status in this file.

## Current Quality Gates

The live GitHub ruleset `Protect reconstruction integration` (`20549698`) last required these exact check contexts:

- `Node tests`
- `Web production build`
- `Android lint`

GitHub ruleset state is the final authority for required checks. Do not infer required status from this list alone.

For integration SHA `533119d74d7a48028266100c3e8b06e1f7007fbc`, all three checks passed in [Reconstruction CI run 31269103274](https://github.com/Chaos-kjj/finallybeidanci/actions/runs/31269103274).

## Completed Major Work

- Git rescue completed; the preserved `rescue/*` refs remain immutable evidence.
- Canonical base selected: `rescue/current-a31a-2026-08-07` at `eb927192336527d56ce5a018a1d6a41a751b1921`, as frozen by the reconstruction contract.
- Reconstruction governance installed in integration history at `f5d5987`.
- Reconstruction operator installed by [PR #4](https://github.com/Chaos-kjj/finallybeidanci/pull/4).
- I1 Reconstruction CI completed by [PR #1](https://github.com/Chaos-kjj/finallybeidanci/pull/1).
- B1/B2 Android lint baseline completed by [PR #2](https://github.com/Chaos-kjj/finallybeidanci/pull/2).
- V1 Historical Legacy Fields Validation completed; the frozen result is recorded in `RECOVERY_BACKLOG.md`.
- V1-F1 governance sync completed by [PR #5](https://github.com/Chaos-kjj/finallybeidanci/pull/5).
- V1-F1A Legacy Data Preservation + Repair Core completed by [PR #6](https://github.com/Chaos-kjj/finallybeidanci/pull/6); its exact-SHA post-merge integration CI passed.

## Current Active Reconstruction Task

**V1-F1 — Legacy Identity and Occurrence Compatibility: IN PROGRESS**

| Slice | Status | Evidence or boundary |
| --- | --- | --- |
| V1-F1A — Legacy Data Preservation + Repair Core | **DONE** | PR #6 merged; exact-SHA post-merge integration CI passed |
| V1-F1B — Re-import Identity Continuity | **NEXT** | Explicit product-owner selection for this durable handoff |
| V1-F1C — Historical Occurrence Compatibility | **PENDING** | Not completed; not active |
| V1-F1D — Backup Compatibility + Final Integration | **PENDING** | Requires A, B, and C complete |

### V1-F1 Dependency State

- A → B: **HARD DEPENDENCY — SATISFIED**.
- A → C: **HARD DEPENDENCY — SATISFIED**.
- B ↔ C: **NO HARD DEPENDENCY**.
- A + B + C → D: **HARD DEPENDENCY**; only A is currently complete.
- Recommended sequencing selected by the owner: A → B → C → D. The owner explicitly selected B before C.

### V1-F1B Approved Objective

V1-F1B is limited to re-import identity continuity:

- Match the current SHA fingerprint.
- Support trusted legacy SHA compatibility.
- Reproduce the exact historical fallback comparator.
- Collect candidates before writes.
- Fail closed on ambiguity or conflict.
- Reuse the historical book ID for the same source.
- Hydrate source content only after identity validation.
- Do not separate progress, notes, bookmarks, or historical occurrences.

## Immediate Next Action

**IMPLEMENT V1-F1B — Re-import Identity Continuity**

This is the only active next action.

## Upcoming Queue

- V1-F1C remains pending.
- V1-F1D remains pending and blocked until A, B, and C are complete.
- R2 is not active.
- Architecture Audit has not started.

After V1-F1, the remaining proven recovery trajectory is:

1. R2 — Safe Backup Merge.
2. R3 — StarDict Field Compatibility.
3. R4 — Cancellable Dictionary Parsing.
4. R5 — Active Study Time Accuracy.
5. R1 — Persistent Text Anchor.
6. R6 — Arbitrary Native Hardware Key Mapping.

This trajectory does not rewrite the dependency semantics in `RECOVERY_BACKLOG.md`.

## Deferred Product Decisions

These remain outside reconstruction unless the product owner explicitly opens a dedicated task:

- Foliate / CFI route.
- FSRS.
- `stableShuffle`.
- Custom statistics ranges.
- Local dictionary audio.
- `EInkRenderScheduler`.

Do not implement them incidentally.

## Frozen Safety Decisions

- `main` is frozen.
- `rescue/*` is immutable.
- Never merge a whole rescue snapshot.
- Never force push.
- Never use admin bypass.
- Never develop directly on the integration branch.
- Use one task, one worktree, one branch, and one pull request.
- Never run automatic `npm audit fix`.
- Never add or upgrade a dependency without explicit approval.
- Use old code only as reference implementation, test semantics, or behavior evidence.
- Perform architecture refactoring only after proven behavior reconstruction and an explicit architecture task.

## V1 Frozen Findings

- `bookKey`: **CONVERSION REQUIRED**.
- `fileHash`: **LEGACY COMPATIBILITY REQUIRED**.
- `highlightedOccurrences`: **LEGACY COMPATIBILITY REQUIRED**.
- V1 Gate: **PASS — IMPLEMENTATION TASK REQUIRED**.

These are navigation summaries of the frozen findings. Do not reinterpret or expand them here.

## Frozen Reconstruction Trajectory

Unless new repository evidence creates a proven conflict, do not redesign this trajectory.

1. Git and rescue evidence remains preserved.
2. `reconstruction/canonical-2026-08-07` is the only reconstruction integration line.
3. Recover proven product behavior before architecture refactoring.
4. Complete V1-F1 in A → B → C → D order, with B and C having no mutual hard dependency.
5. Complete remaining proven recovery in R2 → R3 → R4 → R5 → R1 → R6 order.
6. Run complete reconstruction validation.
7. Perform Architecture Audit only after behavior recovery.
8. Convert architecture findings into small independent refactor pull requests.
9. Complete Web, Android, device, and data validation.
10. Only then allow a final reconstruction-to-`main` pull request.

A new session may optimize implementation details, but it must not change this trajectory without new repository evidence, an explicit `DURABLE STATE CONFLICT`, owner approval, and a governance pull request.

## New Chat Bootstrap

1. Read this file first.
2. Follow its links to all authoritative governance and evidence documents.
3. Do not rely on old conversation memory.
4. Follow the single Immediate Next Action above.
5. Reconcile every status against live Git/GitHub/CI/ruleset state; conflicts defer to live state plus frozen documents through the `DURABLE STATE CONFLICT` protocol.
