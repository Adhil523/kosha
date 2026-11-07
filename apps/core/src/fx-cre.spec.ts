import { demoFixedFx, type FxSource } from './fx';
import { CRE_FX_SOURCES, createCreFx, loadCreFxConfig } from './fx-cre';
import type { FxReport } from './fx-report';
import { describe, expect, it } from 'vitest';

const HOUR_MS = 3_600_000;
const FEED_TIME = new Date('2026-11-06T03:28:07Z');
const SIGNERS = [
  '0x' + 'a'.repeat(40),
  '0x' + 'b'.repeat(40),
  '0x' + 'c'.repeat(40),
  '0x' + 'd'.repeat(40)
];

const fallback = (): FxSource => {
  const fixed = demoFixedFx('88.40');
  if (!fixed) throw new Error('fixture rate is invalid');
  return fixed;
};

const report = (overrides: Partial<FxReport> = {}): FxReport => ({
  reportHash: '0x01',
  workflowId: '0x02',
  inrPerUsdMicro: 94_491_166n,
  referenceInrPerUsdMicro: 93_920_000n,
  feedAnswer: 1_058_300n,
  feedDecimals: 8,
  feedUpdatedAt: FEED_TIME,
  chainSelector: 4051577828743386545n,
  feed: '0xDA0F8Df6F5dB15b346f4B8D1156722027E194E60',
  ...overrides
});

describe('loadCreFxConfig', () => {
  it('is off when CRE_FX_TRUST is unset', () => {
    expect(loadCreFxConfig({})).toEqual({ ok: true, data: null });
  });

  it('needs f + 1 of a 3f + 1 signer set by default', () => {
    const loaded = loadCreFxConfig({ CRE_FX_TRUST: 'signers', CRE_FX_SIGNERS: SIGNERS.join(', ') });
    expect(loaded.ok && loaded.data?.trust).toEqual({
      mode: 'signers',
      signers: new Set(SIGNERS),
      minSignatures: 2
    });
  });

  it('refuses signers mode without valid addresses', () => {
    expect(loadCreFxConfig({ CRE_FX_TRUST: 'signers' })).toEqual({
      ok: false,
      data: { key: 'CRE_FX_SIGNERS' }
    });
  });
});

describe('createCreFx', () => {
  const config = {
    trust: { mode: 'simulation' as const, minSignatures: 1 },
    maxAgeMs: 26 * HOUR_MS
  };

  it('quotes with the fallback until a report arrives', async () => {
    const cre = createCreFx({ fallback: fallback(), config });
    expect((await cre.source.current()).inrPerUsdMicro).toBe(88_400_000n);
  });

  it('uses a fresh report, labelled by how it was trusted', async () => {
    const now = () => new Date(FEED_TIME.getTime() + HOUR_MS);
    const cre = createCreFx({ fallback: fallback(), config, now });
    expect(cre.accept(report())).toBe(true);
    expect(await cre.source.current()).toEqual({
      inrPerUsdMicro: 94_491_166n,
      asOf: FEED_TIME,
      source: CRE_FX_SOURCES.simulation
    });
  });

  it('falls back once the feed reading is older than the limit', async () => {
    const now = () => new Date(FEED_TIME.getTime() + 27 * HOUR_MS);
    const cre = createCreFx({ fallback: fallback(), config, now });
    cre.accept(report());
    expect((await cre.source.current()).source).toBe('demo-fixed');
  });

  it('ignores a repeated report and one older than the rate in use', () => {
    const cre = createCreFx({ fallback: fallback(), config });
    expect(cre.accept(report())).toBe(true);
    expect(cre.accept(report())).toBe(false);
    const older = report({
      reportHash: '0x03',
      feedUpdatedAt: new Date(FEED_TIME.getTime() - HOUR_MS)
    });
    expect(cre.accept(older)).toBe(false);
  });
});
