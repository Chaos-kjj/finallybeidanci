# APK delivery requirement

- After **any** workspace modification, do not report completion until `npm run build` succeeds.
- `npm run build` is the canonical delivery command. It must run all tests, perform the offline scan, rebuild and sync web assets, assemble `android/app/build/outputs/apk/debug/app-debug.apk`, and pass the APK freshness verifier.
- Never treat changes in `src/`, `dist/`, or `android/app/src/main/assets/public/` as delivered until the final APK has been rebuilt and verified.
- Never use `npm run build:web`, `npm run android:sync`, or opening Android Studio as evidence that the APK is current.
- If APK generation or freshness verification cannot run, explicitly state that delivery is incomplete; do not claim the product change is finished.
- The source fingerprint deliberately covers documentation and tests as well as runtime code, so even non-runtime edits require a refreshed APK before handoff.

# Canonical installation requirement

- Only the first path returned by `git worktree list --porcelain` is the canonical APK delivery workspace. APKs built in detached or temporary worktrees are previews and must never be installed as the delivered app.
- After `npm run build`, install/update the emulator only with `npm run android:install`. Never use raw `adb install`, Android Studio's Run action, or the downgrade flag `-d` for delivery.
- `npm run android:install` must reject non-canonical worktrees, verify APK freshness and the bookshelf/settings product contract, install without downgrade permission, then verify the installed version and APK SHA-256.
- Final screenshots and simulator acceptance checks must be taken only after the canonical install command succeeds.
- Every user-visible release must increase Android `versionCode`; older APKs must not be able to overwrite the current release through a normal update.

# Reconstruction governance

## Scope and source of truth

- `docs/reconstruction/RECONSTRUCTION_CONTRACT.md` is the canonical reconstruction contract. `RECOVERY_BACKLOG.md` and `VALIDATION_MATRIX.md` define task boundaries and required evidence.
- Reconstruction restores only behavior proven by the contract. It is not authorization for product expansion, architecture redesign, module splitting, file moves, new framework layers, or opportunistic cleanup.
- Rescue branches are immutable evidence. Never develop on, rewrite, or otherwise modify a `rescue/*` branch.
- Never merge an entire rescue snapshot into reconstruction or cherry-pick a manually created Rescue Phase 1B snapshot commit.
- Old code may be used only as reference implementation, test semantics, or behavior evidence. Never replace a current file wholesale with an old version.

## Branch, worktree, and pull request workflow

- `main` is the frozen legacy production release. Until final reconstruction acceptance, never develop directly on `main`, target a recovery pull request at `main`, or merge intermediate reconstruction work into `main`.
- `rescue/*` branches are immutable evidence. Never develop on or modify them, merge a whole rescue snapshot, or cherry-pick a rescue snapshot commit.
- During reconstruction, `reconstruction/canonical-2026-08-07` is the integration branch.
- Start every independent task from the reconstruction integration branch and use one dedicated worktree, one dedicated branch, and one dedicated pull request.
- A branch and pull request must solve exactly one recovery, validation, baseline-fix, or infrastructure item. Do not bundle adjacent recovery work.
- Recovery pull requests target the reconstruction integration branch until reconstruction is formally closed.
- The required task flow is: `reconstruction/canonical-2026-08-07` → dedicated worktree → dedicated task branch → dedicated pull request → `reconstruction/canonical-2026-08-07`.
- A final pull request into `main` may be created only after R1–R6, the V1 final gate, all required baseline and quality gates, reconstruction validation, and explicit product-owner approval are complete.
- Recommended branch names are:
  - `recovery/r1-persistent-anchor`
  - `recovery/r2-backup-merge`
  - `recovery/r3-stardict-fields`
  - `recovery/r4-dictionary-cancel`
  - `recovery/r5-active-time`
  - `recovery/r6-native-key-mapping`
  - `validation/v1-legacy-fields`
  - `fix/android-lint-baseline`
  - `infra/reconstruction-ci`

## Reconstruction operator

- Use `.agents/skills/reconstruction-operator/SKILL.md` (`reconstruction-operator`) by default for every reconstruction task's complete Git and GitHub lifecycle.
- Automate every safe operation available through `git`, `gh`, the GitHub REST API, or GitHub Actions; pause only for the skill's explicit escalation conditions.

## Change Discipline

- A behavior-preserving recovery must not change unrelated product behavior.
- Do not perform opportunistic refactors or optimize nearby code merely because the task touches it.
- If the required scope expands beyond the approved item, stop and report the new scope before changing it.
- Keep bug fixes separate from architecture refactors, and keep recovery work separate from new product features.
- Do not copy whole files from an old snapshot. Adapt the smallest proven behavior to the current implementation.
- A new dependency or dependency upgrade requires explicit approval before changing dependency manifests or lockfiles.
- Never run `npm audit fix` to modify dependencies automatically.
- Do not run Capacitor sync unless the explicit task or the canonical delivery command requires it.
- Never delete, relax, skip, or disable a regression test merely to make validation pass.

## Testing Discipline

Every recovery must follow this order:

1. Translate the old version's proven behavior into a regression test against the current API.
2. When a failing case can be constructed safely, demonstrate that the current implementation is missing the behavior.
3. Implement the smallest behavior-preserving change.
4. Demonstrate that the new regression test passes.
5. Run the complete existing test suite.

- Web-facing changes require a production Web build.
- Android-native changes require Android lint, compile, and unit validation.
- Device-dependent behavior must be marked `DEVICE VALIDATION REQUIRED`. It cannot be reported as `PASS` without Bigme physical-device evidence.
- I1's minimum reconstruction CI—automated Node tests and a production Web build—is a hard gate before any product-code implementation pull request can enter its merge workflow.
- Android lint becomes a required reconstruction CI check only after B1/B2 are correctly fixed. Before then, never manufacture a green check with a lint baseline, suppression, ignored failure, reduced severity, or `continue-on-error`.
- These task-specific checks supplement, and do not replace, the APK delivery requirements at the top of this file.

## Code Review Rules

Every pull request must be reviewed specifically for:

- Scope beyond the approved recovery item.
- Whole-file copying from an old branch.
- New cross-module dependencies.
- Circular dependencies.
- Duplicate implementations of existing business rules.
- Bypassed database transactions.
- Broken backup compatibility.
- Lost or corrupted legacy data.
- Reduced Android `minSdk` compatibility.
- Broken reader selection behavior.
- Weakened dictionary bounds or safety guards.
- Deleted, relaxed, skipped, or disabled regression tests.
- Changes to deferred product behavior.
- Unapproved new dependencies or dependency upgrades.
- API or schema contract breaks.

## Architecture boundary

- `AGENTS.md` defines work rules, quality gates, and reconstruction scope; it is not an architecture redesign document.
- Without an explicit product-owner architecture task, do not redesign the directory structure, split modules, move files, introduce repository/service/domain layers or architecture frameworks, split or introduce microservices, perform system-wide service decomposition, or incidentally implement a new target architecture during reconstruction.
- This boundary does not prohibit normal maintenance of A's existing services or modules when that maintenance is required by an approved, bounded task.
- Phase 0 defines no future target architecture.
- A real architecture audit may begin only after the approved behavior reconstruction is complete and only under an explicit task.
