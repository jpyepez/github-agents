// The agent job's egress allowlist (docs/design.md, "Egress"). harden-runner takes it as
// space-separated host:port entries. The engine's defaults come from Claude Code's network
// requirements and what claude-code-action and setup-bun download; agents.yml's `egress`
// adds to them. harden-runner itself always allows the Actions hosts (artifacts, cache).
//
// Step 3's audit pass (docs/research.md, "Tested in step 3") checked this list against real
// triage and implement runs. platform.claude.com wasn't called there, but Claude Code's
// sign-in docs list it.

import type { Settings } from "./settings";

export const DEFAULT_HOSTS = [
  "api.anthropic.com", // the model, and the WebFetch safety check
  "claude.ai", // sign-in, and the installer claude-code-action runs
  "platform.claude.com", // sign-in
  "downloads.claude.ai", // the Claude Code binary
  "github.com", // git and gh
  "api.github.com", // gh, and claude-code-action's own calls
  "release-assets.githubusercontent.com", // release downloads (setup-bun, Playwright)
  "registry.npmjs.org", // bun install, for the action and the repo
];

// Playwright's browser downloads, for the browser walk.
export const BROWSER_HOSTS = ["cdn.playwright.dev", "playwright.download.prss.microsoft.com", "storage.googleapis.com"];

const withPort = (host: string) => (/:\d+$/.test(host) ? host : `${host}:443`);

export function endpoints(settings: Settings, flow: "triage" | "implement"): string {
  const hosts = [...DEFAULT_HOSTS, ...(flow === "implement" && settings.browser ? BROWSER_HOSTS : []), ...settings.egress];
  return [...new Set(hosts.map(withPort))].join(" ");
}
