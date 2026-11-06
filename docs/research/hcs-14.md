# HCS-14 agent identity

**Answer:** HCS-14 (Universal Agent ID, **Draft**) is only an ID format: `uaid:aid:<hash>;params` or `uaid:did:<id>;params`. It has no on-chain registry. The SDK resolves a Hedera UAID through the account's **HCS-11 profile**, so we do both at once. **Recommendation:** compute a `uaid:aid` locally with `createUaid()` (offline, free) and inscribe one HCS-11 profile that sets `uaid` and `properties.kosha`. Skip `did:hedera` issuance; it needs the optional `@hiero-did-sdk/*` peer deps.

## Sources
- https://hol.org/docs/standards/hcs-14 (status Draft, UAID grammar, params, "HCS-11 profiles must include a top-level `uaid`")
- https://hol.org/docs/standards/hcs-11 (Draft; memo `hcs-11:hcs://1/<topic>`; "`properties` ... can contain any custom data")
- npm tarball `@hashgraphonline/standards-sdk@0.1.192`: `dist/es/hcs-11/{client,types}.d.ts`, `dist/es/hcs-14/{sdk,did,types}.d.ts`, and compiled sources for `HCS11Client.inscribeProfile`/`attachUaidIfMissing`/`fetchProfileByAccountId`, `createUaid`, `ResolverRegistry`, `HCS11ProfileResolver`, `HederaHieroIssuer`
- GitHub `hashgraph-online/standards-sdk` demos: `demo/hcs-14/aid-generate.ts`, `demo/hcs-11/inscribe-profile-with-uaid.ts`, `demo/hcs-11/resolve-profile-uaid.ts`

## Versions (checked 2026-11-06)
- `@hashgraphonline/standards-sdk` **0.1.192** (latest, published 2026-10-19). `"type": "module"`, ships ESM and CJS (`require` → `dist/cjs`). No `engines` field.
- Bundled deps: `@hashgraph/sdk ^2.78.0` (latest 2.81.0), `@kiloscribe/inscription-sdk 2.0.10-canary.9` (exact pin), `zod ^3.25.76`.
- Optional peers: `@hiero-did-sdk/registrar` and `@hiero-did-sdk/resolver` at `^0.1.8`. The latest is 0.2.1 (moved to `@hiero-ledger/sdk`), which does **not** satisfy `^0.1.8`. If needed, pin 0.1.8. The recommended path below needs neither.

## Snippet
```ts
import {
  HCS11Client, AIAgentType, AIAgentCapability, createUaid, parseHcs14Did, parseHederaCaip10,
} from '@hashgraphonline/standards-sdk';

// Registration (demo payer agent, run once with the agent's own account key)
const accountId = process.env.AGENT_ACCOUNT_ID!;           // e.g. 0.0.5xxxxx
const nativeId = `hedera:testnet:${accountId}`;             // CAIP-10, required for proto hcs-10
const uaid = await createUaid(
  { registry: 'kosha', name: 'kosha-demo-agent-1', version: '1.0.0', protocol: 'hcs-10', nativeId, skills: [0] },
  { uid: '0' },                                             // -> uaid:aid:<b58 sha384>;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.x
);
const hcs11 = new HCS11Client({
  network: 'testnet',
  auth: { operatorId: accountId, privateKey: process.env.AGENT_PRIVATE_KEY! },
});
await hcs11.initializeOperator();                           // detects ed25519 vs ecdsa from the mirror node
const profile = hcs11.createAIAgentProfile('Kosha Demo Agent 1', AIAgentType.AUTONOMOUS,
  [AIAgentCapability.TEXT_GENERATION], 'gpt-4o', {
    properties: { kosha: { credentialIssuer: 'did:key:z6Mk…', credentialHash: 'sha256:…', wallets: [accountId] } },
  });
profile.uaid = uaid;                                        // set it, or inscribeProfile tries to mint a did:hedera
const res = await hcs11.createAndInscribeProfile(profile, true); // HCS-1 inscription, then AccountUpdate memo
if (!res.success) throw new Error(res.error);               // res.profileTopicId, res.totalCostHbar

// Resolution in Core (read-only; no operator key needed)
const { params } = parseHcs14Did(uaid);                     // { method: 'aid', id, params: { nativeId, proto, ... } }
const { network, accountId: acct } = parseHederaCaip10(params.nativeId);
const reader = new HCS11Client({ network: network as 'testnet', auth: { operatorId: acct } });
const got = await reader.fetchProfileByAccountId(acct, 'testnet'); // memo -> kiloscribe CDN -> zod parse
if (!got.success || got.profile?.uaid !== uaid) throw new Error('UAID/profile mismatch');
const kosha = got.profile.properties?.kosha;               // { credentialIssuer, credentialHash, wallets }
```
The full SDK route `new HCS14Client().resolveUaidProfile(uaid)` returns `profiles.hcs11.profile`. However, it first calls the Hiero DID resolver on `did:hedera:testnet:0.0.x`. Without the peer dep that resolver throws, and it is unconfirmed whether it accepts an account-style DID. Use the direct path above.

