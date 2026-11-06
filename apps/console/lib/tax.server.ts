import 'server-only';
import { api, type ApiError, type ApiResponse } from '@/lib/api';
import { getRulePack, isMockMode, openTdsExport } from '@/lib/core.server';
import { paymentsHcsConfig } from '@/lib/display-config.server';
import { parseTdsExport, summarise, type TaxReport } from '@/lib/tax-report';
import { type Quarter } from '@/lib/tax-report';
import { URLS } from '@/lib/urls';
import { mirrorTopicMessage } from '@kosha/shared/links';
import { z } from 'zod';

const BAD_GATEWAY = 502;

/* eslint-disable @typescript-eslint/naming-convention -- Mirror Node fields are snake_case */
const topicMessagesSchema = z.object({
  messages: z.array(z.object({ sequence_number: z.int().positive(), message: z.string() }))
});
/* eslint-enable @typescript-eslint/naming-convention */
const rulePackMessageSchema = z.object({ t: z.literal('rulepack'), hash: z.string() });

const decode = (base64: string): unknown => {
  try {
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

// Core publishes each rule pack's hash to the payments topic when it starts; find that record so
// the screen can link the pack to its evidence. Null when it isn't in the topic's first page.
const findRulePackHcs = async (hash: string): Promise<TaxReport['rulePack']['hcs']> => {
  const topic = paymentsHcsConfig();
  if (isMockMode() || !topic) return null;
  const response = await api.get<unknown>(
    URLS.mirror.topicMessages(topic.mirrorUrl, topic.topicId)
  );
  const page = response.ok ? topicMessagesSchema.safeParse(response.data) : null;
  if (!page?.success) {
    console.error(`[tax]: Mirror Node topic read failed (${response.status})`);
    return null;
  }
  const match = page.data.messages.find(
    (message) => rulePackMessageSchema.safeParse(decode(message.message)).data?.hash === hash
  );
  if (!match) return null;
  const sequence = match.sequence_number;
  return { sequence, url: mirrorTopicMessage(topic.mirrorUrl, topic.topicId, sequence) };
};

// One quarter's TDS for this receiver: Core's export, summed overall and per deductee, with the
// rule pack it was decided under
export const getTaxReport = async (quarter: Quarter): Promise<ApiResponse<TaxReport, ApiError>> => {
  const [csv, rulePack] = await Promise.all([openTdsExport(quarter), getRulePack()]);
  if (!csv.ok) return csv;
  if (!rulePack.ok) return rulePack;
  const rows = parseTdsExport(await new Response(csv.data).text());
  if (!rows) {
    console.error('[tax]: the TDS export broke its schema');
    return {
      ok: false,
      status: BAD_GATEWAY,
      data: { message: 'Core sent a TDS file in an unknown shape' }
    };
  }
  const hcs = await findRulePackHcs(rulePack.data.hash);
  return {
    ok: true,
    status: 200,
    data: { quarter, ...summarise(rows), rows, rulePack: { ...rulePack.data, hcs } }
  };
};
