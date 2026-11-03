import { describe, expect, test } from "bun:test";
import { applyTriage, originalBody, originalNote } from "./apply-triage";
import { fakeGh } from "./fake-gh";
import { parseSettings } from "./settings";
import { Tracker } from "./tracker";
import { DISCLAIMER } from "./triage-outcome";

const settings = parseSettings("board: 4\n", {});
const note = { id: 9, author: "jp", body: `${DISCLAIMER}\n\nOriginal note:\n\nThe rough idea.` };

describe("originalNote", () => {
  test("finds the owner's Original note comment and its body", () => {
    expect(originalNote([{ id: 1, author: "jp", body: `${DISCLAIMER}\n\nReasons.` }, note], "jp")).toEqual(note);
    expect(originalBody(note)).toBe("The rough idea.");
    expect(originalNote([{ ...note, author: "stranger" }], "jp")).toBeNull();
  });
});

describe("applyTriage", () => {
  test("for ready: keeps the original, writes the spec, comments, labels last, then Status", () => {
    const gh = fakeGh({ number: 5, title: "Old", body: "The rough idea.", labels: ["needs-triage"] });
    applyTriage({
      tracker: new Tracker("jp/app", gh.run), settings, issue: 5, owner: "jp",
      decision: { category: "bug", outcome: "ready", retitle: "New" }, comment: "Meets the bar.", spec: "Spec.\n\n- [ ] Works",
    });
    expect(gh.summary()).toEqual(["issue comment", "body", "title:New", "issue comment", "labels:+bug,ready-needs-triage", "status:Ready"]);
    expect(gh.writes[0]!.input).toBe(`${DISCLAIMER}\n\nOriginal note:\n\nThe rough idea.\n`);
    expect(gh.writes[1]!.input).toBe(`${DISCLAIMER}\n\nSpec.\n\n- [ ] Works\n`);
    expect(gh.writes[3]!.input).toBe(`${DISCLAIMER}\n\nMeets the bar.\n`);
  });

  test("a ready re-triage doesn't post a second Original note", () => {
    const gh = fakeGh({ number: 5, title: "T", body: "old spec", labels: ["bug", "ready"], comments: [note] });
    applyTriage({
      tracker: new Tracker("jp/app", gh.run), settings, issue: 5, owner: "jp",
      decision: { category: "bug", outcome: "ready", retitle: null }, comment: "Still ready.", spec: "Spec v2.\n\n- [ ] Works",
    });
    expect(gh.summary()).toEqual(["body", "issue comment", "status:Ready"]);
  });

  test("a re-triage away from ready restores the original body", () => {
    const gh = fakeGh({ number: 5, title: "T", body: "old spec", labels: ["bug", "ready"], comments: [note] });
    applyTriage({
      tracker: new Tracker("jp/app", gh.run), settings, issue: 5, owner: "jp",
      decision: { category: "bug", outcome: "needs-info", retitle: null }, comment: "Questions.", spec: null,
    });
    expect(gh.summary()).toEqual(["body", "issue comment", "labels:+needs-info-ready", "status:HITL"]);
    expect(gh.writes[0]!.input).toBe("The rough idea.");
  });

  test("leaves the Status alone for a claimed ready issue, and skips it without a board", () => {
    const claimed = fakeGh({ number: 5, title: "T", body: "B", assignees: ["jp"] });
    applyTriage({
      tracker: new Tracker("jp/app", claimed.run), settings, issue: 5, owner: "jp",
      decision: { category: "bug", outcome: "ready", retitle: null }, comment: "x", spec: "- [ ] y",
    });
    expect(claimed.summary().some((s) => s.startsWith("status:"))).toBe(false);
    const noBoard = fakeGh({ number: 5, title: "T", body: "B" });
    const log = applyTriage({
      tracker: new Tracker("jp/app", noBoard.run), settings: parseSettings(null, {}), issue: 5, owner: "jp",
      decision: { category: "bug", outcome: "wontfix", retitle: null }, comment: "Dup of issue 3.", spec: null,
    });
    expect(log).toContain("no board, Status skipped");
  });
});
