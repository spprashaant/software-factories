# Spec: Move the factory's runners onto a self-hosted VPS: implementation and testing

Part of the [factory infrastructure spec](./README.md). The other implementation decisions are in the README.

## Implementation Decisions (continued)

### Requeue module (new, deep)

A pure TypeScript module next to the shared Sandcastle helpers, with no GitHub or network calls. The workflow steps and the resumer are thin `gh` wrappers around it. Its interface has three functions:

- **Classify the outcome**: takes the agent run's stream-json events (the final result event plus any rate-limit events) and the current time. Returns the stats record: task, ticket or PR, outcome (`success`, `failure` or `usage_limit`), turns, tokens, duration, estimated cost and, for `usage_limit`, `resetsAt`.
  - The outcome is `usage_limit` only when the result reports an error _and_ its text or a rate-limit event matches the usage-limit wording. A `subtype` of `"success"` or exit code 0 is not trusted on its own, because headless runs are reported to return both on a limit.
  - When no reset time can be parsed, `resetsAt` is the current time plus five hours.
- **Decide what `finish` does**: takes the stats record, the run's start label, whether the item belongs to a spec chain, and the existing requeue marker on the item, if any. Returns the label changes, the comment body and the new marker.
  - `success`: unchanged from today.
  - `failure`: `agent:blocked`.
  - `usage_limit` with attempt ≤ 3: `agent:queued`, plus a comment giving the reset time and a marker.
  - `usage_limit` past attempt 3: `agent:blocked`, plus a comment saying the requeue limit was reached.
- **Decide what the resumer restarts**: takes the markers on all open issues and PRs labelled `agent:queued`, plus the current time. Returns the items whose reset time has passed, each with its action: re-add a named start label, or restart the spec chain. Items without a requeue marker (ordinary spec-chain queue entries) are left alone.

The marker is a hidden HTML comment in the requeue comment:

```
<!-- factory:requeue label=agent:implement resets=2026-11-19T18:00Z attempt=1 -->
```

## Testing Decisions

- A good test checks behaviour you can observe through a module's interface: given these inputs, which record, label changes, comment and marker come out. Tests don't reach into how the module gets there.
- **The requeue module is the one unit-test seam.** It's tested with vitest, following the pure-function script tests already in the repo: the lint-exemption and allow-scripts checks.
  - **Classifier**: tested against fixture files of real stream-json output:
    1. a successful run;
    2. an ordinary failure, e.g. a run that ended on a failing check;
    3. a run stopped by the usage limit.

    The usage-limit fixture is marked **"to capture from a real run"** until one has been captured, because that format is unconfirmed. Until then, its test is skipped or marked pending and must not pass against an invented fixture. The first real usage-limit stop on the box is saved as that fixture.

  - **`finish` decision**: success; ordinary failure; usage limit on the first, second and third attempts; usage limit past the cap; usage limit with no reset time; a spec-chain item.
  - **Resumer decision**: reset time not yet reached; reset time passed; a mix of issues and PRs; spec-chain items restart the chain; `agent:queued` items with no marker are left alone.
- **No unit tests for the workflow YAML, the supervisor or the Dockerfile.** They are checked by a **canary**: a manually dispatched workflow that sends one trivial job to each slot label. It checks that the job ran on the box and uploaded a stats record, then queries GitHub to confirm no factory runner is left registered, and the supervisor confirms no job container is left. Run the canary after every change to the box, image or supervisor.
- The repo's usual checks (typecheck, boundary lint, tests, mutation tests) apply to the requeue module like any other TypeScript.
