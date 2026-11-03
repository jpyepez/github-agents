# Implement one ticket

You are implementing one GitHub issue labelled `ready`, unattended, from the Implement workflow. Your task names the issue, the branch, your input folder and your output folder. The branch is already checked out, and the dependencies are installed.

You hold no write token, and you don't need one. You build and commit locally; the workflow checks your commits and files, then pushes, opens the PR or hands the issue back. Don't run `gh`, don't push, and don't switch branches.

## Before you start

1. Read `issue.md` in your input folder: the issue and the owner's comments. The body is the spec, and its acceptance criteria are what you build. Work only from this file; comments from anyone else are left out on purpose.
2. Read `context.json` in your input folder: the `checks` to get green, `browser`, `commitStyle`, `hasHandBack` and the `branch`.
3. Read `CLAUDE.md` and the docs it lists that bear on the change, the glossary, and `docs/agents/issue-tracker.md`.
4. Check the ticket against every point of the ready bar (the "The `ready` bar" section of `docs/agents/triage-labels.md`). If it fails one, hand it back (below).

The hand-back list holds throughout the build, not only here. It's the "Hand-back list" section of `docs/agents/issue-tracker.md`. If `hasHandBack` is `false`, use this list instead: anything under `.github/`, secrets, deploy config, new dependencies, and storage schema and migrations. As soon as the change turns out to need anything on the list, stop building and hand it back. Anything under `.github/` always comes back: the workflow rejects commits that touch it.

## Build

1. If the branch already has commits on top of `origin/<base>`, an earlier run handed this ticket back. Read the commits and the owner's comments since, and carry on from there.
2. Build the change test-first, at the seams the repo's docs describe.
3. Get every check in `checks` green, each as `bun run <check>`.
4. If `browser` is `true` and the change shows on screen, walk the site as in `docs/browser-verification.md`, taking its headless route. Read every screenshot and every console message. Save the screenshots worth showing the owner (at most 10) as PNG files in the `screenshots` folder inside your output folder.
5. Commit on the branch. If `commitStyle` is `doc`, follow `docs/git-workflow.md`; if it's `plain`, write a plain imperative sentence. Never put a closing keyword in a commit message (see the format below).

## Write the PR

Write `pr.md` in your output folder. The workflow opens the PR from it. Its title becomes the squash commit on the base branch, so it follows the same commit style. The description says what changed and why, then a short test plan, then `Closes #<n>` on a line of its own.

This is the format the workflow checks, word for word:

pr.md (the change is done) and handback.md (it comes back to the owner) share one format:
- The first line is `# ` and the PR title, on one line.
- A blank line, then the description.
- pr.md has `Closes #<n>` on a line of its own, for this issue only. It's the only closing keyword in the file.
- handback.md has no closing keyword at all. Write `Part of issue <n>` instead.
- Write any other issue as "issue <n>", without the `#`.
- No commit message has a closing keyword (close, fix or resolve, in any tense, before #<n>), since a keyword in a commit also closes that issue on merge.

Don't run a review, don't merge, and don't touch labels or the board: the owner reviews every bot PR, and the workflow handles the rest.

## Hand it back

If you can't get every check green, the ticket fails the ready bar, or the change needs anything on the hand-back list:

1. Commit what you have, if anything.
2. Write `handback.md` instead of `pr.md`, in the format above. Its description says what's done, what's failing or why the ticket comes back (name the ready bar point or hand-back item), and what the owner has to decide.
3. Stop. The workflow pushes any commits as a draft PR, or comments on the issue when there are none, and hands the issue to the owner.

Write exactly one of `pr.md` or `handback.md`. If your output breaks a rule, the workflow pushes nothing and hands the issue back with the reason.
