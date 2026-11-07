import {
  consensusIdenticalAggregation,
  consensusMedianAggregation,
  CronCapability,
  encodeCallMsg,
  EVMClient,
  getNetwork,
  handler,
  hexToBase64,
  HTTPClient,
  type HTTPSendRequester,
  LATEST_BLOCK_NUMBER,
  ok,
  type Report,
  Runner,
  type Runtime
} from '@chainlink/cre-sdk';
import type { HTTP_CLIENT_PB, SDK_PB } from '@chainlink/cre-sdk/pb';
import {
  type Address,
  bytesToHex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  zeroAddress
} from 'viem';
import { z } from 'zod';

// kosha-fx: Kosha Core's INR/USD rate. Reads Chainlink's INR/USD feed, checks it against the ECB
// reference rate, and sends Core a DON-signed report. Rates are micro-rupees per USD (₹94.49 →
// 94_490_000n), never floats, matching apps/core/src/fx.ts.
const MICRO = 1_000_000n;
const BPS = 10_000n;
const DECIMAL_RATE = /^(\d+)(?:\.(\d{1,6}))?$/;
// z.url() needs the URL global, which the workflow's WASM runtime doesn't have
const HTTP_URL = /^https?:\/\/\S+$/;

export const configSchema = z.object({
  schedule: z.string().min(1),
  chainSelectorName: z.string().min(1),
  inrUsdFeed: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  referenceUrl: z.string().regex(HTTP_URL),
  maxDeviationBps: z.number().int().positive(),
  coreReportUrl: z.string().regex(HTTP_URL)
});
export type Config = z.infer<typeof configSchema>;

// The report body Core decodes (apps/core/src/fx-report.ts must match)
export const FX_REPORT_PARAMS = parseAbiParameters(
  'uint256 inrPerUsdMicro, uint256 referenceInrPerUsdMicro, int256 feedAnswer, uint8 feedDecimals, uint64 feedUpdatedAt, uint64 chainSelector, address feed'
);

const FEED_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
]);

// The feed quotes USD per INR. Rounded up: a higher rate never under-values a payment in rupees.
export const inrPerUsdMicroFromFeed = (answer: bigint, decimals: number): bigint => {
  const scaled = 10n ** BigInt(decimals) * MICRO;
  return (scaled + answer - 1n) / answer;
};

// "93.92" → 93_920_000n, through the decimal text rather than a float
export const parseRateMicro = (text: string): bigint => {
  const match = DECIMAL_RATE.exec(text);
  if (!match) throw new Error(`[kosha-fx]: not a decimal rate: ${text}`);
  const [, whole = '0', fraction = ''] = match;
  return BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, '0'));
};

export const deviationBps = (a: bigint, b: bigint): bigint => ((a > b ? a - b : b - a) * BPS) / b;

const referenceRateSchema = z.object({ rates: z.object({ INR: z.number().positive() }) });

// Each node fetches the reference rate; the DON takes the median
const fetchReferenceMicro = (sendRequester: HTTPSendRequester, config: Config): bigint => {
  const response = sendRequester.sendRequest({ url: config.referenceUrl, method: 'GET' }).result();
  if (!ok(response)) throw new Error(`[kosha-fx]: reference rate HTTP ${response.statusCode}`);
  const body = referenceRateSchema.parse(JSON.parse(new TextDecoder().decode(response.body)));
  return parseRateMicro(String(body.rates.INR));
};

type FeedRead = { answer: bigint; decimals: number; updatedAt: bigint; chainSelector: bigint };

