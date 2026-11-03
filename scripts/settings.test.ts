import { describe, expect, test } from "bun:test";
import { DEFAULTS, isSkipped, parseSettings } from "./settings";

const scripts = { lint: "oxlint", typecheck: "tsc", test: "bun test", "test:e2e": "playwright test", dev: "vite" };

describe("parseSettings defaults", () => {
  test("a missing file gives every cautious default", () => {
    const s = parseSettings(null, {});
    expect(s.automation).toBe("triage");
    expect(s.board).toBeNull();
    expect(s.checks).toEqual([]);
    expect(s.browser).toBe(false);
    expect(s.labels).toEqual(DEFAULTS.labels);
    expect(s.columns).toEqual(DEFAULTS.columns);
    expect(s.skip_labels).toEqual(["notes", "spec", "pathfinder:*"]);
    expect(s.caps).toEqual({ triage: { turns: 30, minutes: 30 }, implement: { turns: 80, minutes: 120 } });
    expect(s.base).toBe("main");
    expect(s.branch_prefix).toBe("auto/issue-");
    expect(s.egress).toEqual([]);
  });

  test("an empty file is the same as a missing one", () => {
    expect(parseSettings("", scripts)).toEqual(parseSettings(null, scripts));
    expect(parseSettings("# nothing yet\n", scripts)).toEqual(parseSettings(null, scripts));
  });

  test("checks default to the known scripts package.json has, in a fixed order", () => {
    expect(parseSettings(null, scripts).checks).toEqual(["lint", "typecheck", "test", "test:e2e"]);
  });

  test("browser defaults on when test:e2e exists", () => {
    expect(parseSettings(null, scripts).browser).toBe(true);
    expect(parseSettings(null, { test: "x" }).browser).toBe(false);
  });
});

describe("parseSettings values", () => {
  test("reads the lyrics-display example", () => {
    const s = parseSettings("board: 3\nautomation: implement\nchecks: [lint, typecheck, test, test:e2e]\n", scripts);
    expect(s.board).toBe(3);
    expect(s.automation).toBe("implement");
    expect(s.checks).toEqual(["lint", "typecheck", "test", "test:e2e"]);
  });

  test("renames a label role and keeps the others", () => {
    const s = parseSettings("labels: { ready: go }\n", {});
    expect(s.labels.ready).toBe("go");
    expect(s.labels["needs-info"]).toBe("needs-info");
  });

  test("takes columns as a list in board order or as a role mapping", () => {
    expect(parseSettings("columns: [New, Owner, Queued, Doing, Shipped]\n", {}).columns).toEqual({
      inbox: "New", hitl: "Owner", ready: "Queued", in_progress: "Doing", done: "Shipped",
    });
    expect(parseSettings("columns: { hitl: Waiting }\n", {}).columns.hitl).toBe("Waiting");
  });

  test("merges caps per workflow", () => {
    expect(parseSettings("caps: { implement: { turns: 40 } }\n", {}).caps).toEqual({
      triage: { turns: 30, minutes: 30 }, implement: { turns: 40, minutes: 120 },
    });
  });

  test("lowercases egress hosts", () => {
    expect(parseSettings("egress: [Example.com, '*.cdn.example.com:8443']\n", {}).egress).toEqual([
      "example.com", "*.cdn.example.com:8443",
    ]);
  });
});

describe("parseSettings rejects", () => {
  const rejects = (yaml: string, message: string, s: Record<string, unknown> = scripts) =>
    expect(() => parseSettings(yaml, s)).toThrow(message);

  test("an unknown key, naming it", () => rejects("bord: 3\n", "`bord` isn't a setting"));
  test("a non-mapping file", () => rejects("- a\n- b\n", "must be a mapping"));
  test("an unknown automation level", () => rejects("automation: yes\n", "`automation` must be `triage` or `implement`"));
  test("a board that isn't a whole number", () => {
    rejects("board: 0\n", "`board` must be a whole number");
    rejects("board: '3'\n", "`board` must be a whole number");
  });
  test("a check package.json has no script for", () => rejects("checks: [lint, build]\n", "lists `build`, which package.json has no script for"));
  test("a browser setting that isn't a boolean", () => rejects("browser: on-ish\n", "`browser` must be true or false"));
  test("an unknown label role", () => rejects("labels: { ready-for-agent: go }\n", "`labels.ready-for-agent` isn't a role"));
  test("a label with a comma", () => rejects("labels: { ready: 'a,b' }\n", "without commas"));
  test("a category that clashes with a triage label", () => rejects("categories: [bug, wontfix]\n", "must all be different labels"));
  test("a duplicate category", () => rejects("categories: [bug, bug]\n", "has a duplicate entry"));
  test("no categories", () => rejects("categories: []\n", "must list at least one category"));
  test("the wrong number of columns", () => rejects("columns: [A, B]\n", "must list 5 columns"));
  test("two columns with the same name", () => rejects("columns: { hitl: ready }\n", "must all have different names"));
  test("a skip pattern with a star in the middle", () => rejects("skip_labels: ['a*b']\n", "may only end in a single *"));
  test("a skip pattern that would skip ready", () => rejects("skip_labels: ['re*']\n", "can't match the `ready` label"));
  test("an unknown cap", () => rejects("caps: { triage: { tokens: 5 } }\n", "`caps.triage.tokens` isn't a cap"));
  test("a branch name with ..", () => rejects("base: ../main\n", "`base` must be a plain branch name"));
  test("a host that isn't one", () => rejects("egress: ['http://x.com']\n", "entry `http://x.com` must be a host name"));
});

describe("isSkipped", () => {
  const s = parseSettings(null, {});
  test("matches exact labels and star prefixes", () => {
    expect(isSkipped(s, ["bug", "notes"])).toBe(true);
    expect(isSkipped(s, ["pathfinder:map"])).toBe(true);
    expect(isSkipped(s, ["bug", "ready", "specification"])).toBe(false);
  });
});
