import { type PayConfigInput } from './pay-config';
import { PrivateKey } from '@hiero-ledger/sdk';

// The spec's agent-resident: pays from 0.0.6001, reserves TDS in 0.0.6101, trusts Core at 0.0.4000
export const PAYER_KEY = PrivateKey.generateED25519();

export const PAY_CONFIG: PayConfigInput = {
  network: 'testnet',
  accountId: '0.0.6001',
  privateKey: PAYER_KEY.toStringDer(),
  reserveAccountId: '0.0.6101',
  asset: '0.0.429274',
  trustedFacilitators: ['0.0.4000'],
  policy: {
    perPaymentUsdc: '0.50',
    dailyUsdc: '5',
    fyBudgetUsdc: '200',
    allowlist: ['api.demo-in.dev']
  }
};
