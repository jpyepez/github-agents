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
   - **Decide first** (owner). Each has a recommendation:
     - [ ] **Job split.** Recommend: each workflow has three jobs. `prepare` (shell, `OWNER_PAT`) runs the check step, reads `agents.yml`, and fetches the issue with only the owner's comments into a file. `agent` (`GITHUB_TOKEN` read-only, no `OWNER_PAT`, egress limited) runs Claude. `apply` (shell, `OWNER_PAT`) validates the agent's files and makes every write. Why: `permissions` apply per job, so the agent needs a job of its own to keep a read-only token. And a secret a job never references never reaches that job's processes.
     - [ ] **Passing files between jobs.** Recommend: upload the agent's output folder as an artifact (`actions/upload-artifact` / `download-artifact`), with commits as a `git bundle` in it. `apply` checks the bundle's branch, validates the files, then pushes. Why: it's the documented way to pass files between jobs, and nothing the agent writes reaches GitHub without `apply` checking it. Job outputs are too small for specs and screenshots.
     - [ ] **Egress.** Recommend: `step-security/harden-runner` (v2.22.3 or later) as the first step of the `agent` job, with `egress-policy: block`, `disable-telemetry: true` and `disable-sudo-and-containers: true`. Run one audit-mode pass first, to find the hosts the browser walk needs. Start the allowlist from Claude Code's [network requirements](https://code.claude.com/docs/en/network-config): `api.anthropic.com`, `claude.ai`, `platform.claude.com`, `downloads.claude.ai`, `registry.npmjs.org`, `github.com`, `api.github.com`, plus the release-asset host `oven-sh/setup-bun` downloads from. The engine keeps a default list, and `agents.yml` can add to it. Why, and what it costs:
       - It's free only for **public** repos. On a private repo without a subscription it silently drops to audit mode and stops enforcing, so the v1 test repo must be public (see below).
       - Without `disable-telemetry`, every run's network events go to StepSecurity. That option works only in block mode, which is another reason to block from the start.
       - Without `disable-sudo-and-containers`, the agent could use root to undo the firewall. That means the `agent` job can't `sudo apt-get`. `playwright install --with-deps` needs sudo, so it must run without `--with-deps` (if the runner image already has the libraries) or move out of the agent's job. This is a real gap to settle in the audit pass.
       - If an allowed host fails to resolve at the start, it reverts and enforces nothing. IPv6 may not be covered. Both are from its source, not tested, so the v1 test checks that a host off the list is blocked.
       - The alternative is `bullfrogsec/bullfrog` (MIT, no account needed), if harden-runner's fail-open cases or the open westus2 bug (issue 708) bite.
     - [ ] **Script runtime.** Recommend: Bun, as today. Why: the scripts and tests port as they are, `Bun.YAML` parses `agents.yml` without a dependency, and both consumer repos already install it. `prepare` and `apply` install Bun with `oven-sh/setup-bun` themselves, so a consumer repo needs nothing extra.
     - [ ] **Label and skip-label overrides in the byte-identical caller.** Gap: the design's caller hard-codes `ready` and `spec` in its `if`, so a renamed label (allowed by `labels`) or a changed `skip_labels` would never start, or never skip, a run. Recommend: the caller's `if` keeps only the owner checks, and passes the event's label name; `prepare` compares it with `agents.yml` and skips. Cost: a short skipped run on every label event by the owner.
     - [ ] **Testing v1 before the tag.** Recommend: a **public** `github-agents-sandbox`, with a tiny Bun project, its two secrets and a board. Triage and build two test issues there against the branch, check that a host off the allowlist is blocked, then delete it. Why: the consumer repos are the only other place to try it, and they're live. It must be public, because harden-runner doesn't enforce on a private repo without a subscription. Secrets stay secret in a public repo, and the sandbox holds no private content.
     - [ ] **CI for this repo.** Recommend: one small `ci.yml` that runs `actionlint`, `shellcheck`, `bun test` and a typecheck of `scripts/`. No issue automation, as step 1 settled. Why: the engine's scripts get unit tests, and every consumer runs them.
   - **Workflows**
     - [ ] `.github/workflows/triage.yml`: `on: workflow_call`, inputs `issue` and `label`, secrets `OWNER_PAT` and `CLAUDE_CODE_OAUTH_TOKEN` (`required: true`), the jobs above, caps from `agents.yml`, concurrency per issue
     - [ ] `.github/workflows/implement.yml`: the same shape, with the claim in `prepare`, `branch_prefix` and `base` from `agents.yml`, and dev-website-2026's hand-off logic (`pr=new`, draft PR, `ready` → `ready-for-human`, HITL) in `apply`. One run at a time per repo.
     - [ ] Self-checkout at `job.workflow_sha` in every job that runs engine code
     - [ ] `templates/callers/triage.yml` and `templates/callers/implement.yml`, byte-identical in every repo
   - **Check step** (`scripts/check.ts`, run first in `prepare`; `doctor` reuses it in step 7)
     - [ ] Every row of the design's table: a missing or empty secret, the board, the labels, the ready bar and hand-back list, `docs/git-workflow.md`, a tracker other than GitHub
   - **Settings**
     - [ ] `scripts/settings.ts`: read `.github/agents.yml`, apply every default from the design's table, and fail on an unknown key or a bad value. A missing key always means the more cautious setting.
     - [ ] `automation: triage` means `apply` never lets an outcome start an implement run, and implement skips at once
   - **Scripts**, generic: the repo from `GITHUB_REPOSITORY`, the project by number, the Status field and columns by name
     - [ ] `scripts/tracker.ts`, the tracker seam: every label, comment, body, assignee, PR and board call
     - [ ] `scripts/board-status.ts`, ported, on top of `tracker.ts`
     - [ ] `scripts/triage-outcome.ts`, ported. It now validates `decision.json`, `comment.md` and `spec.md` before `apply` writes anything, instead of checking a comment the agent posted. The categories and labels come from `agents.yml`.
     - [ ] An implement-outcome check: `pr.md` or `handback.md` is present and well formed, the bundle's branch is `branch_prefix` + the issue number, and no commit touches `.github/`
     - [ ] Unit tests for each, ported from dev-website-2026's where they exist
   - **Prompts**
     - [ ] `prompts/triage.md` and `prompts/implement.md`, ported. The agent reads the issue file, writes its output files and never calls `gh` to write. They link the repo's ready bar and hand-back list, with the design's fallbacks when one is missing.
     - [ ] Nothing repo-specific left in them (the porting notes' list)
   - **Owner-only comments**
     - [ ] `prepare` writes the issue, its body and only the owner's comments to a file, and the agent works from that file
   - **Egress allowlist**
     - [ ] harden-runner on the `agent` job, as decided above
   - **Release**
     - [ ] The sandbox run from the decision above passes for triage and implement
     - [ ] Tag `v1.0.0` and `v1`, after the owner's go-ahead
4. **dev-website-2026 goes public.** Its items are below.
5. **lyrics-display goes public and migrates.** Its items are below.
6. **dev-website-2026 migrates**: callers, `agents.yml` (`board: 1`, `automation: implement`, checks including `build`), and removal of the old copies (`.github/prompts/`, `scripts/board-status.ts`, `scripts/triage-outcome.ts`). Its `docs/agents/issue-tracker.md` keeps the `Closes` rule (`Closes #<n>` on its own line, other issues as "issue N"), with the reason changed to "a closing keyword closes that issue on merge"; remove the sentence saying the board moves the card to In progress at once, since that workflow is now off.
7. **`doctor`**, then the **`setup-github-agents` skill**, written from what steps 5 and 6 actually needed.

## Consumer repos

### lyrics-display

- [x] Merge settings
- [x] Homepage URL → https://lyrics-display.jpyepez.workers.dev
- [x] `.gitignore` agent worktrees + MIT `LICENSE` (issue 30, PR 32)
- [x] Old worktrees and local branches removed
- [ ] Step 5: make public; `main` ruleset (PR + `checks` required, no one skips); board 3 public
- [ ] Step 5: migration PR, which closes issue 31 (in HITL):
  - callers and `agents.yml` (`board: 3`, `automation: implement`, `checks: [lint, typecheck, test, test:e2e]`)
  - remove the old copies
  - its `docs/agents/issue-tracker.md` keeps the `Closes` rule (`Closes #<n>` on its own line, other issues as "issue N"), with the reason changed to "a closing keyword closes that issue on merge"; remove the sentence saying the board moves the card to In progress at once, since that workflow is now off
  - move the hand-back items inlined in its prompts into `docs/agents/issue-tracker.md`
  - add `docs/git-workflow.md` with conventional commits. Settle the scopes first: issue 31's triage found nothing covers print, storage, PWA or deps.

### dev-website-2026

- [x] Merge settings
- [x] Homepage URL → https://jpyepez.com
- [x] Old worktree and local branches removed
- [ ] Before going public: reword the personal notes in `GLOSSARY.md` (the owner writes these). Move the two draft-post issues to a private note and delete them, with the owner's OK. No history rewrite: PR refs keep the old commits reachable anyway.
- [ ] Step 4: make public; `main` ruleset requiring the `checks` job (its `ci.yml` comment already expects one); board 1 public. No license.

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
