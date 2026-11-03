/// <reference types="bun" />
// The `prepare` job's script, after settings.ts and check.ts. It decides whether the run
// goes ahead, claims the issue (implement), and writes what the agent works from:
//
//   issue.md         the issue and only the owner's comments (docs/design.md, privilege split)
//   context.json     what the prompt needs: readyAllowed, labels, categories, checks, …
//   open-issues.json the owner's open issues, for duplicates (triage)
//
//   bun scripts/prepare.ts <triage|implement> <settings.json> <check.json> <out-dir>
//
// Env: ISSUE, LABEL (implement: the label that started the run), OWNER (the repo owner),
// GITHUB_EVENT_NAME, GITHUB_REPOSITORY, GH_TOKEN (OWNER_PAT) and GITHUB_OUTPUT.
// Outputs: go, and when go is true: turns, minutes (the claude step), job_minutes, endpoints, branch, base, browser, install,
// author_name and author_email.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setStatus } from "./board-status";
import type { CheckResult } from "./check";
import { endpoints } from "./egress";
import { busyRun } from "./runs";
import { isSkipped, type Settings } from "./settings";
import { type Comment, type Issue, Tracker } from "./tracker";
import { OUTCOMES } from "./triage-outcome";

export type Flow = "triage" | "implement";

// Why the run skips, or null to go ahead. A skipped run changes nothing.
export function triageSkip(o: { issue: Issue; settings: Settings; owner: string; event: string }): string | null {
  const { issue, settings, owner, event } = o;
  // Someone else's issue: triaging it would spend the owner's budget on their text.
  if (issue.author !== owner) return `opened by ${issue.author}, not the owner`;
  // A closed issue is done: re-triaging it would move its card off Done.
  if (issue.state !== "OPEN") return "closed";
  if (isSkipped(settings, issue.labels)) return "has a skip label";
  // Opened already triaged (say, a ticket a session filed as ready): don't second-guess it.
  // A manual run still re-triages.
  const outcomes = OUTCOMES.map((r) => settings.labels[r]);
  if (event !== "workflow_dispatch" && issue.labels.some((l) => outcomes.includes(l))) return "opened with an outcome label";
  return null;
}

export function implementSkip(o: {
  issue: Issue; settings: Settings; check: CheckResult; owner: string; event: string; label: string; subIssues: number;
}): string | null {
  const { issue, settings, owner, event, label } = o;
  const ready = settings.labels.ready;
  // The caller starts a run on every label event by the owner; only the ready label builds.
  if (event === "issues" && label !== ready) return `the label was ${label || "none"}, not ${ready}`;
  if (settings.automation !== "implement") return "automation is triage in agents.yml";
  if (!o.check.readyAllowed) return "the repo has no ready bar or hand-back list";
  if (issue.author !== owner) return `opened by ${issue.author}, not the owner`;
  if (issue.state !== "OPEN") return "closed";
  // Read now, not from the event: the run may have queued.
  if (!issue.labels.includes(ready)) return `no longer labelled ${ready}`;
  if (isSkipped(settings, issue.labels)) return "has a skip label";
  if (o.subIssues > 0) return "a spec parent, with sub-issues";
  return null;
}

// The cap is the claude step's own timeout. The job gets 10 more minutes, so the steps
// after it (the bundle and the upload) still run when the agent times out.
export function timeouts(minutes: number): { minutes: number; job_minutes: number } {
  return { minutes, job_minutes: minutes + 10 };
}

export function busyComment(settings: Settings): string {
  return `A build for this issue is already running; label \`${settings.labels.ready}\` again after it finishes.`;
}

export function ownerComments(comments: Comment[], owner: string): Comment[] {
  return comments.filter((c) => c.author === owner);
}

// Everything the agent may read about the issue. Others' comments are left out on purpose.
export function issueFile(issue: Issue, comments: Comment[]): string {
  const parts = [
    `# Issue ${issue.number}: ${issue.title}`,
    "",
    `Labels: ${issue.labels.join(", ") || "none"}`,
    "",
    "## Body",
    "",
    issue.body.trim() || "(empty)",
  ];
  for (const c of comments) parts.push("", `## Comment ${c.id} by the owner`, "", c.body.trim() || "(empty)");
  return parts.join("\n") + "\n";
}

