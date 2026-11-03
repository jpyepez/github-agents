/// <reference types="bun" />
// The implement outcome check, run by `apply` before it pushes anything. The implement
// agent holds no write token: it commits locally and leaves its output folder with
// exactly one of pr.md or handback.md, plus its commits as commits.bundle.
//
// PR_FORMAT is the contract with prompts/implement.md, which quotes it word for word:
export const PR_FORMAT = `pr.md (the change is done) and handback.md (it comes back to the owner) share one format:
- The first line is \`# \` and the PR title, on one line.
- A blank line, then the description.
- pr.md has \`Closes #<n>\` on a line of its own, for this issue only. It's the only closing keyword in the file.
- handback.md has no closing keyword at all. Write \`Part of issue <n>\` instead.
- Write any other issue as "issue <n>", without the \`#\`.
- No commit message has a closing keyword (close, fix or resolve, in any tense, before #<n>), since a keyword in a commit also closes that issue on merge.`;
//
//   bun scripts/implement-outcome.ts <out-dir> <settings.json> <issue-number> <result.json>
//
// Run inside the consumer repo's clone, with origin/<base> fetched. It fetches the bundle's
// branch into refs/agent/<branch>, checks it, and writes result.json for `apply`.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closingRefs } from "./closing";
import type { Settings } from "./settings";

export const MAX_BODY = 60000;
export const MAX_TITLE = 256;

export type Commit = { sha: string; message: string; files: string[] };

export type OutcomeInputs = {
  issue: number;
  pr: string | null; // pr.md
  handback: string | null; // handback.md
  branch: string; // the branch the agent was told to use
  bundleHeads: string[] | null; // refs in commits.bundle, or null when there's no bundle
  commits: Commit[]; // origin/<base>..<branch>, oldest first
};

export type Outcome =
  | { pass: true; kind: "pr" | "handback"; title: string; body: string; commits: number }
  | { pass: false; reason: string };

const fail = (reason: string): Outcome => ({ pass: false, reason });

export function parseDoc(name: string, text: string): { title: string; body: string } | string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines[0] ?? "";
  if (!first.startsWith("# ") || first.slice(2).trim() === "") return `${name}'s first line must be \`# \` and the title`;
  const title = first.slice(2).trim();
  if (title.length > MAX_TITLE) return `${name}'s title is longer than ${MAX_TITLE} characters`;
  if ((lines[1] ?? "") !== "") return `${name} needs a blank line after the title`;
  const body = lines.slice(2).join("\n").trim();
  if (body === "") return `${name} has no description`;
  if (body.length > MAX_BODY) return `${name}'s description is longer than ${MAX_BODY} characters`;
  return { title, body };
}

