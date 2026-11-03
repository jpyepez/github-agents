# Research

GitHub Actions facts the design rests on. They were checked against docs.github.com on 2026-11-03. Step 2 of the [plan](plan.md) tested the rest, below.

## Verified in the docs

- **Visibility.** A caller in a private repo can use public and private reusable workflows; a caller in a public repo can use only public ones. Private sharing works between private repos of the same user, after the engine's Settings → Actions → General → Access is set to "Accessible from repositories owned by the user". This engine is public, so none of that applies.
  - https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations
  - https://docs.github.com/en/actions/how-tos/reuse-automations/share-across-private-repositories
- **The caller's context.** Inside a reusable workflow, the `github` context belongs to the caller: `github.repository`, `github.repository_owner`, `github.actor`, `github.event` and `github.token`. `env` doesn't carry over from the caller. `actions/checkout` checks out the caller by default.
  - https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations
- **Self-checkout.** `job.workflow_repository`, `job.workflow_sha`, `job.workflow_ref` and `job.workflow_file_path` refer to the reusable workflow itself. The docs give `actions/checkout` with `repository: ${{ job.workflow_repository }}` and `ref: ${{ job.workflow_sha }}` as the way to check out its own source.
  - https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
- **Secrets.** `secrets: inherit` is documented only within an organisation or enterprise, not between repos of a user account. A secret that isn't passed resolves to an empty string unless the callee marks it `required: true`.
  - https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idsecretsinherit
  - https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows
- **Labels from `GITHUB_TOKEN`** don't start other workflows, and `GITHUB_TOKEN` can't edit a user-owned Projects board. That's why the owner's PAT applies labels and edits the board.
- **Closing keywords.** `close`, `fix` or `resolve` in any tense (`closes`, `fixed`, …), followed by `#<n>`, anywhere in a PR description, link the PR to the issue and close the issue when the PR merges into the default branch. A keyword in a commit message also closes the issue on merge. A PR that targets another branch ignores the keywords. None of this depends on a board workflow. The keywords, or a manual link from the PR sidebar's Development section, create the link that the "Pull request linked to issue" board workflow reacts to; a plain `#<n>` mention doesn't.
  - https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
- **Status options get new IDs when replaced** (observed on 2026-11-03, not from the docs). Replacing a Status field's options through `updateProjectV2Field` gives every option a new ID, even one whose name stays the same. Built-in board workflows that still point at the old IDs break: the UI shows a red icon, and each one must be set to its Status again. Change options in place rather than replacing them, or re-check the workflows afterwards.
- **harden-runner** (checked at v2.22.3, 2026-11-03), for the egress allowlist:
  - Free (Community tier) only for public repos on GitHub-hosted runners. On a private repo without a subscription it drops to audit mode and stops enforcing, with only an annotation to say so. https://github.com/step-security/harden-runner#features-and-pricing-tiers
  - It sends each run's network telemetry to StepSecurity. `disable-telemetry: true` stops that, but only with `egress-policy: block`. https://docs.stepsecurity.io/github-actions/harden-runner/workflow-runs.md
  - It enforces host-wide, through DNS and iptables, so it covers every later step and process in the job, including Claude's shell. It has to be the first step of each job. Wildcards work (`*.x.com`, which doesn't match `x.com` itself), and the port defaults to 443.
  - `disable-sudo-and-containers` removes sudo for the rest of the job, which also rules out `sudo apt-get`. Without it, root could undo the firewall.
  - From its source, not tested: it enforces nothing if an allowed host fails to resolve at the start, and there are no IPv6 rules. Past bypasses (DNS over HTTPS, DNS over TCP, the docker group) are fixed in v2.16.0 and earlier. https://github.com/step-security/harden-runner/security/advisories
- **Hosts Claude Code needs:** `api.anthropic.com`, `claude.ai`, `platform.claude.com`, `downloads.claude.ai` (the installer `claude-code-action` runs), `registry.npmjs.org` and `github.com`. Telemetry hosts are optional. https://code.claude.com/docs/en/network-config
- **Rulesets and branch protection** aren't available on private repos on the Free plan; the API returns 403. Public repos get them free.

## Tested in step 2

Run on 2026-11-03 from the private repo `github-agents-sandbox` (since deleted), calling [`.github/workflows/hello.yml`](../.github/workflows/hello.yml) at `cd99532` on ubuntu 26.04 runners, with `claude-code-action@v1` and `actions/checkout@v7`. The caller is [`scripts/sandbox/caller/hello.yml`](../scripts/sandbox/caller/hello.yml).

