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

The callers are byte-identical in every repo. Triggers and the owner gate stay in the caller, because a `workflow_call` workflow can't declare event triggers. The caller checks only who acted, and passes the label that started the run. It names no label, because `agents.yml` can rename labels and change `skip_labels`, and a caller that hard-codes `ready` or `spec` would then never start or never skip a run. The engine's `prepare` job compares the label with `agents.yml` and skips everything else. The cost is a short skipped run on every label event by the owner. Decided with the owner on 2026-11-03 for step 3. Secrets pass by name, because `secrets: inherit` is documented only for organisations (see [research](research.md)).

```yaml
# <repo>/.github/workflows/implement.yml
on:
  issues: { types: [labeled] }
  workflow_dispatch: { inputs: { issue: { type: number, required: true } } }
jobs:
  implement:
    if: >-
      (github.event_name == 'workflow_dispatch' && github.actor == github.repository_owner) ||
      (github.event.issue.user.login == github.repository_owner &&
       github.event.sender.login == github.repository_owner)
    uses: jpyepez/github-agents/.github/workflows/implement.yml@v1
    with:
      issue: ${{ fromJSON(github.event.issue.number || inputs.issue) }}
      label: ${{ github.event.label.name }}
    secrets:
      OWNER_PAT: ${{ secrets.OWNER_PAT }}
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

`fromJSON` around the issue number is needed: on a manual run, `github.event.issue.number || inputs.issue` reaches the engine's `number` input as the wrong type, and the run fails at startup with only "a workflow file issue" (found in step 3's sandbox run). The engine declares both secrets `required: true`, which catches a secret the caller doesn't pass. It doesn't catch one that is set but empty, which step 2 showed arrives as an empty string, so [the check step](#the-check-step) also fails on an empty secret. It checks itself out at the pinned commit with `job.workflow_repository` and `job.workflow_sha`, so `@v1` means the prompts and scripts of v1 too.

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
| `egress` | none | hosts added to the agent job's [egress](#egress) allowlist, like `example.com` or `*.cdn.example.com:443` |

Example, lyrics-display:

```yaml
board: 3
automation: implement
checks: [lint, typecheck, test, test:e2e]
```

## Rules the agent reads, with fallbacks

- **Commit and PR title style**: follow `docs/git-workflow.md`; without it, a plain imperative sentence. `pr.md` and `handback.md` titles follow the same setting. Only the shell's fallback, for a run that stopped before writing either file, uses `WIP: issue <n>`, and its draft PR's body asks the owner to retitle it in the repo's style before merging, since a squash merge uses the PR title. A doc rather than a switch, because conventional commits also need each repo's scopes.
- **Ready bar**: without one, triage never applies `ready`, so nothing builds unattended. Every criterion must be checkable by a test, a screenshot, **or, for config- and docs-only changes, by reading the diff**. The baseline run on lyrics-display issue 30 showed the old bar made config-only tickets impossible to mark `ready`.
- **Hand-back list**: without one, a strict built-in default: `.github/`, secrets, deploy config, new dependencies, storage schema and migrations.

## Security: the privilege split

Consumer repos are public, so anyone can comment on the owner's issues. A rule in the prompt telling the agent to ignore those comments is likely to hold, never certain. The protection comes from what the agent can do:

- **The agent holds no write token.** It writes files and the shell steps validate and apply them.
  - Triage writes `decision.json` (category, outcome, retitle), `comment.md` and, for `ready`, `spec.md`. The shell posts the original body as an `Original note:` comment, edits the body, comments, sets labels last, then sets the board Status. On a re-triage whose outcome isn't `ready`, the shell restores the body from the `Original note:` comment, since the spec no longer applies. `decision.json` names the outcome by role (`ready`, `needs-info`, `ready-for-human`, `wontfix`), and the shell maps it to the repo's label.
  - Implement commits locally and writes `pr.md` (title and description), or `handback.md`, plus screenshots. The shell pushes the branch, opens or updates the PR, posts the screenshots, and hands off to HITL when needed.
- **The agent's job keeps `GITHUB_TOKEN` read-only**, for example `contents: read` and `issues: read`. The agent sees the action's `github_token` in its environment, and `permissions` apply to a whole job, not to one step, so every job that runs the agent stays read-only. All writes go through `OWNER_PAT` in shell steps: push, PR, labels, comments and board. That also suits GitHub's rule that pushes and labels made with `GITHUB_TOKEN` don't start other workflows. See [research](research.md#tested-in-step-2).
- **The agent's job limits egress** to the hosts it needs, because the OAuth token can be read from the agent's shell (see [research](research.md#tested-in-step-2)). See [Egress](#egress) below.
- **Owner-only comments.** The workflow fetches the issue and only the owner's comments into a file, and the agent works from that file.
- **`main` rulesets** on every consumer repo: a PR plus the required `checks` job, with no one able to skip them, the owner included, since the PAT acts as the owner.
- **One classic `OWNER_PAT`** (scopes `repo`, `project`, `read:org`) for every repo, not a fine-grained token per repo. Decided on 2026-11-03.
  - The privilege split already keeps every token away from the agent. Only the workflow's own shell steps use it.
  - Fine-grained tokens can't be created through the API, so a token per repo would add a manual create, set and renew step to every repo. That works against a fast, repeatable setup.
  - One token means one expiry date. Give it about a year, and track it under "Things that expire" in the [plan](plan.md).
  - Step 2's agent-environment test found `OWNER_PAT` unreachable from the agent's shell, so the classic token stands. Revisit this if GitHub adds fine-grained permissions for user-owned Projects boards.

What a hijacked agent can still do: write a bad decision, which the outcome check validates, or put bad code in a PR the owner reviews before merging.

**The output scan.** `apply` publishes the agent's output on a public repo at once: comments, the spec, the PR body, commits, screenshots. Before it writes anything, a step of its own, the only one with `CLAUDE_CODE_OAUTH_TOKEN` in its env, scans all of it for the token: every output file, every screenshot, and every commit's message and diff. It looks for the plain token, base64 (standard and url-safe, at all three offsets) and percent-encoding. A hit publishes none of the agent's output and fails the run, naming the file but never the value, with a "treat as leaked: revoke" error in the log. The engine then posts its own fixed comment ("This run failed a safety check and wrote nothing", with the run's link) and moves the issue to HITL, swapping `ready` for `ready-for-human` on implement, so the issue doesn't sit in In progress looking like a running build. The agent job also deletes anything in its output that isn't a regular file before upload, and `apply` posts a screenshot only if it's a regular file with an image's first bytes, so a symlink to `/proc/<pid>/environ` can't be uploaded.

**What's left.** A determined agent could still disguise the token (split it, or transform it some other way) and get it past the scan. Claude Code needs the token in its own process, so it can't be fully hidden from the agent's shell. What remains is owner-only input, GitHub's secret scanning on public repos, and revoking the token if it leaks.

### Pinned actions

Every third-party action in the engine's workflows, and in this repo's own CI, is pinned to a full commit SHA, with its version in a comment: `actions/checkout@3d3c42e… # v7.0.1`. **Why:** they run with `OWNER_PAT` in every consumer repo, and a tag can be moved to other code, so a moved tag would be a supply-chain hole. A version bump is a reviewed PR that changes the SHA and the comment together.

