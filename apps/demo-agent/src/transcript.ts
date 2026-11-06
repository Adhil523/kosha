import {
  KOSHA_PAID_FETCH_TOOL,
  type PaidFetchOutput,
  readPaidFetchOutput
} from '@kosha/pay/agent-kit-plugin';
import { AIMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages';

const describe = ({ raw }: PaidFetchOutput): string => {
  if (raw.status !== 'SUCCESS') return `not paid: ${raw.url}: ${raw.error ?? 'unknown error'}`;
  if (!raw.paid) return `free: ${raw.url} (${raw.httpStatus ?? '?'})`;
  return (
    `paid ${raw.totalUsdc} USDC (TDS reserved ${raw.tdsUsdc} USDC) for ${raw.url}: ` +
    `${raw.transactionId ?? 'no transaction ID'} ${raw.hashscanUrl ?? ''}`.trimEnd()
  );
};

// One line per kosha_paid_fetch_tool call the agent made, in order: paid, free, or refused and why
export const readReceipts = (messages: BaseMessage[]): string[] =>
  messages
    .filter((message) => ToolMessage.isInstance(message) && message.name === KOSHA_PAID_FETCH_TOOL)
    .flatMap((message) => {
      const output = readPaidFetchOutput(message.content);
      return output ? [describe(output)] : [];
    });

// The agent's last answer as plain text, whatever content blocks the model used
export const finalText = (messages: BaseMessage[]): string => {
  const answer = messages.findLast((message) => AIMessage.isInstance(message));
  return answer?.text ?? '';
};
