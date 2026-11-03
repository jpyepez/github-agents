/// <reference types="bun" />
// The tracker seam: every label, comment, body, assignee, PR and board call the engine
// makes goes through here, so a second tracker would replace only this file. GitHub only
// for now (docs/design.md, "Tracker").
//
// Every call runs through a `Run` function. The real one spawns `gh`; tests pass a fake
// that records the arguments, so no test ever reaches GitHub.

export type Run = (args: string[], input?: string) => string;

export const gh: Run = (args, input) => {
  const proc = Bun.spawnSync(["gh", ...args], {
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed:\n${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString().trim();
};

export type Issue = {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  author: string;
  labels: string[];
  assignees: string[];
};

export type Comment = { id: number; author: string; body: string };

export type PullRequest = { number: number; isDraft: boolean; url: string };

export type StatusField = { projectId: string; fieldId: string; options: { id: string; name: string }[] };

export class Tracker {
  readonly owner: string;

  constructor(
    readonly repo: string,
    private readonly run: Run = gh,
  ) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Not an owner/name repo: "${repo}"`);
    this.owner = repo.split("/")[0]!;
  }

  private json<T>(args: string[]): T {
    return JSON.parse(this.run(args)) as T;
  }

  // Issues

  issue(n: number): Issue {
    const raw = this.json<{
      number: number; title: string; body: string; state: "OPEN" | "CLOSED";
      author: { login: string }; labels: { name: string }[]; assignees: { login: string }[];
    }>(["issue", "view", String(n), "--repo", this.repo, "--json", "number,title,body,state,author,labels,assignees"]);
    return {
      number: raw.number,
      title: raw.title,
      body: raw.body,
      state: raw.state,
      author: raw.author.login,
      labels: raw.labels.map((l) => l.name),
      assignees: raw.assignees.map((a) => a.login),
    };
  }

  // REST rather than `gh issue view`, for the numeric ids. --slurp gathers every page.
  comments(n: number): Comment[] {
    const pages = this.json<{ id: number; user: { login: string } | null; body: string | null }[][]>([
      "api", "--paginate", "--slurp", `repos/${this.repo}/issues/${n}/comments?per_page=100`,
    ]);
    return pages.flat().map((c) => ({ id: c.id, author: c.user?.login ?? "", body: c.body ?? "" }));
  }

  subIssueCount(n: number): number {
    return Number(this.run(["api", `repos/${this.repo}/issues/${n}`, "--jq", ".sub_issues_summary.total // 0"]) || 0);
  }

  // One call, so nothing sees a half-applied set of labels.
  editLabels(n: number, add: string[], remove: string[]): void {
    if (add.length === 0 && remove.length === 0) return;
    const args = ["issue", "edit", String(n), "--repo", this.repo];
    if (add.length) args.push("--add-label", add.join(","));
    if (remove.length) args.push("--remove-label", remove.join(","));
    this.run(args);
  }

  // Bodies go through stdin, never the command line, and never empty.
  comment(n: number, body: string): void {
    this.run(["issue", "comment", String(n), "--repo", this.repo, "--body-file", "-"], nonEmpty(body));
  }

  editBody(n: number, body: string): void {
    this.run(["issue", "edit", String(n), "--repo", this.repo, "--body-file", "-"], nonEmpty(body));
  }

  editTitle(n: number, title: string): void {
    this.run(["issue", "edit", String(n), "--repo", this.repo, "--title", oneLine(title)]);
  }

  assign(n: number, login: string): void {
    this.run(["issue", "edit", String(n), "--repo", this.repo, "--add-assignee", login]);
  }

  repoLabels(): string[] {
    return this.json<{ name: string }[]>(["label", "list", "--repo", this.repo, "--limit", "1000", "--json", "name"]).map((l) => l.name);
  }

  // Pull requests

  openPr(head: string): PullRequest | null {
    const prs = this.json<PullRequest[]>([
      "pr", "list", "--repo", this.repo, "--head", head, "--state", "open", "--json", "number,isDraft,url",
    ]);
    return prs[0] ?? null;
  }

  createPr(o: { base: string; head: string; title: string; body: string; draft: boolean }): string {
    const args = ["pr", "create", "--repo", this.repo, "--base", o.base, "--head", o.head, "--title", oneLine(o.title), "--body-file", "-"];
    if (o.draft) args.push("--draft");
    return this.run(args, nonEmpty(o.body));
  }

  editPr(pr: number, title: string, body: string): void {
    this.run(["pr", "edit", String(pr), "--repo", this.repo, "--title", oneLine(title), "--body-file", "-"], nonEmpty(body));
  }

  setPrReady(pr: number, ready: boolean): void {
    const args = ["pr", "ready", String(pr), "--repo", this.repo];
    if (!ready) args.push("--undo");
    this.run(args);
  }

  // `--attach` needs gh 2.103 or later.
  commentPr(pr: number, body: string, attachments: string[] = []): void {
    const args = ["pr", "comment", String(pr), "--repo", this.repo, "--body-file", "-"];
    for (const file of attachments) args.push("--attach", file);
    this.run(args, nonEmpty(body));
  }

  // Board: a user-owned project, found by number; the Status field found by name.

  statusField(project: number): StatusField {
    const projectId = this.run(["project", "view", String(project), "--owner", this.owner, "--format", "json", "--jq", ".id"]);
    const { fields } = this.json<{ fields: { id: string; name: string; options?: { id: string; name: string }[] }[] }>([
      "project", "field-list", String(project), "--owner", this.owner, "--format", "json", "--limit", "100",
    ]);
    const status = fields.find((f) => f.name === "Status" && f.options);
    if (!status?.options) throw new Error(`Project ${project} has no Status field with columns.`);
    return { projectId, fieldId: status.id, options: status.options };
  }

  // Adds the issue to the board if it isn't there (item-add returns the existing item if it is).
  setItemStatus(project: number, field: StatusField, issue: number, optionId: string): void {
    const url = `https://github.com/${this.repo}/issues/${issue}`;
    const item = this.run(["project", "item-add", String(project), "--owner", this.owner, "--url", url, "--format", "json", "--jq", ".id"]);
    this.run([
      "project", "item-edit", "--project-id", field.projectId, "--id", item,
      "--field-id", field.fieldId, "--single-select-option-id", optionId,
    ]);
  }
}

function nonEmpty(body: string): string {
  if (body.trim() === "") throw new Error("Refusing to write an empty body.");
  return body;
}

function oneLine(title: string): string {
  const t = title.trim();
  if (t === "" || t.includes("\n")) throw new Error(`A title must be one non-empty line, got: ${JSON.stringify(title)}`);
  return t;
}
