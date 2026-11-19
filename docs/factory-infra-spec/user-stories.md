# Spec: Move the factory's runners onto a self-hosted VPS: user stories

Part of the [factory infrastructure spec](./README.md).

## User Stories

### Cost and capacity

1. As the factory owner, I want agent jobs to run on my own VPS, so that runs don't use up my Actions allowance however long they take.
2. As the factory owner, I want the runner to cost a flat monthly price, so that a busy week doesn't produce a surprise bill.
3. As the factory owner, I want short bookkeeping jobs to stay on hosted runners, so that they fit inside the included minutes and don't queue behind long agent runs.
4. As the factory owner, I want at most one implement run at a time, so that two implementers don't compete for the same subscription usage window.
5. As the factory owner, I want reviews and explores to run in their own slot, so that a PR review doesn't wait behind a 60-minute implement run.
6. As the factory owner, I want queued jobs to wait in GitHub's queue rather than be cancelled, so that labelling three issues at once builds all three, one after another.
7. As the factory owner, I want the number of parallel jobs to be a setting on the box, so that I can raise it once measurements show there's room.

### Disposability and safety

8. As the factory owner, I want every agent job to start in a fresh container from a known image, so that nothing one run leaves behind can affect the next.
9. As the factory owner, I want each runner to take exactly one job and then deregister, so that no runner stays registered between runs.
10. As the factory owner, I want the runner image built on the box from a Dockerfile in the repo, so that it doesn't use the storage that GitHub Packages shares with artifacts.
11. As the factory owner, I want an npm cache shared between runs that is safe to delete, so that installs are fast and a deleted cache only makes the next run slower.
12. As the factory owner, I want the box to accept no inbound connections except SSH from my IP, so that there is nothing on it to attack.
13. As the factory owner, I want the box to hold only a credential that can register runners, so that if the box is compromised the attacker cannot push code or comment as the factory.
14. As the factory owner, I want runners registered into a runner group that admits only this repository, so that no other repo in the org, and no public repo, can run jobs on my box.

### Credentials

15. As the factory owner, I want the factory to act as `factory[bot]` through a GitHub App, so that I can formally approve its PRs and tell its comments apart from mine.
16. As the factory owner, I want each job to get a token that expires within an hour and covers only what that job needs, so that a leaked token is worth little.
17. As the factory owner, I want the agent step to hold a read-only GitHub token, so that the agent cannot push or comment directly. Only the deterministic steps after it can.
18. As the factory owner, I want the write token minted after the agent finishes, so that a 60-minute run never pushes with an expired token.
19. As the factory owner, I want label changes made by the factory App to trigger the next workflow, so that runs still chain without a personal access token.
20. As the factory owner, I want the personal access token retired once the App is in place, so that no long-lived credential acting as me remains.

### Hung runs, outages and maintenance

21. As the factory owner, I want every job container killed after 75 minutes, so that a job GitHub has already given up on can't hold a slot forever.
22. As the factory owner, I want the supervisor to remove leftover containers when it starts, so that a crash or reboot doesn't leave slots taken.
23. As the factory owner, I want the bookkeeping job that runs after an agent job to still run when the box is down, so that a ticket whose run died is labelled rather than left in `agent:in-progress`.
24. As the factory owner, I want jobs queued while the box is down to start when it returns, so that an outage delays work without losing it.
25. As the factory owner, I want a `drain` command that stops the box taking new jobs and waits for the in-flight ones, so that I can rebuild the image or reboot without failing a run.
26. As the factory owner, I want a `resume` command that starts the runner loops again, so that queued jobs start when maintenance is finished.
27. As the factory owner, I want security updates to install themselves while reboots stay manual, so that the box stays patched without a reboot landing mid-run.

### Usage-limit requeue

28. As the factory owner, I want a run that stops on a Claude usage limit to be told apart from an ordinary failure, so that waiting for the reset isn't treated as a bug.
29. As the factory owner, I want a usage-limited ticket or PR moved to `agent:queued` with a comment saying when the window resets, so that I can see why it's waiting and until when.
30. As the factory owner, I want the comment to carry a hidden marker recording the start label, the reset time and the attempt number, so that the restart needs nothing beyond what's on the ticket.
31. As the factory owner, I want an hourly clock run to restart items whose reset time has passed, so that requeued work restarts on its own.
32. As the factory owner, I want the clock run to restart a spec-chain ticket by restarting the chain, so that a spec's remaining tickets keep going in order.
33. As the factory owner, I want the clock run to put the original start label back on a PR as well as an issue, so that a usage-limited review restarts like an implement does.
34. As the factory owner, I want at most three usage-limit requeues per ticket or PR, after which it's labelled `agent:blocked`, so that a runaway run can't use up every window for days.
35. As the factory owner, I want a run that hit the limit with no readable reset time to retry five hours later, so that an unexpected message format still recovers.
36. As the factory owner, I want only failures that clearly match a usage limit to be requeued, so that a real failure isn't retried three times before I see it.
37. As the factory owner, I want two clock runs never to overlap, so that one item is never restarted twice.

### Observability and retros

38. As the factory owner, I want each agent run's transcript kept as an artifact for 90 days, so that I can read what the agent did long after the run page scrolls away.
39. As the factory owner, I want each agent run to record its turns, tokens, duration, estimated cost, task, ticket and outcome in a small stats record, so that runs can be compared without reading transcripts.
40. As the factory owner, I want the estimated cost labelled as an API-equivalent estimate, so that I don't mistake it for a charge on my subscription.
41. As the factory owner, I want a weekly retro run that reads the last seven days of artifacts, so that I see patterns across runs rather than one run at a time.
42. As the factory owner, I want the retro filed as one issue per ISO week, labelled `factory:retro`, so that I read findings in my tracker and can turn one into a ticket.
43. As the factory owner, I want the retro to skip filing when that week's issue already exists, so that a re-run doesn't file a duplicate.
44. As the factory owner, I want transcripts to stay in GitHub, next to the private code, so that code and tool output aren't sent to a third party.

### Verification

45. As the factory owner, I want a manual canary workflow that sends one trivial job to each slot, so that I can check the box end to end after any change to it.
46. As the factory owner, I want the canary to confirm each job ran on the box, uploaded a stats record, and left no runner registered and no container behind, so that the box's guarantees are checked rather than assumed.
