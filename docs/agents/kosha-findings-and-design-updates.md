# Kosha: findings, issues and design updates

> Companion to the **Kosha: Execution Plan** doc. Collects everything found after that plan was written: corrections, new issues, solutions and open questions. As of 6 Nov 2026.
>
> **Not tax or legal advice.** Several points are unsettled; confirm with a chartered accountant (CA).

---

## 0. Summary of changes to the plan

| # | Change | Why | Section |
|---|---|---|---|
| 1 | **Threshold depends on the API owner (buyer), not the agent** | The ₹50,000 / ₹10,000 threshold is keyed to whether the *buyer* is a specified person; the plan had it on the payer | 3.1 |
| 2 | **Switch to mode C: tax goes into the agent's own reserve**, not an escrow held for the API | Price-inclusive (mode A) makes the API bear the tax, so grossing up applies; payer-funded into an API-owned escrow (mode B) is ambiguous | 2 |
| 3 | **All-in price calculated for each quote**, not at listing | The rate differs by buyer (0%, 1%, 20%), so one listed price can't be right | 2.4 |
| 4 | **Monthly tax via reimbursement**: the API owner pays the challan in INR, then the reserve is released | Avoids converting the reserve to INR (which triggers another 1% TDS) and avoids Kosha handling fiat | 1.2 |
| 5 | **Step-by-step verification** (levels 0, 1, 2) plus a lighter path for small API owners | Don't burden people who owe nothing (small payers, non-residents, specified persons) | 3 |
| 6 | **Compatibility mode** for standard x402 clients, and a **standalone `POST /v1/decide`** | Integrability: off-the-shelf clients can't sign Kosha's split; other facilitators can plug in the tax engine | 5 |
| 7 | **Every tax decision logged on HCS, even for payments settled on other chains** | Keeps Hedera essential: the evidence layer for all of Kosha | 6.2 |
| 8 | **On-chain verifiability**: rule-pack hash and running totals on HCS; Gate checks the reserve leg before serving | Answers the "this is web2" concern; meets CBDT's "proof before release" in real time | 6.1 |
| 9 | **Watcher only flags outside payments**; owner can mark a transfer "not consideration (gift from relative)" | Gifts and non-commercial transfers must not be taxed | 7 |
| 10 | **New CA questions** (escrow leg, reserve timing, deposit mechanics) | See section 9 | 9 |

---

## 1. How HCS, the reserve and the monthly tax work

### 1.1 HCS and the reserve, in plain terms
- **HCS (Hedera Consensus Service):** a public, timestamped message log. Each message gets a consensus timestamp and sequence number and can't be edited or deleted. Kosha posts a record of every tax decision (payment ID, transaction ID, amounts, rate, rule-pack version, an anonymised pair ID; never PAN or names). It is the **evidence** behind each row of the TDS export.
- **Reserve:** the account holding withheld tax until it is paid in rupees. It has a 2-of-2 key, so neither Kosha nor the other party can move it alone. Under mode C (section 2) it is **owned by the agent's operator**, co-controlled by Kosha.

### 1.2 The monthly cycle (reimbursement model)
1. **Month closes (automatic):** Core totals the TDS for each API owner, by payer. Under the old Act the deposit was due by the 7th of the next month (30 April for March); **confirm the new Act's due dates.**
2. **Tax paid in INR:** Console shows a ready payment summary (amount, TAN or PAN, month, section). The deductor pays on the income-tax portal via net banking (this can't be automated, as it needs the deductor's own login) and enters the challan reference into Console, which links it to that month's HCS records.
3. **Reserve released:** once the challan is recorded, a co-signed scheduled transaction releases the reserved USDC as reimbursement.
4. **Quarterly return:** the CA files the TDS statement from Console's export; payers see the TDS as a credit against their PAN.

**Why reimburse rather than convert the reserve to INR:**
- Selling USDC for INR on an Indian exchange is itself a VDA transfer, so the exchange deducts **another 1% TDS** (recoverable, but messy), and it's a small disposal for the 30% tax on gains.
- Kosha would need its own fiat off-ramp and banking relationships.

