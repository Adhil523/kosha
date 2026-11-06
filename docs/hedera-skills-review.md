# Kosha × Hedera Skills: review of main

2026-11-07 · Agent A (Adhil Rumais)

## Summary

Five Hedera skills found 31 code findings in `main`, 3 of them high. All 31 are fixed, in two draft PRs: [#71](https://github.com/Adhil523/kosha/pull/71) (Core, `@kosha/hedera`, shared) and [#72](https://github.com/Adhil523/kosha/pull/72) (Gate, Pay, demo agent, bootstrap; stacked on #71). Fixing them turned up one more hole, which is fixed too. The hackathon validator scored the submission 23/35.

- **Fixed, high:**
  - A quote signed for a cheap route could pay for an expensive one (X1). The fix had two parts: first the client's echoed terms, then Core reporting the quoted price so Gate matches it to the route.
  - One unpublishable HCS message could block the outbox for good (C1).
  - Outbox retries could post the same evidence twice (C2).
- **Fixed, medium:** among others, Core's fee payer is protected from unfunded payers (X2), and a lost settle response no longer strands a paying client (X3). Failed scheduled releases are no longer recorded as executed (T1). The Pay tool no longer fetches arbitrary hosts (K2), and it honours the agent's approval mode (K3). The demo agent no longer holds Core's key (C5).
- **Still open:** what needs people. That means outside feedback, a waitlist, a demo video and a deployed URL for the submission, one testnet bootstrap run, and a merge-order note for Agent B's PR #69.
- **Checks:** typecheck, lint and tests pass for every changed package and its dependents, 30 of 30 turbo tasks. Every behaviour change has a test that fails against the previous code.

## Process

The review applied five of the 25 skills in [hedera-dev/hedera-skills](https://github.com/hedera-dev/hedera-skills) (commit `8b1fccd`, 2026-09-03) to `origin/main` at `b03ed39` (merge of PR #68).

1. **Source.** The skills repo was cloned into a scratch directory and treated as reference material. It is a plugin marketplace, not one skill.
2. **Lens selection.** Each skill was matched against what Kosha actually imports (`@x402/*` 2.30.0, `@hiero-ledger/sdk` 2.90.1, `@hashgraph/hedera-agent-kit` 4.2.0). The skills for Solidity system contracts, oracles, cross-chain, harness and dev workflow were skipped because Kosha uses none of those.
3. **Parallel review.** One reviewer per lens read its skill in full, then checked the code in a clean, detached checkout of `main`. No network calls and no writes.
4. **Verification.** Each finding had to point at a file and line. Findings were then re-checked against the code before any fix.
5. **Fixes, pass 1.** Fixes were limited to Agent A's paths ([PROTOCOL §4](agents/PROTOCOL.md): `packages/shared`, `packages/hedera`, `apps/core`, root config, the seed, smoke-settle and cosign scripts). They went onto `a/hedera-skills-fixes` as small commits, each one typechecked and tested.
6. **Fixes, pass 2.** With the human's go-ahead, Agent B's files were fixed too, on `a/hedera-skills-b-fixes`, stacked on pass 1. Agent B's open PR #69 touched none of those files. Gate and Pay went to two agents in separate worktrees, and their commits were reviewed before being cherry-picked. The human chose the topic-key design (C5) and the license.

| Lens | Skill | Kosha code in scope |
| --- | --- | --- |
| x402 | native-services-js / x402-payments | Gate, Pay, Core facilitator, verify and settle, shared x402 contracts |
| Token Service | native-services-js / hedera-token-service | `@kosha/hedera` transfers and verifiers, reserve releases, schedules, bootstrap token |
| Consensus Service | native-services-js / hedera-consensus-service | HCS client, outbox, settlement events, HCS-11 profiles, topic bootstrap |
| Agent Kit | agent-kit-plugin, agent-kit-policy, agent-kit-v4-migration | Pay's kit plugin and policy, demo agent |
| Submission | hackathon-helper / validate-submission | README, docs, CI, commit history |

Plan v2 had already been revised once against this skills repo (PROTOCOL §2), so this pass checks the implementation rather than the design.

## Findings by lens

The four code lenses produced 31 findings: 3 high, 10 medium, 18 low or low-medium. Each one was traced to a file and line in `main`. IDs are used in the Fixes section.

### x402 payments

| ID | Severity | Finding | Where | Owner |
| --- | --- | --- | --- | --- |
| X1 | High | A quote signed for a cheap route can pay for an expensive one. Gate checks the client-sent `accepted.amount` against the route; Core never compared that entry with the stored quote. | `gate/src/gate-handler.ts:138`, `core/src/payment-verify.ts:61` | A (Core), B (Gate) |
| X2 | Medium | No balance or token-association check before Core signs as fee payer, so an unfunded payer burns Core's HBAR on failed transfers. | `core/src/payment-verify.ts:141` | A |
| X3 | Medium | If Gate times out while settle is still landing, the client's retry is refused as `replay`: paid, nothing served. | `gate/src/core-client.ts:13`, `core/src/payment-settle.ts:110` | A, B |
| X4 | Low | Kosha Pay uses the exact current millisecond as valid start, so two payers in the same millisecond collide. | `hedera/src/quoted-transfer.ts:50`, `pay/src/kosha-split-scheme.ts:79` | A, B |
| X5 | Low | Legacy `X-PAYMENT` is read but decoded as v2, and is missing from the CORS allow-list. | `gate/src/gate-handler.ts:321`, `shared/src/headers.ts:34` | B |
| X6 | Low | A failed-payment 402 has no `PAYMENT-REQUIRED`, so a stock x402 client can't retry. | `gate/src/gate-handler.ts:96` | B |
| X7 | Low | Pay rejects a whole 402 if any `accepts` entry uses a network or scheme it doesn't model. | `shared/src/x402-payment.ts:103` | A |

### Hedera Token Service and schedules

| ID | Severity | Finding | Where | Owner |
| --- | --- | --- | --- | --- |
| T1 | Medium-high | A reserve release is marked executed when its schedule runs, even if the transfer inside it failed. | `core/src/releases.ts:124` | A |
| T2 | Medium | Releases from the pooled compatibility reserve need Core + compliance keys, but the co-sign script signs with the agent key. | `core/src/monthly-close.ts:70`, `scripts/cosign-release.ts:110` | A |
| T3 | Medium | A `DUPLICATE_TRANSACTION` precheck counted as a definite failure, though the SDK's node failover can produce it after the first submission landed. | `hedera/src/executor.ts:45` | A |
| T4 | Medium | The outside-payment watcher reads only `CRYPTOTRANSFER`, so airdrops and contract transfers are missed. | `hedera/src/mirror.ts:158` | A |
| T5 | Low | Core claims the quote before checking that the transaction's own validity window is still open. | `core/src/payment-verify.ts:79` | A |
| T6 | Low | Token decimals are assumed to be 6 and never checked on chain. | `hedera/src/quoted-transfer.ts:59` | A |
| T7 | Low | Bootstrap can fund an agent twice when the Mirror Node lags. | `scripts/lib/bootstrap-association.ts:68` | B |
| T8 | Low | tUSDC has no admin key. Accepted for a dev token. | `scripts/lib/bootstrap-token.ts:18` | B |

### Hedera Consensus Service

| ID | Severity | Finding | Where | Owner |
| --- | --- | --- | --- | --- |
| C1 | High | One message that can never publish (oversized `chain` or `transactionRef`, permanent status) blocks the outbox for good once 20 accumulate. | `core/src/hcs-outbox.ts:25`, `shared/src/facilitator-api.ts:88` | A |
| C2 | High | Outbox retries post the same message twice: each retry gets a new transaction ID, so a receipt timeout or a crash after submit duplicates the evidence log. | `core/src/hcs-outbox.ts:35`, `hedera/src/hcs.ts:25` | A |
| C3 | Medium | A failed row is skipped and later rows publish first, so a topic's order can differ from the order events happened. | `core/src/hcs-outbox.ts:33` | A |
| C4 | Low-medium | An HCS-1 profile chunk serializes to about 1,038 bytes and is split by the SDK into two messages. | `scripts/lib/hcs11-inscribe.ts:27` | B |
| C5 | Low | Topics have no admin key, so a leaked Core key can't be rotated; the demo agent also holds Core's key. | `scripts/lib/bootstrap-topics.ts:27`, `demo-agent/src/agent.ts:52` | B, human |
| C6 | Low | The receipt's running hash and consensus time are discarded. | `hedera/src/hcs.ts:33` | A |

### Hedera Agent Kit

All ten are in Agent B's packages (`packages/pay`, `apps/demo-agent`, `docs/research`). No v3 leftovers were found.

| ID | Severity | Finding | Where |
| --- | --- | --- | --- |
| K1 | Medium | The `execute` override calls the post-hook itself, so a settled payment whose body read fails is reported unpaid and audited as an error. | `pay/src/agent-kit-plugin.ts:133` |
| K2 | Medium | The URL is fetched before any policy runs, so the tool fetches any host, including metadata IPs, when there is no 402. | `pay/src/prepare-payment.ts:87` |
| K3 | Medium | The tool ignores `AgentMode`, signing and settling even in `RETURN_BYTES` and human-approval modes. | `pay/src/agent-kit-plugin.ts:78` |
| K4 | Low-medium | The tool type is `other`, not `transaction`, so type-based kit policies skip it. | `pay/src/agent-kit-plugin.ts:62` |
| K5 | Low-medium | Pay's own caps are checked before and recorded after the request, so concurrent calls can exceed them. | `pay/src/prepare-payment.ts:105` |
| K6 | Low | The budget policy returns `true` instead of throwing a reason, and records spend before later policies run. | `pay/src/agent-kit-plugin.ts:189` |
| K7 | Low | A user who adds `coreTokenPlugin` gets an uncapped USDC transfer tool beside the capped one. | `pay/src/agent-kit-plugin.ts:179` |
| K8 | Low | Tool name lacks `_tool`, `url` has no `.describe()`, and there is no output parser. | `pay/src/agent-kit-plugin.ts` |
| K9 | Low | The peer dependency is `^4.2.0`, but the override relies on 4.2.0 internals. | `pay/package.json:48` |
| K10 | Low | `docs/research/agent-kit.md` still describes plain `Tool` objects. | `docs/research/agent-kit.md` |

### Hackathon submission scorecard

The validator scored the project **23/35 (about 65%)**. The build and Hedera depth score well. Validation (no outside feedback recorded) and a judge-facing surface that hides how much is built hold it down.

| Criterion | Weight | Score | Main gap |
| --- | --- | --- | --- |
| Innovation | 10% | 4/5 | No prior-art comparison |
| Feasibility | 10% | 4/5 | Pricing still a proposal |
| Execution | 20% | 4/5 | No deployed URL; README lists built features as in progress |
| Integration | 15% | 4/5 | No HashScan proof of the scheduled release; no wallet partner |
| Validation | 15% | 1/5 | Feedback table empty, no waitlist |
| Success | 20% | 3/5 | Testnet only, no usage numbers |
| Pitch | 10% | 3/5 | No video, deck or market-size figure |

Other blockers it found: `.env.example` contradicted the README's setup steps; Run-locally omits `pnpm register-agents` and the LLM key; there is no LICENSE.

## Fixes applied

All 31 findings are fixed in two passes. Every commit typechecks and passes its package's tests. Every behaviour change has a test that fails without it.

### Pass 1: Agent A's code (PR #71)

| Finding | Fix | Commits |
| --- | --- | --- |
| X1 | Core requires the echoed `accepted` amount, `payTo` and asset to match the stored quote, so a raised amount fails with `amount_mismatch` | `1be82da` |
| C1 | `chain` must be a CAIP-2 ID and `transactionRef` is capped at 128 characters; a message over 1,024 bytes is set aside (`abandonedAt`) instead of blocking the queue | `c8262d7`, `761b5bb` |
| C2 | Each HCS message gets its transaction ID before submit; after an unknown outcome the outbox asks the Mirror Node about that ID and posts again only if it never landed | `6de12ae`, `c5a9f76`, `b8fc1a8`, `761b5bb` |
| C3 | A failed row holds later rows on the same topic; shutdown waits for a publish in flight | `caa569b` |
| T3 | `DUPLICATE_TRANSACTION` is an unknown outcome, so settle and the forwarder ask the Mirror Node instead of failing or paying twice | `73ec88f` |
| T1 | A release whose scheduled transfer failed is marked `failed`, read from the transfer's own result | `ea6dd5b`, `fc8fa7d` |
| T2 | `cosign-release` signs pooled-reserve releases with the compliance key | `219b5e9` |
| T5 | A transaction past its valid duration, or not yet valid, is refused before the quote is claimed | `10f1d21` |
| X2 | A payer whose token balance is below the debit, or who isn't associated, is refused (`insufficient_funds`) before Core signs | `596ba32`, `ff93e2a` |
| X3 | A retried settle with the same signed transaction gets the earlier result instead of `replay`; the payer's signature is re-checked | `65fb7e6` |
| T4 | The outside-payment scan reads every transaction type, so airdrops and contract transfers count | `c278473` |
| X4 | Random nanoseconds inside the signing millisecond keep transaction IDs apart | `fa0867f` |
| X7 | `offeredPaymentRequiredSchema` drops 402 entries Kosha doesn't model | `51cdc71` |
| T6 | Quoted transfers, forwards and releases declare the token's 6 decimals, so the network refuses a token with other decimals; the split verifier requires the declaration | `03521b1`, `ecb9cb5` |
| C6 | The outbox keeps each message's running hash with its sequence number | `bf8c566`, `25e83e6` |
| Submission | `.env.example` matches the README's setup steps and database name | `ef5d873` |
| Docs | [`docs/core-api.md`](core-api.md) covers the new refusals, the retried settle, `failed` releases and the outbox | `78ed3b1` |

### Pass 2: Agent B's files, with the human's go-ahead (PR #72)

Gate and Pay were fixed by two parallel agents in their own worktrees. Their commits were reviewed and cherry-picked; edits they made to human-owned files were dropped.

| Finding | Fix | Commits |
| --- | --- | --- |
| X1 (route) | Core reports the quoted API price on verify and settle; Gate serves only the route priced at exactly that. This closes the `exact` case and a hole the retried settle opened: a resent cheap payment serving a dearer route | `f863f15`, `4921f32`, `1d7d67c` |
| X3 (Gate) | Settle gets 75 s, above Core's receipt-plus-Mirror wait; a resent payment goes to settle for Core's earlier result | `25efa35`, `b26c3d8` |
| X6 | A failed 402 carries a fresh `PAYMENT-REQUIRED`, but not after `settlement_pending`, `replay`, a reserve-proof mismatch or a `policy_*` refusal | `c6353dc` |
| X5 | Gate stops reading the v1 `X-PAYMENT` header | `5b8c4a1` |
| X7 (Pay) | Pay parses 402s with `offeredPaymentRequiredSchema` | `7725205` |
| K2 | The host allowlist is checked before any fetch; private, loopback, link-local and metadata IPs are always refused; redirects are manual | `a0df543` |
| K5 | Caps are held when a payment is signed and freed if it doesn't go ahead | `5ad46f8` |
| K1 | A settled payment stays paid with its transaction ID when the body read or a later hook fails | `5c066ab` |
| K3, K4 | The tool pays only in `AUTONOMOUS` mode and is typed as a transaction tool | `327ab49` |
| K6 | The budget policy throws, naming the cap and amounts, and gives back what doesn't go ahead | `873b7bd` |
| K8 | Renamed to `kosha_paid_fetch_tool`, with a described `url`, a Parameters section and an output parser | `ee278e4`, `08712e8` |
| K9 | The Agent Kit peer is pinned to `4.2.0` | `9abfa66` |
| K7, K10 | Pay's README explains the mode and why to reject raw transfer tools; the research note requires `BaseTool` | `5bdb4d3`, `f0001ad` |
| C5 | An audit account, created by bootstrap, owns the audit topic; the demo agent posts with it and no longer receives `CORE_PRIVATE_KEY` | `acf983c`, `22d80df` |
| C4 | Each HCS-1 profile chunk fits one HCS message, envelope included | `0f6291f` |
| T7 | Bootstrap never funds an agent whose balance it couldn't read | `3682bfb` |
| T8 | tUSDC gets Core's key as admin key; the compliance account gets HBAR for the pooled-reserve ScheduleSign | `0cc8281`, `acf983c` |
| Submission | MIT LICENSE | `7c5a815` |

Behaviour changes visible to other code:

- A settle sent twice with the same payload returns the first result instead of `replay`; the transfer still runs once.
- `ERROR_CODES` gains `insufficient_funds`; release statuses gain `failed`; verify and settle responses gain `priceMicroUsdc`.
- The Pay tool is `kosha_paid_fetch_tool` (constant `KOSHA_PAID_FETCH_TOOL`). It refuses outside `AUTONOMOUS` mode and refuses private-address hosts with `blocked_host`. `pay.release(payment)` frees a held payment that won't be sent.
- Gate's settle can take up to 75 s, and a failed 402 can carry `PAYMENT-REQUIRED`.

## Still open

None of the 31 findings is open. What remains needs people or a merge-order decision:

- **Testnet, once #72 merges:**
  - Run `pnpm bootstrap`. It creates `AUDIT_ACCOUNT_ID` and `AUDIT_PRIVATE_KEY` and replaces the audit topic.
  - Copy the env to `kosha-b`.
  - Top up the existing compliance account with HBAR.
  - Confirm once that a schedule's `executed_timestamp` matches the consensus timestamp of the transfer it ran (T1).
- **Agent B's open PR #69:** it adds `RELEASE_STATUS_LABELS` in `apps/console/lib/monthly.ts`. Once #71 is merged too, that map needs a `failed` label, or Console's typecheck fails.
- **Human-owned docs:** `Kosha Execution Plan.md`, `docs/agents/PROTOCOL.md` and `docs/agents/AGENT_B.md` still name the tool `kosha_paid_fetch`.
- **Submission:** outside feedback for the Validation table, a waitlist, a demo video, a deployed Console URL, and the README's stale "in progress" labels. Agent B's #69 already edits the README.

## Where the skills are out of date

The skills lag the versions Kosha pins in several places, so their advice was checked against installed type definitions before any finding relied on it. None of these gaps changed a fix.

| Skill | What it says | What the pinned version does |
| --- | --- | --- |
| x402-payments | Asset `0.0.0`, prices in tinybars; fee payer must be ECDSA | `@x402/hedera` 2.30.0 supports HTS tokens and defaults to USDC; nothing enforces ECDSA |
| x402-payments | A three-step facilitator check | 2.30.0 also checks that `accepted` matches the requirements, the fee payer is its own, and the payer's balance (the basis for X1 and X2) |
| hedera-token-service | Amounts are `number` or `Long` | SDK 2.90.1 also takes `bigint` |
| hedera-token-service | Examples skip `getReceipt()`; no word on minor units, decimals checks, max fee, valid duration, scheduled transactions or Mirror lag | All of these matter to Kosha (T1, T3, T5, T6) |
| hedera-consensus-service | Only a 90-day auto-renew period | 2.90.1 also sets the payer as the topic's auto-renew account |
| hedera-consensus-service | `setChunkSize(2048)` example | The network caps a message at 1,024 bytes, so the example likely fails (not confirmed on testnet) |
| agent-kit-policy | `relevantTools` is informational | Agent Kit 4.2.0 filters by it before every `shouldBlock` |
| agent-kit-policy | Example blocks `transfer_hbar` | The real tool is `transfer_hbar_tool`, so the example never fires |
| agent-kit-plugin | Two agent modes; `secondaryAction` abstract; `Status.InvalidTransaction` | 4.2.0 has four modes plus `transactionStrategy`, a concrete `secondaryAction`, and `TOOL_STATUS.ERROR`; `BaseQueryTool`, `BaseTransactionTool` and `toolType` go unmentioned |
| agent-kit-v4-migration | Toolkits on `^1.0.0` bundling LangChain | The LangChain toolkit is 2.1.0 with LangChain as a peer dependency |
