# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Where they live

- **Glossaries** (read every one, in this order):
  - `GLOSSARY.md`: writable
- **ADRs**: `docs/adr/`: writable
- **Out of scope**: `docs/out-of-scope/`: writable

Each entry is `writable` or `read-only`. Read all of them; write new terms, ADRs and rejections only to a `writable` one. A term that conflicts with a `read-only` glossary is flagged, never redefined.

If any of these don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `domain-records` skill creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the glossary. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `domain-records`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
