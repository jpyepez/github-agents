// Finds GitHub's closing keywords in a PR description or commit message. Any of these,
// in any case, with an optional colon, closes the issue it names when the PR merges into
// the default branch (docs/research.md, "Closing keywords"):
//
//   close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved
//
// followed by `#12`, `owner/repo#12` or `https://github.com/owner/repo/issues/12`.
// The match is deliberately wider than GitHub's (no space needed after the keyword or
// colon), since a false alarm costs a hand-back and a miss closes the wrong issue.

export const KEYWORDS = ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"] as const;

export type ClosingRef = {
  keyword: string;
  repo: string | null; // `owner/name`, or null for a bare `#12`
  number: number;
  line: string; // the whole line it's on, trimmed
};

const REF = new RegExp(
  String.raw`(?<![\w-])(${KEYWORDS.join("|")})(?![\w-])\s*:?\s*` +
    String.raw`(?:#(\d+)|([\w.-]+\/[\w.-]+)#(\d+)|https?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+))`,
  "gi",
);

export function closingRefs(text: string): ClosingRef[] {
  const refs: ClosingRef[] = [];
  for (const m of text.matchAll(REF)) {
    const start = text.lastIndexOf("\n", m.index) + 1;
    const end = text.indexOf("\n", m.index);
    refs.push({
      keyword: m[1]!.toLowerCase(),
      repo: m[3] ?? m[5] ?? null,
      number: Number(m[2] ?? m[4] ?? m[6]),
      line: text.slice(start, end === -1 ? undefined : end).trim(),
    });
  }
  return refs;
}
