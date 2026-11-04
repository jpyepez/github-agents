import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DoctorInputs, gatherDoctorInputs, runDoctor } from "./doctor";
import { parseSettings } from "./settings";
import type { Run } from "./tracker";

const tracker = "# Issue tracker: GitHub\n\n## Hand-back list\n\n- Anything under `.github/`\n";
const labels = "# Triage Labels\n\n## The `ready` bar\n\n- Small.\n";
const repoLabels = ["needs-triage", "needs-info", "ready", "ready-for-human", "wontfix", "bug", "enhancement", "documentation"];
const templates = {
  triage: readFileSync(join(import.meta.dir, "../templates/callers/triage.yml"), "utf8"),
  implement: readFileSync(join(import.meta.dir, "../templates/callers/implement.yml"), "utf8"),
};
const SECRET_NOTE = "Secrets are checked by name only: doctor can't see whether OWNER_PAT or CLAUDE_CODE_OAUTH_TOKEN is empty.";

function inputs(over: Partial<DoctorInputs> = {}, yaml = "automation: implement\n"): DoctorInputs {
  const settings = parseSettings(yaml, {});
  return {
    check: {
      settings,
      secretLengths: { OWNER_PAT: 3, CLAUDE_CODE_OAUTH_TOKEN: 3 },
      repoLabels,
      boardColumns: null,
      files: { triageLabels: labels, issueTracker: tracker, gitWorkflow: true },
    },
    settingsError: null,
    automation: settings.automation,
    visibility: "PUBLIC",
    callers: { ...templates },
    templates,
    workflowStates: { ".github/workflows/triage.yml": "active", ".github/workflows/implement.yml": "active" },
    leftovers: [],
    head: { checkout: "abc1234", branch: "main", tip: "abc1234" },
    ...over,
  };
}

describe("runDoctor", () => {
  test("passes a fully set-up repo, noting that secrets are checked by name", () => {
    const r = runDoctor(inputs());
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.notices).toContain(SECRET_NOTE);
  });

  test("includes the check step's failures", () => {
    const base = inputs();
    const r = runDoctor({ ...base, check: { ...base.check!, secretLengths: { OWNER_PAT: 3 } } });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("CLAUDE_CODE_OAUTH_TOKEN is missing");
  });

  test("fails when agents.yml can't be read", () => {
    const r = runDoctor(inputs({ check: null, settingsError: "unknown key: boards" }));
    expect(r.failures).toEqual([".github/agents.yml can't be read: unknown key: boards"]);
  });

  test("fails on a private repo, since egress isn't enforced there", () => {
    const r = runDoctor(inputs({ visibility: "PRIVATE" }));
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain("The repo is private");
  });

  test("fails on a caller that isn't byte-identical to its template", () => {
    const r = runDoctor(inputs({ callers: { ...templates, triage: templates.triage.replace("@v1", "@main") } }));
    expect(r.failures).toEqual([expect.stringContaining(".github/workflows/triage.yml differs")]);
  });

  test("needs the implement caller only when automation is implement", () => {
    const missing = { callers: { triage: templates.triage, implement: null } };
    expect(runDoctor(inputs(missing)).failures).toEqual([expect.stringContaining(".github/workflows/implement.yml is missing")]);
    expect(runDoctor(inputs(missing, "automation: triage\n")).ok).toBe(true);
    expect(runDoctor(inputs({ callers: { triage: null, implement: templates.implement } }, "automation: triage\n")).failures).toEqual([
      expect.stringContaining(".github/workflows/triage.yml is missing"),
    ]);
  });

  test("fails on a disabled or unregistered caller", () => {
    const r = runDoctor(inputs({ workflowStates: { ".github/workflows/triage.yml": "disabled_manually" } }));
    expect(r.failures).toEqual([
      ".github/workflows/triage.yml is disabled_manually, so it never runs. Enable it with: gh workflow enable triage.yml",
      expect.stringContaining(".github/workflows/implement.yml isn't registered with Actions"),
    ]);
  });

  test("only notes the old per-repo copies", () => {
    const r = runDoctor(inputs({ leftovers: [".github/prompts"] }));
    expect(r.ok).toBe(true);
    expect(r.notices).toContain(".github/prompts is left over from the old per-repo copies. The engine doesn't use it; remove it.");
  });

  test("notes a checkout that isn't at the tip of the base branch", () => {
    const r = runDoctor(inputs({ head: { checkout: "1111111aaa", branch: "main", tip: "2222222bbb" } }));
    expect(r.ok).toBe(true);
    expect(r.notices).toContain("The checkout is at 1111111, but main on GitHub is at 2222222. Doctor read the checkout's files; the engine runs what's on main.");
  });
});

