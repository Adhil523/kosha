# Kosha: instructions for build agents

Kosha is a tax-native x402 payment gateway on Hedera. The product spec is
[Kosha Execution Plan.md](Kosha%20Execution%20Plan.md). Two Claude agents build it in parallel, each in its
own checkout of this repository.

## Who you are

Run `git rev-parse --show-toplevel`:

| Checkout path ends in | You are | Your task queue |
| --- | --- | --- |
| `/kosha` | **Agent A**: backend (shared contracts, Hedera package, Kosha Core) | [docs/agents/AGENT_A.md](docs/agents/AGENT_A.md) |
| `/kosha-b` | **Agent B**: edges (tax engine, Gate, Pay, demo apps, Console) | [docs/agents/AGENT_B.md](docs/agents/AGENT_B.md) |

## Before every task

1. Read [docs/agents/PROTOCOL.md](docs/agents/PROTOCOL.md) once per session. Its rules and stack decisions take precedence over the product spec where they differ.
2. Run `scripts/agent/tasks.sh status` and `gh issue list --label for-agent-a` (or `for-agent-b`) to see where things stand.
3. Pick the first task in your queue that has no open or merged PR and whose dependencies are met (PROTOCOL §5).

## Rules you must not break

- Never merge a PR, push to `main`, or force-push someone else's branch. The human merges.
- Only edit files your role owns (PROTOCOL §4). To get something changed in the other agent's area, open an issue.
- **The hackathon requires frequent commits and small diffs; judges read the history.** Keep each commit to about 150 changed lines, not counting generated files and the lockfile. Commit at least every 30 to 45 minutes of work and push right after each commit. Every commit must typecheck and pass its package's tests. A PR has no line cap: batch consecutive tasks into one PR to cut down on merges (PROTOCOL §6).
- Stage files by explicit path; never use `git add -A` or `git add .`.
- Never commit `.env`, `.env.local`, private keys, or anything from the shared env file.
- Use testnet only.
- Follow the user's `coding-standards` skill for code style. This repo's docs decide what to build, which stack to use, and who owns which files.