**Later:** under the exchange-style model, Kosha could act as the deductor itself (own TAN, bank account, off-ramp). That is a regulated business, not a hackathon build.

**Demo:** show the payment summary, a mock challan reference, and the co-signed release on HashScan. Label the INR payment as mocked.

---

## 2. The "tax on tax" issue and who bears the tax

### 2.1 Who is who
- The **agent** hands over USDC, so it is the **seller of the VDA** = **deductee** (gets the TDS credit).
- The **API** receives USDC and gives a service, so it is the **buyer** = **deductor**.
- The API's "payment" to the agent is a **service**, and you can't withhold 1% of a service. Under CBDT's guidance for consideration in kind, either **the seller funds its own tax** (and shows proof before the buyer releases the consideration), or **the buyer bears it and grosses up**.

### 2.2 The three modes compared (₹100 service)

| Mode | Agent pays | API side receives | Who really bears the ₹1 | Fit with CBDT guidance |
|---|---|---|---|---|
| **A. Price-inclusive** (₹99 to API, ₹1 to escrow) | ₹100 | **₹100** (escrow is held for the API) | **The API**: gives a ₹100 service, nets ₹99 | API bears the agent's tax = "payer grosses up" → base arguably ₹101.01, TDS ₹1.0101. **Tax on tax returns** |
| **B. Payer-funded, API-owned escrow** (old plan default) | ₹101 | ₹101 | The agent | **Unclear**: is the extra ₹1 consideration (base ₹101) or a separate VDA transfer? |
| **C. Payer-funded, agent-owned reserve** (**new default**) | ₹100 to the API + ₹1 into **its own** reserve | **₹100**, exactly the price | The agent | **Closest fit**: the seller funds its own tax, and the buyer gets proof |

The user's question ("won't the escrow payment also count as payment?") was correct for mode A: on paper the escrow leg is the API's money. Calling price-inclusive "textbook TDS" was wrong; that applies to cash payments, not services.

### 2.3 Research on the escrow leg (no definitive answer exists)
- **Settled:** the TDS base is "consideration for transfer of VDA, less GST" (CBDT Circular 14/2022). For consideration in kind, the buyer must ensure tax is paid before releasing it; the seller may pay and show the challan, or the payer may gross up. In VDA-for-VDA swaps, both sides are buyers.
- **Not settled:** CBDT never considers the seller **sending extra crypto to fund the tax**. Nothing says whether that extra USDC is consideration or a separate VDA transfer. Nothing found under the Income-tax Act 2025 changes this.
- **Practical answer:** mode C keeps the tax leg inside the agent's own ownership (moving between your own accounts arguably isn't a "transfer"), so the API's consideration is plainly ₹100. The formal route to certainty is a CA opinion or an advance ruling.

### 2.4 Per-quote all-in pricing (user's proposal, refined)
**Proposal:** the API lists its price raised so it nets its real price after tax (e.g. list ₹101, hold ₹1.01, API nets ₹99.99).

- **What works:** the API is made whole and the buyer sees one number; the base is the listed price, so the arithmetic is clean.
- **Arithmetic fix:** 101 − 1.01 = 99.99 (not 99.9). To net P, list at P ÷ 0.99 (+1.0101%).
- **Problem 1, the rate varies by buyer:**

| Buyer | TDS | Listed ₹101.01 | API nets |
|---|---|---|---|
| Resident with PAN, over threshold | 1% | ₹1.01 withheld | ₹100 ✓ |
| Resident under threshold | 0% | none | ₹101.01 (buyer overpays) |
| No PAN / unverified | 20% | ₹20.20 withheld | ₹80.81 (API loses) |
| Non-resident | 0% | none | ₹101.01 (buyer overpays) |

- **Problem 2:** if the extra goes to an API-held escrow, it is mode A again.
- **Recommended version:** the API sets its **net price** once; Core computes the **all-in price for each quote** after the tax engine decides the rate. The buyer sees "₹101 total: ₹100 to the API, ₹1 TDS reserved in your name". The API receives exactly its price; the tax goes to the agent's own reserve (mode C).