describe("gatherDoctorInputs", () => {
  function repoDir(): string {
    const root = mkdtempSync(join(tmpdir(), "doctor-"));
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    mkdirSync(join(root, "docs/agents"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, ".github/agents.yml"), "automation: implement\nboard: 3\n");
    writeFileSync(join(root, ".github/workflows/triage.yml"), templates.triage);
    writeFileSync(join(root, "docs/agents/issue-tracker.md"), tracker);
    writeFileSync(join(root, "docs/agents/triage-labels.md"), labels);
    writeFileSync(join(root, "scripts/board-status.ts"), "");
    return root;
  }

  const options = ["Inbox", "HITL", "Ready", "In progress", "Done"].map((name, i) => ({ id: `o${i}`, name }));
  const calls: string[][] = [];
  const run: Run = (args) => {
    calls.push(args);
    const [a = "", b = ""] = args;
    if (a === "secret" && b === "list") return JSON.stringify([{ name: "OWNER_PAT" }]);
    if (a === "label" && b === "list") return JSON.stringify(repoLabels.map((name) => ({ name })));
    if (a === "project" && b === "view") return "PVT_1";
    if (a === "project" && b === "field-list") return JSON.stringify({ fields: [{ id: "F1", name: "Status", options }] });
    if (a === "workflow" && b === "list") return JSON.stringify([{ path: ".github/workflows/triage.yml", state: "active" }]);
    if (a === "repo" && b === "view") return "PUBLIC";
    if (a === "api" && b === "repos/jp/app/branches/main") return "f00d";
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };

  test("reads the checkout and GitHub, and only reads", () => {
    const got = gatherDoctorInputs(repoDir(), "jp/app", run);
    expect(got.check?.secretLengths).toEqual({ OWNER_PAT: 3, CLAUDE_CODE_OAUTH_TOKEN: 0 });
    expect(got.check?.boardColumns).toEqual(options.map((o) => o.name));
    expect(got.automation).toBe("implement");
    expect(got.callers.triage).toBe(templates.triage);
    expect(got.callers.implement).toBeNull();
    expect(got.leftovers).toEqual(["scripts/board-status.ts"]);
    expect(got.visibility).toBe("PUBLIC");
    expect(got.head).toEqual({ checkout: null, branch: "main", tip: "f00d" });
    expect(calls.every((args) => ["list", "view", "field-list"].includes(args[1] ?? "") || args[0] === "repo" || (args[0] === "api" && args.length === 4))).toBe(true);

    const r = runDoctor(got);
    expect(r.failures).toEqual([
      "The secret CLAUDE_CODE_OAUTH_TOKEN is missing or empty. Set it with: gh secret set CLAUDE_CODE_OAUTH_TOKEN",
      expect.stringContaining(".github/workflows/implement.yml is missing"),
    ]);
  });

  test("reports a bad agents.yml instead of throwing", () => {
    const root = repoDir();
    writeFileSync(join(root, ".github/agents.yml"), "boards: 3\n");
    const got = gatherDoctorInputs(root, "jp/app", run);
    expect(got.check).toBeNull();
    expect(got.settingsError).toBeTruthy();
  });
});
