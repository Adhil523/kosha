import { pairId, payMessage, rulepackHashPrefix, rulepackMessage } from './hcs-messages';
import { HCS_MESSAGE_LIMIT_BYTES } from '@kosha/hedera/hcs';
import { describe, expect, it } from 'vitest';

const HASH = 'ab'.repeat(32);

describe('HCS messages', () => {
  it('derives a stable pair ID that depends on the secret and both parties', () => {
    const id = pairId('secret', 'agent-1', 'receiver-1');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(pairId('secret', 'agent-1', 'receiver-1')).toBe(id);
    expect(pairId('other', 'agent-1', 'receiver-1')).not.toBe(id);
    expect(pairId('secret', 'receiver-1', 'agent-1')).not.toBe(id);
  });

  it('builds the v2 pay message with the running total and the rule-pack hash prefix', () => {
    const message = payMessage({
      paymentId: 'pay_1',
      transactionId: '0.0.4000@1762425000.000000000',
      rulepack: 'in-2026.2',
      rulepackHash: HASH,
      priceMicro: 100_000n,
      tdsMicro: 1_019n,
      rateBps: 100,
      pair: pairId('secret', 'agent-1', 'receiver-1'),
      fy: '2026-27',
      aggregatePaise: 1_000_884n
    });
    expect(message).toMatchObject({
      v: 2,
      t: 'pay',
      rph: rulepackHashPrefix(HASH),
      price: '100000',
      tds: '1019',
      bps: 100,
      agg: '1000884'
    });
    expect(rulepackHashPrefix(HASH)).toHaveLength(16);
    expect(new TextEncoder().encode(JSON.stringify(message)).length).toBeLessThan(
      HCS_MESSAGE_LIMIT_BYTES
    );
  });

  it('publishes the full rule-pack hash once per pack', () => {
    expect(rulepackMessage('in-2026.2', HASH)).toEqual({
      v: 2,
      t: 'rulepack',
      rp: 'in-2026.2',
      hash: HASH
    });
  });
});
