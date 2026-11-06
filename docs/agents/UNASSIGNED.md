# Unassigned tasks

These tasks belong to neither queue. Each has no dependencies, so the human can hand one to whichever agent has time, at any point in the build. An agent never picks one up by itself; it starts one only when the human assigns it in the conversation (PROTOCOL §5).

Each card reads: **branch** · **depends on** · **unblocks**. The assigned agent uses its own prefix: `a/u01-site` for Agent A, `b/u01-site` for Agent B. An unassigned task is never batched with queue tasks; it gets its own PR. "Spec" means [Kosha Execution Plan.md](../../Kosha%20Execution%20Plan.md) (v2).

---

### U01 · Product showcase site

`<agent>/u01-site` · depends on: none · unblocks: none · **optional for submission, recommended for the Pitch score** ([hackathon-readiness.md](../hackathon-readiness.md) §5)

A public, static site that explains Kosha to judges and visitors in a couple of minutes: what it does, how a payment flows, and the four products, with links to the real evidence. The README stays the full write-up (B18); the site is its shop window and links to it.

**Ownership:** the assigned agent owns `apps/site/` for the life of the task, and touches nothing outside it (no Console changes, no root config). The site reads nothing from Core and runs no server code.

1. `chore(site): generate app` (generated output only)
   - `apps/site`, named `@kosha/site`: the same Next.js and Tailwind v4 versions the Console uses, with `output: 'export'` so it builds to static files.
   - Its own `package.json`, a `tsconfig.json` extending `../../tsconfig.base.json`, and the lint, typecheck and test scripts copied from `packages/shared/package.json` (PROTOCOL §4).
2. `feat(site): hero and payment flow`
   - The name, *Every agent payment, tax-ready.*, and the problem in two lines: an AI agent paying an Indian API owes TDS, and nobody withholds it today.
   - The flow as a diagram: quote → one atomic split transfer (price to the API, TDS to **the payer's own 2-of-2 reserve**) → the record on HCS → the TDS file.
3. `feat(site): the four products`, one section each, taken from spec Components 1–4:
   - **Kosha Gate** for API owners: Express middleware, net prices, an install snippet.
   - **Kosha Pay** for agents: the x402 v2 client, spending policy, the Agent Kit plugin.
   - **Kosha Core**, the facilitator: verifier, tax engine, versioned rule packs, HCS log.
   - **Kosha Console** for owners and CAs: live feed, threshold counter, TDS file.
4. `feat(site): proof and links`
   - Every external link lives in **one file**, `apps/site/content/links.ts`:
     - the live Console
     - the GitHub repo
     - three HashScan transactions (a normal payment, a payment with TDS reserved, the reserve release)
     - the payments HCS topic
     - the demo video
     - the waitlist form (validation action V5)
   - A link may be `null`, and a null link renders as "coming soon". The site can ship before Gate 2; filling in links later is a one-file change.
5. `feat(site): why Hedera and labels`
   - "Why Hedera" from hackathon-readiness §5, kept short.
   - The labels "testnet", "rule pack unreviewed" and "not tax advice" on every page.
6. `chore(site): Vercel config`
   - Static-export settings and the env list (none expected).
   - The deploy command in the PR description. The human runs it as part of H6.

**Done when:**
- `pnpm --filter @kosha/site build` produces a static export.
- Lint, typecheck and tests pass.
- The page works at phone width.
- No external URL appears outside `content/links.ts`.

**Later:** when Gates 2 to 4 produce real links, the owner (or either agent, if the human says so) fills in `content/links.ts` in a small follow-up PR on a `<agent>/u01-…` branch. B18 links the README to the site once it is deployed.
