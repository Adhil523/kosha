import 'server-only';
import type { HcsLinkConfig } from '@/components/elements/PaymentsFeed';
import { topicIdSchema } from '@kosha/shared/ids';

const DEFAULT_MIRROR_URL = 'https://testnet.mirrornode.hedera.com';
// FX_SOURCE=demo-fixed: the rate Core quotes with, shown in the counter's tooltip
const DEFAULT_FX_INR_PER_USD = '88.40';

export const mirrorUrl = (): string => process.env.MIRROR_URL?.trim() || DEFAULT_MIRROR_URL;

// The payments topic from bootstrap; without it the feed shows HashScan links only
export const paymentsHcsConfig = (): HcsLinkConfig => {
  const topic = topicIdSchema.safeParse(process.env.HCS_PAYMENTS_TOPIC?.trim());
  if (!topic.success) return null;
  return { mirrorUrl: mirrorUrl(), topicId: topic.data };
};

export const demoFxInrPerUsd = (): string =>
  process.env.FX_DEMO_INR_PER_USD?.trim() || DEFAULT_FX_INR_PER_USD;
