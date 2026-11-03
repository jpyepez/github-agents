import { describe, expect, test } from "bun:test";
import { execute, type Plan, plan, wipDoc } from "./apply-implement";
import { fakeGh } from "./fake-gh";
import type { OutcomeInputs } from "./implement-outcome";
import { parseSettings } from "./settings";
import { Tracker } from "./tracker";

const branch = "auto/issue-5";
const run = "https://github.com/jp/app/actions/runs/1";
const inputs: OutcomeInputs = {
  issue: 5,
  pr: "# Fix the header\n\nWhat changed.\n\nCloses #5\n",
  handback: null,
  branch,
  bundleHeads: [`refs/heads/${branch}`],
  commits: [{ sha: "abc1234", message: "Fix the header", files: ["src/a.ts"] }],
};

describe("plan", () => {
  test("a finished run with a good pr.md opens the PR", () => {
    expect(plan(inputs, "success", run)).toEqual({ path: "pr", title: "Fix the header", body: "What changed.\n\nCloses #5", commits: 1 });
  });
  test("a hand-back passes through", () => {
    expect(plan({ ...inputs, pr: null, handback: "# Needs copy\n\nPart of issue 5." }, "success", run)).toMatchObject({ path: "handback", commits: 1 });
  });
  test("a run that didn't finish comes back as work in progress, even with a pr.md", () => {
    expect(plan(inputs, "failure", run)).toEqual({
      path: "handback", title: "WIP: issue 5", body: `The Implement run stopped before finishing (failure): ${run}\n\nPart of issue 5.`, commits: 1,
    });
    expect(plan({ ...inputs, pr: null, bundleHeads: null, commits: [] }, "cancelled", run)).toMatchObject({ path: "handback", commits: 0 });
  });
  test("output that breaks a rule stops, even from an unfinished run", () => {
    const bad = { ...inputs, commits: [{ sha: "abc1234", message: "Closes #5", files: ["a.ts"] }] };
    expect(plan(bad, "success", run)).toMatchObject({ path: "stop", reason: expect.stringContaining("closing keyword") });
    expect(plan({ ...bad, pr: null }, "failure", run)).toMatchObject({ path: "stop" });
  });
  test("wipDoc reads as a valid hand-back", () => expect(wipDoc(5, "failure", run)).toStartWith("# WIP: issue 5\n\n"));
});

describe("execute", () => {
  const settings = parseSettings("board: 4\n", {});
  const go = (p: Plan, pr: { number: number; isDraft: boolean; url: string } | null = null, screenshots: string[] = []) => {
    const gh = fakeGh({ number: 5, title: "T", body: "B", labels: ["bug", "ready"] }, { pr });
    const pushes: string[][] = [];
    const log = execute({ plan: p, tracker: new Tracker("jp/app", gh.run), git: (a) => void pushes.push(a), settings, issue: 5, runUrl: run, screenshots });
    return { gh, pushes, log };
  };
  const pr: Plan = { path: "pr", title: "Fix", body: "Closes #5", commits: 1 };
  const handback: Plan = { path: "handback", title: "Needs copy", body: "Part of issue 5.", commits: 1 };

  test("pr: pushes without force, opens the PR and posts screenshots; no hand-off", () => {
    const { gh, pushes } = go(pr, null, ["/tmp/a.png"]);
    expect(pushes).toEqual([["push", "origin", `refs/agent/${branch}:refs/heads/${branch}`]]);
    expect(gh.summary()).toEqual(["pr create", "pr comment"]);
    expect(gh.writes[1]!.args).toContain("42");
    expect(gh.writes[1]!.args).toContain("/tmp/a.png");
  });

  test("pr: updates an earlier draft and marks it ready", () => {
    expect(go(pr, { number: 7, isDraft: true, url: "u" }).gh.summary()).toEqual(["pr edit", "pr ready"]);
  });

  test("handback: pushes, opens a draft PR and hands off", () => {
    const { gh, pushes } = go(handback);
    expect(pushes).toHaveLength(1);
    expect(gh.summary()).toEqual(["pr create", "labels:+ready-for-human-ready", "status:HITL"]);
    expect(gh.writes[0]!.args).toContain("--draft");
    expect(gh.writes[0]!.input).toBe(`Part of issue 5.\n\nRun: ${run}`);
  });

  test("handback with nothing to push comments on the issue instead", () => {
    const { gh, pushes } = go({ ...handback, commits: 0 });
    expect(pushes).toEqual([]);
    expect(gh.summary()).toEqual(["issue comment", "labels:+ready-for-human-ready", "status:HITL"]);
  });

  test("handback turns a ready PR from an earlier run back into a draft", () => {
    expect(go(handback, { number: 7, isDraft: false, url: "u" }).gh.summary()).toEqual(["pr edit", "pr ready", "labels:+ready-for-human-ready", "status:HITL"]);
  });

  test("stop: pushes nothing, says why and hands off", () => {
    const { gh, pushes } = go({ path: "stop", reason: "commit abc1234 changes .github/x" });
    expect(pushes).toEqual([]);
    expect(gh.summary()).toEqual(["issue comment", "labels:+ready-for-human-ready", "status:HITL"]);
    expect(gh.writes[0]!.input).toContain("nothing was pushed: commit abc1234 changes .github/x");
  });
});
