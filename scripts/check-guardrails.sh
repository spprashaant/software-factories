#!/bin/sh
# Fails when the commits since <base> change a guardrail: the lint, format,
# type, test and hook configuration that decides whether code passes.
#
#     sh scripts/check-guardrails.sh <base>
#
# The agent workflows run this after the agent, from the base commit's copy
# (`git show <base>:scripts/check-guardrails.sh | sh -s -- <base>`), so the
# agent cannot edit the check that judges it. A guardrail change is a
# person's decision, made in a pull request of its own.
#
# One edit is allowed: a file leaving a legacy allowlist in .oxlintrc.json.
#
# The review reads CODING_STANDARDS.md, app/modules/README.md, AGENTS.md,
# CLAUDE.md, its skills and its prompt from the branch, so those are guarded
# too: an agent that weakens them weakens its own review.
set -eu
base=$1
status=0

guarded='^(CODING_STANDARDS\.md|AGENTS\.md|CLAUDE\.md|app/modules/README\.md|\.agents/.*|\.claude/.*|\.sandcastle/.*|\.dependency-cruiser\.cjs|biome\.json|tsconfig\.json|vitest\.config\.ts|stryker\.conf\.mjs|lint-rules/.*|scripts/pre-commit\.sh|scripts/check-[^/]+|scripts/mutate-diff\.ts|\.husky/.*|\.github/.*)$'
changed=$(git diff --name-only "$base" HEAD | grep -E "$guarded" || true)
if [ -n "$changed" ]; then
  echo "::error::These commits change guardrail files:"
  echo "$changed" | sed 's/^/  /'
  status=1
fi

# The package.json entries that run the checks.
checks='{ "lint-staged": ."lint-staged", scripts: (.scripts | with_entries(select(.key | test("^(check|typecheck|lint|test|format|prepare)")))) }'
if [ "$(git show "$base:package.json" | jq -S "$checks")" != "$(git show HEAD:package.json | jq -S "$checks")" ]; then
  echo "::error::These commits change the check scripts or lint-staged in package.json."
  status=1
fi

# .oxlintrc.json (only a shrinking allowlist) and suppression comments. If
# the commits edited this check, the list above has already failed the run.
npx tsx scripts/check-lint-exemptions.ts --range "$base" HEAD || status=1

if [ "$status" -ne 0 ]; then
  echo
  echo "Change the code so the checks pass. If the ticket needs a guardrail"
  echo "changed, stop and say so in the pull request: a person decides."
fi
exit $status
