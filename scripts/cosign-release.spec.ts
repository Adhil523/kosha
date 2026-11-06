import { demoSigner, releaseArgument, signedScheduleSign } from './cosign-release';
import { PrivateKey, ScheduleSignTransaction, Transaction } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const KEY = PrivateKey.generateED25519();
const ENV = {
  HEDERA_NETWORK: 'testnet' as const,
  CORE_URL: 'http://localhost:4000',
  CONSOLE_ADMIN_TOKEN: 'a'.repeat(48),
  AGENT_RESIDENT_ACCOUNT_ID: '0.0.6001',
  AGENT_RESIDENT_PRIVATE_KEY: KEY.toStringDer(),
  AGENT_NONRESIDENT_ACCOUNT_ID: '0.0.6002',
  AGENT_NONRESIDENT_PRIVATE_KEY: 'x',
  AGENT_UNKNOWN_ACCOUNT_ID: '0.0.6003',
  AGENT_UNKNOWN_PRIVATE_KEY: 'y'
};

describe('cosign-release', () => {
  it('reads the release argument', () => {
    expect(releaseArgument(['--release', 'rel_1'])).toBe('rel_1');
    expect(releaseArgument(['--release'])).toBeNull();
    expect(releaseArgument([])).toBeNull();
  });

  it('picks the demo key behind the agent identity, CAIP-10 or UAID', () => {
    expect(demoSigner(ENV, 'hedera:testnet:0.0.6003')?.accountId).toBe('0.0.6003');
    expect(demoSigner(ENV, 'uaid:aid:0.0.6001')?.accountId).toBe('0.0.6001');
    expect(demoSigner(ENV, 'hedera:testnet:0.0.9999')).toBeNull();
  });

  it('serializes a ScheduleSign the agent paid for and signed', async () => {
    const signer = { accountId: '0.0.6001', privateKey: KEY.toStringDer() };
    const bytes = Buffer.from(await signedScheduleSign('0.0.8001', signer), 'base64');
    const parsed = Transaction.fromBytes(bytes);
    expect(parsed).toBeInstanceOf(ScheduleSignTransaction);
    if (!(parsed instanceof ScheduleSignTransaction)) return;
    expect(parsed.scheduleId?.toString()).toBe('0.0.8001');
    expect(parsed.transactionId?.accountId?.toString()).toBe('0.0.6001');
    expect((parsed.nodeAccountIds ?? []).map(String)).toEqual(['0.0.3', '0.0.4', '0.0.5']);
    const signatures = parsed.getSignatures();
    expect(signatures.size).toBe(3);
  });
});
