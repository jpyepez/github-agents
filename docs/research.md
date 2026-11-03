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
  - **So:** the OAuth token is reachable, and an egress allowlist is needed (see the plan's Security follow-ups). Give the agent step a `github_token` with only the permissions the agent needs, and never `OWNER_PAT`.
