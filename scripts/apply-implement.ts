/// <reference types="bun" />
// The implement `apply` job: checks the agent's output with implement-outcome.ts, then
// makes every write. One of three paths:
//
//   pr        the agent finished and pr.md passed: push the branch, open the PR (or update
//             the draft an earlier run left and mark it ready), post the screenshots.
//   handback  the agent wrote handback.md, or stopped early with commits that pass the
//             rules: push them, open or update a draft PR (or comment on the issue when
//             nothing was pushed), then hand off to the owner.
//   stop      the output failed the check: push nothing, comment why, hand off, and fail
//             the job.
//
// Handing off swaps `ready` for `ready-for-human` and sets Status to HITL. Relabelling
// `ready` retries.
//
//   bun scripts/apply-implement.ts <prepare-dir> <agent-dir>
//
// Run inside the consumer repo's clone, with origin/<base> and the branch fetched.
// Env: AGENT_RESULT, RUN_URL, GITHUB_REPOSITORY, GH_TOKEN (OWNER_PAT).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setStatus } from "./board-status";
import { checkOutcome, type Outcome, type OutcomeInputs, readBundle } from "./implement-outcome";
import type { Settings } from "./settings";
import { type PullRequest, Tracker } from "./tracker";

export type Plan =
  | { path: "pr"; title: string; body: string; commits: number }
  | { path: "handback"; title: string; body: string; commits: number }
  | { path: "stop"; reason: string };

// Stands in for handback.md when the agent stopped before writing either file.
export function wipDoc(issue: number, agentResult: string, runUrl: string): string {
  return `# WIP: issue ${issue}\n\nThe Implement run stopped before finishing (${agentResult}): ${runUrl}\n\nPart of issue ${issue}.\n`;
}

export function plan(inputs: OutcomeInputs, agentResult: string, runUrl: string): Plan {
  const hasDocs = inputs.pr !== null || inputs.handback !== null;
  // A run that didn't finish can't vouch for its pr.md, so it comes back as work in progress.
  const finished = agentResult === "success" && hasDocs;
  const checked: Outcome = finished
    ? checkOutcome(inputs)
    : checkOutcome({ ...inputs, pr: null, handback: wipDoc(inputs.issue, agentResult, runUrl) });
  if (!checked.pass) return { path: "stop", reason: checked.reason };
  return { path: checked.kind, title: checked.title, body: checked.body, commits: checked.commits };
}

export type Git = (args: string[]) => void;

export const git: Git = (args) => {
  const proc = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args[0]} failed:\n${proc.stderr.toString().trim()}`);
};

export function execute(o: {
  plan: Plan;
  tracker: Tracker;
  git: Git;
  settings: Settings;
  issue: number;
  runUrl: string;
  screenshots: string[];
}): string[] {
  const { plan: p, tracker, settings, issue } = o;
  const branch = `${settings.branch_prefix}${issue}`;
  const log: string[] = [];
  const existing: PullRequest | null = tracker.openPr(branch);

  const push = () => {
    // Not forced: the agent built on top of origin/<branch>, if there was one.
    o.git(["push", "origin", `refs/agent/${branch}:refs/heads/${branch}`]);
    log.push(`pushed ${branch}`);
  };
  const handOff = () => {
    tracker.editLabels(issue, [settings.labels["ready-for-human"]], [settings.labels.ready]);
    const name = setStatus(tracker, settings, issue, "hitl");
    log.push(`handed off: ${settings.labels.ready} → ${settings.labels["ready-for-human"]}${name ? `, Status → ${name}` : ""}`);
  };

  if (p.path === "pr") {
    push();
    let number: number;
    if (existing) {
      tracker.editPr(existing.number, p.title, p.body);
      if (existing.isDraft) tracker.setPrReady(existing.number, true);
      number = existing.number;
      log.push(`updated PR #${number} and marked it ready`);
    } else {
      const url = tracker.createPr({ base: settings.base, head: branch, title: p.title, body: p.body, draft: false });
      number = Number(url.split("/").pop());
      log.push(`opened ${url}`);
    }
    if (o.screenshots.length) {
      tracker.commentPr(number, "Screenshots from the headless browser walk in CI.", o.screenshots);
      log.push(`posted ${o.screenshots.length} screenshot(s)`);
    }
    return log;
  }

  if (p.path === "handback") {
    if (p.commits > 0) push();
    const body = `${p.body}\n\nRun: ${o.runUrl}`;
    if (existing) {
      tracker.editPr(existing.number, p.title, body);
      if (!existing.isDraft) tracker.setPrReady(existing.number, false);
      log.push(`updated draft PR #${existing.number}`);
    } else if (p.commits > 0) {
      log.push(`opened draft ${tracker.createPr({ base: settings.base, head: branch, title: p.title, body, draft: true })}`);
    } else {
      tracker.comment(issue, `**${p.title}**\n\n${body}`);
      log.push("nothing to push, so commented on the issue");
    }
    handOff();
    return log;
  }

  tracker.comment(issue, `The Implement run's output failed the check, so nothing was pushed: ${p.reason}.\n\nRun: ${o.runUrl}`);
  if (existing && !existing.isDraft) tracker.setPrReady(existing.number, false);
  log.push(`stopped: ${p.reason}`);
  handOff();
  return log;
}

function readOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

if (import.meta.main) {
  const [prepareDir = "", agentDir = ""] = process.argv.slice(2);
  try {
    if (!prepareDir || !agentDir) throw new Error("Usage: bun scripts/apply-implement.ts <prepare-dir> <agent-dir>");
    const env = process.env;
    const settings = JSON.parse(readFileSync(join(prepareDir, "settings.json"), "utf8")) as Settings;
    const { issue } = JSON.parse(readFileSync(join(prepareDir, "context.json"), "utf8")) as { issue: number };
    const branch = `${settings.branch_prefix}${issue}`;
    const runUrl = env.RUN_URL ?? "";
    const agentResult = env.AGENT_RESULT || "unknown";

    const bundlePath = join(agentDir, "commits.bundle");
    const bundle = existsSync(bundlePath) ? readBundle(process.cwd(), bundlePath, branch, settings.base) : null;
    const shotsDir = join(agentDir, "screenshots");
    const screenshots = existsSync(shotsDir)
      ? readdirSync(shotsDir).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f)).sort().slice(0, 10).map((f) => join(shotsDir, f))
      : [];

    const p = plan(
      {
        issue,
        pr: readOrNull(join(agentDir, "pr.md")),
        handback: readOrNull(join(agentDir, "handback.md")),
        branch,
        bundleHeads: bundle?.heads ?? null,
        commits: bundle?.commits ?? [],
      },
      agentResult,
      runUrl,
    );
    const log = execute({ plan: p, tracker: new Tracker(env.GITHUB_REPOSITORY ?? ""), git, settings, issue, runUrl, screenshots });
    for (const line of log) console.log(`#${issue} ${line}`);
    if (p.path === "stop") {
      console.log(`::error::#${issue} failed the implement outcome check: ${p.reason}`);
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error::${message.split("\n")[0]}`);
    console.error(message);
    process.exit(1);
  }
}
