/**
 * Fails a commit that widens a lint exemption.
 *
 * Three ways to get code past a check without fixing it:
 * - add a file to a `files` list under `overrides` in .oxlintrc.json, the
 *   legacy allowlists that switch a rule off;
 * - turn a rule off or loosen it anywhere else in .oxlintrc.json;
 * - add a suppression comment (oxlint-disable, eslint-disable, biome-ignore,
 *   @ts-ignore, @ts-expect-error, @ts-nocheck).
 *
 * The allowlists only shrink. A file leaves one when it is split; nothing
 * joins. PR #52 added six moved files to the max-lines-per-function list
 * instead of splitting them.
 *
 *     npx tsx scripts/check-lint-exemptions.ts                # staged changes against HEAD
 *     npx tsx scripts/check-lint-exemptions.ts --range A B    # commits A..B (the agent workflows)
 *
 * Either way, the one edit .oxlintrc.json accepts is a file leaving a list.
 * A person who means to change a rule does it in a pull request of its own,
 * committing with --no-verify, and the agent workflows still fail any agent
 * commit that does it.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const CONFIG = ".oxlintrc.json";

const SUPPRESSION =
  /\b(?:oxlint-disable|eslint-disable|biome-ignore)\b|@ts-(?:ignore|expect-error|nocheck)\b/;

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

// These two files name the patterns they look for.
const SELF = new Set([
  "scripts/check-lint-exemptions.ts",
  "scripts/check-lint-exemptions.test.ts",
]);

type Override = { files?: string[]; rules?: Record<string, unknown> };

function overridesOf(jsonc: string): Override[] {
  const { config, error } = ts.parseConfigFileTextToJson(CONFIG, jsonc);
  if (error) throw new Error(`${CONFIG} does not parse`);
  return (config as { overrides?: Override[] }).overrides ?? [];
}

/**
 * Every `file (rules)` that `after` exempts and `before` did not. An override
 * is matched to its old self by the rules it sets, so moving a block or
 * reordering its files is not an addition.
 */
export function addedExemptions(before: string, after: string): string[] {
  const old = new Map<string, Set<string>>();
  for (const { files = [], rules = {} } of overridesOf(before)) {
    const key = JSON.stringify(rules);
    old.set(key, new Set([...(old.get(key) ?? []), ...files]));
  }
  return overridesOf(after).flatMap(({ files = [], rules = {} }) => {
    const known = old.get(JSON.stringify(rules)) ?? new Set();
    const names = Object.keys(rules).join(", ");
    return files
      .filter((file) => !known.has(file))
      .map((file) => `${file} (${names})`);
  });
}

/**
 * Whether `after` differs from `before` anywhere but the allowlists. A file
 * leaving a list is the one edit to the config that needs no person.
 */
export function changesOutsideAllowlists(
  before: string,
  after: string
): boolean {
  const withoutLists = (jsonc: string) => {
    const { config } = ts.parseConfigFileTextToJson(CONFIG, jsonc);
    const overrides = (config?.overrides ?? []) as Override[];
    const rules = overrides.map((override) => override.rules ?? {});
    return JSON.stringify({ ...config, overrides: rules });
  };
  return withoutLists(before) !== withoutLists(after);
}

/** Every suppression comment a `git diff -U0` adds, as `file: line`. */
export function addedSuppressions(diff: string): string[] {
  const found: string[] = [];
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : line.slice("+++ b/".length);
      continue;
    }
    const counts = file && CODE_FILE.test(file) && !SELF.has(file);
    if (counts && line.startsWith("+") && SUPPRESSION.test(line)) {
      found.push(`${file}: ${line.slice(1).trim()}`);
    }
  }
  return found;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** The config at a revision, or the empty config if it is not there. */
function configAt(revision: string): string {
  try {
    return git(["show", `${revision}:${CONFIG}`]);
  } catch {
    return "{}";
  }
}

/** Everything the change does to get code past a check, one line each. */
export function violations(
  before: string,
  after: string,
  diff: string
): string[] {
  return [
    ...(changesOutsideAllowlists(before, after)
      ? [
          `${CONFIG} changes outside its allowlists (a rule, an option, a new override or ignore pattern).`,
        ]
      : []),
    ...addedExemptions(before, after).map(
      (entry) => `${CONFIG} exempts a new file: ${entry}`
    ),
    ...addedSuppressions(diff).map((entry) => `suppression comment: ${entry}`),
  ];
}

function main(args: string[]): void {
  const [from, to] = args[0] === "--range" ? args.slice(1, 3) : [];
  const range = from !== undefined && to !== undefined;
  const before = configAt(range ? from : "HEAD");
  const after = range ? configAt(to) : configAt(""); // ":" is the index
  const diff = range
    ? git(["diff", "-U0", "--no-color", from, to])
    : git(["diff", "--cached", "-U0", "--no-color"]);

  const found = violations(before, after, diff);
  if (found.length === 0) return;

  for (const entry of found) console.error(`  ${entry}`);
  console.error(`
Lint exemptions only shrink. Change the code so the check passes:
- a function over 50 lines: extract its parts into named functions or
  components;
- a file over a size limit: split it along its seams (see the message from
  scripts/check-file-tokens.js);
- a type error or a lint error: fix the cause.
If the ticket cannot be built without an exemption, stop and say so in the
pull request. A person decides.`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
