# Scheduled transactions

**Answer:** Long-term scheduled transactions (HIP-423) shipped in services v0.57 (finished in v0.58). They are on by default and work on testnet and mainnet today: on 2026-11-06 we saw testnet schedules with `wait_for_expiry=true` execute at their expiry time, and mainnet schedules with expiries 3 to 7 days out. The maximum expiry is 62 days. The monthly sweep can be one schedule that executes as soon as compliance co-signs, so we don't need the short-expiry plus cron fallback.

## Sources
- docs.hedera.com/hedera/core-concepts/scheduled-transaction (expiry, `wait_for_expiry`, IDENTICAL_SCHEDULE, admin and payer)
- docs.hedera.com/hedera/networks/release-notes/services.md (v0.57: "completes the implementation of HIP-423"; v0.58: ScheduleSign throttles, "This completes HIP-423"; mainnet and testnet are on v0.78)
- github.com/hiero-ledger/hiero-consensus-node `main`: `hedera-config/.../SchedulingConfig.java`, `LedgerConfig.java`, `schedule-service-impl/.../ScheduleCreateHandler.java`, `ScheduleStoreUtility.java`, `configuration/{testnet,mainnet}/upgrade/throttles.json`
- github.com/hiero-ledger/hiero-sdk-js `src/schedule/*.js` (method names), README
- Live mirror node: `testnet.mirrornode.hedera.com/api/v1/schedules` (6,000 recent schedules scanned) and the same call on `mainnet-public`
- hips.hedera.com/hip/hip-423 returned HTTP 403; we didn't read it directly.

## Versions (checked 2026-11-06)
- **SDK:** `@hiero-ledger/sdk@2.90.1` (2026-10-15) is the maintained package. `@hashgraph/sdk` stops at `2.81.0` (2026-03-13). Both are built from the same repo (`hiero-ledger/hiero-sdk-js`), and the method names below are the same in both.
- **Network defaults** (`SchedulingConfig` / `LedgerConfig` on `main`). Neither `configuration/testnet/application.properties` nor `configuration/mainnet/application.properties` overrides them. We didn't read live file 0.0.121, so the live values are unconfirmed, though the mirror-node data is consistent with these defaults.
  - `scheduling.longTermEnabled=true`
  - `scheduling.maxExpirationFutureSeconds=5356800` (62 days)
  - `ledger.schedule.txExpiryTimeSecs=1800`: the 30-minute expiry applied when long-term scheduling is off or no expiry is set
  - `scheduling.maxTxnPerSec=100`: at most 100 schedules may expire in the same second, otherwise `SCHEDULE_EXPIRY_IS_BUSY`
  - `scheduling.maxExecutionsPerUserTxn=100`, `scheduling.maxNumber=10000000`
  - `scheduling.whitelist` includes `CryptoTransfer`
- **Throttles** (testnet and mainnet `throttles.json`): ScheduleCreate 10,500 ops/s on throughput and 100/s on creation; ScheduleSign 100 ops/s. Both are network-wide, far above what Kosha needs.
- **Testnet evidence:** `0.0.11337298` was created at 09:40:39Z with `wait_for_expiry=true` and executed at its expiry, 09:41:04Z. `0.0.11335891` executed exactly at `expiration_time`.

