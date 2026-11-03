/// <reference types="bun" />
// Runs in `apply` only when the output scan found the OAuth token. It publishes none of the
// agent's output: it posts a fixed comment written here, then moves the issue to HITL so it
// doesn't sit in In progress looking like a running build. For implement it also swaps
// `ready` for `ready-for-human`, like any other hand-off.
//
//   bun scripts/safety-stop.ts <triage|implement> <prepare-dir>
//
// Env: RUN_URL, GITHUB_REPOSITORY, GH_TOKEN (OWNER_PAT). Never the OAuth token.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setStatus } from "./board-status";
import type { Settings } from "./settings";
import { Tracker } from "./tracker";

export function safetyComment(runUrl: string): string {
  return `This run failed a safety check and wrote nothing. See ${runUrl}`;
}

export function safetyStop(o: { tracker: Tracker; settings: Settings; flow: "triage" | "implement"; issue: number; runUrl: string }): string[] {
  const { tracker, settings, issue } = o;
  const log: string[] = [];
  tracker.comment(issue, safetyComment(o.runUrl));
  log.push("posted the safety-check comment");
  if (o.flow === "implement") {
    tracker.editLabels(issue, [settings.labels["ready-for-human"]], [settings.labels.ready]);
    log.push(`${settings.labels.ready} → ${settings.labels["ready-for-human"]}`);
  }
  const name = setStatus(tracker, settings, issue, "hitl");
  log.push(name === null ? "no board, Status skipped" : `Status → ${name}`);
  return log;
}

if (import.meta.main) {
  const [flow = "", prepareDir = ""] = process.argv.slice(2);
  try {
    if ((flow !== "triage" && flow !== "implement") || !prepareDir) {
      throw new Error("Usage: bun scripts/safety-stop.ts <triage|implement> <prepare-dir>");
    }
    const settings = JSON.parse(readFileSync(join(prepareDir, "settings.json"), "utf8")) as Settings;
    const { issue } = JSON.parse(readFileSync(join(prepareDir, "context.json"), "utf8")) as { issue: number };
    const log = safetyStop({ tracker: new Tracker(process.env.GITHUB_REPOSITORY ?? ""), settings, flow, issue, runUrl: process.env.RUN_URL ?? "" });
    for (const line of log) console.log(`#${issue} ${line}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error::${message.split("\n")[0]}`);
    console.error(message);
    process.exit(1);
  }
}
