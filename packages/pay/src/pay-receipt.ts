import { decodeHeader, HEADERS } from '@kosha/shared/headers';
import { type SettlementResponse, settlementResponseSchema } from '@kosha/shared/x402-payment';

// What `pay.lastReceipt` holds after a paid call
export type Receipt = {
  txId: SettlementResponse['transaction'];
  payer: SettlementResponse['payer'] | null;
  hashscanUrl: string | null;
  hcsSequence: number | null;
  tdsMicroUsdc: bigint;
  // The all-in total Pay signed for: the price plus any TDS reserved
  totalMicro: bigint;
};

// The decoded PAYMENT-RESPONSE, or null when the server sent none (or an unreadable one)
export const readSettlement = (response: Response): SettlementResponse | null => {
  const header = response.headers.get(HEADERS.paymentResponse);
  if (!header) {
    return null;
  }
  const decoded = decodeHeader(settlementResponseSchema, header);
  return decoded.ok ? decoded.data : null;
};

export const toReceipt = (
  settlement: SettlementResponse,
  quoted: { totalMicro: bigint; tdsMicroUsdc: bigint }
): Receipt => {
  const kosha = settlement.extensions?.kosha;
  return {
    txId: settlement.transaction,
    payer: settlement.payer ?? null,
    hashscanUrl: kosha?.hashscanUrl ?? null,
    hcsSequence: kosha?.hcsSequence ?? null,
    tdsMicroUsdc: kosha ? BigInt(kosha.tdsMicroUsdc) : quoted.tdsMicroUsdc,
    totalMicro: quoted.totalMicro
  };
};
