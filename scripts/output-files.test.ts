// The agent job's cleanup step, and the screenshot check in `apply`.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isImage, wipDoc } from "./apply-implement";

const dir = mkdtempSync(join(tmpdir(), "output-files-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00", "latin1");
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

describe("isImage", () => {
  test("accepts PNG, JPEG, GIF and WebP files", () => {
    for (const [name, bytes] of [["a.png", png], ["b.jpg", jpeg], ["c.gif", gif], ["d.webp", webp]] as const) {
      writeFileSync(join(dir, name), bytes);
      expect(isImage(join(dir, name))).toBe(true);
    }
  });
  test("rejects a symlink, even to a real image", () => {
    symlinkSync(join(dir, "a.png"), join(dir, "link.png"));
    expect(isImage(join(dir, "link.png"))).toBe(false);
  });
  test("rejects text named .png, a directory, an empty file and a missing one", () => {
    writeFileSync(join(dir, "env.png"), "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-...\n");
    mkdirSync(join(dir, "folder.png"));
    writeFileSync(join(dir, "empty.png"), "");
    for (const name of ["env.png", "folder.png", "empty.png", "missing.png"]) expect(isImage(join(dir, name))).toBe(false);
  });
});

describe("the agent job's cleanup step", () => {
  // The exact command from the workflow, so the test covers what runs.
  const workflow = readFileSync(join(import.meta.dir, "..", ".github", "workflows", "implement.yml"), "utf8");
  const command = workflow.match(/name: Drop anything in the output that isn't a regular file\n\s+if: always\(\)\n\s+run: (.+)\n/)?.[1];

  test("is the same in both workflows", () => {
    const triage = readFileSync(join(import.meta.dir, "..", ".github", "workflows", "triage.yml"), "utf8");
    expect(command).toBeDefined();
    expect(triage).toContain(`run: ${command}\n`);
  });

  test("deletes symlinks and keeps regular files and folders", () => {
    const temp = join(dir, "runner");
    const out = join(temp, "out");
    mkdirSync(join(out, "screenshots"), { recursive: true });
    writeFileSync(join(out, "pr.md"), "# Fix\n\nCloses #5\n");
    writeFileSync(join(out, "screenshots", "home.png"), png);
    symlinkSync("/etc/hosts", join(out, "screenshots", "environ.png"));
    symlinkSync(join(out, "screenshots"), join(out, "linked-folder"));
    const proc = Bun.spawnSync(["bash", "-c", command!], { env: { ...process.env, RUNNER_TEMP: temp }, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(0);
    expect(existsSync(join(out, "pr.md"))).toBe(true);
    expect(existsSync(join(out, "screenshots", "home.png"))).toBe(true);
    for (const gone of [join(out, "screenshots", "environ.png"), join(out, "linked-folder")]) {
      expect(Bun.spawnSync(["test", "-L", gone]).exitCode).not.toBe(0);
    }
  });
});

test("the WIP fallback asks the owner to retitle before merging, only when there's a PR", () => {
  expect(wipDoc(5, "failure", "https://run")).toContain("Retitle this PR before merging, in the repo's commit style");
  expect(wipDoc(5, "failure", "https://run", false)).not.toContain("Retitle");
});
