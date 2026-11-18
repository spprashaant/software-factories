import { describe, expect, it } from "vitest";
import {
  addedExemptions,
  addedSuppressions,
  changesOutsideAllowlists,
  violations,
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

describe("violations", () => {
  const base = config(["a.ts", "b.ts"]);
  const loosened = {
    "a top-level rule's option": base.replace('["error", 3]', '["error", 6]'),
    "a top-level rule turned off": base.replace('["error", 3]', '"off"'),
    "a rule an override switches off": base.replace(
      '"max-lines-per-function": "off"',
      '"max-lines-per-function": "off", "max-params": "off"'
    ),
    "a new ignore pattern": base.replace(
      '"rules": { "max-depth"',
      '"ignorePatterns": ["app/**"], "rules": { "max-depth"'
    ),
  };

  for (const [change, after] of Object.entries(loosened)) {
    it(`fails ${change}`, () => {
      expect(violations(base, after, "")).toContain(
        ".oxlintrc.json changes outside its allowlists (a rule, an option, a new override or ignore pattern)."
      );
    });
  }

  it("passes a file leaving a list, and nothing else", () => {
    expect(violations(base, config(["a.ts"]), "")).toEqual([]);
  });

  it("reports a joined file and a suppression together", () => {
    expect(
      violations(
        base,
        config(["a.ts", "b.ts", "c.ts"]),
        diff("app/x.ts", "// @ts-ignore")
      )
    ).toEqual([
      ".oxlintrc.json exempts a new file: c.ts (max-lines-per-function)",
      "suppression comment: app/x.ts: // @ts-ignore",
    ]);
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
