import { describe, expect, test } from "bun:test";
import { closingRefs, KEYWORDS } from "./closing";

describe("closingRefs", () => {
  test("finds every keyword, in any case", () => {
    for (const keyword of KEYWORDS) {
      for (const form of [keyword, keyword.toUpperCase(), keyword[0]!.toUpperCase() + keyword.slice(1)]) {
        expect(closingRefs(`${form} #12`)).toEqual([{ keyword, repo: null, number: 12, line: `${form} #12` }]);
      }
    }
  });

  test("allows a colon and no space", () => {
    expect(closingRefs("Fixes: #3").map((r) => r.number)).toEqual([3]);
    expect(closingRefs("closes#4").map((r) => r.number)).toEqual([4]);
  });

  test("finds owner/repo references and issue URLs", () => {
    expect(closingRefs("Resolves jp/other#8")).toEqual([{ keyword: "resolves", repo: "jp/other", number: 8, line: "Resolves jp/other#8" }]);
    expect(closingRefs("fixed https://github.com/jp/app/issues/9 today")[0]).toMatchObject({ repo: "jp/app", number: 9 });
  });

  test("finds keywords anywhere in a line, and reports each line", () => {
    const refs = closingRefs("Some text.\nThis also fixes #2 and closes #3.\nPart of issue 4");
    expect(refs.map((r) => [r.number, r.line])).toEqual([
      [2, "This also fixes #2 and closes #3."],
      [3, "This also fixes #2 and closes #3."],
    ]);
  });

  test("ignores mentions without a keyword, and words that only contain one", () => {
    expect(closingRefs("See #5. Part of issue 6. prefix #7. unfixed #8. closest #9. Fixer #1")).toEqual([]);
  });
});
