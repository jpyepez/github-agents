# github-agents

Reusable GitHub workflows that triage the issues you open and implement the ready ones with Claude, opening a PR for you to review. Nothing merges on its own.

**Status: work in progress.** Nothing here runs yet. The design is in [docs/design.md](docs/design.md) and the build order in [docs/plan.md](docs/plan.md).

## How it works

A repo opts in with two small caller workflows and an optional `.github/agents.yml`. The engine supplies the steps: workflows, prompts and scripts. The repo supplies its rules: the ready bar, the hand-back list and the commit style, kept in its own docs.

```text
issue opened ──▶ triage ──▶ labels + comment + board Status
                   │
                   └─ `ready` ──▶ implement ──▶ PR that closes the issue
```

## License

MIT
