import { accountTable, accountTableMarkdown } from './testnet-accounts';
import { describe, expect, it } from 'vitest';

const ENV = {
  CORE_ACCOUNT_ID: '0.0.1001',
  CORE_PRIVATE_KEY: '302e-secret',
  SETTLEMENT_TOKEN_ID: '0.0.7007',
  AGENT_RESIDENT_RESERVE_ID: '0.0.2002',
  HCS_AUDIT_TOPIC: '0.0.8003',
  RECEIVER_IN_ACCOUNT_ID: 'not-an-id'
};

describe('accountTable', () => {
  const rows = accountTable('testnet', ENV);
  const byKey = (envKey: string) => rows.find((row) => row.envKey === envKey);

  it('links accounts, the token and topics on HashScan', () => {
    expect(byKey('CORE_ACCOUNT_ID')?.link).toBe('https://hashscan.io/testnet/account/0.0.1001');
    expect(byKey('SETTLEMENT_TOKEN_ID')?.link).toBe('https://hashscan.io/testnet/token/0.0.7007');
    expect(byKey('HCS_AUDIT_TOPIC')?.link).toBe('https://hashscan.io/testnet/topic/0.0.8003');
    expect(byKey('AGENT_RESIDENT_RESERVE_ID')?.id).toBe('0.0.2002');
  });

  it('marks missing or malformed IDs as not set', () => {
    expect(byKey('RECEIVER_IN_ACCOUNT_ID')).toMatchObject({ id: null, link: null });
    expect(byKey('POOL_RESERVE_ACCOUNT_ID')).toMatchObject({ id: null, link: null });
  });

  it('never includes a private key in the document', () => {
    const markdown = accountTableMarkdown('testnet', rows);
    expect(markdown).not.toContain('302e-secret');
    expect(markdown).not.toMatch(/PRIVATE_KEY/);
    expect(markdown).toContain('| HCS audit topic | `HCS_AUDIT_TOPIC` | [0.0.8003]');
  });
});