### Jobs

Decided with the owner on 2026-11-03 for step 3. Each workflow runs three jobs, in order:

- **`prepare`** (shell, `OWNER_PAT`): the check step, reading `agents.yml`, the label and skip checks, the claim (implement), and writing the issue with only the owner's comments to a file.
- **`agent`** (`GITHUB_TOKEN` read-only, no `OWNER_PAT`, egress limited): runs Claude, which writes its output files and, for implement, commits locally.
- **`apply`** (shell, `OWNER_PAT`): validates the agent's output, then makes every write: body, comments, labels, Status, push, PR, screenshots and hand-off.

**Why:** `permissions` apply to a whole job, so only a job of its own keeps the agent's token read-only. A secret a job never references never reaches that job's processes.

**Files between jobs:** `agent` uploads its output folder as an artifact (`actions/upload-artifact`), with its commits as a `git bundle` inside. `apply` downloads it, checks the bundle's branch and commits, validates the files, then pushes. **Why:** artifacts are the documented way to pass files between jobs, job outputs are too small for specs and screenshots, and nothing the agent writes reaches GitHub until `apply` has checked it.

**Concurrency:** `concurrency` sits on the `agent` and `apply` jobs, never on the workflow. Both jobs run only when `prepare` outputs that the run should go ahead, so skip runs never enter a group. Triage and implement both use one group per issue, so builds for different issues run in parallel, and only a second run for the same issue replaces a pending one, which is wanted. A single implement group per repo would drop builds: with three issues marked `ready` at once, the first builds, the second waits, and the third cancels the second. The cost: parallel builds use more Claude quota at once, and two PRs may conflict at merge, which review handles as with any two PRs. Each job has its own group (for example `implement-agent-<issue>` and `implement-apply-<issue>`), so another run's `agent` can't take the group between this run's two jobs and leave its `apply` pending. **Why:** the caller starts a run on every label event by the owner, and `apply` sets labels with `OWNER_PAT`, acting as the owner, so each triage starts several skip runs. GitHub keeps only one pending run per group, and a newer pending run cancels the older one. A `ready` run waiting behind a busy implement run could be cancelled by a skip run from a label added seconds later, and the build would be lost without a trace. Whether a job skipped by its `if` enters its concurrency group is untested; the v1 sandbox run settles it.

