/// <reference types="bun" />
// Moves an issue to a column of the repo's board, adding it to the board first if it
// isn't there. The board is `board` in agents.yml; its Status field and columns are looked
// up by name on every run, so no ids are stored. Column names match case-insensitively.
// A column can be given as its role (`in_progress`) or as its name on the board.
//
//   bun scripts/board-status.ts <settings.json> <issue-number> <column>
//   e.g. bun scripts/board-status.ts settings.json 29 in_progress

import { readFileSync } from "node:fs";
import { COLUMN_ROLES, type ColumnRole, type Settings } from "./settings";
import { Tracker } from "./tracker";

export const USAGE = "Usage: bun scripts/board-status.ts <settings.json> <issue-number> <column>";

export type StatusOption = { id: string; name: string };

export function parseArgs(args: string[]): { settingsPath: string; issue: number; column: string } {
  const [settingsPath = "", issue = "", ...rest] = args;
  const column = rest.join(" ").trim();
  if (settingsPath === "" || !/^[1-9]\d*$/.test(issue) || column === "") throw new Error(USAGE);
  return { settingsPath, issue: Number(issue), column };
}

// A role maps through `columns` in agents.yml; anything else is taken as a column name.
export function columnName(settings: Settings, column: string): string {
  return (COLUMN_ROLES as readonly string[]).includes(column) ? settings.columns[column as ColumnRole] : column;
}

export function findOption(options: StatusOption[], column: string): StatusOption {
  const wanted = column.trim().toLowerCase();
  const option = options.find((o) => o.name.toLowerCase() === wanted);
  if (!option) {
    const valid = options.map((o) => o.name).join(", ");
    throw new Error(`No column named "${column}" on the board. Valid columns: ${valid}.`);
  }
  return option;
}

// Moves the issue and returns the column's name as the board spells it, or null when the
// repo has no board (the check step already said so).
export function setStatus(tracker: Tracker, settings: Settings, issue: number, column: string): string | null {
  if (settings.board === null) return null;
  const field = tracker.statusField(settings.board);
  const option = findOption(field.options, columnName(settings, column));
  tracker.setItemStatus(settings.board, field, issue, option.id);
  return option.name;
}

if (import.meta.main) {
  try {
    const { settingsPath, issue, column } = parseArgs(process.argv.slice(2));
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) throw new Error("GITHUB_REPOSITORY isn't set.");
    const name = setStatus(new Tracker(repo), settings, issue, column);
    console.log(name === null ? `#${issue}: no board, Status left alone` : `#${issue} → ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error::${message.split("\n")[0]}`);
    console.error(message);
    process.exit(1);
  }
}
