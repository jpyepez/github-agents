# Design

Settled with the owner on 2026-11-03. Each decision has its reason, so a later change can tell which reasons still hold.

## The split: engine and contract

The **engine** is what every repo shares, versioned once, here:

```text
github-agents/
├── .github/workflows/
│   ├── triage.yml          # on: workflow_call
│   └── implement.yml       # on: workflow_call
├── prompts/
│   ├── triage.md
│   └── implement.md
├── scripts/
│   ├── board-status.ts     # finds the board and its Status field by name; no IDs
│   ├── triage-outcome.ts   # validates the agent's decision file
│   └── tracker.ts          # the tracker seam: every label, board and comment call
└── templates/              # what setup-github-agents installs into a repo
    ├── callers/triage.yml
    ├── callers/implement.yml
    ├── agents.yml
    ├── ready-bar.md
    ├── hand-back.md
    └── git-workflow-conventional.md
```

The **contract** is what each repo provides:

| Piece | Where it lives | Read by |
| --- | --- | --- |
| Settings | `.github/agents.yml` | shell steps, scripts, agent |
| Ready bar | `docs/agents/triage-labels.md#the-ready-bar` | agent |
| Hand-back list | `docs/agents/issue-tracker.md#hand-back-list` | agent |
| Commit and PR title style | `docs/git-workflow.md` | agent, draft-PR step |
| Repo rules | `CLAUDE.md` | agent |
| Browser walk | `docs/browser-verification.md` (headless route) | agent |
| Secrets | repo secrets `OWNER_PAT`, `CLAUDE_CODE_OAUTH_TOKEN` | workflow |

**Why:** the per-repo copies drifted. dev-website-2026's port improved its implement workflow and the fixes never reached lyrics-display. One engine makes a fix a one-commit change.

## Callers

The callers are byte-identical in every repo. Triggers and the owner gate stay in the caller, because a `workflow_call` workflow can't declare event triggers. Secrets pass by name, because `secrets: inherit` is documented only for organisations (see [research](research.md)).

