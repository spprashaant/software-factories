# Spec: Move the factory's runners onto a self-hosted VPS

This spec is split across three files:

- **README.md** (this file): problem, solution, services, implementation decisions, out of scope and further notes.
- [user-stories.md](./user-stories.md): the user stories.
- [implementation-and-testing.md](./implementation-and-testing.md): the requeue module, the classifier fixtures, the canary and the rest of the testing decisions.

## Problem Statement

The software factory runs every run on GitHub-hosted Actions runners. Once the repository is private in a one-seat GitHub Team org, those runners draw on an allowance of 3,000 Linux minutes a month ($18 of compute), and GitHub bills every minute an agent spends waiting on the model. At 5 to 10 runs a day with runs of 20 to 60 minutes, the factory needs 3,000 to 9,000 minutes a month, so the allowance runs out and overage costs grow with every run.

Four other problems come with the current setup:

- Every call the factory makes to GitHub goes through a long-lived fine-grained personal access token. That token acts as the owner, so the owner cannot formally approve the factory's PRs, and it reaches every step that references it.
- When a run hits the Claude subscription's usage limit, it fails like any other run and the ticket is marked `agent:blocked`. A human then has to notice and retry it, even though the only fix is to wait for the usage window to reset.
- Several implement runs can run at once, and they compete for the same subscription window.
- Run pages show one run at a time, so the owner cannot run a retro across many runs.

## Solution

GitHub Actions stays the orchestrator, and GitHub Issues and GitHub stay the ticket tracker and git host. Agent jobs move to ephemeral self-hosted runners on one Hetzner CX33 (4 vCPU, 8 GB). Each job gets a fresh container that is destroyed when the job ends. Self-hosted minutes don't count against the allowance, so the factory's runner costs are a flat ~€9 a month.

The box has two slots. One runs implement jobs only, so there is at most one implement run at a time. The other runs review, explore and decompose. Short bookkeeping jobs stay on hosted `ubuntu-latest`, so they still run when the box is down.

The factory acts through a GitHub App (`factory[bot]`) that mints a short-lived token per job. A second App on the box holds only the permission to register runners.

When a run stops on a usage limit, its ticket or PR goes back to `agent:queued`, with a comment saying when the window resets. An hourly clock run restarts it after the reset, up to three times.

Each agent run uploads its transcript and a small stats record as an Actions artifact. A weekly retro run reads the last week's artifacts and files a single retro issue for that week.

### Services

| Slot                   | Product                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Ticket tracker         | GitHub Issues (unchanged)                                                                                                                    |
| Git host               | GitHub (unchanged); the factory acts as a GitHub App                                                                                         |
| Orchestrator           | GitHub Actions                                                                                                                               |
| Runner                 | Ephemeral self-hosted runners on a Hetzner CX33, with a fresh container per job, for agent jobs. Hosted `ubuntu-latest` for bookkeeping jobs |
| Observability platform | Actions artifacts (transcript plus stats record, kept 90 days)                                                                               |
| Ticket source          | The weekly retro run                                                                                                                         |

## Implementation Decisions

### Orchestrator

- GitHub Actions remains the orchestrator. The existing triggers, concurrency groups, label state machine and `timeout-minutes` stay as they are.
- Jobs reach a slot through runner labels, not concurrency groups. A concurrency group keeps only one pending run by default, and a newer one cancels it. A job waiting for a runner label waits in GitHub's queue, for up to 24 hours.
- Slot A has the label `factory-implement` and takes the implement jobs of both the implement and implement-spec workflows. Slot B has the label `factory-agent` and takes review, explore and decompose.
- All other jobs (survey, apply, chain, finish, the resumer and the bookkeeping part of the retro) run on hosted `ubuntu-latest`. They use about 900 of the 3,000 included minutes a month.
- The implement and review workflows gain a hosted `finish` job, which runs whether or not the agent job succeeded, like the one explore already has.

### Runner

- One Hetzner CX33 (4 vCPU, 8 GB, 80 GB), about €8.49 a month plus €0.50 for IPv4, excl. VAT.
- A supervisor runs as a systemd service, with one loop per slot. Each loop:
  1. calls the org-level just-in-time runner config endpoint, passing the slot's labels and the `factory` runner group;
  2. starts the runner image with a 75-minute deadline and `--rm`;
  3. waits for that job to finish, then repeats.
