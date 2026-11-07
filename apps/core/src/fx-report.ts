import {
  type Address,
  concatHex,
  decodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  recoverAddress,
  toHex
} from 'viem';
import { z } from 'zod';

// A Chainlink CRE report from the kosha-fx workflow (cre/kosha-fx), checked the way the CRE docs'
// "Verifying outside CRE" does: hash the report, recover each DON signature, count trusted signers.
const REPORT_HEADER_BYTES = 109;
const SIGNATURE_BYTES = 65;
const HEX = /^[0-9a-fA-F]*$/;

// The body kosha-fx encodes; cre/kosha-fx/main.ts FX_REPORT_PARAMS must match
const FX_REPORT_PARAMS = parseAbiParameters(
  'uint256 inrPerUsdMicro, uint256 referenceInrPerUsdMicro, int256 feedAnswer, uint8 feedDecimals, uint64 feedUpdatedAt, uint64 chainSelector, address feed'
);

// Pattern 4 of "Submitting Reports via HTTP": hex strings without 0x
export const creReportPayloadSchema = z.object({
  report: z
    .string()
    .regex(HEX)
    .min(REPORT_HEADER_BYTES * 2),
  context: z.string().regex(HEX).min(2),
  signatures: z
    .array(
      z
        .string()
        .regex(HEX)
        .length(SIGNATURE_BYTES * 2)
    )
    .min(1)
    .max(32)
});
export type CreReportPayload = z.infer<typeof creReportPayloadSchema>;

// signers: a deployed workflow's DON signers (from Chainlink's Capability Registry), counted.
// simulation: `cre workflow simulate` signs with fresh throwaway keys on every run, so no signer
// can be trusted; any distinct signers count, and the route accepts such reports only locally.
export type CreTrust =
  | { mode: 'signers'; signers: ReadonlySet<string>; minSignatures: number }
  | { mode: 'simulation'; minSignatures: number };

export type FxReport = {
  reportHash: Hex;
  workflowId: Hex;
  inrPerUsdMicro: bigint;
  referenceInrPerUsdMicro: bigint;
  feedAnswer: bigint;
  feedDecimals: number;
  feedUpdatedAt: Date;
  chainSelector: bigint;
  feed: Address;
};

export const FX_REPORT_ERRORS = {
  notSigned: 'fx_report_not_signed',
  badBody: 'fx_report_bad_body'
} as const;
type FxReportError = (typeof FX_REPORT_ERRORS)[keyof typeof FX_REPORT_ERRORS];

export type VerifiedFxReport =
  { ok: true; data: FxReport } | { ok: false; data: { error: FxReportError; message: string } };

const fromHex = (hex: string): Hex => `0x${hex}`;

// What each DON node signs: keccak256(keccak256(rawReport) || reportContext)
export const creReportHash = (report: Hex, context: Hex): Hex =>
  keccak256(concatHex([keccak256(report), context]));

const recoverSigner = async (hash: Hex, signature: Hex): Promise<string | null> => {
  const bytes = hexToBytes(signature);
  const v = bytes[SIGNATURE_BYTES - 1] ?? 0;
  // CRE nodes may sign with v = 27/28; recovery wants 0/1
  if (v >= 27) bytes[SIGNATURE_BYTES - 1] = v - 27;
  try {
    const address = await recoverAddress({ hash, signature: toHex(bytes) });
    return address.toLowerCase();
  } catch {
    return null;
  }
};

const decodeBody = (report: Hex): FxReport | null => {
  const body = toHex(hexToBytes(report).slice(REPORT_HEADER_BYTES));
  try {
    const [rate, reference, answer, decimals, updatedAt, chainSelector, feed] = decodeAbiParameters(
      FX_REPORT_PARAMS,
      body
    );
    if (rate <= 0n || answer <= 0n) return null;
    return {
      reportHash: keccak256(report),
      workflowId: toHex(hexToBytes(report).slice(45, 77)),
      inrPerUsdMicro: rate,
      referenceInrPerUsdMicro: reference,
      feedAnswer: answer,
      feedDecimals: decimals,
      feedUpdatedAt: new Date(Number(updatedAt) * 1000),
      chainSelector,
      feed
    };
  } catch {
    return null;
  }
};

export const verifyFxReport = async (
  payload: CreReportPayload,
  trust: CreTrust
): Promise<VerifiedFxReport> => {
  const report = fromHex(payload.report);
  const hash = creReportHash(report, fromHex(payload.context));
  const recovered = await Promise.all(
    payload.signatures.map((signature) => recoverSigner(hash, fromHex(signature)))
  );
  const counts = (address: string | null): address is string =>
    address !== null && (trust.mode === 'simulation' || trust.signers.has(address));
  // Each node counts once, however many times its signature is repeated
  const trusted = new Set(recovered.filter(counts));
  if (trusted.size < trust.minSignatures) {
    return {
      ok: false,
      data: {
        error: FX_REPORT_ERRORS.notSigned,
        message: `${trusted.size} trusted signatures, ${trust.minSignatures} required`
      }
    };
  }
  const decoded = decodeBody(report);
  if (!decoded) {
    return {
      ok: false,
      data: { error: FX_REPORT_ERRORS.badBody, message: 'the report body is not a kosha-fx rate' }
    };
  }
  return { ok: true, data: decoded };
};
