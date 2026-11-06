# Kosha: hackathon readiness

Everything that decides the score but can't be fixed by editing the plan. The source is a review of the plan against the Hedera hackathon rubric in [`hedera-dev/hedera-skills`](https://github.com/hedera-dev/hedera-skills) (`hackathon-helper`), as of 6 Nov 2026. The technical findings from that review are already folded into [the spec](../Kosha%20Execution%20Plan.md) and [the agent protocol](agents/PROTOCOL.md).

The rubric is the one Hedera uses for its own hackathons. ETHGlobal's Hedera prize is judged by Hedera's team, so it is a good proxy, not the official criteria.

Owner: the human team. Agents build what is marked **(B18)**; everything else needs people.

## 1. Where the score stands

| Section | Weight | Plan v1 | Plan v2 | v2 + this doc done | What moves it |
| --- | --- | --- | --- | --- | --- |
| Innovation | 10% | 4 | 4 | 4–5 | Comparison with prior art (`hak-mppx-hedera-plugin`, findings §10) |
| Feasibility | 10% | 3 | 3 | 4 | Lean Canvas (§4), CA engagement (§2) |
| Execution | 20% | 4 | 4 | 4–5 | GTM and roadmap (§6), polished Console |
| Integration | 15% | 4 | 4–5 | 5 | Agent Kit policy and hook, HCS-11/14 (Hashgraph Online), HashPack co-sign (§5) |
| Validation | 15% | 1 | 1 | 3 | **Only real outside feedback moves this** (§2) |
| Success | 20% | 2 | 2 | 3 | Network-impact section (§3) |
| Pitch | 10% | 3 | 3 | 4 | Cited data and "why Hedera" (§5) |
| **Grade** | | ~59% | ~62% | ~76% | |

Grade = Σ(score ÷ 5 × weight). Execution and Success are 40% together; Validation is the biggest gap.

## 2. Validation (15%): get outside feedback during the hackathon

Plans score nothing here. Only recorded contact with people outside the team counts.

| # | Action | Who | When | Evidence to keep |
| --- | --- | --- | --- | --- |
| V1 | One CA reviews rule pack `in-2026.2` and answers findings §9 questions 1–3 | Human | Before Gate 3 | Their written comments; if they sign off, set `reviewedBy` and the badge changes |
| V2 | 3 to 5 Indian API owners or developers try the deployed Gate (`pay-once` or the Console) | Human | After H6 deploy | Name or handle, date, what they tried, quote, what changed because of it |
| V3 | Present to Hedera's team at the venue with findings §8.2 (opener, walkthrough, questions) | Human | Day 1 or 2 | Their answers, especially to "does a tax layer fit the x402 track?" |
| V4 | One agent developer (outside the team) pays a Kosha endpoint with a stock x402 client (compatibility mode) | Human | After Gate 3 | Transaction ID on HashScan plus their feedback |
| V5 | A short waitlist or interest form linked from the README | Human | Any time | Count of sign-ups at submission |

Record every item in a feedback log. The README's **Validation** section summarises it **(B18)**:

| Date | Who (role) | Channel | What they saw | Feedback | Change made |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

A second round (going back to someone after a change) counts as a second feedback cycle, which the rubric asks for at 5/5.

## 3. Success (20%): show the network impact

Testnet volume won't impress anyone, so show the mechanism and an honest projection **(B18: README "Network impact" section)**.

**Hedera transactions per unit of use** (from the v2 design):

| Event | Transactions |
| --- | --- |
| One paid call (`kosha-split`) | 1 `CryptoTransfer` + 1 HCS message (payments log) + 1 HCS message (Agent Kit audit hook) = **3** |
| One paid call (compatibility mode) | 2 `CryptoTransfer` + 2 HCS messages = **4** |
| One new agent | 1 reserve `AccountCreate` (+ its own account if Kosha onboards it) + about 3 for the HCS-11 profile |
| One payer–receiver pair, per month | 1 `ScheduleCreate` + 1 `ScheduleSign` (release) + 1 HCS challan record |
| `POST /v1/decide` from another chain | 1 HCS message per decision (Hedera usage even when settlement is elsewhere) |

**Illustrative scenario** (not a forecast; label it as such): 100 API owners × 50 agents each × 200 paid calls a day = 1,000,000 calls a day ≈ 3,000,000 transactions a day ≈ **35 TPS** sustained. About 10,000 monthly active accounts (5,000 agents and 5,000 reserve accounts, plus 100 receivers). Each new agent creates at least one Hedera account (its reserve).

