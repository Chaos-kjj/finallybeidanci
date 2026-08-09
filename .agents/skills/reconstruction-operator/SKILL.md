---
name: reconstruction-operator
description: "Automate the complete safe Git and GitHub lifecycle for reconstruction tasks in Chaos-kjj/finallybeidanci, including V1-F1, V1, R1-R6, B3, B4, recovery, validation, baseline-fix, infrastructure, and reconstruction status tasks. Use whenever the user asks to execute, continue, deliver, merge, or finish a reconstruction task: prepare its branch and workspace, read governance, implement only its scope, validate, commit, push, open and review a PR to reconstruction/canonical-2026-08-07, diagnose CI, merge safely, verify post-merge CI, clean up, and report. Never use reconstruction work to develop on or target main."
---

# Reconstruction Operator

Own the complete safe engineering lifecycle. Do not send the product owner to the GitHub website for an operation that `git`, `gh`, the GitHub REST API, or GitHub Actions can safely complete.

## Fix the repository model

- Operate only on `Chaos-kjj/finallybeidanci` after verifying the remote identity.
- Treat `main` as the frozen legacy production release.
- Treat every `rescue/*` branch as immutable evidence.
- Use `reconstruction/canonical-2026-08-07` as the integration branch.
- Route every task through: latest integration -> dedicated task branch and worktree -> dedicated PR -> integration.
- Require explicit product-owner approval and all final reconstruction gates before any final PR to `main`.
- Obey the repository `AGENTS.md` and the reconstruction contract whenever either is stricter than this workflow.

## Pause only for an escalation

Pause and report one precise reason only when the state matches one of these categories:

- `DURABLE STATE CONFLICT`: `CURRENT_STATE.md` conflicts with live Git/GitHub/CI/ruleset state or frozen governance/evidence. Do not choose one version or continue from stale state.
- `AUTHORIZATION REQUIRED`: OAuth, device authorization, 2FA, SSO, or missing repository authorization cannot be completed without the owner.
- `PRODUCT DECISION REQUIRED`: product behavior or acceptance requires an owner decision not already present in the approved task.
- `DEVICE MANUAL VALIDATION REQUIRED`: a required physical-device experience cannot be automated. Never convert this to PASS without the required evidence.
- `SECURITY BLOCKER`: a secret, credential, security policy, or unsafe disclosure blocks safe continuation.
- `UNSAFE HISTORY STATE`: continuation would require force push, admin bypass, destructive history rewrite, or unsafe recovery-ref mutation.
- `UNRESOLVED MERGE CONFLICT`: a conflict cannot be resolved safely and unambiguously within current scope.
- `SCOPE EXPANSION REQUIRED`: a necessary fix exceeds the task's approved backlog boundary.

Continue automatically through all other routine Git, GitHub, validation, CI, review, update, merge, and cleanup work. Diagnose recoverable failures and fix them only within the approved scope.

## Preserve safety invariants

Never:

- expose a token or secret, or use `gh auth status --show-token`;
- force push, use `--force-with-lease`, rewrite shared history, rebase a shared task branch, or amend unrelated history;
- use `--admin`, bypass rules or checks, add a bypass actor, or merge with pending or failed required checks;
- develop on or push directly to `main`, `reconstruction/canonical-2026-08-07`, or `rescue/*`;
- modify, merge wholesale, garbage-collect, prune, or delete rescue evidence;
- merge a whole rescue snapshot, cherry-pick a manual rescue snapshot commit, or replace a current file wholesale with an old version;
- run `git add .`, `git add -A`, `git add --all`, or stage files outside the current task;
- run `npm audit fix`, add or upgrade a dependency without approval, weaken validation, or disable a regression test;
- perform opportunistic refactoring, architecture redesign, deferred product work, or unrelated cleanup.

## Track the lifecycle

Before changing files, record the task ID, approved scope, source and target branches, expected files, required evidence, and stop conditions in the working plan. Keep the plan current through post-merge verification. Record the task branch, commit SHA, PR number and URL, check results, merge result, integration SHA, and post-merge result for the final report.

## Durable start-of-task protocol

Before every reconstruction task:

