import { lookupUrl, payOnceConfig, readPayOnceEnv } from './pay-once';
import { createKoshaPay, type KoshaPay } from '@kosha/pay/kosha-pay';
import { loadEnv } from '@kosha/shared/env';
import { hashscanAccount } from '@kosha/shared/links';
import { formatUsdc } from '@kosha/shared/money';
import { type ChildProcess, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `pnpm burst [--calls 20] [--url <api url>]` (B17): agent-resident pays demo-api-in 20 times in
// quick succession, so the Console's threshold counter visibly moves on stage. Without --url it
// starts its own demo-api-in with DEMO_API_PROOF=off on a side port, so the calls are not each
// held up by Gate's Mirror Node reserve proof (B28), and stops it at the end. With --url (say a
// deployed API) it bursts against that one as it is. Needs Core running and `pnpm seed`.

const DEFAULT_CALLS = 20;
const MAX_CALLS = 200;
const CONCURRENCY = 4;
const BURST_PORT = 4111;
const START_TIMEOUT_MS = 20_000;
const HEALTH_POLL_MS = 250;

export type BurstArgs = { calls: number; url: string | null };
export type ParsedArgs = { ok: true; data: BurstArgs } | { ok: false; data: string };

export const parseArgs = (argv: string[]): ParsedArgs => {
  const args: BurstArgs = { calls: DEFAULT_CALLS, url: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--calls' && value !== undefined) {
      const calls = Number(value);
      if (!Number.isInteger(calls) || calls < 1 || calls > MAX_CALLS) {
        return { ok: false, data: `--calls takes a whole number from 1 to ${MAX_CALLS}` };
      }
      args.calls = calls;
      index += 1;
    } else if (flag === '--url' && value !== undefined) {
      if (!URL.canParse(value)) return { ok: false, data: '--url takes an absolute URL' };
      args.url = value;
      index += 1;
    } else {
      return { ok: false, data: `unknown argument ${flag ?? ''}` };
    }
  }
  return { ok: true, data: args };
};

export type BurstResult =
  | { index: number; ok: true; txId: string; tdsMicro: bigint }
  | { index: number; ok: false; reason: string };

// One call through Pay's two steps, so concurrent calls never share `lastReceipt`
export const payOnce = async (pay: KoshaPay, url: string, index: number): Promise<BurstResult> => {
  const prepared = await pay.prepare(url);
  if (!prepared.ok) {
    return { index, ok: false, reason: `${prepared.data.reason}: ${prepared.data.message}` };
  }
  if (prepared.data.kind === 'free') {
    return { index, ok: false, reason: `${url} is not priced (${prepared.data.response.status})` };
  }
  const done = await pay.complete(prepared.data.payment);
  if (!done.ok) return { index, ok: false, reason: `${done.data.reason}: ${done.data.message}` };
  const receipt = done.data.receipt;
  return {
    index,
    ok: true,
    txId: receipt?.txId ?? '(no receipt)',
    tdsMicro: receipt?.tdsMicroUsdc ?? 0n
  };
};

// A small worker pool: `concurrency` calls in flight, results in call order
export const runBurst = async (
  calls: number,
  concurrency: number,
  call: (index: number) => Promise<BurstResult>,
  onResult: (result: BurstResult) => void = () => {}
): Promise<BurstResult[]> => {
  const results: BurstResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < calls) {
      const index = next;
      next += 1;
      const result = await call(index);
      results[index] = result;
      onResult(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, calls) }, worker));
  return results;
};

export type BurstSummary = { settled: number; failed: number; tdsMicro: bigint; withTds: number };

export const summarise = (results: BurstResult[]): BurstSummary =>
  results.reduce<BurstSummary>(
    (summary, result) =>
      result.ok
        ? {
            ...summary,
            settled: summary.settled + 1,
            tdsMicro: summary.tdsMicro + result.tdsMicro,
            withTds: summary.withTds + (result.tdsMicro > 0n ? 1 : 0)
          }
        : { ...summary, failed: summary.failed + 1 },
    { settled: 0, failed: 0, tdsMicro: 0n, withTds: 0 }
  );

const waitForHealth = async (baseUrl: string, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/health', baseUrl));
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  return false;
};

// Its own demo-api-in, proof off, in its own process group so the stop reaches tsx under pnpm
const startDemoApi = (port: number): ChildProcess => {
  const child = spawn('pnpm', ['--filter', '@kosha/demo-api-in', 'start'], {
    env: { ...process.env, DEMO_API_IN_PORT: String(port), DEMO_API_PROOF: 'off' },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true
  });
  child.unref();
  return child;
};

const stopDemoApi = (child: ChildProcess): void => {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
};

const main = async (): Promise<void> => {
  const loaded = loadEnv();
  if (!loaded.ok) throw new Error(`no pnpm workspace found above ${loaded.data.searchedFrom}`);
  const args = parseArgs(process.argv.slice(2));
  if (!args.ok) throw new Error(`${args.data}; usage: pnpm burst [--calls 20] [--url <api url>]`);
  const read = readPayOnceEnv(process.env);
  if (!read.ok)
    throw new Error(`set these env keys (pnpm bootstrap): ${read.data.keys.join(', ')}`);

  const ownApi = args.data.url === null;
  const apiUrl = args.data.url ?? `http://localhost:${BURST_PORT}`;
  const env = { ...read.data, DEMO_API_IN_URL: apiUrl };
  const url = lookupUrl(env);
  const child = ownApi ? startDemoApi(BURST_PORT) : null;
  try {
    if (child) {
      console.info(
        `[burst]: starting demo-api-in on port ${BURST_PORT} with the reserve proof off`
      );
      if (!(await waitForHealth(apiUrl, START_TIMEOUT_MS))) {
        throw new Error(`demo-api-in did not answer on ${apiUrl} within ${START_TIMEOUT_MS} ms`);
      }
    }
    const pay = createKoshaPay(payOnceConfig(env));
    const { calls } = args.data;
    console.info(`[burst]: ${calls} calls to ${url}, ${CONCURRENCY} in flight`);
    const started = Date.now();
    const results = await runBurst(
      calls,
      CONCURRENCY,
      (index) => payOnce(pay, url, index),
      (result) => {
        const label = `${result.index + 1}/${calls}`;
        if (result.ok) {
          const tds = result.tdsMicro > 0n ? `, TDS ${formatUsdc(result.tdsMicro)} USDC` : '';
          console.info(`[burst]: ${label} settled ${result.txId}${tds}`);
        } else {
          console.error(`[burst]: ${label} failed: ${result.reason}`);
        }
      }
    );
    const summary = summarise(results);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.info(
      `[burst]: ${summary.settled} settled, ${summary.failed} failed in ${seconds} s; ` +
        `TDS reserved on ${summary.withTds} calls, ${formatUsdc(summary.tdsMicro)} USDC in total`
    );
    console.info(
      `[burst]: reserve ${hashscanAccount(env.HEDERA_NETWORK, env.AGENT_RESIDENT_RESERVE_ID)}`
    );
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    if (child) stopDemoApi(child);
  }
};

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url);
};

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    console.error('[burst]: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