## Gotchas
- `kosha` **must sit under `properties`**. The read-side zod schema is a non-passthrough `z.object`, so unknown top-level keys are stripped on fetch. `properties` is `z.record(z.any())`.
- `HCS11Client.inscribeProfile` auto-calls `attachUaidIfMissing`. That tries to create a `did:hedera` (a new HCS topic plus fees) through the Hiero registrar, and only logs a warning if the registrar is absent. Pre-set `profile.uaid` to avoid it.
- Inscription goes through Kiloscribe (`InscriptionSDK.createWithAuth`, signed with the account key; **no API key needed**). It waits up to 100×2s. Typical latency is about 10–60 s (**unconfirmed**). Fees: Kiloscribe service fee is **unconfirmed** (use `generateQuote` or read `totalCostHbar`). The Hedera part is roughly 1 HCS message (<1 KB JSON) plus topic create plus AccountUpdate, well under 1 HBAR. Fund each agent account with ~5 testnet HBAR.
- Reads depend on `https://kiloscribe.com/api/inscription-cdn/<topic>?network=testnet` being up. Cache the resolved profile in Core's `agents` row.
- The memo is set with the **agent account's** key. The binding UAID → nativeId account → memo → profile is the proof of control. Core should also check that `profile.uaid === header UAID`.
- `proto=hcs-10` is required for the SDK to derive the Hedera account from an `aid` UAID, even though we create no HCS-10 inbound/outbound topics. This is a slight misuse that the spec tolerates (`uid=0`).
- Node 24, ESM `import` from TS (NodeNext), testnet: the package metadata supports all three, but runtime is **unconfirmed** because nothing was installed. The SDK pulls in a heavy tree (`ethers`, `viem`, wallet-connect). Keep it in Pay/demo-agent and Core only, never in Gate.

## What this changes in the spec
- `X-KOSHA-AGENT` carries the full UAID string: `uaid:aid:<base58>;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.x`. It contains `;` and `:`, which are header-safe, so no encoding is needed. Store it verbatim in `agents.hcs14_id`.
- The `kosha` field lives at `profile.properties.kosha = { credentialIssuer, credentialHash, wallets[] }` in an HCS-11 AI-agent profile (type 1), linked from the account memo `hcs-11:hcs://1/<profileTopicId>`. The signed credential itself is POSTed to Core and is not on-chain (PAN never on-chain).
- `POST /v1/agents`: Core runs `parseHcs14Did` → `nativeId` → `fetchProfileByAccountId`. It asserts `profile.uaid === hcs14_id`, asserts `sha256(credential) === properties.kosha.credentialHash`, and verifies the Ed25519 signature against the known issuer. Then it persists the record. Do not resolve per request; Gate/quote uses the stored row.
- Registration cost and latency: one inscription plus one memo update per agent, about 10–60 s and under 1 HBAR on testnet (Kiloscribe fee unconfirmed). Run it once in a seed script for the three demo agents.
- "HCS-11 fallback" stops being a separate path, because HCS-14 on Hedera *is* an HCS-11 profile plus a UAID string. If Kiloscribe is down, the cut-line fallback is to register with the UAID and credential only and skip on-chain profile verification.
