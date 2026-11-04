/// <reference types="bun" />
// `doctor`: the check step, run by hand against a consumer repo's checkout, plus the
// set-up mistakes only a local run can see (docs/design.md, "Doctor"). It changes nothing.
//
//   bun <engine>/scripts/doctor.ts [repo-root] [--repo owner/name] [--json]
//
// It calls GitHub with your own `gh` login, and compares the callers with this engine's
// templates, so run it from the engine checked out at the tag the callers pin (`v1`).
// Exit 0 when nothing fails; exit 1 otherwise.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type CheckInputs, SECRETS, gatherInputs, runChecks } from "./check";
import { type Settings, readSettings } from "./settings";
import { type Run, Tracker, gh } from "./tracker";

export const CALLERS = ["triage", "implement"] as const;
type Caller = (typeof CALLERS)[number];

// The old per-repo copies a migration removes (docs/design.md, "Porting notes").
export const LEFTOVERS = [".github/prompts", "scripts/board-status.ts", "scripts/triage-outcome.ts"];

export type DoctorInputs = {
  // `null` when .github/agents.yml can't be read; `settingsError` says why.
  check: CheckInputs | null;
  settingsError: string | null;
  automation: Settings["automation"] | null;
  visibility: string; // PUBLIC, PRIVATE or INTERNAL
  callers: Record<Caller, string | null>; // the repo's .github/workflows/<caller>.yml
  templates: Record<Caller, string>; // this engine's templates/callers/<caller>.yml
  workflowStates: Record<string, string>; // workflow path -> state, from the Actions API
  leftovers: string[]; // which of LEFTOVERS exist
  // The checkout's commit, and the tip of the branch the engine runs from (`base`).
  head: { checkout: string | null; branch: string; tip: string | null };
};

export type DoctorResult = { ok: boolean; failures: string[]; notices: string[] };

export function runDoctor(inputs: DoctorInputs): DoctorResult {
  const failures: string[] = [];
  const notices: string[] = [];

  if (inputs.check === null) {
    failures.push(`.github/agents.yml can't be read: ${inputs.settingsError}`);
  } else {
    const result = runChecks(inputs.check);
    failures.push(...result.failures);
    notices.push(...result.notices);
  }
  notices.push(`Secrets are checked by name only: doctor can't see whether ${SECRETS.join(" or ")} is empty.`);

  if (inputs.visibility !== "PUBLIC") {
    failures.push(`The repo is ${inputs.visibility.toLowerCase()}. harden-runner only enforces the egress allowlist on a public repo, so the agent would run with no egress limit.`);
  }

  for (const caller of CALLERS) {
    const path = `.github/workflows/${caller}.yml`;
    const have = inputs.callers[caller];
    if (have === null) {
      // automation: triage needs no implement caller; implement skips at once anyway.
      if (caller === "triage" || inputs.automation === "implement") {
        failures.push(`${path} is missing. Copy it from the engine's templates/callers/${caller}.yml.`);
      }
      continue;
    }
    if (have !== inputs.templates[caller]) {
      failures.push(`${path} differs from the engine's templates/callers/${caller}.yml. The callers are byte-identical in every repo: copy the template over it.`);
    }
    const state = inputs.workflowStates[path];
    if (state === undefined) {
      failures.push(`${path} isn't registered with Actions yet. Merge it to the default branch.`);
    } else if (state !== "active") {
      failures.push(`${path} is ${state}, so it never runs. Enable it with: gh workflow enable ${caller}.yml`);
    }
  }

  const { checkout, branch, tip } = inputs.head;
  if (checkout !== null && tip !== null && checkout !== tip) {
    notices.push(`The checkout is at ${checkout.slice(0, 7)}, but ${branch} on GitHub is at ${tip.slice(0, 7)}. Doctor read the checkout's files; the engine runs what's on ${branch}.`);
  }

  for (const path of inputs.leftovers) {
    notices.push(`${path} is left over from the old per-repo copies. The engine doesn't use it; remove it.`);
  }

  return { ok: failures.length === 0, failures, notices };
}

function readOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const engineRoot = join(import.meta.dir, "..");

export function gatherDoctorInputs(root: string, repo: string, run: Run = gh): DoctorInputs {
  const tracker = new Tracker(repo, run);
  const json = <T>(args: string[]) => JSON.parse(run(args)) as T;

  const present = new Set(json<{ name: string }[]>(["secret", "list", "--repo", repo, "--json", "name"]).map((s) => s.name));
  // A secret doctor can see is counted as set; its value never leaves GitHub.
  const env = Object.fromEntries(SECRETS.map((name) => [name, present.has(name) ? "set" : ""]));

  let check: CheckInputs | null = null;
  let settingsError: string | null = null;
  let automation: Settings["automation"] | null = null;
  let base = "main";
  try {
    const settings = readSettings(root);
    automation = settings.automation;
    base = settings.base;
    check = gatherInputs(root, settings, tracker, env);
  } catch (error) {
    settingsError = (error instanceof Error ? error.message : String(error)).split("\n")[0]!;
  }

  const states: Record<string, string> = {};
  for (const w of json<{ path: string; state: string }[]>(["workflow", "list", "--repo", repo, "--all", "--json", "path,state", "--limit", "200"])) {
    states[w.path] = w.state;
  }

  return {
    check,
    settingsError,
    automation,
    visibility: run(["repo", "view", repo, "--json", "visibility", "--jq", ".visibility"]),
    callers: {
      triage: readOrNull(join(root, ".github/workflows/triage.yml")),
      implement: readOrNull(join(root, ".github/workflows/implement.yml")),
    },
    templates: {
      triage: readFileSync(join(engineRoot, "templates/callers/triage.yml"), "utf8"),
      implement: readFileSync(join(engineRoot, "templates/callers/implement.yml"), "utf8"),
    },
    workflowStates: states,
    leftovers: LEFTOVERS.filter((path) => existsSync(join(root, path))),
    head: { checkout: headOf(root), branch: base, tip: tipOf(run, repo, base) },
  };
}

function headOf(root: string): string | null {
  const proc = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() : null;
}

function tipOf(run: Run, repo: string, branch: string): string | null {
  try {
    return run(["api", `repos/${repo}/branches/${branch}`, "--jq", ".commit.sha"]) || null;
  } catch {
    return null;
  }
}

// The repo the checkout belongs to, as gh sees it.
function repoOf(root: string): string {
  const proc = Bun.spawnSync(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`Can't tell which repo ${root} is. Pass --repo owner/name.\n${proc.stderr.toString().trim()}`);
  return proc.stdout.toString().trim();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const repoAt = args.indexOf("--repo");
  const repoArg = repoAt >= 0 ? args[repoAt + 1] : undefined;
  const root = args.find((a, i) => !a.startsWith("--") && (repoAt < 0 || i !== repoAt + 1)) ?? ".";
  try {
    const repo = repoArg ?? repoOf(root);
    const result = runDoctor(gatherDoctorInputs(root, repo));
    if (asJson) {
      console.log(JSON.stringify({ repo, ...result }, null, 2));
    } else {
      console.log(`Doctor: ${repo}`);
      for (const failure of result.failures) console.log(`FAIL    ${failure}`);
      for (const notice of result.notices) console.log(`NOTICE  ${notice}`);
      console.log(result.ok ? "Doctor passed." : `Doctor failed: ${result.failures.length} to fix.`);
    }
    if (!result.ok) process.exit(1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
