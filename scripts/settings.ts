/// <reference types="bun" />
// Reads a consumer repo's `.github/agents.yml` and fills in every default from the
// Settings table in docs/design.md. Every key is optional, and a missing key always means
// the more cautious setting. An unknown key or a bad value fails, naming it, rather than
// being ignored.
//
//   bun scripts/settings.ts <repo-root> <out.json>
//
// `prepare` runs it and passes settings.json to the later jobs.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The five triage roles. A repo may rename the label for any of them.
export const LABEL_ROLES = ["needs-triage", "needs-info", "ready", "ready-for-human", "wontfix"] as const;
export type LabelRole = (typeof LABEL_ROLES)[number];

// The board's Status columns, in board order. A repo may rename any of them.
export const COLUMN_ROLES = ["inbox", "hitl", "ready", "in_progress", "done"] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const KNOWN_CHECKS = ["lint", "typecheck", "test", "build", "test:e2e"] as const;

export type Caps = { turns: number; minutes: number };

export type Settings = {
  automation: "triage" | "implement";
  board: number | null;
  install: string;
  checks: string[];
  browser: boolean;
  categories: string[];
  labels: Record<LabelRole, string>;
  columns: Record<ColumnRole, string>;
  skip_labels: string[];
  caps: { triage: Caps; implement: Caps };
  base: string;
  branch_prefix: string;
  egress: string[];
};

export const DEFAULTS = {
  automation: "triage",
  board: null,
  install: "bun install --frozen-lockfile",
  categories: ["bug", "enhancement", "documentation"],
  labels: {
    "needs-triage": "needs-triage",
    "needs-info": "needs-info",
    ready: "ready",
    "ready-for-human": "ready-for-human",
    wontfix: "wontfix",
  },
  columns: { inbox: "Inbox", hitl: "HITL", ready: "Ready", in_progress: "In progress", done: "Done" },
  skip_labels: ["notes", "spec", "pathfinder:*"],
  caps: { triage: { turns: 30, minutes: 30 }, implement: { turns: 80, minutes: 120 } },
  base: "main",
  branch_prefix: "auto/issue-",
  egress: [],
} satisfies Omit<Settings, "checks" | "browser">;

const KEYS = [
  "automation", "board", "install", "checks", "browser", "categories", "labels",
  "columns", "skip_labels", "caps", "base", "branch_prefix", "egress",
];

class SettingsError extends Error {}
const bad = (key: string, why: string): never => {
  throw new SettingsError(`agents.yml: \`${key}\` ${why}`);
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function str(key: string, v: unknown): string {
  if (typeof v !== "string" || v.trim() === "") bad(key, "must be a non-empty string");
  return (v as string).trim();
}

function strList(key: string, v: unknown): string[] {
  if (!Array.isArray(v)) bad(key, "must be a list");
  const list = (v as unknown[]).map((item, i) => str(`${key}[${i}]`, item));
  if (new Set(list).size !== list.length) bad(key, "has a duplicate entry");
  return list;
}

function posInt(key: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) bad(key, "must be a whole number above 0");
  return v as number;
}

// A label name: one line, no commas (gh takes label lists comma-separated).
function labelName(key: string, v: unknown): string {
  const name = str(key, v);
  if (/[,\n]/.test(name) || name.length > 50) bad(key, "must be one line of at most 50 characters, without commas");
  return name;
}

// A host for the egress allowlist: a domain, optionally `*.`-prefixed, with an optional port.
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;

