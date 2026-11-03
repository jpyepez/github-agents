// A fake gh for tests: answers reads from a small model of one issue and records writes.
import type { Run } from "../tracker";

export type FakeIssue = {
  number: number; title: string; body: string; state?: "OPEN" | "CLOSED"; author?: string;
  labels?: string[]; assignees?: string[]; comments?: { id: number; author: string; body: string }[];
};

export function fakeGh(issue: FakeIssue, extra: { pr?: { number: number; isDraft: boolean; url: string } | null; board?: boolean } = {}) {
  const writes: { args: string[]; input?: string }[] = [];
  const options = ["Inbox", "HITL", "Ready", "In progress", "Done"].map((name, i) => ({ id: `o${i}`, name }));
  const run: Run = (args, input) => {
    const [a = "", b = ""] = args;
    if (a === "issue" && b === "view") {
      return JSON.stringify({
        number: issue.number, title: issue.title, body: issue.body, state: issue.state ?? "OPEN",
        author: { login: issue.author ?? "jp" }, labels: (issue.labels ?? []).map((name) => ({ name })),
        assignees: (issue.assignees ?? []).map((login) => ({ login })),
      });
    }
    if (a === "api" && b === "--paginate") {
      return JSON.stringify([(issue.comments ?? []).map((c) => ({ id: c.id, user: { login: c.author }, body: c.body }))]);
    }
    if (a === "pr" && b === "list") return JSON.stringify(extra.pr ? [extra.pr] : []);
    if (a === "project" && b === "view") return "PVT_1";
    if (a === "project" && b === "field-list") return JSON.stringify({ fields: [{ id: "F1", name: "Status", options }] });
    if (a === "project" && b === "item-add") return "ITEM_1";
    writes.push({ args, input });
    if (a === "pr" && b === "create") return "https://github.com/jp/app/pull/42";
    return "";
  };
  // Short labels for asserting on the order of writes.
  const summary = () =>
    writes.map(({ args }) => {
      const [a, b] = args;
      if (a === "issue" && b === "edit") {
        if (args.includes("--body-file")) return "body";
        if (args.includes("--title")) return `title:${args[args.indexOf("--title") + 1]}`;
        if (args.includes("--add-assignee")) return "assign";
        const add = args.includes("--add-label") ? args[args.indexOf("--add-label") + 1] : "";
        const rm = args.includes("--remove-label") ? args[args.indexOf("--remove-label") + 1] : "";
        return `labels:+${add}-${rm}`;
      }
      if (a === "project" && b === "item-edit") return `status:${options.find((o) => o.id === args.at(-1))?.name}`;
      return `${a} ${b}`;
    });
  return { run, writes, summary };
}