export function context(flow: Flow, issue: Issue, settings: Settings, check: CheckResult) {
  return {
    flow,
    issue: issue.number,
    readyAllowed: check.readyAllowed,
    hasReadyBar: check.hasReadyBar,
    hasHandBack: check.hasHandBack,
    commitStyle: check.commitStyle,
    categories: settings.categories,
    labels: settings.labels,
    checks: settings.checks,
    browser: settings.browser,
    base: settings.base,
    branch: `${settings.branch_prefix}${issue.number}`,
  };
}

function output(values: Record<string, string>): void {
  const file = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(values).map(([k, v]) => {
    if (v.includes("\n")) throw new Error(`Output ${k} must be one line.`);
    return `${k}=${v}`;
  });
  if (file) appendFileSync(file, lines.join("\n") + "\n");
  else console.log(lines.join("\n"));
}

if (import.meta.main) {
  const [flowArg = "", settingsPath = "", checkPath = "", outDir = ""] = process.argv.slice(2);
  try {
    if ((flowArg !== "triage" && flowArg !== "implement") || !settingsPath || !checkPath || !outDir) {
      throw new Error("Usage: bun scripts/prepare.ts <triage|implement> <settings.json> <check.json> <out-dir>");
    }
    const flow = flowArg as Flow;
    const env = process.env;
    const number = Number(env.ISSUE);
    if (!Number.isInteger(number) || number < 1) throw new Error(`ISSUE must be an issue number, got "${env.ISSUE}"`);
    const repo = env.GITHUB_REPOSITORY ?? "";
    const owner = env.OWNER ?? "";
    if (!owner) throw new Error("OWNER isn't set.");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
    const check = JSON.parse(readFileSync(checkPath, "utf8")) as CheckResult;
    const tracker = new Tracker(repo);
    const issue = tracker.issue(number);
    const event = env.GITHUB_EVENT_NAME ?? "";

    const skip =
      flow === "triage"
        ? triageSkip({ issue, settings, owner, event })
        : implementSkip({ issue, settings, check, owner, event, label: env.LABEL ?? "", subIssues: tracker.subIssueCount(number) });
    console.log(`#${number} by ${issue.author}, ${issue.state}, labels: ${issue.labels.join(", ") || "none"}`);
    if (skip) {
      console.log(`Skipped: ${skip}.`);
      output({ go: "false" });
      process.exit(0);
    }

    // Another run for this issue already has its agent or apply job queued or running.
    const other = busyRun(tracker, flow, number, Number(env.GITHUB_RUN_ID));
    if (other !== null) {
      if (flow === "implement") tracker.comment(number, busyComment(settings));
      console.log(`::notice::Skipped: run ${other} is already working on #${number}.`);
      output({ go: "false" });
      process.exit(0);
    }

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "issue.md"), issueFile(issue, ownerComments(tracker.comments(number), owner)));
    writeFileSync(join(outDir, "context.json"), JSON.stringify(context(flow, issue, settings, check), null, 2) + "\n");
    if (flow === "triage") {
      const list = tracker.openIssuesBy(owner).filter((i) => i.number !== number);
      writeFileSync(join(outDir, "open-issues.json"), JSON.stringify(list, null, 2) + "\n");
    }

    // Commits are the owner's, through their noreply address.
    let author_email = `${owner}@users.noreply.github.com`;
    if (flow === "implement") {
      // The claim: the only move to In progress (docs/design.md, "Board").
      tracker.assign(number, owner);
      const column = setStatus(tracker, settings, number, "in_progress");
      console.log(column ? `#${number} claimed → ${column}` : `#${number} claimed`);
      author_email = `${tracker.userId(owner)}+${owner}@users.noreply.github.com`;
    }

    const caps = settings.caps[flow];
    output({
      go: "true",
      turns: String(caps.turns),
      minutes: String(timeouts(caps.minutes).minutes),
      job_minutes: String(timeouts(caps.minutes).job_minutes),
      endpoints: endpoints(settings, flow),
      branch: `${settings.branch_prefix}${number}`,
      base: settings.base,
      browser: String(flow === "implement" && settings.browser),
      install: settings.install,
      author_name: owner,
      author_email,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error::${message.split("\n")[0]}`);
    console.error(message);
    process.exit(1);
  }
}
