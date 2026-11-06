import { finalText, readReceipts } from './transcript';
import { KOSHA_PAID_FETCH, type PaidFetchOutput } from '@kosha/pay/agent-kit-plugin';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

const URL_PAID = 'http://localhost:4101/v1/gst-lookup?gstin=29AAKCK4821M1ZQ';

const toolMessage = (output: PaidFetchOutput, name = KOSHA_PAID_FETCH) =>
  // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain's field name
  new ToolMessage({ content: JSON.stringify(output), tool_call_id: 'call_1', name });

describe('readReceipts', () => {
  it('describes each paid, free and refused call in order, ignoring other tools', () => {
    const messages = [
      new HumanMessage('find GST details'),
      toolMessage({
        raw: {
          status: 'SUCCESS',
          url: URL_PAID,
          paid: true,
          totalUsdc: '0.101019',
          tdsUsdc: '0.001019',
          transactionId: '0.0.4000@1762424400.123456789',
          hashscanUrl: 'https://hashscan.io/testnet/transaction/0.0.4000-1762424400-123456789'
        },
        humanMessage: 'Paid'
      }),
      toolMessage({
        raw: { status: 'SUCCESS', url: URL_PAID, paid: false, httpStatus: 200 },
        humanMessage: 'Free'
      }),
      toolMessage({
        raw: {
          status: 'ERROR',
          url: URL_PAID,
          paid: false,
          error: 'blocked by policy: Kosha budget'
        },
        humanMessage: 'Blocked'
      }),
      toolMessage(
        { raw: { status: 'SUCCESS', url: 'x', paid: false }, humanMessage: 'x' },
        'get_hbar_balance_query_tool'
      )
    ];

    expect(readReceipts(messages)).toEqual([
      `paid 0.101019 USDC (TDS reserved 0.001019 USDC) for ${URL_PAID}: 0.0.4000@1762424400.123456789 https://hashscan.io/testnet/transaction/0.0.4000-1762424400-123456789`,
      `free: ${URL_PAID} (200)`,
      `not paid: ${URL_PAID}: blocked by policy: Kosha budget`
    ]);
  });
});

describe('finalText', () => {
  it("reads the last answer's text, skipping non-text blocks", () => {
    const messages = [
      new AIMessage('first draft'),
      new AIMessage({
        content: [
          { type: 'thinking', thinking: 'weighing the lookups', signature: 'sig' },
          { type: 'text', text: 'Five companies, all active.' }
        ]
      })
    ];

    expect(finalText(messages)).toBe('Five companies, all active.');
  });
});
