import { describe, expect, test } from "bun:test";
import { type Run, Tracker } from "./tracker";

// A fake gh: records every call and answers from a table keyed by the first two args.
function fake(answers: Record<string, string> = {}) {
  const calls: { args: string[]; input?: string }[] = [];
  const run: Run = (args, input) => {
    calls.push({ args, input });
    return answers[args.slice(0, 2).join(" ")] ?? "";
  };
  return { calls, run };
}

describe("Tracker", () => {
  test("rejects a repo that isn't owner/name", () => {
    expect(() => new Tracker("nope")).toThrow('Not an owner/name repo: "nope"');
  });

  test("reads an issue into plain fields", () => {
    const { run } = fake({
      "issue view": JSON.stringify({
        number: 7, title: "T", body: "B", state: "OPEN",
        author: { login: "jp" }, labels: [{ name: "bug" }], assignees: [{ login: "jp" }],
      }),
    });
    expect(new Tracker("jp/app", run).issue(7)).toEqual({
      number: 7, title: "T", body: "B", state: "OPEN", author: "jp", labels: ["bug"], assignees: ["jp"],
    });
  });

  test("flattens every page of comments", () => {
    const { run, calls } = fake({
      "api --paginate": JSON.stringify([[{ id: 1, user: { login: "a" }, body: "x" }], [{ id: 2, user: null, body: null }]]),
    });
    expect(new Tracker("jp/app", run).comments(3)).toEqual([
      { id: 1, author: "a", body: "x" },
      { id: 2, author: "", body: "" },
    ]);
    expect(calls[0]!.args).toContain("repos/jp/app/issues/3/comments?per_page=100");
  });

  test("sets labels in one edit, and skips an empty one", () => {
    const { run, calls } = fake();
    const t = new Tracker("jp/app", run);
    t.editLabels(5, ["bug", "ready"], ["needs-triage"]);
    t.editLabels(5, [], []);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["issue", "edit", "5", "--repo", "jp/app", "--add-label", "bug,ready", "--remove-label", "needs-triage"]);
  });

  test("sends bodies on stdin and refuses empty ones", () => {
    const { run, calls } = fake();
    const t = new Tracker("jp/app", run);
    t.comment(5, "Hello");
    expect(calls[0]).toEqual({ args: ["issue", "comment", "5", "--repo", "jp/app", "--body-file", "-"], input: "Hello" });
    expect(() => t.editBody(5, "  \n")).toThrow("Refusing to write an empty body.");
  });

  test("refuses a title on more than one line", () => {
    const { run } = fake();
    expect(() => new Tracker("jp/app", run).editTitle(5, "a\nb")).toThrow("A title must be one non-empty line");
  });

  test("creates a draft PR with its body on stdin", () => {
    const { run, calls } = fake();
    new Tracker("jp/app", run).createPr({ base: "main", head: "auto/issue-5", title: "Fix it", body: "Body", draft: true });
    expect(calls[0]).toEqual({
      args: ["pr", "create", "--repo", "jp/app", "--base", "main", "--head", "auto/issue-5", "--title", "Fix it", "--body-file", "-", "--draft"],
      input: "Body",
    });
  });

  test("finds the Status field by name", () => {
    const { run } = fake({
      "project view": "PVT_1",
      "project field-list": JSON.stringify({
        fields: [{ id: "F0", name: "Title" }, { id: "F1", name: "Status", options: [{ id: "o1", name: "Inbox" }] }],
      }),
    });
    expect(new Tracker("jp/app", run).statusField(4)).toEqual({ projectId: "PVT_1", fieldId: "F1", options: [{ id: "o1", name: "Inbox" }] });
  });

  test("counts a job's started steps", () => {
    const { run } = fake({
      "api --paginate": JSON.stringify([{ jobs: [{ name: "implement / agent", status: "completed", steps: [] }, { name: "implement / apply", status: "in_progress", steps: [{ started_at: "t" }, { started_at: null }] }] }]),
    });
    expect(new Tracker("jp/app", run).runJobs(9, 1)).toEqual([
      { name: "implement / agent", status: "completed", startedSteps: 0 },
      { name: "implement / apply", status: "in_progress", startedSteps: 1 },
    ]);
  });

  test("fails on a board without a Status field", () => {
    const { run } = fake({ "project view": "PVT_1", "project field-list": JSON.stringify({ fields: [] }) });
    expect(() => new Tracker("jp/app", run).statusField(4)).toThrow("Project 4 has no Status field with columns.");
  });
});
