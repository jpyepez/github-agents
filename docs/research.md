# Research

GitHub Actions facts the design rests on. They were checked against docs.github.com on 2026-11-03. Step 2 of the [plan](plan.md) tests the untested ones.

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
- **Rulesets and branch protection** aren't available on private repos on the Free plan; the API returns 403. Public repos get them free.

## Untested: step 2 settles these

- [ ] The self-checkout works from a private caller with the default token, the engine being public.
- [ ] Secrets passed by name arrive in the callee.
- [ ] What the agent's shell environment exposes in `claude-code-action`. If `CLAUDE_CODE_OAUTH_TOKEN` or other secrets are visible, add an egress allowlist (for example harden-runner).
- [ ] A fine-grained PAT can move cards on a user-owned Projects board. If it can, use one per repo, limited to that repo, instead of the classic `OWNER_PAT` (scopes `repo`, `project`, `read:org`, which reaches every repo).