1. Complete the non-mutating authentication and repository-identity preflight, then run `git fetch origin` before reading task state.
2. Read these files completely from the latest reconstruction integration base, in this order:
   - `AGENTS.md`
   - `docs/reconstruction/CURRENT_STATE.md`
   - `docs/reconstruction/RECONSTRUCTION_CONTRACT.md`
   - `docs/reconstruction/RECOVERY_BACKLOG.md`
   - `docs/reconstruction/VALIDATION_MATRIX.md`
3. Reconcile `CURRENT_STATE.md` against live Git refs, GitHub pull requests, CI runs and checks, the active ruleset, and the backlog.
4. If `CURRENT_STATE.md` conflicts with any live fact or frozen governance/evidence, output `DURABLE STATE CONFLICT` and stop. Never silently prefer stale `CURRENT_STATE.md`, choose between conflicting versions, or continue from conversation memory.

`CURRENT_STATE.md` is an operational index and navigation layer. It does not replace or override frozen evidence or governance.

## Durable evidence protocol

Use this priority for engineering facts:

1. Live Git, GitHub, CI, and ruleset state.
2. `AGENTS.md`.
3. `docs/reconstruction/RECONSTRUCTION_CONTRACT.md`.
4. `docs/reconstruction/RECOVERY_BACKLOG.md`.
5. `docs/reconstruction/VALIDATION_MATRIX.md`.
6. Committed evidence and reports.
7. `docs/reconstruction/CURRENT_STATE.md` as operational navigation.
8. Conversation memory.

Do not make a critical engineering judgment from conversation memory alone. Require at least one repository, Git, or GitHub source such as source code, a test, a committed governance document, Git history, a pull request, a CI run, a ruleset, or rescue evidence. If no such evidence exists, record `UNKNOWN` instead of completing the claim by inference.

Claims that work is `DONE`, tested, merged, a required check, or a supported feature must be verified against live evidence at the time of use.

## Phase A — Establish base safety

1. Run `gh auth status --hostname github.com`. Never request or print the token.
2. Confirm that the active account can access `Chaos-kjj/finallybeidanci`; inspect the viewer permission without exposing credentials.
3. Confirm that `origin` resolves to the intended repository.
4. Run `git fetch origin`.
5. Verify that `refs/remotes/origin/reconstruction/canonical-2026-08-07` exists.
6. Resolve its current SHA and use it as the task base.
7. If a local integration branch must move, allow only a clean fast-forward. Never rebase, reset, force, or disturb an integration branch checked out in another worktree. Prefer branching directly from the latest remote-tracking ref.

## Phase B — Create the task workspace and branch

1. Confirm that the current worktree contains no unrelated user changes. Preserve any user-owned change; stop if it overlaps or prevents isolation.
2. Derive the branch name from `RECOVERY_BACKLOG.md` or the explicit task name.
3. Check both local and remote refs for the exact proposed name. Never overwrite or silently reuse an existing branch.
4. Use the current Codex-managed detached worktree by creating a new branch from the latest integration ref when appropriate.
5. Otherwise use one dedicated worktree and one dedicated branch for the task.
6. Verify that the task branch is based on the latest integration SHA before implementation.
7. Never implement product changes while checked out on `main`, `rescue/*`, or the integration branch.

Do not run broad `git worktree prune`, `git gc`, or cleanup commands. Leave Codex-managed worktree lifecycle to the Codex app.

## Phase C — Read governance

Before implementation, apply the durable start-of-task protocol and read these files completely from the latest integration base:

1. `AGENTS.md`
2. `docs/reconstruction/CURRENT_STATE.md`
3. `docs/reconstruction/RECONSTRUCTION_CONTRACT.md`
4. `docs/reconstruction/RECOVERY_BACKLOG.md`
5. `docs/reconstruction/VALIDATION_MATRIX.md`

Extract only the current task's scope, dependencies, target modules, required tests, acceptance criteria, risk, rollback, PR boundary, Definition of Done, and device/manual requirements. Do not implement another backlog item incidentally.

## Phase D — Bound the plan

Check and record:

