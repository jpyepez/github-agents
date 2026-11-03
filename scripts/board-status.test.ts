import { describe, expect, test } from "bun:test";
import { columnName, findOption, parseArgs, setStatus, USAGE } from "./board-status";
import { parseSettings } from "./settings";
import { type Run, Tracker } from "./tracker";

const options = [
  { id: "a", name: "Inbox" },
  { id: "b", name: "HITL" },
  { id: "c", name: "Ready" },
  { id: "d", name: "In progress" },
  { id: "e", name: "Done" },
];

describe("findOption", () => {
  test("finds a column by its exact name", () => {
    expect(findOption(options, "In progress")).toEqual({ id: "d", name: "In progress" });
  });
  test("ignores case and surrounding spaces", () => {
    expect(findOption(options, " in PROGRESS ")).toEqual({ id: "d", name: "In progress" });
  });
  test("rejects a column the board doesn't have, listing the ones it does", () => {
    expect(() => findOption(options, "Review")).toThrow(
      'No column named "Review" on the board. Valid columns: Inbox, HITL, Ready, In progress, Done.',
    );
  });
});

describe("columnName", () => {
  test("maps a role through agents.yml and passes a name through", () => {
    const s = parseSettings("columns: { in_progress: Doing }\n", {});
    expect(columnName(s, "in_progress")).toBe("Doing");
    expect(columnName(s, "HITL")).toBe("HITL");
  });
});

describe("parseArgs", () => {
  test("reads the settings path, the issue and a column, quoted or not", () => {
    expect(parseArgs(["s.json", "29", "In", "progress"])).toEqual({ settingsPath: "s.json", issue: 29, column: "In progress" });
  });
  test("rejects a missing column or a bad issue number", () => {
    expect(() => parseArgs(["s.json", "29"])).toThrow(USAGE);
    expect(() => parseArgs(["s.json", "0", "Ready"])).toThrow(USAGE);
  });
});

describe("setStatus", () => {
  test("does nothing without a board", () => {
    const calls: string[][] = [];
    const run: Run = (args) => (calls.push(args), "");
    expect(setStatus(new Tracker("jp/app", run), parseSettings(null, {}), 5, "ready")).toBeNull();
    expect(calls).toEqual([]);
  });

  test("adds the issue to the board and sets the column the role names", () => {
    const calls: string[][] = [];
    const run: Run = (args) => {
      calls.push(args);
      if (args[0] === "project" && args[1] === "view") return "PVT_1";
      if (args[1] === "field-list") return JSON.stringify({ fields: [{ id: "F1", name: "Status", options }] });
      if (args[1] === "item-add") return "ITEM_9";
      return "";
    };
    expect(setStatus(new Tracker("jp/app", run), parseSettings("board: 4\n", {}), 5, "hitl")).toBe("HITL");
    expect(calls.at(-1)).toEqual([
      "project", "item-edit", "--project-id", "PVT_1", "--id", "ITEM_9", "--field-id", "F1", "--single-select-option-id", "b",
    ]);
    expect(calls.find((c) => c[1] === "item-add")).toContain("https://github.com/jp/app/issues/5");
  });
});
