/// <reference types="bun" />
// Scans everything the agent could publish for the Claude OAuth token, before `apply`
// writes anything. Step 2 showed the agent's shell can read the token from /proc, and on a
// public repo `apply` would publish the agent's output at once (docs/design.md, privilege
// split). It runs as its own step, the only one with CLAUDE_CODE_OAUTH_TOKEN in its env.
//
//   bun scripts/scan-output.ts triage <agent-dir>
//   bun scripts/scan-output.ts implement <agent-dir> <settings.json> <issue-number>
//
// Triage: decision.json, comment.md, spec.md. Implement: pr.md, handback.md, every file
// under screenshots/, and every commit's message and diff in the bundle. A hit fails the
// job, naming the file and the form but never the value, and `apply` writes nothing.

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBundle } from "./implement-outcome";
import type { Settings } from "./settings";

export type Form = { kind: string; bytes: Buffer };

// Plain; base64 (standard and url-safe) at each of the three byte offsets, so the token
// can't hide inside a longer base64 string; and percent-encoded, in both cases.
export function secretForms(token: string): Form[] {
  if (token.length < 8) throw new Error("The token is too short to scan for.");
  const raw = Buffer.from(token, "utf8");
  const forms: Form[] = [{ kind: "plain", bytes: raw }];
  for (let offset = 0; offset < 3; offset++) {
    // Encoding the token from a 3-byte boundary gives a run of characters that appears in
    // any base64 text containing the token at that alignment. Keep whole groups only.
    const rest = raw.subarray(offset);
    const std = rest.toString("base64").slice(0, Math.floor(rest.length / 3) * 4);
    const url = std.replace(/\+/g, "-").replace(/\//g, "_");
    forms.push({ kind: `base64 (offset ${offset})`, bytes: Buffer.from(std) });
    if (url !== std) forms.push({ kind: `base64url (offset ${offset})`, bytes: Buffer.from(url) });
  }
  const uri = encodeURIComponent(token);
  if (uri !== token) forms.push({ kind: "url-encoded", bytes: Buffer.from(uri) });
  const pct = [...raw].map((b) => `%${b.toString(16).padStart(2, "0")}`).join("");
  forms.push({ kind: "percent-encoded", bytes: Buffer.from(pct) });
  forms.push({ kind: "percent-encoded", bytes: Buffer.from(pct.toUpperCase()) });
  return forms;
}

export type Hit = { name: string; kind: string };

export function scan(items: { name: string; content: Buffer }[], forms: Form[]): Hit[] {
  const hits: Hit[] = [];
  for (const item of items) {
    const form = forms.find((f) => item.content.includes(f.bytes));
    if (form) hits.push({ name: item.name, kind: form.kind });
  }
  return hits;
}

function read(dir: string, names: string[]): { name: string; content: Buffer }[] {
  return names.filter((n) => existsSync(join(dir, n))).map((n) => ({ name: n, content: readFileSync(join(dir, n)) }));
}

// Every file under dir, without following symlinks (the link itself is what's uploaded).
function readTree(dir: string, prefix: string): { name: string; content: Buffer }[] {
  if (!existsSync(dir)) return [];
  const out: { name: string; content: Buffer }[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = lstatSync(path);
    if (stat.isDirectory()) out.push(...readTree(path, `${prefix}${entry}/`));
    else if (stat.isFile()) out.push({ name: `${prefix}${entry}`, content: readFileSync(path) });
  }
  return out;
}

function gitBytes(args: string[]): Buffer {
  const proc = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args[0]} failed:\n${proc.stderr.toString().trim()}`);
  return Buffer.from(proc.stdout);
}

if (import.meta.main) {
  const [flow = "", agentDir = "", settingsPath = "", issueArg = ""] = process.argv.slice(2);
  try {
    if ((flow !== "triage" && flow !== "implement") || !agentDir) {
      throw new Error("Usage: bun scripts/scan-output.ts <triage|implement> <agent-dir> [<settings.json> <issue-number>]");
    }
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "";
    const forms = secretForms(token);
    const items =
      flow === "triage"
        ? read(agentDir, ["decision.json", "comment.md", "spec.md"])
        : [...read(agentDir, ["pr.md", "handback.md"]), ...readTree(join(agentDir, "screenshots"), "screenshots/")];

    if (flow === "implement") {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
      const branch = `${settings.branch_prefix}${Number(issueArg)}`;
      const bundlePath = join(agentDir, "commits.bundle");
      if (existsSync(bundlePath)) {
        const { heads } = readBundle(process.cwd(), bundlePath, branch, settings.base);
        if (heads.includes(`refs/heads/${branch}`)) {
          // --text so binary files show their bytes; messages and diffs in one stream.
          const log = gitBytes(["log", "-p", "--text", "--no-color", "--no-renames", "--format=%H%n%B", `origin/${settings.base}..refs/agent/${branch}`]);
          items.push({ name: `the commits on ${branch}`, content: log });
        }
      }
    }

    const hits = scan(items, forms);
    if (hits.length) {
      for (const hit of hits) console.log(`::error::${hit.name} contains the Claude OAuth token (${hit.kind}). Nothing was written.`);
      console.log("::error::Treat CLAUDE_CODE_OAUTH_TOKEN as leaked: revoke it, set a new one, and read the agent's run before retrying.");
      process.exit(1);
    }
    console.log(`Scanned ${items.length} output item(s): no token found.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`::error::${message.split("\n")[0]}`);
    console.error(message);
    process.exit(1);
  }
}
