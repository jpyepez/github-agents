/// <reference types="bun" />
// The triage `apply` job: checks the agent's files with triage-outcome.ts, then makes
// every write, in this order (docs/design.md, privilege split):
//
//   1. for `ready`: post the original body as an `Original note:` comment (once), then
//      replace the body with the spec. For any other outcome, if an `Original note:`
//      comment exists, restore the body from it, since the spec no longer applies.
//   2. retitle, if the decision asks
//   3. post the reasons comment
//   4. labels, last and in one edit, so nothing sees `ready` before the spec is written
//   5. the board Status
//
//   bun scripts/apply-triage.ts <prepare-dir> <agent-dir>
//
// Env: AGENT_RESULT (the agent job's result), OWNER, GITHUB_REPOSITORY, GH_TOKEN (OWNER_PAT).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setStatus } from "./board-status";
import type { CheckResult } from "./check";
import type { Settings } from "./settings";
import { agentNeverStarted } from "./runs";
import { type Comment, Tracker } from "./tracker";
import { DISCLAIMER, labelPlan, statusFor, type TriageDecision, validateTriage, withDisclaimer } from "./triage-outcome";

const ORIGINAL = "Original note:";

// The owner's `Original note:` comment from an earlier `ready` triage, if any.
export function originalNote(comments: Comment[], owner: string): Comment | null {
  return (
    comments.find((c) => {
      if (c.author !== owner) return false;
      const body = c.body.trimStart();
      return body.startsWith(DISCLAIMER) && body.slice(DISCLAIMER.length).trimStart().startsWith(ORIGINAL);
    }) ?? null
  );
}

// The original body inside an `Original note:` comment.
export function originalBody(note: Comment): string {
  const rest = note.body.trimStart().slice(DISCLAIMER.length).trimStart().slice(ORIGINAL.length);
  return rest.trim();
}

const EMPTY_BODY = "_No description._";

export function applyTriage(o: {
  tracker: Tracker;
  settings: Settings;
  issue: number;
  owner: string;
  decision: TriageDecision;
  comment: string;
  spec: string | null;
}): string[] {
  const { tracker, settings, issue: n, owner, decision } = o;
  const log: string[] = [];
  const issue = tracker.issue(n);
  const note = originalNote(tracker.comments(n), owner);

  if (decision.outcome === "ready" && o.spec !== null) {
    if (note === null) {
      tracker.comment(n, withDisclaimer(`${ORIGINAL}\n\n${issue.body.trim() || EMPTY_BODY}`));
      log.push("posted the original body as an Original note comment");
    }
    tracker.editBody(n, withDisclaimer(o.spec));
    log.push("replaced the body with the spec");
  } else if (note !== null) {
    tracker.editBody(n, originalBody(note) || EMPTY_BODY);
    log.push("restored the body from the Original note comment");
  }

  if (decision.retitle && decision.retitle !== issue.title) {
    tracker.editTitle(n, decision.retitle);
    log.push(`retitled to "${decision.retitle}"`);
  }

  tracker.comment(n, withDisclaimer(o.comment));
  log.push("posted the triage comment");

  const labels = labelPlan(decision, issue.labels, settings);
  tracker.editLabels(n, labels.add, labels.remove);
  log.push(`labels: +${labels.add.join(",") || "none"} -${labels.remove.join(",") || "none"}`);

  const column = statusFor(decision.outcome, issue.assignees.length > 0);
  if (column === null) log.push("assigned, so Status left alone");
  else {
    const name = setStatus(tracker, settings, n, column);
    log.push(name === null ? "no board, Status skipped" : `Status → ${name}`);
  }
  return log;
}

function readOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

if (import.meta.main) {
  const [prepareDir = "", agentDir = ""] = process.argv.slice(2);
  try {
    if (!prepareDir || !agentDir) throw new Error("Usage: bun scripts/apply-triage.ts <prepare-dir> <agent-dir>");
    const env = process.env;
    const settings = JSON.parse(readFileSync(join(prepareDir, "settings.json"), "utf8")) as Settings;
    const check = JSON.parse(readFileSync(join(prepareDir, "check.json"), "utf8")) as CheckResult;
    const { issue } = JSON.parse(readFileSync(join(prepareDir, "context.json"), "utf8")) as { issue: number };
    // A newer run for the issue replaced this one before its agent started: nothing to do.
    if (env.AGENT_RESULT !== "success" && agentNeverStarted(new Tracker(env.GITHUB_REPOSITORY ?? ""), Number(env.GITHUB_RUN_ID), Number(env.GITHUB_RUN_ATTEMPT || 1))) {
      console.log(`::notice::#${issue}: the agent job never started (${env.AGENT_RESULT || "unknown"}), so nothing was written.`);
      process.exit(0);
    }
    if (env.AGENT_RESULT !== "success") {
      console.log(`::error::#${issue}: the triage agent didn't finish (${env.AGENT_RESULT || "unknown"}). Nothing was written; re-dispatch Triage.`);
      process.exit(1);
    }
    const result = validateTriage(
      {
        decision: readOrNull(join(agentDir, "decision.json")),
        comment: readOrNull(join(agentDir, "comment.md")),
        spec: readOrNull(join(agentDir, "spec.md")),
      },
      settings,
      check.readyAllowed,
    );
    if (!result.pass) {
      console.log(`::error::#${issue} failed the triage outcome check: ${result.reason}. ${result.hint}`);
      process.exit(1);
    }
    const log = applyTriage({
      tracker: new Tracker(env.GITHUB_REPOSITORY ?? ""),
      settings,
      issue,
      owner: env.OWNER ?? "",
      decision: result.decision,
      comment: result.comment,
      spec: result.spec,
    });
    console.log(`#${issue} triaged: ${result.decision.category}, ${result.decision.outcome}`);
    for (const line of log) console.log(`  ${line}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error::${message.split("\n")[0]}`);
    console.error(message);
    process.exit(1);
  }
}
