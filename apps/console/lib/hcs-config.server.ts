import 'server-only';
import type { HcsLinkConfig } from '@/components/elements/PaymentsFeed';
import { topicIdSchema } from '@kosha/shared/ids';

const DEFAULT_MIRROR_URL = 'https://testnet.mirrornode.hedera.com';

// The payments topic from bootstrap; without it the feed shows HashScan links only
export const paymentsHcsConfig = (): HcsLinkConfig => {
  const topic = topicIdSchema.safeParse(process.env.HCS_PAYMENTS_TOPIC?.trim());
  if (!topic.success) return null;
  return { mirrorUrl: process.env.MIRROR_URL?.trim() || DEFAULT_MIRROR_URL, topicId: topic.data };
};
