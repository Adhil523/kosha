import { type BurstResult, parseArgs, runBurst, summarise } from './burst';
import { describe, expect, it } from 'vitest';

describe('parseArgs', () => {
  it('defaults to 20 calls against its own demo API', () => {
    expect(parseArgs([])).toEqual({ ok: true, data: { calls: 20, url: null } });
  });

  it('takes a call count and a deployed API', () => {
    expect(parseArgs(['--calls', '5', '--url', 'https://api.example/v1'])).toEqual({
      ok: true,
      data: { calls: 5, url: 'https://api.example/v1' }
    });
  });

  it('refuses a bad count, a bad URL and an unknown flag', () => {
    expect(parseArgs(['--calls', '0']).ok).toBe(false);
    expect(parseArgs(['--calls', '2.5']).ok).toBe(false);
    expect(parseArgs(['--url', 'not a url']).ok).toBe(false);
    expect(parseArgs(['--fast']).ok).toBe(false);
  });
});

describe('runBurst', () => {
  it('keeps at most the given calls in flight and returns results in call order', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await runBurst(7, 3, async (index) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Later calls finish first, so order has to come from the index, not completion
      await new Promise((resolve) => setTimeout(resolve, 10 - index));
      inFlight -= 1;
      return { index, ok: true, txId: `tx-${index}`, tdsMicro: 0n };
    });

    expect(peak).toBe(3);
    expect(results.map((result) => result.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('reports each result as it lands', async () => {
    const seen: number[] = [];
    await runBurst(
      3,
      1,
      async (index) => ({ index, ok: true, txId: 'tx', tdsMicro: 0n }),
      (result) => seen.push(result.index)
    );
    expect(seen).toEqual([0, 1, 2]);
  });
});

describe('summarise', () => {
  it('counts settled, failed and the calls that reserved TDS', () => {
    const results: BurstResult[] = [
      { index: 0, ok: true, txId: 'a', tdsMicro: 0n },
      { index: 1, ok: true, txId: 'b', tdsMicro: 1019n },
      { index: 2, ok: false, reason: 'policy_daily: over the cap' },
      { index: 3, ok: true, txId: 'c', tdsMicro: 1019n }
    ];
    expect(summarise(results)).toEqual({ settled: 3, failed: 1, tdsMicro: 2038n, withTds: 2 });
  });
});