### 2.5 Remaining safeguards
- Rule-pack field `taxBase: "price"` so the base is never the total.
- Label each transfer leg as `consideration` or `tds_reserve`. *Correction (plan v2):* a Hedera transaction has **one** memo (max 100 bytes), not one per leg, so the memo stays `kosha:<quoteId>` and the leg labels live in the quote (`extra.kosha.transfers[].leg`), the HCS record and the export row.
- Every HCS record and export row states "consideration ₹100, TDS ₹1, funded by the deductee".
- Never offer grossing up so the API receives an exact net amount through deduction.

---

## 3. Tax rules: corrections and clarifications

### 3.1 Threshold is keyed to the buyer (API owner)
- The ₹50,000 threshold applies when the **buyer** is a **specified person** (individual or HUF with no business income, or turnover up to ₹1 crore / professional receipts up to ₹50 lakh); ₹10,000 for all other buyers. In Kosha the buyer is the **API owner**.
- Specified-person buyers **don't need a TAN**; they can pay and report through the challan-cum-statement (Form 26QE under the old Act; confirm the new Act's equivalent).
- **Engine change:** threshold from the **receiver profile**. The agent profile decides only the **rate** (1% with PAN, 20% without) and **non-resident** status.

### 3.2 Two different taxes: "all crypto is taxable" vs the threshold

| | 30% tax on gains | 1% TDS |
|---|---|---|
| Section | Old Act s.115BBH, carried into the Income-tax Act 2025 | s.393(1) of the 2025 Act (formerly s.194S) |
| What | Tax on profit from each transfer; no loss set-off | Withholding at transfer; credited against final tax |
| Threshold | **None**: every transfer counts | **Yes**: ₹50,000 (specified-person buyer) / ₹10,000 (others) per seller per year |
| Who | The payer, in their yearly return | The buyer (API owner) |

Indian **exchanges deduct 1% on every trade from the first rupee**, which is why it can look as if there's no threshold. For direct payments like Kosha's, the threshold applies. The 30% gains tax applies to every agent payment regardless; Console's per-payment rupee value and gain or loss report serves that.

### 3.3 Gifts (e.g. an agent funding a spouse's wallet)
- No consideration → **no TDS**.
- Gifts from a **relative** (spouse included) are exempt for the recipient; gifts of VDA from non-relatives above ₹50,000 a year are taxable for the recipient.
- A gift generally isn't a "transfer" for capital gains, so no gains tax for the giver on the general view; some experts question how that applies to VDAs.
- **Clubbing:** income or gains the spouse later earns from the gifted asset may be added to the giver's income.
- Kosha never sees such a transfer (no 402 quote, no Gate). See section 7 for the watcher edge case.

---

## 4. Identity, KYC and who has to verify

### 4.1 Who needs KYC

