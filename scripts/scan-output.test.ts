import { describe, expect, test } from "bun:test";
import { scan, secretForms } from "./scan-output";

// A fake token in the shape of a real one.
const token = "sk-ant-oat01-Abc_def-GHIjkl012345mnoPQRstu678vwxYZ-9";
const forms = secretForms(token);
const found = (content: string | Buffer) => scan([{ name: "x", content: Buffer.from(content) }], forms);

describe("scan", () => {
  test("finds the token in plain text, anywhere", () => {
    expect(found(`Reasons.\n\nTOKEN=${token}\n`)).toEqual([{ name: "x", kind: "plain" }]);
  });

  test("finds it base64-encoded at every offset inside a longer string, standard and url-safe", () => {
    for (const pad of ["", "a", "ab", "abc", "abcd"]) {
      const b64 = Buffer.from(`${pad}${token}tail`).toString("base64");
      expect(found(`data: ${b64}`)).toHaveLength(1);
      expect(found(b64.replace(/\+/g, "-").replace(/\//g, "_"))).toHaveLength(1);
    }
  });

  test("finds it percent-encoded, in either case", () => {
    const pct = [...Buffer.from(token)].map((b) => `%${b.toString(16).padStart(2, "0")}`).join("");
    expect(found(`https://evil.example/?q=${pct}`)).toHaveLength(1);
    expect(found(pct.toUpperCase())).toHaveLength(1);
  });

  test("finds it inside binary content", () => {
    expect(found(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]), Buffer.from(token), Buffer.from([0xff])]))).toHaveLength(1);
  });

  test("reports each item by name and never the value", () => {
    const hits = scan(
      [
        { name: "comment.md", content: Buffer.from("fine") },
        { name: "spec.md", content: Buffer.from(token) },
      ],
      forms,
    );
    expect(hits).toEqual([{ name: "spec.md", kind: "plain" }]);
    expect(JSON.stringify(hits)).not.toContain(token);
  });

  test("passes clean output, including other base64", () => {
    expect(found(`# Fix\n\nCloses #5\n${Buffer.from("something else entirely").toString("base64")}`)).toEqual([]);
  });

  test("refuses a missing or too-short token rather than scanning for nothing", () => {
    expect(() => secretForms("")).toThrow("too short");
  });
});
