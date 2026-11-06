import { type DecideInput } from './decide';
import { loadBuiltInRulePack } from './load-rule-pack';
import { type RulePack } from './rule-pack';

const loaded = loadBuiltInRulePack('in-2026.1');
if (!loaded.ok) {
  throw new Error('[decide.fixture]: in-2026.1 failed to load');
}
export const IN_2026_1: RulePack = loaded.data;

export const INR_88_40 = 88_400_000n;
// ₹10,000 and ₹50,000 in paise
export const OTHER_THRESHOLD = 1_000_000n;
export const SPECIFIED_THRESHOLD = 5_000_000n;
// 0.10 USDC, worth 884 paise at ₹88.40
export const TEN_CENTS = 100_000n;

type Overrides = Omit<Partial<DecideInput>, 'payer' | 'receiver'> & {
  payer?: Partial<DecideInput['payer']>;
  receiver?: Partial<DecideInput['receiver']>;
};

// A resident payer with a PAN, paying a resident receiver in threshold mode, at the start of the year.
export const decideInput = (overrides: Overrides = {}): DecideInput => ({
  priceMicroUsdc: TEN_CENTS,
  inrPerUsdMicro: INR_88_40,
  aggregatePaise: 0n,
  mode: 'threshold',
  pack: IN_2026_1,
  ...overrides,
  payer: { residency: 'resident', panOnFile: true, specifiedPerson: false, ...overrides.payer },
  receiver: { residency: 'resident', ...overrides.receiver }
});
