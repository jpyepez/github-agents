import { describe, expect, test } from "bun:test";
import { safetyComment, safetyStop } from "./safety-stop";
import { parseSettings } from "./settings";
import { fakeGh } from "./testing/fake-gh";
import { Tracker } from "./tracker";

const settings = parseSettings("board: 4\n", {});
const run = "https://github.com/jp/app/actions/runs/1";

describe("safetyStop", () => {
  test("triage: posts the fixed comment and moves the issue to HITL", () => {
    const gh = fakeGh({ number: 5, title: "T", body: "B", labels: ["needs-triage"] });
    safetyStop({ tracker: new Tracker("jp/app", gh.run), settings, flow: "triage", issue: 5, runUrl: run });
    expect(gh.summary()).toEqual(["issue comment", "status:HITL"]);
    expect(gh.writes[0]!.input).toBe(`This run failed a safety check and wrote nothing. See ${run}`);
  });

  test("implement: also hands the issue back", () => {
    const gh = fakeGh({ number: 5, title: "T", body: "B", labels: ["bug", "ready"] });
    safetyStop({ tracker: new Tracker("jp/app", gh.run), settings, flow: "implement", issue: 5, runUrl: run });
    expect(gh.summary()).toEqual(["issue comment", "labels:+ready-for-human-ready", "status:HITL"]);
  });

  test("the comment holds only engine text and the run link", () => {
    expect(safetyComment(run)).toBe(`This run failed a safety check and wrote nothing. See ${run}`);
  });
});

describe("the workflows", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  for (const flow of ["triage", "implement"]) {
    const text = readFileSync(join(import.meta.dir, "..", ".github", "workflows", `${flow}.yml`), "utf8");
    test(`${flow}: runs the safety stop only after a scan hit, without the OAuth token`, () => {
      const stop = text.slice(text.indexOf("- name: Safety stop"));
      expect(stop).toContain("if: failure() && steps.scan.outcome == 'failure'");
      expect(stop).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
      expect(text.match(/CLAUDE_CODE_OAUTH_TOKEN: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/g)?.length).toBe(2); // check step and scan step
    });
  }
});