const readFeed = (runtime: Runtime<Config>): FeedRead => {
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: runtime.config.chainSelectorName
  });
  if (!network) throw new Error(`[kosha-fx]: unknown chain ${runtime.config.chainSelectorName}`);
  const evm = new EVMClient(network.chainSelector.selector);
  const to = runtime.config.inrUsdFeed as Address;
  // Polygon's safe and finalized reads are unreliable (CRE supported networks), so read latest
  const call = (functionName: 'decimals' | 'latestRoundData') =>
    evm
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to,
          data: encodeFunctionData({ abi: FEED_ABI, functionName })
        }),
        blockNumber: LATEST_BLOCK_NUMBER
      })
      .result().data;
  const decimals = decodeFunctionResult({
    abi: FEED_ABI,
    functionName: 'decimals',
    data: bytesToHex(call('decimals'))
  });
  const [, answer, , updatedAt] = decodeFunctionResult({
    abi: FEED_ABI,
    functionName: 'latestRoundData',
    data: bytesToHex(call('latestRoundData'))
  });
  if (answer <= 0n) throw new Error('[kosha-fx]: the feed answer is not positive');
  return { answer, decimals, updatedAt, chainSelector: network.chainSelector.selector };
};

// Pattern 4 (hex JSON) from the CRE docs, so Core can verify the signatures itself
const toCoreRequest =
  (url: string) =>
  (r: SDK_PB.ReportResponse): HTTP_CLIENT_PB.RequestJson => {
    const payload = {
      report: bytesToHex(r.rawReport).slice(2),
      context: bytesToHex(r.reportContext).slice(2),
      signatures: r.sigs.map((sig) => bytesToHex(sig.signature).slice(2))
    };
    return {
      url,
      method: 'POST',
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      headers: { 'Content-Type': 'application/json' },
      cacheSettings: { store: true, maxAge: '60s' }
    };
  };

type Submitted = { statusCode: number };

const submit = (sendRequester: HTTPSendRequester, report: Report, url: string): Submitted => {
  const response = sendRequester.sendReport(report, toCoreRequest(url)).result();
  if (!ok(response)) {
    const detail = new TextDecoder().decode(response.body);
    throw new Error(`[kosha-fx]: Core refused the report: HTTP ${response.statusCode} ${detail}`);
  }
  return { statusCode: response.statusCode };
};

export const onCron = (runtime: Runtime<Config>): string => {
  const { config } = runtime;
  const feed = readFeed(runtime);
  const chainlinkMicro = inrPerUsdMicroFromFeed(feed.answer, feed.decimals);
  const http = new HTTPClient();
  const referenceMicro = http
    .sendRequest(
      runtime,
      fetchReferenceMicro,
      consensusMedianAggregation<bigint>()
    )(config)
    .result();
  const deviation = deviationBps(chainlinkMicro, referenceMicro);
  runtime.log(
    `[kosha-fx]: Chainlink ${chainlinkMicro} µ₹/USD (updated ${feed.updatedAt}), ECB ${referenceMicro}, ${deviation} bps apart`
  );
  if (deviation > BigInt(config.maxDeviationBps)) {
    throw new Error(
      `[kosha-fx]: ${deviation} bps apart, over ${config.maxDeviationBps}; no report`
    );
  }

  const encoded = encodeAbiParameters(FX_REPORT_PARAMS, [
    chainlinkMicro,
    referenceMicro,
    feed.answer,
    feed.decimals,
    feed.updatedAt,
    feed.chainSelector,
    config.inrUsdFeed as Address
  ]);
  const report = runtime
    .report({
      encodedPayload: hexToBase64(encoded),
      encoderName: 'evm',
      signingAlgo: 'ecdsa',
      hashingAlgo: 'keccak256'
    })
    .result();
  const sent = http
    .sendRequest(
      runtime,
      (sendRequester: HTTPSendRequester) => submit(sendRequester, report, config.coreReportUrl),
      consensusIdenticalAggregation<Submitted>()
    )()
    .result();
  return `Core accepted INR/USD ${chainlinkMicro} micro-rupees (HTTP ${sent.statusCode})`;
};

export const initWorkflow = (config: Config) => [
  handler(new CronCapability().trigger({ schedule: config.schedule }), onCron)
];

// A function declaration, not a const: cre-compile rejects the module otherwise
// ("JS module does not export main")
export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
