# Plan

The build order, with each step's status. Tick a step when it lands. Each outward-facing step (create, publish, push, merge, delete) waits for the owner's go-ahead. Decisions and their reasons are in [design.md](design.md).

## Build order

1. **Create the repo**
   - [x] Local folder `~/Hub/Areas/Tooling/github-agents` with `README.md`, `LICENSE` (MIT), `CLAUDE.md` and `docs/`
   - [x] `gh repo create jpyepez/github-agents --public --source . --push`, with description "Reusable GitHub workflows that triage issues and implement ready ones with Claude"
   - [x] Merge settings: squash only, `PR_TITLE` / `PR_BODY`, delete branches
   - [x] repo-scout alias `github-agents`
   - [x] Board 4: Status columns Inbox, HITL, Ready, In progress, Done; built-in workflows on, except Pull request linked to issue, which is off on boards 1, 3 and 4
   - [x] Owner runs `/setup-work`: GitHub tracker, default labels (`ready-for-agent` as `ready`), `docs/agents/`. Issues and [board 4](https://github.com/users/jpyepez/projects/4), triaged by hand; no automation on this repo.
   - [x] Merge PR 1 (agent skills config and board docs), as 821c318
2. **Plumbing test** in `github-agents-sandbox` (private, deleted afterwards). A small reusable "hello" workflow settles every open item in [research.md](research.md#tested-in-step-2). The sandbox needs the secrets `OWNER_PAT` and `CLAUDE_CODE_OAUTH_TOKEN`, and no board.
   - [x] Done 2026-11-03 in PR 2, as 5f19dc2; results in [research.md](research.md#tested-in-step-2)
3. **Engine v1**: triage and implement as `workflow_call`, built to [design.md](design.md) and ported from dev-website-2026 (see [porting notes](design.md#porting-notes)). Tag `v1.0.0` and `v1`.
   - The decisions for this step (jobs, files between jobs, egress, runtime, the caller, testing) are in [design.md](design.md#jobs).
   - **This repo**
     - [x] `ci.yml`, as in [Testing the engine](design.md#testing-the-engine)
   - **Workflows**
     - [x] `.github/workflows/triage.yml`: `on: workflow_call`, input `issue` (triage runs on opening or by hand, so it needs no label), plus `egress-policy` for the audit pass, secrets `OWNER_PAT` and `CLAUDE_CODE_OAUTH_TOKEN` (`required: true`), the [three jobs](design.md#jobs), caps from `agents.yml`, one run per issue as in [Concurrency](design.md#jobs)
     - [x] `.github/workflows/implement.yml`: the same shape, with the claim in `prepare`, `branch_prefix` and `base` from `agents.yml`, and dev-website-2026's hand-off logic (`pr=new`, draft PR, `ready` → `ready-for-human`, HITL) in `apply`. One run per issue, as in [Concurrency](design.md#jobs).
     - [x] Self-checkout at `job.workflow_sha` in every job that runs engine code
     - [x] `templates/callers/triage.yml` and `templates/callers/implement.yml`, byte-identical in every repo
   - **Check step** (`scripts/check.ts`, run first in `prepare`; `doctor` reuses it in step 7)
     - [x] Every row of the design's table: a missing or empty secret, the board, the labels, the ready bar and hand-back list, `docs/git-workflow.md`, a tracker other than GitHub
   - **Settings**
     - [x] `scripts/settings.ts`: read `.github/agents.yml`, apply every default from the design's table, and fail on an unknown key or a bad value. A missing key always means the more cautious setting.
     - [x] `automation: triage` means `apply` never lets an outcome start an implement run, and implement skips at once
   - **Scripts**, generic: the repo from `GITHUB_REPOSITORY`, the project by number, the Status field and columns by name
     - [x] `scripts/tracker.ts`, the tracker seam: every label, comment, body, assignee, PR and board call
     - [x] `scripts/board-status.ts`, ported, on top of `tracker.ts`
     - [x] `scripts/triage-outcome.ts`, ported. It now validates `decision.json`, `comment.md` and `spec.md` before `apply` writes anything, instead of checking a comment the agent posted. The categories and labels come from `agents.yml`.
     - [x] An implement-outcome check: `pr.md` or `handback.md` is present and well formed, the bundle's branch is `branch_prefix` + the issue number, and no commit touches `.github/`. It also enforces the [`Closes` rule](design.md#board): `pr.md` has `Closes #<n>` for its own issue only (`handback.md` none), and no commit message has a closing keyword (`close`, `fix` or `resolve`, any tense) before `#<n>`.
     - [x] Unit tests for each, ported from dev-website-2026's where they exist
   - **Prompts**
     - [x] `prompts/triage.md` and `prompts/implement.md`, ported. The agent reads the issue file, writes its output files and never calls `gh` to write. They link the repo's ready bar and hand-back list, with the design's fallbacks when one is missing.
     - [x] `implement.md` says a closing keyword in a commit message also closes that issue on merge, so other issues are written as "issue N" in commits as well as in `pr.md`
     - [x] Nothing repo-specific left in them (the porting notes' list)
   - **Owner-only comments**
     - [x] `prepare` writes the issue, its body and only the owner's comments to a file, and the agent works from that file
   - **Egress allowlist**
     - [x] harden-runner on the `agent` job, as in [design.md](design.md#egress), with the default allowlist in the engine and additions from `agents.yml`
     - [x] One audit-mode pass in the sandbox, to find the hosts the browser walk needs
     - [x] In that pass, test plain `bunx playwright install chromium` (no `--with-deps`) on `ubuntu-latest`, since the image already ships Chrome and likely its libraries. If it fails, the libraries need sudo, which the `agent` job doesn't have. bullfrog doesn't help with that, since it also needs sudo off to be safe, so it would need a new decision.
     - [x] The sandbox run checks that a host off the list is blocked
   - **Release**
     - [x] The public sandbox run ([Testing the engine](design.md#testing-the-engine)) passes for triage and implement
     - [x] In the sandbox, label two issues `ready` while a third issue's build is running, and add a label that doesn't match. Check that all three build. Then label one issue `ready` a second time, and check that it replaces only that issue's own pending run. It's untested whether a job skipped by its `if` enters a concurrency group, and this settles it.
     - [x] In the sandbox, probe with step 2's hash method whether the agent's shell can reach `ACTIONS_RUNTIME_TOKEN` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`. Issue events run on `main`, so if it can, a hijacked agent could poison caches that CI on `main` restores. If it's reachable, that becomes a decision before the tag.
     - [x] Merge the step 3 PR, after the owner's go-ahead
     - [x] Tag `v1.0.0` and `v1`, after the owner's go-ahead
     - [x] Smoke run, after the owner's go-ahead: point the sandbox's callers at `@v1`, then triage a new issue and build a `ready` one
     - [x] Tear down, after the owner's go-ahead: delete `github-agents-sandbox` and its board (project 5)
     - [x] Owner: revoke the sandbox's `OWNER_PAT` ("github-agents sandbox", at github.com/settings/tokens) and its Claude OAuth token
4. **dev-website-2026 goes public.** Its items are below. Done 2026-11-04 in dev-website-2026 PR 76, as 40db98e.
5. **lyrics-display goes public and migrates.** Its items are below. Done 2026-11-04 in lyrics-display PR 33, as 1512c60; a smoke issue (34) was triaged on the engine.
6. **dev-website-2026 migrates**: first the owner disables its old Triage and Implement (see step 7's notes); then callers, `agents.yml` (`board: 1`, `automation: implement`, checks including `build`), and removal of the old copies (`.github/prompts/`, `scripts/board-status.ts`, `scripts/triage-outcome.ts`). Its `docs/agents/issue-tracker.md` keeps the `Closes` rule (`Closes #<n>` on its own line, other issues as "issue N"), with the reason changed to "a closing keyword closes that issue on merge"; remove the sentence saying the board moves the card to In progress at once, since that workflow is now off. Done 2026-11-05 in dev-website-2026 PR 77, as 470b2aa. Smoke test: issue 78 (vague) went to HITL with `needs-info`; issue 79 was triaged `ready` and built into PR 80, whose checks passed.
7. **`doctor`**, then the **`setup-github-agents` skill**, written from what steps 5 and 6 actually needed. Learned in step 5:
   - Disable the old Triage and Implement before a repo goes public, since they read every commenter's text with `OWNER_PAT` and no egress limit. The disable is tied to the file path, so it survives the migration merge. Re-enable with `gh workflow enable` only after the merge. The owner runs both commands: the auto-mode classifier blocks them.
   - Scan for secrets in a `git clone --mirror`, so PR refs and orphan branches such as `pr-assets` are scanned too (gitleaks).
   - Check the state after each `gh` call. During GitHub 502s, `gh pr merge --delete-branch`, `gh issue create` and the auto-close partly failed, and `gh api` (REST) worked as a fallback.
   - The browser walk stubs third-party APIs with `page.route` rather than adding them to `egress` (lyrics-display stubs lrclib.net).
   - A repo's `CLAUDE.md` may be a symlink to `AGENTS.md` (lyrics-display's is).
   - Learned in step 6: the owner's `gh` token has no `workflow` scope, so a push that changes workflow files must go over SSH. A smoke test should build one `ready` issue, not only triage.

## Consumer repos

### lyrics-display

- [x] Merge settings
- [x] Homepage URL → https://lyrics-display.jpyepez.workers.dev
- [x] `.gitignore` agent worktrees + MIT `LICENSE` (issue 30, PR 32)
- [x] Old worktrees and local branches removed
- [x] Step 5: make public; `main` ruleset (PR + `checks` required, no one skips); board 3 public
- [x] Step 5: migration PR, which closes issue 31 (in HITL):
  - callers and `agents.yml` (`board: 3`, `automation: implement`, `checks: [lint, typecheck, test, test:e2e]`)
  - remove the old copies
  - its `docs/agents/issue-tracker.md` keeps the `Closes` rule (`Closes #<n>` on its own line, other issues as "issue N"), with the reason changed to "a closing keyword closes that issue on merge"; remove the sentence saying the board moves the card to In progress at once, since that workflow is now off
  - move the hand-back items inlined in its prompts into `docs/agents/issue-tracker.md`
  - add `docs/git-workflow.md` with conventional commits. Settle the scopes first: issue 31's triage found nothing covers print, storage, PWA or deps.

### dev-website-2026

- [x] Merge settings
- [x] Homepage URL → https://jpyepez.com
- [x] Old worktree and local branches removed
- [x] Before going public: reword the personal notes in `GLOSSARY.md` (the owner writes these). Move the two draft-post issues to a private note and delete them, with the owner's OK. No history rewrite: PR refs keep the old commits reachable anyway.
- [x] Step 4: make public; `main` ruleset requiring the `checks` job (its `ci.yml` comment already expects one); board 1 public. No license.

## Follow-ups after the plan

- **Consistency**, as separate small PRs:
  - Cloudflare PR previews for lyrics-display
  - the same CI shape in both repos
  - one formatter, with the same config
  - `AGENTS.md` with `CLAUDE.md` linking to it
- **Security**: interaction limits, only if strangers start commenting.
- **Things that expire**: `OWNER_PAT` and `CLAUDE_CODE_OAUTH_TOKEN` have expiry dates. Note them and renew before they lapse, or every run fails. `OWNER_PAT` is one classic token for every repo, so it has one expiry date: give it about a year.
- **Engine**:
  - a `v2` only for breaking changes
  - a second tracker only when a real repo needs one
  - CI as a shared workflow, if the same CI shape proves out
  - an "In review" column between In progress and Done, only if the owner starts missing ready bot PRs. Until then, ready PRs show as In progress, and reviews wait in the PR list.
- **Nice to have**:
  - link the engine from dev-website-2026
  - a work-owned version, built from this as a reference, when a job calls for it