export function checkOutcome(inputs: OutcomeInputs): Outcome {
  const { issue, pr, handback } = inputs;
  if ((pr === null) === (handback === null)) return fail("the output needs exactly one of pr.md or handback.md");
  const kind = pr !== null ? "pr" : "handback";
  const name = kind === "pr" ? "pr.md" : "handback.md";
  const doc = parseDoc(name, (pr ?? handback)!);
  if (typeof doc === "string") return fail(doc);

  // The Closes rule (docs/design.md, "Board").
  const refs = closingRefs(`${doc.title}\n${doc.body}`);
  if (kind === "pr") {
    const own = `Closes #${issue}`;
    if (refs.length !== 1 || refs[0]!.repo !== null || refs[0]!.number !== issue || refs[0]!.line !== own) {
      const found = refs.length ? refs.map((r) => `"${r.line}"`).join(", ") : "none";
      return fail(`pr.md must have \`${own}\` on a line of its own and no other closing keyword (found: ${found})`);
    }
  } else if (refs.length) {
    return fail(`handback.md must have no closing keyword (found: ${refs.map((r) => `"${r.line}"`).join(", ")}); write "Part of issue ${issue}"`);
  }

  if (inputs.bundleHeads === null) {
    if (kind === "pr") return fail("pr.md needs commits, but there is no commits.bundle");
    return { pass: true, kind, title: doc.title, body: doc.body, commits: 0 };
  }
  const wanted = `refs/heads/${inputs.branch}`;
  if (inputs.bundleHeads.length !== 1 || inputs.bundleHeads[0] !== wanted) {
    return fail(`commits.bundle must hold only ${wanted}, but holds: ${inputs.bundleHeads.join(", ") || "nothing"}`);
  }
  if (kind === "pr" && inputs.commits.length === 0) return fail(`${inputs.branch} has no commits on top of the base branch`);

  for (const commit of inputs.commits) {
    const short = commit.sha.slice(0, 7);
    const touched = commit.files.filter((f) => f === ".github" || f.startsWith(".github/"));
    if (touched.length) return fail(`commit ${short} changes ${touched.join(", ")}: anything under .github/ goes back to the owner`);
    const refsInMessage = closingRefs(commit.message);
    if (refsInMessage.length) {
      return fail(`commit ${short}'s message has a closing keyword ("${refsInMessage[0]!.line}"); write "issue <n>" in commits`);
    }
  }

  return { pass: true, kind, title: doc.title, body: doc.body, commits: inputs.commits.length };
}

function git(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args[0]} failed:\n${proc.stderr.toString().trim()}`);
  return proc.stdout.toString();
}

// Reads the bundle's heads, fetches its branch into refs/agent/, and lists its commits.
export function readBundle(repoDir: string, bundle: string, branch: string, base: string): { heads: string[]; commits: Commit[] } {
  git(["bundle", "verify", bundle], repoDir);
  const heads = git(["bundle", "list-heads", bundle], repoDir)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" ")[1] ?? "");
  if (heads.length !== 1 || heads[0] !== `refs/heads/${branch}`) return { heads, commits: [] };
  const ref = `refs/agent/${branch}`;
  git(["fetch", "--no-tags", "--force", bundle, `refs/heads/${branch}:${ref}`], repoDir);
  // %x00 between fields and %x01 after each commit, then its file list (--no-renames lists both sides).
  const log = git(["log", "--reverse", "--no-renames", "--name-only", "--format=%x01%H%x00%B%x00", `origin/${base}..${ref}`], repoDir);
  const commits = log
    .split("\x01")
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const [sha = "", message = "", files = ""] = chunk.split("\x00");
      return { sha: sha.trim(), message: message.trim(), files: files.split("\n").map((f) => f.trim()).filter(Boolean) };
    });
  return { heads, commits };
}

function readOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

if (import.meta.main) {
  const [outDir = "", settingsPath = "", issueArg = "", resultPath = "result.json"] = process.argv.slice(2);
  try {
    if (!outDir || !settingsPath || !/^[1-9]\d*$/.test(issueArg)) {
      throw new Error("Usage: bun scripts/implement-outcome.ts <out-dir> <settings.json> <issue-number> <result.json>");
    }
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
    const issue = Number(issueArg);
    const branch = `${settings.branch_prefix}${issue}`;
    const bundlePath = join(outDir, "commits.bundle");
    const bundle = existsSync(bundlePath) ? readBundle(process.cwd(), bundlePath, branch, settings.base) : null;
    const result = checkOutcome({
      issue,
      pr: readOrNull(join(outDir, "pr.md")),
      handback: readOrNull(join(outDir, "handback.md")),
      branch,
      bundleHeads: bundle?.heads ?? null,
      commits: bundle?.commits ?? [],
    });
    writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");
    if (!result.pass) {
      console.log(`::error::#${issue} failed the implement outcome check: ${result.reason}`);
      process.exit(1);
    }
    console.log(`#${issue} implement outcome passed: ${result.kind}, ${result.commits} commit(s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error::${message.split("\n")[0]}`);
    console.error(message);
    process.exit(1);
  }
}
