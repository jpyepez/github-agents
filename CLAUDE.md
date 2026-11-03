# github-agents

The engine behind auto triage and auto implement on GitHub: reusable workflows (`on: workflow_call`), the agent prompts and the scripts they run. Consumer repos call it with thin callers pinned to `@v1` and keep their own rules in their docs. Today's consumers are `jpyepez/lyrics-display` (`~/Hub/Areas/Music/lyrics-display`) and `jpyepez/dev-website-2026` (`~/Hub/Projects/Personal/dev-website-2026`).

## Before any work here

- [Plan](./docs/plan.md): read first in every session. It holds the build order with each step's status, the consumer-repo items, and the follow-ups. Tick off a step there when it lands.
- [Design](./docs/design.md): read before writing a workflow, a prompt, a script or the config format. It holds the settled decisions and the reasons behind them.
- [Research](./docs/research.md): read before relying on GitHub Actions behaviour. It holds the verified facts with their sources, and the ones still untested.

## Rules

- The design's decisions are settled. Build to them; raise a change with the owner rather than drifting from them.
- Anything outward-facing needs the owner's go-ahead first: creating or deleting repos, changing visibility or settings, pushing, merging, deleting issues.
- This repo is public. Keep consumer repos' private details out of it.