- [x] **Self-checkout works from a private caller with the default token.** `job.workflow_repository` was `jpyepez/github-agents`, `job.workflow_ref` named the engine's branch, and `actions/checkout` with `repository: ${{ job.workflow_repository }}` and `ref: ${{ job.workflow_sha }}` landed on exactly that commit. `actionlint` doesn't know the `job.workflow_*` properties yet and flags them; ignore that.
- [x] **Secrets passed by name arrive in the callee.** But **`required: true` doesn't catch an empty secret.** A secret that was set to an empty string passed the check and arrived with 0 characters. (A `!` command in Claude Code has no terminal, so `gh secret set` there reads an empty value instead of prompting; pipe the value in instead.) The check step must test that each secret is non-empty.
- [x] **The agent's shell can reach `CLAUDE_CODE_OAUTH_TOKEN` and the action's `github_token`, but not `OWNER_PAT`.** A probe the agent ran compared sha256 hashes of what its shell could reach against the real secrets. The job was shaped like v1, with `OWNER_PAT` only in an earlier step's `env`.
  - `OWNER_PAT`: not found. A step's `env` doesn't carry over to later steps, even through `/proc`.
  - `CLAUDE_CODE_OAUTH_TOKEN`: not in the agent's own env, but readable in `/proc/<pid>/environ` of the action's `bun` process, the `claude` process and their parent shell, all running as the same user.
  - The `github_token` input (here `github.token`): in the agent's own env as `GH_TOKEN`, `GITHUB_TOKEN`, `DEFAULT_WORKFLOW_TOKEN` and `OVERRIDE_GITHUB_TOKEN`. So the agent can do whatever that token's `permissions` allow.
  - The agent's env also has empty `ANTHROPIC_API_KEY`, `AWS_*` and `SSH_SIGNING_KEY` names, from the action.
  - The probe didn't decode the credentials `actions/checkout` persists: v7 writes them base64-encoded to a `git-credentials-*.config` file under `$RUNNER_TEMP`, not to `.git/config`. Assume the agent can read those too, and check out with `persist-credentials: false` where the agent runs.
  - **So:** the OAuth token is reachable, and an egress allowlist is needed (step 3 of the plan). Limit the `permissions` of every job that runs the agent, since a step can't narrow its job's token, and never give the agent `OWNER_PAT`.

## Tested in step 3

Run on 2026-11-03 in the public `github-agents-sandbox` (since deleted), calling the engine at `step-3-build`, on `ubuntu-latest`, which is now Ubuntu 26.04.

- [x] **Both workflows work end to end from real events.** An issue the owner opened was triaged: labels, the spec as the body, the original as an `Original note:` comment, and the Status. Its `ready` label started implement, which opened a PR with `Closes #1`. The callers' `permissions` (`contents: read`, `issues: read`) were enough for claude-code-action on `issues` events.
- [x] **A manual run needs `fromJSON` around the issue number.** With `issue: ${{ github.event.issue.number || inputs.issue }}`, a `workflow_dispatch` run failed at startup with only "a workflow file issue". `fromJSON(...)` around the same expression works for both events. The callers use it.
- [x] **The egress allowlist.** An audit pass of one triage and one implement run saw: `api.anthropic.com`, `claude.ai`, `downloads.claude.ai`, `github.com`, `api.github.com`, `release-assets.githubusercontent.com` and `registry.npmjs.org`; for Playwright's Chromium, `cdn.playwright.dev`, `playwright.download.prss.microsoft.com` and `storage.googleapis.com`; and Claude Code's telemetry, `http-intake.logs.us5.datadoghq.com`, which `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` turns off. harden-runner allows the Actions hosts (artifacts, results) itself. `platform.claude.com` and `objects.githubusercontent.com` weren't called.
- [x] **Blocking works.** With `egress-policy: block`, a `curl` to `example.com` from the agent's shell failed at once ("Could not connect"), and `api.github.com` returned 200.
- [x] **Chromium installs without sudo.** `bunx playwright install chromium`, without `--with-deps`, worked on Ubuntu 26.04 with Playwright 1.64.1, so the runner image has the libraries. Playwright 1.56.1 refuses Ubuntu 26.04 outright.
- [x] **The agent's shell can't reach the Actions runtime tokens.** `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, `ACTIONS_CACHE_URL` and `ACTIONS_RESULTS_URL` were in neither the agent's env nor any `/proc/<pid>/environ` it could read. The probe printed names only.
- [x] **Cache writes depend on the event.** On `issues` events, every cache save (from `setup-bun`'s post step) was denied: "cache write denied: token has no writable scopes". On `workflow_dispatch`, caches were saved for `refs/heads/main`, including harden-runner's from the agent job. Since the agent can't reach the runtime token, it can't use that.
- [x] **Concurrency, per issue.** Three issues labelled `ready` close together built in parallel, and an unrelated label was only a skip run. Relabelling one issue `ready` twice during its build left one pending run for it and cancelled the other, without touching the other issues.
- [ ] **Two bugs found there**, both when a run replaces another for the same issue:
  - The replaced run's `apply` still ran, since it runs `always()`. It treated the never-started agent as a stopped build and handed the issue back while the newer run was building.
  - The newer run's agent took the issue's agent group as soon as the first run's agent finished, before that run's `apply` had pushed. It branched from `origin/main`, and its push was rejected as non-fast-forward.
- [x] **The agent refuses instructions inside an issue.** Asked in an issue's body to run probe commands and paste their output, the triage agent declined and said it follows `docs/agents/`, not the issue's text.