## Facts that matter
- **What can be scheduled:** `TransferTransaction`, including HTS fungible token transfers. It is `CryptoTransfer` on the whitelist, and the docs list "TransferTransaction".
- **`waitForExpiry(false)`** is the default. The transfer executes in the same transaction as the last required signature, whether that is the create or a ScheduleSign. If the signatures are still incomplete at `expirationTime`, the schedule expires without executing. The mirror node then shows `executed_timestamp=null, deleted=false`, as with testnet `0.0.11336634`.
- **`waitForExpiry(true)`** waits until `expirationTime` and executes then, but only if the signatures are complete at that point. It requires `setExpirationTime`, otherwise `MISSING_EXPIRY_TIME`.
- **Expiry errors:** `SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE` (more than 62 days out) and `SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME`.
- **Signatures:**
  - The ScheduleCreate payer (Core's operator) must sign the create.
  - Any signature on the ScheduleCreate whose key the inner transaction requires also counts toward the inner transaction. Core's escrow-half signature therefore counts the moment the create is submitted.
  - The other keys are added later with `ScheduleSignTransaction` (`setScheduleId`).
  - `setPayerAccountId` sets who pays for the inner transaction when it executes. It defaults to the create payer, and that account's key must also be among the collected signatures.
  - `setAdminKey` is optional. Without it, the schedule can't be deleted with ScheduleDelete.
- **Duplicates:** the equality hash covers memo, admin key, the scheduled body, the provided expiry second and `waitForExpiry`.
  - If all of those match, the create fails with `IDENTICAL_SCHEDULE_ALREADY_CREATED`.
  - The failed receipt still carries the existing `scheduleId`. The SDK's `getReceipt` throws `ReceiptStatusError`, so read `err.transactionReceipt.scheduleId`.
  - Unconfirmed: whether an executed or expired schedule still counts as a duplicate.
- **Reading status:**
  - `ScheduleInfoQuery` returns `ScheduleInfo { executed: Timestamp|null, deleted: Timestamp|null, expirationTime, signers: KeyList, waitForExpiry, scheduledTransactionId }`. Unconfirmed: whether it fails with `INVALID_SCHEDULE_ID` once the schedule has been purged after expiry.
  - The mirror node at `GET /api/v1/schedules/{id}` returns `executed_timestamp`, `deleted`, `expiration_time`, `wait_for_expiry`, `signatures[]` (with `public_key_prefix` and `consensus_timestamp`) and `payer_account_id`. Prefer the mirror node for the Console.

## Snippet
```ts
import { Client, PrivateKey, ScheduleCreateTransaction, ScheduleId, ScheduleInfoQuery,
  ScheduleSignTransaction, Status, ReceiptStatusError, Timestamp, TransferTransaction } from "@hiero-ledger/sdk";

// Escrow key, set once at bootstrap: new KeyList([corePub, compliancePub], 2)   // 2-of-2 (KeyList from the SDK)
export async function createSweep(client: Client, coreKey: PrivateKey, p: {
  usdc: string; escrow: string; deposit: string; amountMicro: bigint; month: string; payer: string }) {
  const inner = new TransferTransaction()
    .addTokenTransfer(p.usdc, p.escrow, -p.amountMicro)
    .addTokenTransfer(p.usdc, p.deposit, p.amountMicro);
  const expiry = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 3600 * 1000)); // must be <= 62 days
  const tx = await new ScheduleCreateTransaction()
    .setScheduledTransaction(inner)
    .setScheduleMemo(`kosha-sweep:${p.month}`)   // unique per month, so no IDENTICAL_SCHEDULE collision
    .setPayerAccountId(p.payer)                    // Core pays when the transfer executes
    .setAdminKey(coreKey.publicKey)                // lets Core cancel a bad sweep
    .setExpirationTime(expiry)
    .setWaitForExpiry(false)                       // execute on the co-sign
    .freezeWith(client)
    .sign(coreKey);                                // Core's half of the 2-of-2 (and operator, if same key)
  try {
    const r = await (await tx.execute(client)).getReceipt(client);
    return r.scheduleId!.toString();
  } catch (e) {
    if (e instanceof ReceiptStatusError && e.status === Status.IdenticalScheduleAlreadyCreated)
      return e.transactionReceipt.scheduleId!.toString();
    throw e;
  }
}

// Console server action (compliance demo key)
export async function cosignSweep(client: Client, complianceKey: PrivateKey, scheduleId: string) {
  const tx = await new ScheduleSignTransaction().setScheduleId(ScheduleId.fromString(scheduleId))
    .freezeWith(client).sign(complianceKey);
  return (await (await tx.execute(client)).getReceipt(client)).status.toString(); // "SUCCESS" -> transfer ran
}

export async function sweepStatus(client: Client, scheduleId: string) {
  const i = await new ScheduleInfoQuery().setScheduleId(scheduleId).execute(client);
  return { executed: i.executed?.toDate() ?? null, deleted: i.deleted?.toDate() ?? null,
           expires: i.expirationTime?.toDate() ?? null, scheduledTxId: i.scheduledTransactionId?.toString() };
  // or: GET {mirror}/api/v1/schedules/{id} -> executed_timestamp, deleted, signatures[]
}
```

## What this changes in the spec
- Remove the "if not, short expiry + cron" fallback and close the open question at Plan line 662. HIP-423 is live on testnet.
- **Demo:** use `setWaitForExpiry(false)` with an expiry of now + 7 days, or the 7th of next month, at most 62 days. The sweep executes on the Console co-sign, so the HashScan link exists within seconds. Don't use `waitForExpiry(true)` in the demo, because it would wait until expiry.
- A cron job still creates the schedule monthly; the network doesn't recur it. Use memo `kosha-sweep:YYYY-MM` and treat `IDENTICAL_SCHEDULE_ALREADY_CREATED` as success so the job is idempotent.
- Store `schedule_id` and the `scheduledTransactionId` (format `…?scheduled`) in `sweeps`. Set `sweeps.status` from mirror `executed_timestamp`, or `expiration_time` passing without one (expired), or `deleted`.
- Escrow and deposit accounts must both be associated with USDC. The escrow key is `KeyList([core, compliance], threshold 2)`. The scheduled-transaction payer should be Core's operator, not the escrow.
- Spec names `@hashgraph/sdk`; the maintained package is `@hiero-ledger/sdk@2.90.1`. This affects the decision for Agent A's `packages/hedera`.
- Plan line 426 says "via WalletConnect". PROTOCOL §2 already replaces it with a demo-key server action (B25) or `scripts/cosign-sweep.ts`; `cosignSweep()` above serves both. WalletConnect stays a stretch goal.