```yaml
# <repo>/.github/workflows/implement.yml
on:
  issues: { types: [labeled] }
  workflow_dispatch: { inputs: { issue: { type: number, required: true } } }
jobs:
  implement:
    if: >-
      (github.event_name == 'workflow_dispatch' && github.actor == github.repository_owner) ||
      (github.event.label.name == 'ready' && !contains(github.event.issue.labels.*.name, 'spec') &&
       github.event.issue.user.login == github.repository_owner &&
       github.event.sender.login == github.repository_owner)
    uses: jpyepez/github-agents/.github/workflows/implement.yml@v1
    with:
      issue: ${{ github.event.issue.number || inputs.issue }}
    secrets:
      OWNER_PAT: ${{ secrets.OWNER_PAT }}
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

The engine declares both secrets `required: true`, so a missing one fails the run at once instead of arriving as an empty string. It checks itself out at the pinned commit with `job.workflow_repository` and `job.workflow_sha`, so `@v1` means the prompts and scripts of v1 too.

## Settings: `.github/agents.yml`

Every key is optional. **A missing setting makes the engine more cautious, never less.**

| Key | Default | Notes |
| --- | --- | --- |
| `automation` | `triage` | `triage` labels and comments only; `implement` also builds `ready` issues. A new repo starts on `triage`. |
| `board` | none: skip Status updates | user project number |
| `install` | `bun install --frozen-lockfile` | |
| `checks` | whichever of `lint`, `typecheck`, `test`, `build`, `test:e2e` exist in `package.json` | |
| `browser` | on when `test:e2e` exists | the headless walk and PR screenshots |
| `categories` | `bug`, `enhancement`, `documentation` | |
| `labels` | the default names (`ready`, `needs-info`, `ready-for-human`, `wontfix`, `needs-triage`) | `setup-work` allows overrides; the scripts must honour them |
| `columns` | Inbox, HITL, Ready, In progress, Done | |
| `skip_labels` | `notes`, `spec`, `pathfinder:*` | triage leaves these alone |
| `caps` | triage 30 turns / 30 min; implement 80 turns / 120 min | |
| `base` | `main` | |
| `branch_prefix` | `auto/issue-` | |

Example, lyrics-display:

```yaml
board: 3
automation: implement
checks: [lint, typecheck, test, test:e2e]
```

## Rules the agent reads, with fallbacks

- **Commit and PR title style**: follow `docs/git-workflow.md`; without it, a plain imperative sentence. The draft-PR title the shell step writes follows the same setting (`WIP: issue <n>` when plain). A doc rather than a switch, because conventional commits also need each repo's scopes.
- **Ready bar**: without one, triage never applies `ready`, so nothing builds unattended. Every criterion must be checkable by a test, a screenshot, **or, for config- and docs-only changes, by reading the diff**. The baseline run on lyrics-display issue 30 showed the old bar made config-only tickets impossible to mark `ready`.
- **Hand-back list**: without one, a strict built-in default: `.github/`, secrets, deploy config, new dependencies, storage schema and migrations.

## Security: the privilege split

Consumer repos are public, so anyone can comment on the owner's issues. A rule in the prompt telling the agent to ignore those comments is likely to hold, never certain. The protection comes from what the agent can do:

- **The agent holds no write token.** It writes files and the shell steps validate and apply them.
  - Triage writes `decision.json` (category, outcome, retitle), `comment.md` and, for `ready`, `spec.md`. The shell posts the original body as an `Original note:` comment, edits the body, comments, sets labels last, then sets the board Status.
  - Implement commits locally and writes `pr.md` (title and description), or `handback.md`, plus screenshots. The shell pushes the branch, opens or updates the PR, posts the screenshots, and hands off to HITL when needed.
- **Owner-only comments.** The workflow fetches the issue and only the owner's comments into a file, and the agent works from that file.
- **`main` rulesets** on every consumer repo: a PR plus the required `checks` job, with no one able to skip them, the owner included, since the PAT acts as the owner.
- **Fine-grained PAT per repo**, if one can edit a user-owned Projects board (untested, see research).

What a hijacked agent can still do: write a bad decision, which the outcome check validates, or put bad code in a PR the owner reviews before merging.

## The check step

It runs first in every workflow, before Claude starts:

| Missing | Result |
| --- | --- |
| A secret | fail, naming it |
| Board | continue, skip Status updates |
| Labels | fail, listing them; the setup skill creates them |
| Ready bar or hand-back list | triage runs but never applies `ready` |
| `docs/git-workflow.md` | plain sentences |
| Tracker isn't GitHub (`docs/agents/issue-tracker.md`) | fail with a clear message |

`doctor` is the same check, runnable on its own, so the setup skill can run it before and after.

## Tracker

GitHub only. Every label, board and comment call goes through `scripts/tracker.ts`, and the prompts use the operations named in the repo's `docs/agents/issue-tracker.md` rather than raw `gh` commands. A second tracker gets built only when a real repo needs one. A local `.work/` tracker has no events, so it would need a scheduled scan.

## Versioning

Callers pin `@v1`, which moves forward with each fix, and semver tags (`v1.2.0`) keep the history. A breaking change gets `v2`, and callers move to it on purpose.

## Setup: `setup-github-agents`

A separate skill from `setup-work`, which it requires. It stops and asks for `/setup-work` when `docs/agents/` is missing. It asks, one section at a time:

- automation level
- board
- checks
- ready bar
- hand-back list
- commit style
- merge settings, defaulting to squash only, PR title as commit, delete branches
- rulesets, defaulting to no one able to skip them

It writes on a branch and opens a PR. It hands the owner's own steps to `wizard`: the secrets, and the board's built-in workflows, which have no API. It runs `doctor` before and after. Templates come from this repo at the pinned tag, so the skill and the engine can't drift. A migration mode removes old per-repo copies and moves the repo-specific rules in them into docs first.

## Porting notes

Build v1 from **dev-website-2026's** copies (`.github/workflows/{triage,implement}.yml`, `.github/prompts/`, `scripts/board-status.ts`, `scripts/triage-outcome.ts`). They're ahead of lyrics-display's on:

- `workflow_dispatch` for implement
- the hand-off step's `pr=new`, without which a draft PR also gets a stray "no PR" comment
- branching from `origin/main`
- copying the prompt to `$RUNNER_TEMP`
- prompts that link the ready bar and hand-back list instead of inlining them

Repo-specific material to keep out of the engine and move into each repo's docs:

- **lyrics-display:** the placeholder-lyrics rule (already in its `CLAUDE.md`); `docs/language-conventions.md`; the preview on port 4174; the hand-back items inlined in its prompts (`.github/`, secrets, deploy config, storage schema and migrations, print CSS, new deps).
- **dev-website-2026:** its hand-back list (already in `docs/agents/issue-tracker.md`); `bun run build` among the checks.

Hard-coded today, to make generic: `OWNER`, `REPO`, `PROJECT_NUMBER`, `PROJECT_ID` and `STATUS_FIELD_ID` in `board-status.ts`, and `OWNER`, `REPO` and `CATEGORIES` in `triage-outcome.ts`. Derive the repo from `GITHUB_REPOSITORY` and look the project up by number and the Status field by name.
