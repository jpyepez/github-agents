import { describe, expect, test } from "bun:test";
import { type CheckInputs, runChecks } from "./check";
import { parseSettings } from "./settings";

const tracker = "# Issue tracker: GitHub\n\n## Hand-back list\n\n- Anything under `.github/`\n";
const labels = "# Triage Labels\n\n## The `ready` bar\n\n- Small.\n";
const repoLabels = ["needs-triage", "needs-info", "ready", "ready-for-human", "wontfix", "bug", "enhancement", "documentation"];

function inputs(over: Partial<CheckInputs> = {}, yaml: string | null = null): CheckInputs {
  return {
    settings: parseSettings(yaml, {}),
    secretLengths: { OWNER_PAT: 40, CLAUDE_CODE_OAUTH_TOKEN: 108 },
    repoLabels,
    boardColumns: null,
    files: { triageLabels: labels, issueTracker: tracker, gitWorkflow: true },
    ...over,
  };
}

describe("runChecks", () => {
  test("passes a fully set-up repo with no board", () => {
    const r = runChecks(inputs());
    expect(r.ok).toBe(true);
    expect(r.readyAllowed).toBe(true);
    expect(r.commitStyle).toBe("doc");
    expect(r.board).toBeNull();
    expect(r.notices).toEqual(["No board in agents.yml: Status updates are skipped."]);
  });

  test("fails on a missing or empty secret, naming it", () => {
    const r = runChecks(inputs({ secretLengths: { OWNER_PAT: 40, CLAUDE_CODE_OAUTH_TOKEN: 0 } }));
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual(["The secret CLAUDE_CODE_OAUTH_TOKEN is missing or empty. Set it with: gh secret set CLAUDE_CODE_OAUTH_TOKEN"]);
    expect(runChecks(inputs({ secretLengths: {} })).failures).toHaveLength(2);
  });

  test("fails on missing labels, listing them, and honours renamed ones", () => {
    const r = runChecks(inputs({}, "labels: { ready: go }\ncategories: [bug, chore]\n"));
    expect(r.failures).toEqual(["The repo is missing these labels: go, chore. Create them with gh label create."]);
  });

  test("fails without the GitHub tracker doc, or with another tracker", () => {
    expect(runChecks(inputs({ files: { triageLabels: labels, issueTracker: null, gitWorkflow: true } })).failures[0]).toContain(
      "docs/agents/issue-tracker.md is missing",
    );
    expect(runChecks(inputs({ files: { triageLabels: labels, issueTracker: "# Issue tracker: Local Markdown\n", gitWorkflow: true } })).failures[0]).toContain(
      "isn't the GitHub tracker",
    );
  });

  test("never allows ready without a ready bar or without a hand-back list", () => {
    const noBar = runChecks(inputs({ files: { triageLabels: "# Triage Labels\n", issueTracker: tracker, gitWorkflow: true } }));
    expect(noBar.ok).toBe(true);
    expect(noBar.readyAllowed).toBe(false);
    const noList = runChecks(inputs({ files: { triageLabels: labels, issueTracker: "# Issue tracker: GitHub\n", gitWorkflow: true } }));
    expect(noList.readyAllowed).toBe(false);
    expect(noList.hasReadyBar).toBe(true);
    expect(noList.notices.some((n) => n.includes("No hand-back list"))).toBe(true);
  });

  test("finds the ready bar under a renamed ready label", () => {
    const r = runChecks(inputs({ files: { triageLabels: "## The `go` bar\n", issueTracker: tracker, gitWorkflow: true } }, "labels: { ready: go }\n"));
    expect(r.hasReadyBar).toBe(true);
  });

  test("uses plain sentences without docs/git-workflow.md", () => {
    expect(runChecks(inputs({ files: { triageLabels: labels, issueTracker: tracker, gitWorkflow: false } })).commitStyle).toBe("plain");
  });

  test("checks a configured board has every column, case-insensitively", () => {
    const ok = runChecks(inputs({ boardColumns: ["inbox", "HITL", "Ready", "In Progress", "Done"] }, "board: 4\n"));
    expect(ok.ok).toBe(true);
    expect(ok.board).toBe(4);
    const missing = runChecks(inputs({ boardColumns: ["Todo", "In Progress", "Done"] }, "board: 4\n"));
    expect(missing.failures).toEqual(["Board 4 has no column named Inbox, HITL, Ready. Its columns: Todo, In Progress, Done."]);
  });

  test("fails when a configured board can't be read", () => {
    const r = runChecks(inputs({ boardColumns: { error: "Could not resolve to a ProjectV2" } }, "board: 9\n"));
    expect(r.failures).toEqual(["Board 9 from agents.yml can't be used: Could not resolve to a ProjectV2"]);
    expect(r.board).toBeNull();
  });
});
