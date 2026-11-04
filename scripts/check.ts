/// <reference types="bun" />
// The check step: runs first in `prepare`, before Claude starts (docs/design.md, "The
// check step"). `doctor.ts` runs the same checks by hand.
//
//   bun scripts/check.ts <repo-root> <settings.json> <out.json>
//
// It reads the secrets' lengths from OWNER_PAT and CLAUDE_CODE_OAUTH_TOKEN in its env, and
// calls GitHub with OWNER_PAT (as GH_TOKEN). Failures print as ::error:: lines and exit 1;
// notices print as ::notice:: lines. check.json tells the later jobs what is allowed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Settings } from "./settings";
import { Tracker } from "./tracker";

export const SECRETS = ["OWNER_PAT", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

export type CheckInputs = {
  settings: Settings;
  // Each secret's length; 0 or missing means unset or empty.
  secretLengths: Partial<Record<(typeof SECRETS)[number], number>>;
  repoLabels: string[];
  // The board's column names, or an error message when `board` is set but can't be read.
  boardColumns: string[] | { error: string } | null;
  files: {
    triageLabels: string | null; // docs/agents/triage-labels.md
    issueTracker: string | null; // docs/agents/issue-tracker.md
    gitWorkflow: boolean; // docs/git-workflow.md exists
  };
};

export type CheckResult = {
  ok: boolean;
  failures: string[];
  notices: string[];
  // Triage may apply `ready` only when the repo has both a ready bar and a hand-back list.
  readyAllowed: boolean;
  hasReadyBar: boolean;
  hasHandBack: boolean;
  // `doc`: follow docs/git-workflow.md. `plain`: plain imperative sentences.
  commitStyle: "doc" | "plain";
  board: number | null;
};

// "## The `ready` bar", with whatever the repo calls its ready label.
const READY_BAR = /^#{2,6}\s+The\s+\S+\s+bar\s*$/im;
const HAND_BACK = /^#{2,6}\s+Hand-back list\s*$/im;
const GITHUB_TRACKER = /^#\s+Issue tracker:\s*GitHub\s*$/m;

export function runChecks(inputs: CheckInputs): CheckResult {
  const { settings, files } = inputs;
  const failures: string[] = [];
  const notices: string[] = [];

  for (const name of SECRETS) {
    const length = inputs.secretLengths[name] ?? 0;
    if (length === 0) failures.push(`The secret ${name} is missing or empty. Set it with: gh secret set ${name}`);
  }

  if (files.issueTracker === null) {
    failures.push("docs/agents/issue-tracker.md is missing. Run /setup-work with the GitHub tracker.");
  } else if (!GITHUB_TRACKER.test(files.issueTracker)) {
    failures.push("docs/agents/issue-tracker.md isn't the GitHub tracker. The engine only works with GitHub Issues.");
  }

  const wanted = [...Object.values(settings.labels), ...settings.categories];
  const missing = wanted.filter((label) => !inputs.repoLabels.includes(label));
  if (missing.length) failures.push(`The repo is missing these labels: ${missing.join(", ")}. Create them with gh label create.`);

  let board: number | null = settings.board;
  if (settings.board === null) {
    notices.push("No board in agents.yml: Status updates are skipped.");
  } else if (inputs.boardColumns === null || !Array.isArray(inputs.boardColumns)) {
    const why = inputs.boardColumns === null ? "it wasn't read" : inputs.boardColumns.error;
    failures.push(`Board ${settings.board} from agents.yml can't be used: ${why}`);
    board = null;
  } else {
    const have = inputs.boardColumns.map((c) => c.toLowerCase());
    const absent = Object.values(settings.columns).filter((c) => !have.includes(c.toLowerCase()));
    if (absent.length) {
      failures.push(`Board ${settings.board} has no column named ${absent.join(", ")}. Its columns: ${inputs.boardColumns.join(", ")}.`);
    }
  }

  const hasReadyBar = files.triageLabels !== null && READY_BAR.test(files.triageLabels);
  const hasHandBack = files.issueTracker !== null && HAND_BACK.test(files.issueTracker);
  if (!hasReadyBar) notices.push(`No ready bar in docs/agents/triage-labels.md: triage never applies \`${settings.labels.ready}\`.`);
  if (!hasHandBack) {
    notices.push(`No hand-back list in docs/agents/issue-tracker.md: triage never applies \`${settings.labels.ready}\`, and implement uses the built-in list.`);
  }

  const commitStyle = files.gitWorkflow ? "doc" : "plain";
  if (!files.gitWorkflow) notices.push("No docs/git-workflow.md: commits and PR titles are plain sentences.");

  return {
    ok: failures.length === 0,
    failures,
    notices,
    readyAllowed: hasReadyBar && hasHandBack,
    hasReadyBar,
    hasHandBack,
    commitStyle,
    board,
  };
}

function readOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function gatherInputs(root: string, settings: Settings, tracker: Tracker, env: Record<string, string | undefined>): CheckInputs {
  const secretLengths: CheckInputs["secretLengths"] = {};
  for (const name of SECRETS) secretLengths[name] = env[name]?.length ?? 0;

  let boardColumns: CheckInputs["boardColumns"] = null;
  if (settings.board !== null) {
    try {
      boardColumns = tracker.statusField(settings.board).options.map((o) => o.name);
    } catch (error) {
      boardColumns = { error: (error instanceof Error ? error.message : String(error)).split("\n").join(" ") };
    }
  }

  return {
    settings,
    secretLengths,
    repoLabels: tracker.repoLabels(),
    boardColumns,
    files: {
      triageLabels: readOrNull(join(root, "docs/agents/triage-labels.md")),
      issueTracker: readOrNull(join(root, "docs/agents/issue-tracker.md")),
      gitWorkflow: existsSync(join(root, "docs/git-workflow.md")),
    },
  };
}

if (import.meta.main) {
  const [root = ".", settingsPath = "settings.json", out = "check.json"] = process.argv.slice(2);
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) throw new Error("GITHUB_REPOSITORY isn't set.");
    const result = runChecks(gatherInputs(root, settings, new Tracker(repo), process.env));
    writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
    for (const notice of result.notices) console.log(`::notice::${notice}`);
    for (const failure of result.failures) console.log(`::error::${failure}`);
    if (!result.ok) process.exit(1);
    console.log("Check passed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error::${message.split("\n")[0]}`);
    console.error(message);
    process.exit(1);
  }
}
