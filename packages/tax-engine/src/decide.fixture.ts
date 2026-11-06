import { type DecideInput } from './decide';
import { loadBuiltInRulePack } from './load-rule-pack';
import { type RulePack } from './rule-pack';

const loaded = loadBuiltInRulePack('in-2026.2');
if (!loaded.ok) {
  throw new Error('[decide.fixture]: in-2026.2 failed to load');
}
export const IN_2026_2: RulePack = loaded.data;

export const INR_88_40 = 88_400_000n;
// ₹10,000, ₹50,000 and the ₹5,000 unverified-payer tolerance, in paise
export const OTHER_THRESHOLD = 1_000_000n;
export const SPECIFIED_THRESHOLD = 5_000_000n;
export const TOLERANCE = 500_000n;
// 0.10 USDC, worth 884 paise at ₹88.40
export const TEN_CENTS = 100_000n;

type Overrides = Omit<Partial<DecideInput>, 'payer' | 'receiver'> & {
  payer?: Partial<DecideInput['payer']>;
  receiver?: Partial<DecideInput['receiver']>;
};

// A resident payer with a PAN, paying a resident, non-specified-person receiver in threshold mode
// (tolerant to unverified payers), at the start of the year.
export const decideInput = (overrides: Overrides = {}): DecideInput => ({
  priceMicroUsdc: TEN_CENTS,
  inrPerUsdMicro: INR_88_40,
  aggregatePaise: 0n,
  pack: IN_2026_2,
  ...overrides,
  payer: { residency: 'resident', panOnFile: true, ...overrides.payer },
  receiver: {
    residency: 'resident',
    specifiedPerson: false,
    mode: 'threshold',
    unverifiedPolicy: 'threshold_tolerant',
    ...overrides.receiver
  }
});