// `scripts` is package.json's scripts, for the `checks` and `browser` defaults.
export function parseSettings(yamlText: string | null, scripts: Record<string, unknown> = {}): Settings {
  const raw: unknown = yamlText === null || yamlText.trim() === "" ? {} : Bun.YAML.parse(yamlText);
  if (raw === null || raw === undefined) return parseSettings(null, scripts);
  if (!isRecord(raw)) throw new SettingsError("agents.yml: must be a mapping of keys to values");
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) bad(key, `isn't a setting. Valid settings: ${KEYS.join(", ")}`);
  }
  const has = (key: string) => raw[key] !== undefined && raw[key] !== null;

  let automation: Settings["automation"] = DEFAULTS.automation;
  if (has("automation")) {
    if (raw.automation !== "triage" && raw.automation !== "implement") bad("automation", "must be `triage` or `implement`");
    automation = raw.automation as Settings["automation"];
  }

  const board = has("board") ? posInt("board", raw.board) : null;
  const install = has("install") ? str("install", raw.install) : DEFAULTS.install;

  const available = KNOWN_CHECKS.filter((c) => typeof scripts[c] === "string");
  const checks = has("checks") ? strList("checks", raw.checks) : [...available];
  for (const check of checks) {
    if (typeof scripts[check] !== "string") bad("checks", `lists \`${check}\`, which package.json has no script for`);
  }

  let browser = typeof scripts["test:e2e"] === "string";
  if (has("browser")) {
    if (typeof raw.browser !== "boolean") bad("browser", "must be true or false");
    browser = raw.browser as boolean;
  }

  const categories = has("categories") ? strList("categories", raw.categories).map((c, i) => labelName(`categories[${i}]`, c)) : [...DEFAULTS.categories];
  if (categories.length === 0) bad("categories", "must list at least one category");

  const labels: Record<LabelRole, string> = { ...DEFAULTS.labels };
  if (has("labels")) {
    if (!isRecord(raw.labels)) bad("labels", `must map roles to label names. Roles: ${LABEL_ROLES.join(", ")}`);
    for (const [role, name] of Object.entries(raw.labels as Record<string, unknown>)) {
      if (!(LABEL_ROLES as readonly string[]).includes(role)) bad(`labels.${role}`, `isn't a role. Roles: ${LABEL_ROLES.join(", ")}`);
      labels[role as LabelRole] = labelName(`labels.${role}`, name);
    }
  }
  const allLabels = [...Object.values(labels), ...categories];
  if (new Set(allLabels).size !== allLabels.length) bad("labels", "and `categories` must all be different labels");

  const columns: Record<ColumnRole, string> = { ...DEFAULTS.columns };
  if (has("columns")) {
    if (Array.isArray(raw.columns)) {
      const list = strList("columns", raw.columns);
      if (list.length !== COLUMN_ROLES.length) bad("columns", `must list ${COLUMN_ROLES.length} columns, in this order: ${COLUMN_ROLES.join(", ")}`);
      COLUMN_ROLES.forEach((role, i) => (columns[role] = list[i]!));
    } else if (isRecord(raw.columns)) {
      for (const [role, name] of Object.entries(raw.columns)) {
        if (!(COLUMN_ROLES as readonly string[]).includes(role)) bad(`columns.${role}`, `isn't a column role. Roles: ${COLUMN_ROLES.join(", ")}`);
        columns[role as ColumnRole] = str(`columns.${role}`, name);
      }
    } else bad("columns", "must be a list of column names or a mapping of roles to names");
    const names = Object.values(columns).map((n) => n.toLowerCase());
    if (new Set(names).size !== names.length) bad("columns", "must all have different names");
  }

  const skip_labels = has("skip_labels") ? strList("skip_labels", raw.skip_labels) : [...DEFAULTS.skip_labels];
  for (const pattern of skip_labels) {
    if (pattern.includes("*") && !/^[^*]+\*$/.test(pattern)) bad("skip_labels", `entry \`${pattern}\` may only end in a single *`);
  }
  for (const role of ["ready", "needs-triage"] as const) {
    if (skip_labels.some((p) => matchesLabel(p, labels[role]))) bad("skip_labels", `can't match the \`${labels[role]}\` label`);
  }

  const caps = structuredClone(DEFAULTS.caps);
  if (has("caps")) {
    if (!isRecord(raw.caps)) bad("caps", "must map `triage` and `implement` to `turns` and `minutes`");
    for (const [flow, value] of Object.entries(raw.caps as Record<string, unknown>)) {
      if (flow !== "triage" && flow !== "implement") bad(`caps.${flow}`, "isn't a workflow. Use `triage` or `implement`");
      if (!isRecord(value)) bad(`caps.${flow}`, "must have `turns` and/or `minutes`");
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k !== "turns" && k !== "minutes") bad(`caps.${flow}.${k}`, "isn't a cap. Use `turns` or `minutes`");
        caps[flow as "triage" | "implement"][k as "turns" | "minutes"] = posInt(`caps.${flow}.${k}`, v);
      }
    }
  }

  const base = has("base") ? str("base", raw.base) : DEFAULTS.base;
  const branch_prefix = has("branch_prefix") ? str("branch_prefix", raw.branch_prefix) : DEFAULTS.branch_prefix;
  for (const [key, value] of [["base", base], ["branch_prefix", branch_prefix]] as const) {
    if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes("..") || value.startsWith("/")) bad(key, "must be a plain branch name");
  }

  const egress = has("egress") ? strList("egress", raw.egress).map((h) => h.toLowerCase()) : [];
  for (const host of egress) if (!HOST.test(host)) bad("egress", `entry \`${host}\` must be a host name, like \`example.com\` or \`*.example.com:443\``);

  return { automation, board, install, checks, browser, categories, labels, columns, skip_labels, caps, base, branch_prefix, egress };
}

// A skip_labels entry matches a label exactly, or by prefix when it ends in `*`.
export function matchesLabel(pattern: string, label: string): boolean {
  return pattern.endsWith("*") ? label.startsWith(pattern.slice(0, -1)) : label === pattern;
}

export function isSkipped(settings: Settings, labels: string[]): boolean {
  return labels.some((label) => settings.skip_labels.some((p) => matchesLabel(p, label)));
}

export function readSettings(repoRoot: string): Settings {
  const yamlPath = join(repoRoot, ".github", "agents.yml");
  const pkgPath = join(repoRoot, "package.json");
  const yaml = existsSync(yamlPath) ? readFileSync(yamlPath, "utf8") : null;
  let scripts: Record<string, unknown> = {};
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, unknown> };
    scripts = pkg.scripts ?? {};
  }
  return parseSettings(yaml, scripts);
}

if (import.meta.main) {
  const [root = ".", out = "settings.json"] = process.argv.slice(2);
  try {
    const settings = readSettings(root);
    writeFileSync(out, JSON.stringify(settings, null, 2) + "\n");
    console.log(JSON.stringify(settings));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error::${message}`);
    process.exit(1);
  }
}
