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
3. **Engine v1**: triage and implement as `workflow_call`, the check step, `.github/agents.yml`, the privilege split, owner-only comments, the tracker seam. Port from dev-website-2026 (see [porting notes](design.md#porting-notes)). Tag `v1.0.0` and `v1`.
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
- **Security**, depending on step 2:
  - an egress allowlist: step 2 found the agent's shell can read `CLAUDE_CODE_OAUTH_TOKEN` (see [research](research.md#tested-in-step-2))
  - interaction limits only if strangers start commenting
- **Things that expire**: `OWNER_PAT` and `CLAUDE_CODE_OAUTH_TOKEN` have expiry dates. Note them and renew before they lapse, or every run fails. `OWNER_PAT` is one classic token for every repo, so it has one expiry date: give it about a year.
- **Engine**:
  - a `v2` only for breaking changes
  - a second tracker only when a real repo needs one
  - CI as a shared workflow, if the same CI shape proves out
  - an "In review" column between In progress and Done, only if the owner starts missing ready bot PRs. Until then, ready PRs show as In progress, and reviews wait in the PR list.
- **Nice to have**:
  - link the engine from dev-website-2026
  - a work-owned version, built from this as a reference, when a job calls for it
