// The prompts and the scripts that check the agent's output must agree.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PR_FORMAT } from "./implement-outcome";
import { OUTCOMES } from "./triage-outcome";

const prompt = (name: string) => readFileSync(join(import.meta.dir, "..", "prompts", name), "utf8");

describe("prompts/implement.md", () => {
  test("quotes PR_FORMAT word for word", () => expect(prompt("implement.md")).toContain(PR_FORMAT));
  test("never asks the agent to push or use gh", () => expect(prompt("implement.md")).toContain("Don't run `gh`, don't push"));
});

describe("prompts/triage.md", () => {
  const text = prompt("triage.md");
  test("names every outcome role the check accepts", () => {
    for (const outcome of OUTCOMES) expect(text).toContain(`**\`${outcome}\`**`);
  });
  test("names decision.json's keys", () => {
    for (const key of ["`category`", "`outcome`", "`retitle`"]) expect(text).toContain(key);
  });
  test("says to pick ready-for-human when ready isn't allowed", () => {
    expect(text).toContain("If `readyAllowed` is `false` in `context.json`, never pick `ready`.");
    expect(text).toContain("Pick `ready-for-human` instead");
  });
});