**Runs for the same issue.** Concurrency alone isn't enough: a queued build for an issue starts as soon as the earlier build's agent finishes, before that run's `apply` has pushed, so it would branch from stale code. So:

- **`prepare` skips while another run is working on the issue.** It looks for another unfinished run with the same title (the callers' `run-name` holds the issue number) whose `agent` or `apply` job is queued or running. Implement then posts a fixed comment: "A build for this issue is already running; label `ready` again after it finishes." Triage skips with a notice only. **The trade-off:** a second `ready` during a build is ignored with a comment, not queued.
- **`apply` writes nothing when its agent job never started**, which it reads from the Actions API: no step of the agent job has a start time, as when a newer run replaced it in the queue. A job that started and then timed out or failed still hands off. Guessing from "cancelled and no artifact" would be wrong, since a timeout also leaves no artifact.
- **A rejected push hands off.** If the branch moved anyway (two `prepare`s racing past the check), the push is rejected as non-fast-forward, and `apply` comments "the branch moved; label `ready` again to rebuild" and hands off, instead of failing without one.

The per-issue concurrency groups stay, as a backstop for two `prepare`s racing.

### Egress

Decided with the owner on 2026-11-03 for step 3. The `agent` job's first step is `step-security/harden-runner` (v2.22.3 or later), with:

- `egress-policy: block` and an allowlist. The engine keeps a default list, starting from Claude Code's network requirements, and `agents.yml` can add to it. One audit-mode pass first finds the hosts the browser walk needs. The workflows take an `egress-policy` input for that pass. It defaults to `block`, and the byte-identical callers never set it; only the sandbox's caller passes `audit`.
- `disable-telemetry: true`, so run data doesn't go to StepSecurity. It only works with `block`.
- `disable-sudo-and-containers: true`, because root could undo the firewall. So the `agent` job can't `sudo apt-get`. The browser walk installs Chromium with plain `playwright install chromium`, which needs Playwright 1.64 or later on `ubuntu-latest`, now Ubuntu 26.04 (step 3's sandbox run); 1.56 refuses it.

**Why harden-runner:** it enforces host-wide, so Claude's shell is covered, and it's free for public repos, which every consumer repo will be by step 5. It doesn't enforce on a private repo without a subscription, and it has fail-open cases in its source. The v1 test checks that a host off the list is blocked. The fallback is `bullfrogsec/bullfrog`. Details and sources are in [research](research.md#verified-in-the-docs).

## The check step

It runs first in every workflow, before Claude starts:

| Missing | Result |
| --- | --- |
| A secret missing or empty | fail, naming it |
| Board | continue, skip Status updates |
| Board set in `agents.yml` but unreadable, or missing a column | fail, listing its columns: a typo should be loud |
| Labels | fail, listing them; the setup skill creates them |
| Ready bar or hand-back list | triage runs but never applies `ready`: the outcome check rejects a `ready` decision rather than downgrading it, since the agent's comment argues for `ready` |
| `docs/git-workflow.md` | plain sentences |
| Tracker isn't GitHub (`docs/agents/issue-tracker.md`) | fail with a clear message |

### Doctor

`doctor` is the same check, run by hand against a consumer repo's checkout, so the setup skill can run it before and after. Decided with the owner on 2026-11-05 for step 7.

