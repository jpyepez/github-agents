import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkOutcome, type OutcomeInputs, parseDoc, readBundle } from "./implement-outcome";

const branch = "auto/issue-5";
const pr = "# Fix the header\n\nWhat changed.\n\nCloses #5\n";
const base: OutcomeInputs = {
  issue: 5,
  pr,
  handback: null,
  branch,
  bundleHeads: [`refs/heads/${branch}`],
  commits: [{ sha: "abc1234def", message: "Fix the header", files: ["src/header.ts"] }],
};
const rejects = (over: Partial<OutcomeInputs>, reason: string) =>
  expect(checkOutcome({ ...base, ...over })).toEqual({ pass: false, reason: expect.stringContaining(reason) });

describe("parseDoc", () => {
  test("splits the title line from the description", () => {
    expect(parseDoc("pr.md", pr)).toEqual({ title: "Fix the header", body: "What changed.\n\nCloses #5" });
  });
  test("needs a title line, a blank line and a description", () => {
    expect(parseDoc("pr.md", "Fix it\n\nBody")).toContain("first line must be");
    expect(parseDoc("pr.md", "# Fix it\nBody")).toContain("needs a blank line");
    expect(parseDoc("pr.md", "# Fix it\n\n")).toContain("has no description");
  });
});

describe("checkOutcome", () => {
  test("passes a PR that closes its own issue", () => {
    expect(checkOutcome(base)).toEqual({ pass: true, kind: "pr", title: "Fix the header", body: "What changed.\n\nCloses #5", commits: 1 });
  });

  test("passes a hand-back with no commits and no bundle", () => {
    expect(checkOutcome({ ...base, pr: null, handback: "# Needs a copy change\n\nPart of issue 5. The owner decides.\n", bundleHeads: null, commits: [] })).toMatchObject({
      pass: true, kind: "handback", commits: 0,
    });
  });

  test("needs exactly one of pr.md or handback.md", () => {
    rejects({ pr: null }, "exactly one of pr.md or handback.md");
    rejects({ handback: "# x\n\ny" }, "exactly one of pr.md or handback.md");
  });

  describe("the Closes rule", () => {
    test("pr.md needs Closes #<n> on its own line", () => {
      rejects({ pr: "# Fix\n\nWhat changed." }, "must have `Closes #5` on a line of its own");
      rejects({ pr: "# Fix\n\nThis closes #5 now." }, 'found: "This closes #5 now."');
      rejects({ pr: "# Fix\n\nFixes #5" }, 'found: "Fixes #5"');
    });
    test("pr.md may not close any other issue, in any form", () => {
      rejects({ pr: `${pr}Closes #6\n` }, "no other closing keyword");
      rejects({ pr: `${pr}Also resolves jp/app#6.\n` }, "no other closing keyword");
      rejects({ pr: `${pr}fixed https://github.com/jp/app/issues/7\n` }, "no other closing keyword");
      rejects({ pr: "# Fixes #5\n\nCloses #5" }, "no other closing keyword");
    });
    test("pr.md may mention other issues without a keyword", () => {
      expect(checkOutcome({ ...base, pr: `${pr}\nSee issue 6 and #7.\n` }).pass).toBe(true);
    });
    test("handback.md has no closing keyword at all", () => {
      rejects({ pr: null, handback: "# Stuck\n\nCloses #5", bundleHeads: null, commits: [] }, "handback.md must have no closing keyword");
    });
    test("no commit message has a closing keyword", () => {
      rejects({ commits: [{ sha: "abc1234def", message: "Fix the header\n\nCloses #5", files: ["a.ts"] }] }, "commit abc1234's message has a closing keyword");
      rejects({ commits: [{ sha: "abc1234def", message: "fix: header (fixes #9)", files: ["a.ts"] }] }, "closing keyword");
    });
    test("a conventional-commit `fix:` without an issue number is fine", () => {
      expect(checkOutcome({ ...base, commits: [{ sha: "abc1234def", message: "fix(header): align logo", files: ["a.ts"] }] }).pass).toBe(true);
    });
  });

  test("no commit changes anything under .github/", () => {
    rejects({ commits: [{ sha: "abc1234def", message: "Tweak CI", files: ["src/a.ts", ".github/workflows/ci.yml"] }] }, "changes .github/workflows/ci.yml");
    expect(checkOutcome({ ...base, commits: [{ sha: "a", message: "m", files: [".githubish/x", "docs/.github-notes.md"] }] }).pass).toBe(true);
  });

  test("the bundle holds only the issue's branch", () => {
    rejects({ bundleHeads: ["refs/heads/main"] }, "must hold only refs/heads/auto/issue-5");
    rejects({ bundleHeads: [`refs/heads/${branch}`, "refs/heads/other"] }, "must hold only");
  });

  test("a PR needs commits", () => {
    rejects({ bundleHeads: null, commits: [] }, "no commits.bundle");
    rejects({ commits: [] }, "has no commits on top of the base branch");
  });
});

describe("readBundle", () => {
  const dir = mkdtempSync(join(tmpdir(), "implement-outcome-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) => {
    const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
  };

  test("lists the branch's commits and every file they touch, renames included", () => {
    // origin: a bare repo with main; agent: a clone that commits on the branch and bundles it.
    const origin = join(dir, "origin.git");
    const seed = join(dir, "seed");
    mkdirSync(seed);
    git(seed, "init", "-q");
    writeFileSync(join(seed, "a.txt"), "a\n");
    git(seed, "add", ".");
    git(seed, "commit", "-qm", "Seed");
    git(dir, "clone", "-q", "--bare", seed, origin);

    const agent = join(dir, "agent");
    git(dir, "clone", "-q", origin, agent);
    git(agent, "switch", "-qc", branch);
    writeFileSync(join(agent, "b.txt"), "b\n");
    git(agent, "add", ".");
    git(agent, "commit", "-qm", "Add b");
    git(agent, "mv", "a.txt", "c.txt");
    git(agent, "commit", "-qm", "Rename a\n\nMore detail.");
    const bundle = join(dir, "commits.bundle");
    git(agent, "bundle", "create", bundle, `origin/main..${branch}`);

    const apply = join(dir, "apply");
    git(dir, "clone", "-q", origin, apply);
    const { heads, commits } = readBundle(apply, bundle, branch, "main");
    expect(heads).toEqual([`refs/heads/${branch}`]);
    expect(commits.map((c) => [c.message, c.files])).toEqual([
      ["Add b", ["b.txt"]],
      ["Rename a\n\nMore detail.", ["a.txt", "c.txt"]],
    ]);
  });
});