- scope and explicit exclusions;
- regression-first strategy and whether a safe failing case can be demonstrated;
- acceptance criteria and Definition of Done;
- expected files and why each belongs;
- risk, rollback, and data compatibility;
- required local, CI, integration, migration, Android, device, and manual validation.

Stop with `SCOPE EXPANSION REQUIRED` when the necessary work clearly exceeds the approved task. Do not infer permission to broaden it.

## Phase E — Implement minimally

1. Add a regression against the current API first when practical.
2. Demonstrate the missing behavior safely when a failing case can be constructed.
3. Make the smallest behavior-preserving change unless the task explicitly requires a behavior change.
4. Preserve transactions, compatibility, safety bounds, reader behavior, native contracts, and existing tests relevant to the touched surface.
5. Use rescue code only as behavior evidence, test semantics, or a reference implementation.
6. Avoid unrelated refactors, dependency drift, file moves, new framework layers, and adjacent backlog work.

## Phase F — Run local validation

1. Run every `REQUIRED` item for the task in `VALIDATION_MATRIX.md` and every task-specific check in `RECOVERY_BACKLOG.md`.
2. Treat Node tests, the production Web build, and Android lint as the current reconstruction CI baseline.
3. Run additional integration, migration, Android build, device, or manual checks exactly when the task requires them.
4. After any workspace modification, run the repository's canonical `npm run build`; require its tests, offline scan, Web asset rebuild and sync, debug APK assembly, and APK freshness verifier to pass.
5. Follow the canonical worktree and `npm run android:install` rules in `AGENTS.md` if installation or final simulator acceptance is required. Never install a detached-worktree preview as the delivered app.
6. Label required physical-device evidence `DEVICE VALIDATION REQUIRED` until it actually exists.

Do not commit or push a completion claim while a required validation fails. Diagnose the failure, fix it within scope, rerun affected checks, then rerun the complete required gate. Escalate only when the failure meets a pause category.

## Phase G — Commit exactly the task

1. Run `git status` and inspect every changed and untracked path.
2. Run `git diff --check`.
3. Review the complete unstaged diff for scope and secrets.
4. Stage only explicit current-task paths.
5. Review `git diff --cached --check`, `git diff --cached --stat`, and the complete cached diff.
6. Verify that the cached diff contains no unintended file, secret, dependency drift, deferred behavior, generated artifact outside scope, or weakened test.
7. Commit with a message tied to the task ID and bounded objective.

Do not amend or combine unrelated history.

## Phase H — Push safely

1. Reconfirm the current branch is the dedicated task branch.
2. Push only that branch with a normal push such as `git push -u origin HEAD`.
3. Reject any command containing `--force`, `--force-with-lease`, or `-f`.
4. Never push directly to `main`, integration, or a rescue branch.

## Phase I — Create the PR automatically

Create the PR with GitHub CLI and always supply both refs explicitly:

```text
gh pr create --base reconstruction/canonical-2026-08-07 --head <task-branch> ...
```

Include the task ID in the title. Include these sections in the body:

- Scope
- Changes
- Tests
- Known limitations
- Out of scope
- Device validation, when applicable

Record the PR number and URL. Never rely on the repository's default base because it is `main`.

## Phase J — Review the PR

Use `gh pr view` and `gh pr diff` to verify:

- the repository, head, and exact integration base;
- task-only files and changes;
- no unintended file, secret, dependency drift, deferred behavior, or weakened guard;
- correct task title, body, and reviewable evidence;
- merge state, review state, and unresolved discussion state.

Do not merge a nonconforming PR. Correct safe in-scope problems and repeat local validation, commit, push, and review.

## Phase K — Wait for CI and diagnose it

1. Wait with `gh pr checks <PR> --watch` or an equivalent GitHub CLI/API loop.
2. Inspect every required check and distinguish pending, skipped, cancelled, failed, and successful results.
3. On failure, inspect the associated Actions run, job, annotations, and failed logs with `gh run view`, `gh run watch`, or `gh api`.
4. Fix a diagnosed cause automatically only when it is safely inside the current task scope.
5. Rerun local required validation, commit explicit paths, push normally, and wait again.
6. Escalate with `SCOPE EXPANSION REQUIRED` when the fix belongs to another task.

