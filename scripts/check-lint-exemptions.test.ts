import { describe, expect, it } from "vitest";
import {
  addedExemptions,
  addedSuppressions,
  changesOutsideAllowlists,
} from "./check-lint-exemptions";

const config = (files: string[], extra = "") => `{
  // a comment, as in the real file
  "rules": { "max-depth": ["error", 3] },
  "overrides": [
    ${extra}
    { "files": ${JSON.stringify(files)}, "rules": { "max-lines-per-function": "off" } }
  ]
}`;

describe("addedExemptions", () => {
  it("passes an unchanged config", () => {
    expect(addedExemptions(config(["a.ts"]), config(["a.ts"]))).toEqual([]);
  });

  it("passes a file leaving the list", () => {
    expect(addedExemptions(config(["a.ts", "b.ts"]), config(["a.ts"]))).toEqual(
      []
    );
  });

  it("passes a reordered list and a moved block", () => {
    const other = `{ "files": ["c.ts"], "rules": { "max-params": "off" } },`;
    expect(
      addedExemptions(config(["a.ts", "b.ts"]), config(["b.ts", "a.ts"], other))
    ).toEqual(["c.ts (max-params)"]);
    expect(
      addedExemptions(config(["a.ts"], other), config(["a.ts"], other))
    ).toEqual([]);
  });

  it("fails a file joining the list, naming the rule", () => {
    expect(
      addedExemptions(config(["a.ts"]), config(["a.ts", "new.tsx"]))
    ).toEqual(["new.tsx (max-lines-per-function)"]);
  });

  it("fails a file joining when the old config has no overrides", () => {
    expect(addedExemptions("{}", config(["a.ts"]))).toEqual([
      "a.ts (max-lines-per-function)",
    ]);
  });
});

describe("changesOutsideAllowlists", () => {
  it("passes a file leaving a list", () => {
    expect(
      changesOutsideAllowlists(config(["a.ts", "b.ts"]), config(["a.ts"]))
    ).toBe(false);
  });

  it("fails a rule switched off or a new override", () => {
    const loosened = config(["a.ts"]).replace('["error", 3]', '"off"');
    expect(changesOutsideAllowlists(config(["a.ts"]), loosened)).toBe(true);
    const other = `{ "files": ["c.ts"], "rules": { "max-params": "off" } },`;
    expect(
      changesOutsideAllowlists(config(["a.ts"]), config(["a.ts"], other))
    ).toBe(true);
  });
});

const diff = (file: string, ...added: string[]) =>
  [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,0 +1,2 @@",
    ...added.map((line) => `+${line}`),
  ].join("\n");

describe("addedSuppressions", () => {
  it("fails each kind of suppression comment", () => {
    const found = addedSuppressions(
      diff(
        "app/x.tsx",
        "// oxlint-disable-next-line max-params",
        "/* eslint-disable */",
        "// biome-ignore format: reason",
        "// @ts-ignore",
        "// @ts-expect-error",
        "// @ts-nocheck"
      )
    );
    expect(found).toHaveLength(6);
    expect(found[0]).toBe("app/x.tsx: // oxlint-disable-next-line max-params");
  });

  it("passes an ordinary added line, a removed suppression and a markdown file", () => {
    expect(
      addedSuppressions(
        [
          diff("app/x.ts", "const total = 1;"),
          "-// oxlint-disable-next-line max-params",
          diff("docs/notes.md", "Never write oxlint-disable."),
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("skips the check's own files", () => {
    expect(
      addedSuppressions(
        diff("scripts/check-lint-exemptions.ts", "// @ts-ignore")
      )
    ).toEqual([]);
  });
});
