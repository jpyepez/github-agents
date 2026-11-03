// Decisions about the engine's own Actions runs (docs/design.md, "Concurrency").
//
//   busy:          prepare skips when another run for the same issue already has its agent
//                  or apply job queued or running. A second `ready` during a build is
//                  ignored with a comment, not queued: a queued build could branch before
//                  the first one's apply pushes.
//   neverStarted:  apply writes nothing when this run's agent job never started, as when a
//                  newer run for the issue replaced it in the concurrency queue. A job that
//                  started and then timed out or failed still hands off.

import type { Job, Tracker, WorkflowRun } from "./tracker";

export const runTitle = (flow: "triage" | "implement", issue: number) =>
  `${flow === "triage" ? "Triage" : "Implement"} issue ${issue}`;

// The engine's jobs show as "<caller job> / agent" in a consumer's run.
export const isJob = (job: Job, name: "agent" | "apply") => job.name === name || job.name.endsWith(` / ${name}`);

const ACTIVE = ["queued", "in_progress", "waiting", "pending", "requested"];

export function busy(runs: WorkflowRun[], jobsOf: (id: number) => Job[], title: string, self: number): number | null {
  for (const run of runs) {
    if (run.id === self || run.title !== title) continue;
    if (jobsOf(run.id).some((j) => (isJob(j, "agent") || isJob(j, "apply")) && ACTIVE.includes(j.status))) return run.id;
  }
  return null;
}

export function neverStarted(jobs: Job[]): boolean {
  const agent = jobs.find((j) => isJob(j, "agent"));
  return agent !== undefined && agent.startedSteps === 0;
}

// For the CLIs: the other busy run for this issue, if any.
export function busyRun(tracker: Tracker, flow: "triage" | "implement", issue: number, self: number): number | null {
  return busy(tracker.unfinishedRuns(), (id) => tracker.runJobs(id), runTitle(flow, issue), self);
}

export function agentNeverStarted(tracker: Tracker, runId: number, attempt: number): boolean {
  return neverStarted(tracker.runJobs(runId, attempt));
}