Never ask the owner to open GitHub merely to wait for or inspect CI.

## Phase L — Update a stale branch without rewriting history

If GitHub requires the branch to be up to date:

1. Fetch origin and resolve the latest integration SHA.
2. Use GitHub's update-branch operation or merge the latest integration ref into the task branch without rewriting shared history.
3. Resolve only unambiguous in-scope conflicts. Escalate an unsafe conflict.
4. Rerun all required validation, push normally, and wait for CI again.

Never rebase the shared branch, reset it to integration, or force push it.

## Phase M — Automate rulesets conservatively

Do not send the owner to `Settings -> Rules -> Rulesets`.

1. Query all current repository rulesets with `gh api`, then GET the complete target ruleset.
2. Save the unmodified JSON in a newly created temporary directory outside the repository.
3. Build a minimal patch that preserves every unrelated rule and field.
4. Never delete a required check, lower protection, add a bypass actor, allow force push, or disable the pull-request requirement.
5. Add a required check only when the current task's Definition of Done explicitly requires it and that exact check context has already succeeded in this repository.
6. Derive the context from actual GitHub check data, not a guessed workflow or job label.
7. GET the ruleset again after mutation and compare before/after JSON. Verify that only explicitly authorized fields changed.
8. Stop with `SECURITY BLOCKER` when the patch cannot be proven preservation-safe.

Do not mutate a ruleset when the task does not require it.

## Phase N — Merge automatically and safely

Merge only after independently confirming all of the following:

1. The PR targets `reconstruction/canonical-2026-08-07` from the intended task branch.
2. The diff is exactly within scope.
3. Every required local validation passes.
4. Every required GitHub check passes.
5. The branch is up to date when repository policy requires it.
6. The task's acceptance criteria and Definition of Done are satisfied.
7. No unresolved review, security, conflict, data, or product issue remains.
8. No owner decision or required manual evidence remains outstanding.

Inspect repository merge capabilities. Prefer squash when allowed; otherwise use a repository-allowed non-bypass strategy. Run `gh pr merge` without `--admin`, bypass, auto-merge over failed checks, or branch deletion. Verify the merged state and merge commit through GitHub after the command succeeds.

## Phase O — Verify integration after merge

1. Fetch or query `reconstruction/canonical-2026-08-07` and record its new SHA.
2. Find the integration branch's push-event Actions run for that exact SHA.
3. Wait for the run and all required checks to complete.
4. Require every required check to pass.
5. Treat a missing required run or any integration failure as a blocker. Diagnose it immediately and do not start another task.

Do not equate green PR checks with successful post-merge integration CI.

## Phase P — Clean up only after green integration

After merge succeeds and post-merge integration CI is green:

1. Delete the remote task branch when safe and allowed.
2. Preserve `main`, integration, all rescue branches, and every rescue ref.
3. Leave local Codex-managed worktree cleanup to the Codex app.
4. Never run broad worktree prune, Git garbage collection, or rescue cleanup.

## Phase Q — Keep status documentation truthful

After an implementation task merges and its exact-SHA post-merge integration CI passes, compare `CURRENT_STATE.md` with the verified result. If it is stale, automatically execute a separate docs-only status-sync task, branch, and pull request. Do not mix that update into the implementation pull request unless the original task explicitly authorizes it.

A status sync may update only operational facts such as `DONE`, `IN PROGRESS`, and the single `NEXT` action. It must not rewrite frozen evidence or historical conclusions. If `RECOVERY_BACKLOG.md` is also factually stale, update it only when the status-sync scope is explicitly authorized; otherwise open another bounded documentation task. Never rewrite frozen historical conclusions in `RECONSTRUCTION_CONTRACT.md`.

## Report the terminal state

For an installation or task explicitly requesting the operator report, return only this structure with real values:

```text
# Reconstruction Operator Installation Report

Skill installed:
YES/NO

PR:
number/url

Required checks:
result

Merged:
YES/NO

Integration SHA:
sha or precise blocker

Post-merge CI:
result

Manual actions required from owner:
NONE or one precise non-automatable action
```