- **How it runs:** `bun <engine>/scripts/doctor.ts [repo-root] [--repo owner/name] [--json]`, from the engine checked out at the tag the callers pin. It uses the owner's own `gh` login, changes nothing, and exits 1 on a failure. It's a script only: no workflow runs it.
- **What it adds** to the check step, from what steps 5 and 6 needed:

| Check | Result |
| --- | --- |
| The repo isn't public | fail: harden-runner doesn't enforce the egress allowlist on a private repo |
| A caller isn't byte-identical to `templates/callers/` (so it pins `@v1`) | fail |
| A caller is missing: triage always, implement with `automation: implement` | fail |
| A caller is disabled, or not yet registered with Actions | fail: step 5 disables the old workflows before a repo goes public |
| Old per-repo copies left (`.github/prompts/`, `scripts/board-status.ts`, `scripts/triage-outcome.ts`) | notice |
| The checkout isn't at the tip of `base` on GitHub | notice: doctor reads the checkout, and the engine runs what's on `base` |

- **Secrets by name only.** Locally, `gh secret list` shows that a secret exists, not its value, so doctor can't catch an empty one. It says so in its output. The check step still fails on an empty secret at the first real run.
- **Not checked:** merge settings and rulesets, which the skill asks for per repo, so doctor can't know the right values; and the board's built-in workflows, which have no API.
- **Release:** doctor ships in `v1.1.0`, and `v1` moves to it, so the skill gets doctor and the templates from the same pinned tag. The workflows and callers are unchanged from `v1.0.0`.

## Tracker

GitHub only. Every label, board and comment call goes through `scripts/tracker.ts`, and the prompts use the operations named in the repo's `docs/agents/issue-tracker.md` rather than raw `gh` commands. A second tracker gets built only when a real repo needs one. A local `.work/` tracker has no events, so it would need a scheduled scan.

## Board

Each repo has one user-owned board. These are its settings and the reasons for them.

- **Columns:** Inbox, HITL, Ready, In progress, Done. HITL sits right after Inbox because most HITL cards come straight out of triage, next to Ready. Hand-backs are the rarer path. Scripts look columns up by name, so the order only changes how the board reads.
- **Built-in workflows on:** Auto-add to project (`is:issue`, issues only), Item added to project → Inbox, Item closed → Done, Pull request merged → Done, Auto-close issue, Auto-add sub-issues to project.
  - **Issues only**, because a PR is how an issue gets done, not separate work. That gives one card per piece of work, and the engine moves issues, not PRs.
- **Pull request linked to issue is off** on every board.
  - Only a claim moves a card to In progress: implement's claim step, or "claim before working".
  - That workflow was the one card move the Status table can't explain, and a stray closing keyword could pull a card out of HITL.
  - It also works against the privilege split, in which shell steps set Status from validated files.
- **The `Closes` rule stays:** `Closes #<n>` on its own line, and any other issue written as "issue N". A closing keyword in any tense, anywhere in a PR description, closes that issue on merge, whatever the board's workflows are (see [research](research.md#verified-in-the-docs)), and an issue closed by mistake disappears without notice. The rule first came from a card wrongly moved from Done to In progress (lyrics-display PR 24, dev-website-2026 PR 56). That workflow is off now, so the closing keyword is the reason the rule remains. A keyword in a commit message closes the issue on merge too, so the rule covers commits, and the implement-outcome check enforces it.

## Runtime

Decided with the owner on 2026-11-03 for step 3. The engine's scripts run on Bun, as dev-website-2026's do. `prepare` and `apply` install it with `oven-sh/setup-bun`, so a consumer repo needs nothing extra. **Why:** the scripts and their tests port as they are, and `Bun.YAML` reads `agents.yml` without a dependency.

## Testing the engine

Decided with the owner on 2026-11-03 for step 3.

- **Before a release:** a **public** throwaway repo, `github-agents-sandbox`, with a tiny Bun project, its two secrets and a board. Triage and build test issues there against the branch, check that a host off the allowlist is blocked, then delete it. It's public because harden-runner doesn't enforce on a private repo. Secrets stay secret in a public repo, and the sandbox holds no private content. The sandbox always uses throwaway, short-lived tokens: a classic `OWNER_PAT` that expires in 7 days and a fresh Claude OAuth token, both revoked at teardown. Never the real ones, because the test exercises leak paths on a public repo.
- **On every PR here:** one small `ci.yml` runs `actionlint`, `shellcheck`, `bun test` and a typecheck of `scripts/`. This repo still has no issue automation.

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
