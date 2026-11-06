# Build protocol for the two Kosha agents

This file is for Agent A and Agent B, and for the human who merges their work. It has the rules both agents follow, the stack decisions that override [Kosha Execution Plan.md](../../Kosha%20Execution%20Plan.md) (called "the spec" below), and the points where the human has to step in.

The task queues are in [AGENT_A.md](AGENT_A.md) and [AGENT_B.md](AGENT_B.md).

## 1. Roles and workspaces

| | Agent A: backend | Agent B: edges |
| --- | --- | --- |
| Checkout | `~/Desktop/ETHGlobal/kosha` (main folder) | `~/Desktop/ETHGlobal/kosha-b` (git worktree) |
| Builds | Repo scaffold, `@kosha/shared` contracts, `@kosha/hedera`, Kosha Core, seed scripts, Core deploy | Research, tax engine, testnet bootstrap, Kosha Gate, Kosha Pay, demo APIs, demo agent, Kosha Console, README, demo scripts |
| Branch prefix | `a/` | `b/` |
| Task IDs | `A01`, `A02`, … | `B00`, `B01`, … |

The split is built around contracts. Agent A publishes every wire schema early (A02), so Agent B can build Gate, Pay and Console against those schemas and their fixtures before Core implements them.

## 2. Stack decisions (these override the spec)

The spec's tech stack stands except for the changes below.

| Area | Spec says | Use instead | Why |
| --- | --- | --- | --- |
| Runtime | Node.js 20 LTS | **Node.js 24 LTS** (`.nvmrc`: `24`; `engines.node >= 24`) | Node 20 reached end of life in April 2026. The dev machine already runs 24. |
| Core server | Fastify 4 + Zod | **Fastify 5 + Zod 4 + `fastify-type-provider-zod`** | Fastify 4 reached end of life in June 2025. The type provider makes routes typed by the shared schemas. |
| Jobs | BullMQ + Redis, or `node-cron` | **`node-cron` only**, running inside Core | Removes Redis from local dev and from deploy. |
| Database in tests | Docker Postgres | **PGlite** (in-process Postgres) through Drizzle | Tests need no Docker and no ports, so both agents can run them at once. Dev and deploy still use real Postgres. |
| Dev database | One Postgres | One Docker container with **one database per agent** (`kosha_a`, `kosha_b`) | Keeps the agents from overwriting each other's ledgers. |
| Internal packages | Built packages | `@kosha/shared`, `@kosha/hedera` and `@kosha/tax-engine` **export TypeScript source** (`"exports": "./src/index.ts"`). Only `@kosha/gate` and `@kosha/pay` build with `tsup`, bundling the internal packages. | No build-order friction in Turborepo. Next.js consumes them through `transpilePackages`. |
| Console | Next.js 15 | **Latest stable Next.js** (16 or later), Tailwind v4, shadcn/ui, TanStack Query 5, Recharts | Current versions; Tailwind v4 is what `coding-standards` expects. |
| Console auth | HashPack WalletConnect + email magic link | **Demo sign-in** (pick API owner, agent owner or CA) behind `DEMO_AUTH=1`. Console calls Core **only from Next.js server code** using `CONSOLE_ADMIN_TOKEN`; the browser never sees Core credentials. SSE is proxied through a route handler. | A magic link needs an email provider and WalletConnect costs a day; judges see neither. The sweep co-sign uses a script (WalletConnect is a stretch goal). |
| Settlement token | Circle testnet USDC | `SETTLEMENT_TOKEN_ID` env. Bootstrap mints a 6-decimal **`tUSDC`** test token for development; switch to **Circle testnet USDC** for the recorded demo | Faucet limits can't block development or burst runs. The code path is the same either way. |
| Credentials | "Core's test issuer signs" | **Ed25519 signatures** with `@hashgraph/sdk` keys over canonical JSON | No new crypto dependency. |
| x402 names | v1, `X-PAYMENT` | Whatever B00 confirms is current. Every header and field name lives in `packages/shared/src/headers.ts` | The spec is still moving; this makes a change one line. |
| Demo agent LLM | `@langchain/openai` | Chosen by env: `LLM_PROVIDER=anthropic\|openai` | Use whichever API key is available. |
| Tax engine tests | 30+ cases | 30+ cases **plus `fast-check` property tests** (never under-deducts; TDS never decreases as value rises) | Catches rounding edge cases that hand-written examples miss. |