| Who | KYC? | Why |
|---|---|---|
| **End users** of an AI app | **No** | They don't own the USDC the agent spends; the app company does |
| **Agent operators** (fund the agent's wallet) | **Optional** | They're the deductee; unverified → 20%, verified → 1%. Small operators may never need to (threshold-tolerant mode) |
| **API owners** (receive and deduct) | **Yes** | Legally responsible for deduction. PAN, plus TAN for larger businesses; specified persons need PAN only |

Edge case: someone running a personal agent with their own USDC is both end user and operator, so verification is optional for them.

### 4.2 How Kosha verifies (Hedera has no KYC; Kosha does it at its own layer)
**API owners**, before Core issues an API key:
1. PAN check via an Indian KYC provider (e.g. Digio, Signzy, HyperVerge), matching the business name.
2. GSTIN (public GST search) and TAN (KYC provider) where applicable.
3. Bank account check by test deposit (they pay challans from it).
4. **Wallet ownership:** sign a challenge with each registered Hedera account's key; re-verify if the key changes.
5. Store only a salted PAN commitment and a signed "verified" credential; only the credential's hash goes on HCS.

**Agents:** a KYC credential linked to their HCS-14 identity, optionally plus World ID for one human behind each agent.

**Limit:** an API owner can always accept USDC outside Kosha; Kosha's guarantee covers only its own users.

### 4.3 Optional on-chain enforcement: kUSDC with an HTS KYC key
- HTS tokens can have a **KYC key**; unapproved accounts can't receive the token.
- Kosha can't do this for USDC (Circle is the issuer), but could issue a **wrapped kUSDC via Hedera's Stablecoin Studio** with KYC enabled.
- Upside: enforcement by the network; may qualify for Hedera's **Tokenize Anything** track (compliance controls bonus).
- Trade-offs: swap friction for agents; Kosha effectively issues a stablecoin, with regulatory weight.
- Hackathon: Kosha-layer verification with a mock provider plus the wallet-signature challenge; mention kUSDC as the path to on-chain enforcement.

### 4.4 Reducing friction: verify only when the law requires it

**Agents, step by step:**
- **Level 0 (no verification):** works immediately. API owner policy:
  - *Strict:* 20% from the first rupee (safest for the API).
  - *Threshold-tolerant* (new default): no tax and no checks while the pair stays well under the threshold (e.g. up to ₹5,000).
- **Level 1 (light):** triggered by the `threshold.near` event. PAN entered and name-matched (rate drops to 1%), or non-resident declaration (0%; Tax Residency Certificate only above a set amount).
- **Level 2 (full KYC):** large or business payers only.

**API owners, two paths:**
- Individuals and small businesses (specified persons): PAN plus a wallet signature; no TAN; simpler form.
- Larger businesses: PAN, TAN and GSTIN.

**Trade-off:** threshold-tolerant mode puts some risk on the API owner (an unverified payer later over the threshold means earlier under-deduction), so the policy is the API owner's choice.

### 4.5 Knowing whether a payment is "Indian"
- Residency is a legal status (mostly days in India), not a wallet or IP attribute.
- The **receiver** is always known (onboarded). The **payer** proves status via a KYC credential, a non-resident's Tax Residency Certificate, or a signed declaration (whoever signs falsely takes the liability).
- Unproven payers: the safe default applies (20%, or the API's chosen policy).

---

## 5. Integrability

| Who | Effort | Friction |
|---|---|---|
| Indian API owners | Low (3 lines of Gate) | Onboarding paperwork they already do for TDS |
| Agent developers | Medium (must use Kosha Pay) | **Standard x402 clients sign a single transfer to `payTo`** and ignore Kosha's split, so the verifier rejects them |
| Agents without a profile | None, but costly | 20% withheld |
| Agents on other chains | Not possible yet | Most x402 traffic is on Base |
| Other facilitators / payment companies | High | Kosha is a whole facilitator |
| CAs and accounting tools | Low | CSV only; no Tally / Zoho Books / filing-software link yet |

**Three changes:**
1. **Compatibility mode:** a second `accepts[]` entry with the plain `exact` scheme; `payTo` is Kosha's settlement account for the full price. Any x402 client pays normally; Core forwards the net amount and keeps the TDS, in a second transaction. Trade-off: brief custody and two transactions. Kosha Pay clients keep the atomic split.
2. **Standalone tax engine:** `POST /v1/decide` plus `@kosha/tax-engine` on npm, so any facilitator or payment company can plug in Kosha's tax decision. Kosha becomes a tax layer, not a facilitator to switch to.
3. **Built for more than one chain:** settlement behind an adapter interface; ship Hedera only, document the interface.

**Smaller:** publish the `extra.kosha` format as a small spec; Hono and Next.js adapters; `tds.withheld` webhook; a one-link "register to drop from 20% to 1%" in the 402 response.

**Hackathon:** build compatibility mode and `/v1/decide`; leave other chains as an interface.

---

## 6. "Isn't this web2?" and Hedera's role

### 6.1 What's on-chain and what isn't

| On Hedera (the core) | Off-chain (the edges) |
|---|---|
| x402 payments in USDC, agents paying without approval | Tax engine calculation |
| Atomic transfer: price to the API, tax to the reserve | Yearly totals (database) |
| Reserve with a 2-of-2 key | Taxpayer credentials (KYC issuer) |
| HCS log of every tax decision | Challan payment in INR on the portal |
| Scheduled transactions for releases | Quarterly return filed by a CA |
| Mirror Node watcher | |

The tax only exists because agents pay in a crypto asset, so it's a **crypto-native problem with a web2 edge**: any product ending in Indian tax has to touch rupees at the end.

**Three changes to make the edges more on-chain:**
1. **Verifiable decisions:** post the rule-pack hash and each pair's running total to HCS, so anyone can recompute every decision ("don't trust us, recompute us").
2. **Real-time proof the tax was reserved:** Gate checks on-chain that the agent's reserve received the tax in the same atomic transaction before returning data. This meets CBDT's "proof before release" in a way a monthly challan can't.
3. **A reserve that only releases for tax:** releases only via a scheduled transaction needing the payer's key plus Kosha's, or a time lock.

**Pitch line:** "The money moves on Hedera, the proof lives on Hedera, and the only off-chain step is the one the government requires: paying in rupees."

### 6.2 Who knows they're using Hedera

| Who | Aware of Hedera? |
|---|---|
| End users of AI apps | No (like card users and Visa's network) |
| Agent developers / operators | Yes: they fund a Hedera account and sign Hedera transfers |
| API owners | Yes, but barely need to care |
| Facilitators using `/v1/decide` | Optional |

Kosha hides the **tax complexity**, not Hedera. To keep Hedera essential even when payments settle elsewhere, **log every tax decision to HCS whichever chain the payment settles on**.

**Pitch line for Hedera judges:** "Hedera is where Kosha's payments settle, and where every tax decision is proven, even for payments that settle on other chains."

---

## 7. Watcher: outside payments and gifts
- The watcher **only flags** USDC arriving outside Kosha; it never withholds automatically.
- The API owner can mark a flagged transfer **"not consideration: gift from a relative"** (with a note), removing it from the threshold count and the TDS export.
- That decision is logged on HCS like any other.
- Existing measures stay: payers declare all their wallets; API owners can choose first-rupee mode so outside payments can't cause a shortfall (over-deduction is a refundable credit; under-deduction costs interest).

---

## 8. Sponsors and validation

### 8.1 Tracks besides Hedera
*Based on track details gathered earlier in the session; re-check each prize page.*

| Track | Prize | Fit | Use |
|---|---|---|---|
| **World ID Agent Pass** | $5,000 | Strong | Unique human behind each paying agent; stops splitting payments across fake agents to stay under the threshold |
| **World IDKit** | $2,500 | Good | Verify owners in Console; the required alternative path already exists (KYC credential / declaration). World is likely one prize slot |
| **Arkiv** (+ Swarm) | $4,000 + $500 | Moderate | Searchable ledger entities; quarterly exports on Swarm. Needs `/arkiv/*.md` files; only worth it if Console reads from Arkiv |
| **Chainlink CRE** | $1,500 | Moderate | Monthly close workflow and INR/USD rate; check Hedera support |
| Arc, Whitechain | — | Weak | Would need a second settlement network |
| EF privacy | — | Weak for now | Only with ZK threshold proofs |
| ENSv2 | — | Weak | Cosmetic names |
| 0G, Uniswap, 1inch Aqua, Definitive | — | None | — |

**Recommended picks:** Hedera (x402, possibly No Solidity Allowed), World (Agent Pass), and Arkiv or Chainlink CRE.
Possible extra: **Tokenize Anything** if kUSDC with KYC is built via Stablecoin Studio.

### 8.2 Presenting to Hedera judges for validation
- **30-second opener:** agents pay APIs via x402; in India USDC is a VDA, so above a threshold 1% TDS is due and the API may owe it; no agent or facilitator handles it; Kosha does, in the same transaction.
- **2-minute walkthrough:** show the architecture diagram; one payment in one sentence; the Hedera features used; one honest limitation (unsettled law, hence rule packs and a CA review).
- **Questions to ask them:**
  1. Does a tax-compliance layer fit the x402 track, or is it too narrow?
  2. Own facilitator, or build on Blocky402 / Ax402? *(Partly answered: the reference spec is `scheme_exact_hedera.md` in x402-foundation/x402, and it rejects extra credits, so Kosha's split needs its own scheme; see `docs/research/x402.md`. Still worth asking whether a `kosha-split` scheme name is acceptable to them.)*
  3. Payer signs a transfer with Core as fee payer: recommended pattern? *(Answered: yes, it is the official `exact` Hedera pattern, with `extra.feePayer`.)*
  4. ~~Are long-term scheduled transactions enabled on testnet?~~ *(Answered: yes, HIP-423 is live, max expiry 62 days; `docs/research/scheduled-transactions.md`.)*
  5. ~~HCS-14 maturity, or fall back to HCS-11?~~ *(Answered: HCS-14 is a draft ID format resolved through an HCS-11 profile, so we do both; `docs/research/hcs-14.md`.)*
  6. ~~Testnet USDC token and faucet?~~ *(Answered: `0.0.429274`, 6 decimals, 20 USDC per 2 h; `docs/research/hedera-usdc.md`.)*
  7. Can one project be considered for both x402 and No Solidity Allowed?
  8. Which bonus items matter most?
  9. *(New)* Does compatibility mode's brief custody (section 5) worry them for the x402 track?
- **Objections and answers:** niche → rule packs extend to other countries; wrong tax reading → versioned, configurable rules logged with each decision; who's Indian → verified profiles, safe default; outside payments → watcher plus first-rupee mode; "why wouldn't MoltPe/Coinbase add it" → jurisdiction-specific and fiddly, so a plug-in layer.
- **Bring:** the diagram, ideally one live split transfer on HashScan, and a notepad.
- **Avoid:** tax-law detail unless asked; presenting the whole plan; defending every point.

---

## 9. Open questions for the CA (updated)

1. **Core reading:** does paying for an API in USDC fall under s.393(1), and is the API the deductor?
2. **Mode C timing:** CBDT expects proof before the consideration is released; with instant services and monthly challans, is a **prefunded reserve** an acceptable substitute?
3. **Reserve conversion:** converting the reserve to INR is a VDA sale by the agent (further 1% TDS and a small disposal). Does the reimbursement model avoid this cleanly?
4. **Deposit mechanics:** can the seller (or Kosha on its behalf) deposit tax against the buyer's TAN, and how is it reported?
5. **Escrow leg (mode B):** is extra crypto sent to fund the tax consideration or a separate VDA transfer? (Avoided by mode C, but worth confirming.)
6. **Threshold crossing:** whole crossing payment or only the excess?
7. **INR rate:** which rate tax law expects for VDA consideration (SBI TT buying rate is common practice).
8. **New Act forms and due dates**, including the equivalent of Form 26QE for specified-person buyers.
9. **Exchange-route model:** can a facilitator take on the deduction duty for its users?
10. **Gifts of VDA:** confirm treatment for the giver and clubbing.
11. **Salted PAN hashes:** whether they count as personal data under the DPDP Act.

---

## 10. Evidence the need exists (sources for the pitch)

**The problem is recognised (US-focused; neither mentions India or withholding):**
- [AI agents paying in crypto could create thousands of taxable events – Crypto Briefing (30 Sep 2026)](https://cryptobriefing.com/ai-agents-crypto-payments-taxable-events/)
- [Taxing agentic income: how AI agents trigger crypto tax liability – Coincub (Mar 2026, updated Apr 2026)](https://coincub.com/blog/taxing-agentic-income-ai/)

**Existing tools skip Indian TDS at payment time:**
- [x402 protocol for Indian developers – DEV Community](https://dev.to/umangbuilds/x402-protocol-for-indian-developers-monetize-apis-in-usdc-2026-1jec) (GST mentioned, no TDS)
- [AI agent payments in India: infrastructure guide (MoltPe) – DEV Community](https://dev.to/umangbuilds/ai-agent-payments-in-india-the-complete-infrastructure-guide-2026-11am) (no tax handling)
- [GreenHelix agent tax ledger compliance – skills.sh](https://www.skills.sh/site/skills.volces.com/greenhelix-agent-tax-ledger-compliance) (US 1099-DA, estimates only)
- [On-chain compliance guardrail for agent stablecoin payments – arXiv 2605.00071](https://arxiv.org/abs/2605.00071) (closest academic overlap; no withholding)
- [TDS on crypto trades on foreign exchanges and DEXs – KoinX](https://www.koinx.com/tax-guides/tds-on-crypto-trades-on-foreign-exchanges-and-dexs) (after-the-fact tools)

**Legal basis:**
- [TDS on VDAs, Section 393(1) (194S) – TDSMAN (Aug 2026)](https://blog.tdsman.com/2026/08/tds-on-virtual-digital-assets-section-3931-194s/)
- [Are stablecoins taxable in India? – KoinX (2026)](https://www.koinx.com/in/tax-guides/are-stablecoins-and-cbdc-taxable-in-india)
- [CBDT Circular 14/2022 (PDF)](https://www.pdicai.org/Docs/circular-14-2022_296202213596419.pdf)
- [CBDT guidelines on TDS for VDAs – Khaitan & Co](https://khaitanco.com/thought-leaderships/CBDT-provides-much-awaited-guidelines-in-relation-to-TDS-on-payments-for-Virtual-Digital-Assets)
- [CBDT clarifies TDS for P2P VDA transactions – Khaitan & Co](https://www.khaitanco.com/thought-leaderships/CBDT-clarifies-TDS-mechanism-for-P2P-Peer-to-Peer-VDA-transactions)
- [CBDT guidelines for TDS u/s 194S outside exchanges – Taxmann](https://www.taxmann.com/post/blog/cbdt-issues-guidelines-for-tds-u-s-194s-where-vdas-are-transferred-other-than-through-exchange/)
- [TDS on crypto in India – ClearTax](https://cleartax.in/s/tds-on-crypto-in-india)

**Pitch framing:** "recognised globally" (Crypto Briefing, Coincub) → "even India-focused agent-payment tools skip TDS" (DEV Community guides) → "and the law says it applies" (TDSMAN, CBDT). Don't claim any article calls for an Indian TDS tool for agents; none do, and that gap is the point.

**Prior art check:** no system found that withholds tax at the moment of an x402 payment (ETHGlobal's showcase isn't well indexed, so not fully ruled out).

---

## Appendix: alternative ideas using the same architecture

The pattern (signed rule packs → rules applied in each 402 quote → one atomic split → reserve with a 2-of-2 key → HCS log → scheduled releases → Core, Gate, Pay, Console) also fits:

| Idea | Summary | Prior art found | Verdict |
|---|---|---|---|
| Refunds / SLA guarantees for x402 | Hold part of each payment, refund on failure | x402r (ETHGlobal), Fortytwo x402escrow, x402resolve, Circle Refund Protocol, ArcSLA | Crowded |
| Carbon offsets per agent call | Split a share to offsets | Carbonmark x402 offsetting; AgentDecarbonizer paper | Crowded |
| Model-lineage royalties | Pay base-model and fine-tune authors per call | Mekar (0G project), Origyn lineage registry | Crowded |
| **Halal402** | Shariah screening at quote time, zakat accrual into a reserve, payout after a lunar year, nisab via gold price, Shariah-board rule packs | None found for agents / x402 | Open; scholars differ on USDC; needs a category dataset and a scholar's review |
| **Upstream** | Each paid call sends a share to the open-source dependencies of the API, in the same transaction; unclaimed shares held until maintainers prove ownership | Drips, thanks.dev, tea.xyz, GitHub Sponsors (not at payment time); none found inside x402 | Open; strongest Hedera fit (HTS revenue splits bonus); xz-backdoor hook |
