import { describe, expect, test } from "bun:test";
import { parseSettings } from "./settings";
import { labelPlan, NO_READY, RETRY, statusFor, validateTriage, withDisclaimer } from "./triage-outcome";

const settings = parseSettings(null, {});
const spec = "Summary.\n\n## Acceptance criteria\n\n- [ ] It works\n";
const files = (decision: unknown, comment: string | null = "Because.", s: string | null = null) => ({
  decision: decision === null ? null : typeof decision === "string" ? decision : JSON.stringify(decision),
  comment,
  spec: s,
});

describe("validateTriage", () => {
  test("passes a needs-info decision with a comment", () => {
    expect(validateTriage(files({ category: "bug", outcome: "needs-info" }), settings, true)).toEqual({
      pass: true, decision: { category: "bug", outcome: "needs-info", retitle: null }, comment: "Because.", spec: null,
    });
  });

  test("passes ready with a spec, and keeps a retitle", () => {
    const r = validateTriage(files({ category: "enhancement", outcome: "ready", retitle: " New title " }, "Meets the bar.", spec), settings, true);
    expect(r).toMatchObject({ pass: true, decision: { outcome: "ready", retitle: "New title" }, spec: spec.trim() });
  });

  const rejects = (f: ReturnType<typeof files>, reason: string, readyAllowed = true, s = settings) =>
    expect(validateTriage(f, s, readyAllowed)).toEqual({ pass: false, reason: expect.stringContaining(reason), hint: expect.any(String) });

  test("rejects a missing or broken decision.json", () => {
    rejects(files(null), "decision.json is missing");
    rejects(files("{oops"), "isn't valid JSON");
    rejects(files("[1]"), "must be a JSON object");
  });
  test("rejects unknown keys", () => rejects(files({ category: "bug", outcome: "wontfix", labels: ["x"] }), "unknown keys: labels"));
  test("rejects a category the repo doesn't use", () => rejects(files({ category: "chore", outcome: "wontfix" }), "category must be one of bug, enhancement, documentation"));
  test("rejects needs-triage and label strings as outcomes", () => {
    rejects(files({ category: "bug", outcome: "needs-triage" }), "outcome must be one of");
    rejects(files({ category: "bug", outcome: "ready-for-agent" }), "outcome must be one of");
  });
  test("rejects ready when the repo has no ready bar or hand-back list, and says a re-dispatch won't help", () => {
    const r = validateTriage(files({ category: "bug", outcome: "ready" }, "x", spec), settings, false);
    expect(r).toMatchObject({ pass: false, reason: expect.stringContaining("may not apply it"), hint: NO_READY });
    expect(NO_READY).toContain("Re-dispatching won't help");
  });
  test("asks for a re-dispatch for any other failure", () => {
    expect(validateTriage(files(null), settings, true)).toMatchObject({ hint: RETRY });
  });
  test("rejects a retitle on two lines", () => rejects(files({ category: "bug", outcome: "wontfix", retitle: "a\nb" }), "retitle must be one line"));
  test("rejects an empty comment", () => rejects(files({ category: "bug", outcome: "wontfix" }, "  \n"), "comment.md is missing or empty"));
  test("rejects ready without a spec, or with one that has no checklist", () => {
    rejects(files({ category: "bug", outcome: "ready" }), "spec.md is missing or empty");
    rejects(files({ category: "bug", outcome: "ready" }, "x", "Just prose."), "no acceptance criteria");
  });
  test("rejects a spec for any outcome but ready", () => rejects(files({ category: "bug", outcome: "wontfix" }, "x", spec), "spec.md is only for ready"));
  test("rejects an over-long comment", () => rejects(files({ category: "bug", outcome: "wontfix" }, "x".repeat(60001)), "longer than 60000"));
});

describe("labelPlan", () => {
  test("adds the category and outcome and removes needs-triage and stale ones", () => {
    expect(labelPlan({ category: "bug", outcome: "ready", retitle: null }, ["needs-triage", "enhancement", "needs-info", "notes-x"], settings)).toEqual({
      add: ["bug", "ready"], remove: ["needs-triage", "enhancement", "needs-info"],
    });
  });
  test("leaves labels that are already right", () => {
    expect(labelPlan({ category: "bug", outcome: "wontfix", retitle: null }, ["bug", "wontfix"], settings)).toEqual({ add: [], remove: [] });
  });
  test("uses the repo's names for renamed roles", () => {
    const renamed = parseSettings("labels: { ready: go, needs-triage: inbox }\n", {});
    expect(labelPlan({ category: "bug", outcome: "ready", retitle: null }, ["inbox"], renamed)).toEqual({ add: ["bug", "go"], remove: ["inbox"] });
  });
});

describe("statusFor", () => {
  test("sends everything but ready to HITL", () => {
    expect(statusFor("needs-info", false)).toBe("hitl");
    expect(statusFor("wontfix", true)).toBe("hitl");
  });
  test("sends ready to Ready, unless someone already claimed it", () => {
    expect(statusFor("ready", false)).toBe("ready");
    expect(statusFor("ready", true)).toBeNull();
  });
});

test("withDisclaimer puts the disclaimer and a blank line on top", () => {
  expect(withDisclaimer("  Reasons.\n")).toBe("> *This was generated by AI during triage.*\n\nReasons.\n");
});
