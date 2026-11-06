import { z } from 'zod';

export const HEDERA_NETWORKS = ['testnet', 'mainnet'] as const;
export const hederaNetworkSchema = z.enum(HEDERA_NETWORKS);
export type HederaNetwork = z.output<typeof hederaNetworkSchema>;

// shard.realm.num, e.g. 0.0.4000
const ENTITY_ID = String.raw`\d+\.\d+\.\d+`;
const entityIdPattern = new RegExp(`^${ENTITY_ID}$`);

export const accountIdSchema = z.string().regex(entityIdPattern).brand<'AccountId'>();
export const tokenIdSchema = z.string().regex(entityIdPattern).brand<'TokenId'>();
export const topicIdSchema = z.string().regex(entityIdPattern).brand<'TopicId'>();
export const scheduleIdSchema = z.string().regex(entityIdPattern).brand<'ScheduleId'>();

export type AccountId = z.output<typeof accountIdSchema>;
export type TokenId = z.output<typeof tokenIdSchema>;
export type TopicId = z.output<typeof topicIdSchema>;
export type ScheduleId = z.output<typeof scheduleIdSchema>;

// SDK form: payer@seconds.nanos, with "?scheduled" for the inner transaction of a schedule
export const transactionIdSchema = z
  .string()
  .regex(new RegExp(`^${ENTITY_ID}@\\d+\\.\\d+(\\?scheduled)?$`))
  .brand<'TransactionId'>();
export type TransactionId = z.output<typeof transactionIdSchema>;

export const quoteIdSchema = z
  .string()
  .regex(/^q_[0-9A-Za-z]{4,40}$/)
  .brand<'QuoteId'>();
export type QuoteId = z.output<typeof quoteIdSchema>;

// A Level 0 agent identifies itself by its account: hedera:testnet:0.0.6001 (CAIP-10)
export const caip10AccountSchema = z
  .string()
  .regex(new RegExp(`^hedera:(${HEDERA_NETWORKS.join('|')}):${ENTITY_ID}$`))
  .brand<'Caip10Account'>();
export type Caip10Account = z.output<typeof caip10AccountSchema>;

// A registered agent sends its HCS-14 UAID, e.g. uaid:aid:<hash>;uid=0;registry=kosha;proto=hcs-10;nativeId=…
export const uaidSchema = z
  .string()
  .regex(/^uaid:(aid|did):[^;\s]+(;[^;=\s]+=[^;\s]*)*$/)
  .brand<'Uaid'>();
export type Uaid = z.output<typeof uaidSchema>;

// What Kosha Pay sends in X-KOSHA-AGENT
export const agentIdentitySchema = z.union([uaidSchema, caip10AccountSchema]);
export type AgentIdentity = z.output<typeof agentIdentitySchema>;