**Exposure:** Indian API businesses and their CAs, a non-crypto audience, and every x402 facilitator that calls `/v1/decide`.

## 4. Feasibility (10%): business model

A draft **Lean Canvas** for the README **(B18)**. Items marked *proposal* need a team decision.

| Block | Content |
| --- | --- |
| Problem | Agents pay Indian APIs in USDC; the API owner must deduct 1% TDS on a VDA it received in kind; no agent-payment tool handles it, and getting it wrong costs interest and penalties |
| Customer segments | Indian API businesses selling to agents (early adopters: data and GST/KYC APIs); agent developers who pay them; CAs who file for both |
| Unique value proposition | "Every agent payment, tax-ready": tax decided and reserved in the same Hedera transaction, with HCS evidence for every row of the return |
| Solution | Gate (3 lines), Pay (drop-in fetch), Core (facilitator and tax engine), Console (filing export) |
| Channels | x402 and Hedera developer communities, Indian API marketplaces, CA networks, `/v1/decide` for other facilitators |
| Revenue streams | *Proposal:* a small per-settlement fee in basis points, or a monthly fee per API owner with filing exports; a per-decision fee for `/v1/decide` |
| Cost structure | Hedera fees (Core is fee payer), Mirror Node access, hosting, KYC provider per verification, CA review of each rule pack |
| Key metrics | Paid calls, TDS reserved, receivers onboarded, filings exported, `/v1/decide` calls |
| Unfair advantage | Versioned, CA-reviewed rule packs and an on-chain evidence trail; jurisdiction knowledge others would need to rebuild |

**Why it needs Web3:** the tax exists only because the payment is a crypto asset (USDC is a VDA under Indian law), and machine payments need an atomic, programmable split with public evidence. A card network can't settle a 1% split of ₹8.84 at this cost.

## 5. Pitch (10%) and Integration (15%)

**Why Hedera** (for the README and the video):

1. **Fixed, tiny fees** make withholding 1% of an ₹8 call worth doing; a variable gas fee would cost more than the tax.
2. **A native multi-party `TransferTransaction`** does the atomic split with no smart contract (and keeps "No Solidity Allowed" open).
3. **HCS** gives an ordered, timestamped, append-only evidence log for every decision, with a submit key so only Kosha can write to it.
4. **Scheduled transactions** implement the 2-of-2 reserve release without custody code.
5. **Agent Kit v4, HCS-14 and HCS-11** give agents identity and policy-enforced spending out of the box.

**Cited data:** use the sources in findings §10 and follow the framing there ("recognised globally" → "even India-focused tools skip TDS" → "the law says it applies"). Add one figure on the size of India's API or SaaS export market from a citable source; the rubric asks for cited numbers.

**Ecosystem integrations** (the 5/5 Integration score requires them):

- **Hashgraph Online** standards (HCS-14 UAID and HCS-11 profiles): already in the plan.
- **HashPack** for the reserve-release co-sign instead of the demo signer: stretch, worth it if time allows.
- **HashScan** deep links everywhere: already in the plan.
- **World ID Agent Pass**: also a separate sponsor prize (findings §8.1).

## 6. Execution (20%): strategy beyond the hackathon

Put these in the README **(B18)** and the last 30 seconds of the video:

- **Roadmap:** CA-reviewed rule pack → KYC provider integration (findings §4.2) → HashPack and Console polish → `/v1/decide` for other chains → Kosha as the registered deductor (findings §1.2, "later") → more jurisdictions as rule packs.
- **GTM:** start with Indian data APIs already selling to agents; partner with one CA firm; list Gate on x402 directories.
- **Feedback cycles:** the CA review per rule pack, and the `threshold.near` → Level 1 conversion rate as a product metric.
- **Design decisions:** the spec's "Design decisions" table and `docs/architecture.md` **(B18)**.

## 7. Process: keep the build moving

| Item | Who | Note |
| --- | --- | --- |
| Upgrade local Node to 24.22.1 or later (`nvm install 24`), then tell Agent A to bump `engines` | Human | Agent Kit v4 requires it. pnpm enforces root `engines`, so the bump waits until the machine is upgraded (PROTOCOL H0b) |
| Create the `for-agent-a` and `for-agent-b` labels | Human | Cross-agent issues fail without them (PROTOCOL §12) |
| Merge at fixed times (about hourly) | Human | Gate 2 sits behind about 10 cross-agent merges; your merges are the critical path |
| Run the `hedera-skills` submission validator on the repo | Human or an agent | At Gate 3 and again before submitting; it scores the code, not the plan |
| Ask a CA early | Human | V1 is the slowest item on this list |