### Design fixes to the spec (all serve "never under-deduct")

1. **Concurrent quotes.** Two quotes issued for one pair just under the threshold would both see the old yearly total, and both would skip TDS. Fix: the total used for a decision is the settled value, plus outside payments, plus the value of the pair's **open quotes** (not expired, not used). An abandoned quote can cause over-deduction, which the spec allows.
2. **Receiver residency.** `decide()` also takes `receiver.residency`. A non-resident receiver (a foreign API) means no TDS and a `fema_review` flag; the spec's "payments to foreign APIs" row requires this, but its `decide()` code doesn't check it.
3. **Payer identification.** The payer is the **only debiting account** in the signed transaction. For a registered agent, that account must be one of its declared wallets. The payer's public key comes from the Mirror Node for that account.
4. **Fee-payer protection** (on top of the spec's checks):
   - `maxTransactionFee` must not exceed `MAX_TX_FEE_HBAR`.
   - The quote names `nodeAccountIds`, and the transaction must use exactly those.
   - The transaction's valid start must fall inside the quote window.
   - The transaction must have no NFT transfers and no approved (allowance) transfers.
5. **Receipt timeouts.** If execution succeeded but the receipt times out, reconcile through the Mirror Node using the transaction ID. Never execute the transaction again.
6. **HCS outbox.** Settlement writes an `hcs_outbox` row in the same database transaction as the payment. A loop publishes the rows and records the sequence numbers. This implements the spec's "retried until it succeeds".
7. **Funding split** lives in the tax engine as `applyFunding()`. With `payer` funding, the API gets the full price and the payer pays price plus TDS. With `price_inclusive`, the API gets price minus TDS.
8. **Money** is always stored as integer minor units (`bigint`: micro-USDC and paise) and sent over the wire as decimal strings. It is never a float.

## 3. Read order for an agent

1. [CLAUDE.md](../../CLAUDE.md), which tells you your role
2. This file
3. Your queue: [AGENT_A.md](AGENT_A.md) or [AGENT_B.md](AGENT_B.md)
4. The sections of the spec that your current task points to

## 4. File ownership

Edit only what you own. If you need a change in the other agent's area, file a request (§8). Each package's own `package.json` belongs to that package's owner, so adding a dependency to your own package is always allowed.

| Owner | Paths |
| --- | --- |
| **Agent A** | Root config (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, lint, format and Vitest config), `.github/`, `.gitignore`, `.env.example` (Agent B may add lines only under its `# --- Agent B ---` section), `packages/shared/`, `packages/hedera/`, `apps/core/`, `scripts/package.json`, `scripts/seed.ts`, `scripts/smoke-settle.ts`, `scripts/cosign-sweep.ts`, `docs/core-api.md` |
| **Agent B** | `docs/research/`, `docs/architecture.md`, `docs/testnet-accounts.md`, `rulepacks/`, `packages/tax-engine/`, `packages/gate/`, `packages/pay/`, `apps/demo-api-in/`, `apps/demo-api-global/`, `apps/demo-agent/`, `apps/console/`, `scripts/bootstrap.ts`, `scripts/lib/` (env-file helpers), `scripts/register-agents.ts`, `scripts/pay-once.ts`, `scripts/burst.ts`, `scripts/demo.ts`, `README.md` |
| **Both** | `pnpm-lock.yaml`: never edit it by hand; regenerate it (§7) |
| **Human only** | `Kosha Execution Plan.md`, `CLAUDE.md`, `docs/agents/`, `scripts/agent/`. To change one of these, propose it in your PR description or your report. |

A01 creates package skeletons (`package.json`, `tsconfig.json`, `src/index.ts`) for every package, including Agent B's, and root `pnpm` scripts for every script in the table. Once A01 is merged, ownership of each skeleton passes to the owner listed above, and neither agent needs to edit root files again.

## 5. The task loop

Repeat until your queue is finished.

1. **Sync.**
   - `git fetch origin`
   - `scripts/agent/tasks.sh status`
   - `gh issue list --label for-agent-a` (Agent B uses `for-agent-b`). Any open request addressed to you comes before your queue (§8).
2. **Choose** the first task in your queue, top to bottom, that has no PR yet and whose dependencies are all met:
   - **A dependency on the other agent** is met only when it is **merged into `main`**. Check with `scripts/agent/tasks.sh check <IDs>`.
   - **A dependency on your own task** is met when it is merged, **or** when it has an open PR and your stack of unmerged PRs is at most **2 deep**. In that case, branch from your open branch (stacking).
   - Tasks marked *(optional, cut N)* come after everything else in your queue. They are ordered in reverse of the spec's cut list, so the first item cut is the last one built. Skip them if the human says the team is behind.
3. **If nothing can start, you are blocked.** Do not start a task early, and do not copy the other agent's unmerged code.
   - Start `scripts/agent/tasks.sh wait <IDs>` with `run_in_background`. You will be woken up when it exits.
   - End your turn with a **BLOCKED report** (§9) naming what the human has to do. Usually that is merging a specific PR.
4. **Branch.**
   - Normally: `git switch -c a/09-quote origin/main`.
   - When stacking: `git switch -c a/09-quote a/08-hedera-io`, and open the PR with `--base a/08-hedera-io`.
5. **Build in small commits**, pushing after each one (§6). Open a **draft PR** after your first push, with the template filled in, including *Unblocks*.
6. **Finish.**
   - Run `pnpm turbo run typecheck lint test --filter=...[origin/main]`. This covers changed packages and everything that depends on them.
   - Fill in *How it was tested*, then run `gh pr ready <n>`.
   - Put a **READY line** (§9) in your next report.
7. **After a parent PR merges**, rebase every branch stacked on it: `git fetch origin && git rebase origin/main && git push --force-with-lease`. GitHub retargets stacked PRs to `main` automatically when the parent branch is deleted on merge (H0 turns this on).

## 6. Commits and PRs (the hackathon rewards frequent, small commits)

- **One task is one PR.** Keep a PR to about **400 changed lines**, not counting generated files and the lockfile. If a task grows past that, split it into `A09` and a follow-up PR on a branch named `a/09-quote-2` that references the same task. `tasks.sh` treats both as `A09`, so finish both before marking the task done.
- **Keep each commit to about 150 changed lines.** Each one must typecheck and pass the touched package's tests, so the history stays bisectable.
- **Commit at least every 30 to 45 minutes of work, and push immediately.** The public history should show steady progress.
- **Message format:** Conventional Commits, `type(scope): subject`.
  - Scopes: `repo`, `shared`, `hedera`, `core`, `tax-engine`, `gate`, `pay`, `console`, `demo-api`, `demo-agent`, `scripts`, `docs`, `ci`.
  - Add no AI attribution trailers.
- **Generated output gets its own commit** with nothing else in it. Examples: `chore(console): generate Next.js app`, shadcn/ui components, Drizzle migrations.
- **Stage files by explicit path.** Never use `git add -A` or `git add .`; the `.env` symlink and `.env.local` must never be staged.
- **Never** push to `main`, merge a PR, force-push a branch you don't own, publish packages, or run a deploy.

## 7. Rebasing and conflicts

- Rebase only your own branches, and push them with `--force-with-lease`.
- **`pnpm-lock.yaml` conflicts.**
  1. Don't resolve them by hand. Run `git checkout --ours pnpm-lock.yaml`; during a rebase, `--ours` is the new base.
  2. Run `pnpm install --lockfile-only`.
  3. Run `git add pnpm-lock.yaml && git rebase --continue`.
- A conflict in a file you don't own means a rule was broken. Stop and report it instead of resolving it.

## 8. Cross-agent requests

If you need something in the other agent's area (a schema field, an endpoint, a fixture), don't edit it yourself.

1. **File the request:**
   ```bash
   gh issue create --label for-agent-b --title "[A→B] <what>" \
     --body "<why, exact shape wanted, which of my tasks waits on it>"
   ```
2. Pick another unblocked task. If your next task depends on the request, add the issue to that task's dependencies (for example `scripts/agent/tasks.sh wait '#14'`).
3. **The receiving agent** handles open requests before its queue.
   - Branch: `b/r14-<slug>` (agent prefix, `r`, then the issue number).
   - PR body: `Closes #14`.
   - The issue closes when the PR merges into `main`, and that is the requester's signal.

## 9. Reporting to the human

End every turn with whichever of these lines apply, so the human can act without reading the whole transcript:

```
READY:   #12 A09 quote service (unblocks A10; Agent B waits on nothing)
BLOCKED: next task A10 needs B03 (PR #9 open, needs merge) — waiting in background on: tasks.sh wait B03
HUMAN:   H2 — run `pnpm bootstrap` needs CORE_ACCOUNT_ID/CORE_PRIVATE_KEY in ../kosha.env
DONE:    queue finished except optional tasks A19–A22
```

## 10. Local runtime: env, ports, databases

- **Shared env.** One file at `~/Desktop/ETHGlobal/kosha.env`, outside both checkouts, is symlinked as `.env` in each checkout. Bootstrap (B03) writes the generated account IDs, topic IDs and secrets into it, so both agents see them at once.
- **Per-checkout overrides.** Put these in `.env.local`, which is gitignored. The env loader that A01 writes resolves the repo root, reads `.env` and then `.env.local`, and lets `.env.local` win.
- **Tests never touch Postgres or testnet.** They use PGlite and fakes. Opt-in testnet tests run only with `KOSHA_TESTNET=1`.
- **Stop the dev servers you started** when your task is finished.

| | Agent A (`kosha/.env.local`) | Agent B (`kosha-b/.env.local`) |
| --- | --- | --- |
| Core | `CORE_PORT=4000`, `CORE_URL=http://localhost:4000` | `CORE_PORT=4100`, `CORE_URL=http://localhost:4100` |
| Demo APIs | none | `DEMO_API_IN_PORT=4101`, `DEMO_API_GLOBAL_PORT=4102` |
| Console | none | `CONSOLE_PORT=3000` |
| Database | `DATABASE_URL=postgres://postgres:kosha@localhost:5432/kosha_a` | `DATABASE_URL=postgres://postgres:kosha@localhost:5432/kosha_b` |

Agent B runs its own Core from its checkout, against `kosha_b`, whenever it needs an end-to-end run. Both Cores share the testnet accounts. That is fine because every Hedera transaction ID is unique.

Never print, log, commit or paste private keys, including in PR descriptions. Account IDs and HashScan links are fine.

## 11. Human checkpoints

| ID | When | What the human does |
| --- | --- | --- |
| **H0** | Before starting the agents | See the preflight in §12 |
| **H1** | First PRs ready (A01, B00) | Merge them. Everything else waits on these two. |
| **H-merge** | Whenever a READY line appears | Merge with **Create a merge commit**, bottom of a stack first. A PR whose *Unblocks* names the other agent comes first. **Never merge a PR whose base is not `main`**; wait for GitHub to retarget it. |
| **H2** | Before B03 runs | `CORE_ACCOUNT_ID` and `CORE_PRIVATE_KEY` (a portal.hedera.com testnet account with HBAR) are in `kosha.env` |
| **H3** | B12 READY (**Gate 2**) | Open the HashScan link and confirm two token transfers (API and escrow) and one HCS message. This meets the Hedera track minimum. |
| **H4** | Before B13 | Add `LLM_PROVIDER` and the matching API key to `kosha.env` |
| **H5** | Before recording | Get Circle testnet USDC for the agent accounts, set `SETTLEMENT_TOKEN_ID` to Circle's token, and re-run bootstrap's association step |
| **H6** | A16 and B19 READY | Log in to Fly or Railway and Vercel, set secrets, run the deploy commands from `docs/core-api.md` and the README, then run `pnpm demo` against the deployed stack twice |
| **H7** | End | Record the video in your own voice, then submit |

### Gates (from the spec's action plan)

| Gate | Passes when merged | Meaning |
| --- | --- | --- |
| Gate 1: foundations | A04, A07, B02, B05, B08 | Tax engine, verifier, Gate and Pay are unit-tested against the shared contracts |
| Gate 2: first split payment | B12 | Price and TDS settled in one transaction, visible on HashScan |
| Gate 3: demo-complete | A14, A15, B13, B14, B15, B17 | `pnpm demo` passes locally, end to end |
| Gate 4: shipped | A16, B19, B18 | Deployed, demo run twice, README links in place |

If Gate 2 slips badly, tell both agents to skip every *optional* task.

## 12. Preflight (H0), done once by the human

```bash
cd ~/Desktop/ETHGlobal/kosha
# 1. These docs must be on main before the worktree is made
git add "Kosha Execution Plan.md" CLAUDE.md .gitignore .github docs/agents scripts/agent
git commit -m "docs: execution plan and agent build protocol" && git push

# 2. Repo settings: keep every commit, auto-retarget stacked PRs, request labels
gh repo edit --enable-squash-merge=false --enable-rebase-merge=false --enable-merge-commit --delete-branch-on-merge
gh label create for-agent-a --color 1f6feb && gh label create for-agent-b --color 8957e5

# 3. Worktree for Agent B (detached; the agent creates its own branches)
git worktree add --detach ../kosha-b origin/main

# 4. Shared env, symlinked into both checkouts
touch ../kosha.env && chmod 600 ../kosha.env
ln -s ../kosha.env .env && ln -s ../kosha.env ../kosha-b/.env
#    then put CORE_ACCOUNT_ID, CORE_PRIVATE_KEY and HEDERA_NETWORK=testnet into ../kosha.env

# 5. Postgres: one container, one database per agent
docker run -d --name kosha-pg -e POSTGRES_PASSWORD=kosha -p 5432:5432 postgres:16
sleep 3 && docker exec kosha-pg createdb -U postgres kosha_a && docker exec kosha-pg createdb -U postgres kosha_b
```

Then create each `.env.local` from §10 and start the agents:

- **Agent A**, in `kosha/`: `claude "You are Agent A. Follow CLAUDE.md, then work your queue in docs/agents/AGENT_A.md."`
- **Agent B**, in `kosha-b/`: `claude "You are Agent B. Follow CLAUDE.md, then work your queue in docs/agents/AGENT_B.md."`

Both agents commit, push their own branches, open PRs and file issues without asking. That authority is granted here. Allow `git push`, `gh pr *` and `gh issue *` in each session, or run the sessions in auto mode.

## 13. Cross-agent dependencies

```mermaid
flowchart LR
  subgraph A[Agent A]
    A01 --> A02 --> A03 --> A04
    A02 --> A05 --> A06 --> A07
    A03 --> A08
    A07 --> A09 --> A10 --> A11
    A10 --> A12 & A13
    A11 & A13 --> A14
    A13 --> A15
  end
  subgraph B[Agent B]
    B00
    B01 --> B02
    B01 --> B07
    B03
    B04 --> B05 --> B06
    B07 --> B08
    B09 --> B10 --> B11
    B12 --> B13 & B17 & B18
    B11 --> B14
    B10 --> B15 & B16
  end
  B00 --> A02
  A01 --> B01 & B03 & B09
  A02 --> B04 & B07 & B10
  A03 --> B08
  B02 --> A09
  B03 --> A10
  B06 & B08 & A11 --> B12
  A12 --> B16 & B17
  A13 & A14 --> B14
  A15 --> B15
```

The expected flow, in waves. The agents don't follow it literally; the task loop sorts out the order.

| Wave | Agent A | Agent B | Human |
| --- | --- | --- | --- |
| 0 | A01 scaffold | B00 research | H1: merge both |
| 1 | A02 contracts → A03 builder → A04 verifier | B01 rule pack → B02 `decide()` → B03 bootstrap | Merge B02 and B03 quickly; A needs them next |
| 2 | A05 → A06 → A07 → A08 | B04 → B05 → B06 (Gate, demo APIs), B07 → B08 (Pay) | Gate 1 |
| 3 | A09 quote → A10 settle → A11 seed | B09 → B10 → B11 (Console on fixtures) | |
| 4 | | B12 first split payment | **H3: Gate 2** |
| 5 | A12 → A13 → A14 → A15 | B13 agent → B14 wiring → B15 → B16 → B17 → B18 | H4 |
| 6 | A16 deploy, then optional tasks | B19 → B20, then optional tasks | H5, H6 |