- At startup the supervisor removes any container left over from an earlier run.
- `drain` stops the loops requesting new configs and waits for in-flight containers to exit. `resume` starts the loops again.
- The runner image contains Node, the Claude Code CLI, `agent-browser` with its Chromium, and the Actions runner. It is built on the box and never pushed to a registry. Agent scripts keep Sandcastle's no-sandbox mode, because the container provides the isolation, so no Docker is needed inside the container.
- The only state kept between runs is an npm cache host volume, mounted into each container. Nothing depends on it being there, and npm's lockfile integrity check rejects a tampered entry.
- Network: a Hetzner Cloud Firewall allows SSH from the owner's IP only, with outbound open. Runners poll GitHub outbound, so the box needs no inbound ports.
- Security updates install unattended; reboots are manual and go through `drain`.

### Credentials

- **Factory App**: its private key lives in Actions secrets and never on the box. Each job mints installation tokens limited to this repository and the permissions that step needs. The agent step gets read-only access; a step after the agent mints a write token to push, open PRs, comment and change labels. Installation tokens expire after one hour. Labels the App applies trigger workflows, which replaces the personal access token's role in chaining runs. The personal access token is retired.
- **Registrar App**: its private key lives on the box only. Its sole permission is the organization's Self-hosted runners: write, which is enough for the org just-in-time config endpoint. It doesn't need repository Administration: write, which could also change branch protection.
- **Runner group**: an org runner group named `factory`, limited to this repository, with public repositories disallowed. Every just-in-time config registers into it.
- `CLAUDE_CODE_OAUTH_TOKEN` stays an Actions secret. Both slots share one subscription usage window.
- The built-in `GITHUB_TOKEN` is kept for checkout only, limited by each job's `permissions:` block.

### Requeue module

See [implementation-and-testing.md](./implementation-and-testing.md#requeue-module-new-deep) for the requeue module's interface and marker format.

### The resumer

- A scheduled workflow on hosted `ubuntu-latest` runs every hour, in a single concurrency group so no two runs overlap.
- For each item the requeue module returns, it first removes `agent:queued` and then either applies the start label with the factory App token or restarts the spec chain.

### Observability platform

- Every agent job uploads a gzipped transcript and the stats record as one artifact, with `retention-days: 90`. Roughly 1 GB at 300 runs a month, inside Team's 2 GB of artifact storage.
- Langfuse is not used. Hobby's 50k units a month is likely too few at 10 runs a day, and it keeps data for 30 days.

### Retro (ticket source)

- A weekly scheduled workflow downloads the artifacts from the last seven days. An agent job on slot B reads them, and a hosted step files the findings.
- It files one issue titled `Factory retro <ISO year>-W<week>` with the label `factory:retro`. If an issue with that title already exists, it files nothing.

### Costs (monthly)

GitHub Team $4; CX33 about €9; Actions $0 inside the included minutes and storage; observability $0.

## Testing Decisions

See [implementation-and-testing.md](./implementation-and-testing.md#testing-decisions).

## Out of Scope

- New tasks, and changes to what existing tasks do, apart from the `finish` jobs and requeue handling above.
- Replacing GitHub Issues or GitHub.
- A custom orchestrator, webhook receiver or UI on the box.
- An LLM tracing platform (Langfuse or similar), and self-hosting one on the CX33.
- An outbound network allowlist on the box.
- Automatic reboots or automatic image rebuilds.
- More than one runner box, or autoscaling.
- Raising the number of parallel jobs past two before measurements justify it.
- Running agent jobs in Docker inside the job container.

## Further Notes

- **Estimates to confirm with measurements**: about 2–2.5 GB of RAM and 1–2 busy vCPUs per job at peak, Stryker being the heaviest. Check with `docker stats` on the first real runs before changing the slot count.
- **Unconfirmed format**: how a usage-limit stop appears in headless stream-json output, including where the reset time sits. Community reports only; no official docs were found. The classifier's strict matching and five-hour fallback exist because of this.
- **Prices that may change**: GitHub announced a $0.002/min fee for self-hosted runners in private repos from March 2026, then postponed it, and as of mid-2026 it hadn't taken effect. If it returns, the cost would be roughly $6–18 a month at this volume. Hetzner raised cloud prices twice in 2026; check the CX33 price when ordering.
- **Meaning of `agent:queued`**: it keeps its existing meaning for the implement-spec chain and adds "waiting for a usage window to reset". The requeue marker tells the two apart.
- **Rollout order** (a suggestion): register the factory App and switch tokens while still on hosted runners; provision the box, the registrar App and the runner group; run the canary; move slot B jobs; move slot A jobs; add the requeue module, the `finish` jobs and the resumer; add artifact upload and the weekly retro.
