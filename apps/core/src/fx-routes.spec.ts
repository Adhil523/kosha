import { buildApp } from './app';
import { demoFixedFx } from './fx';
import { CRE_FX_SOURCES,createCreFx } from './fx-cre';
import type { CreTrust } from './fx-report';
import { SIMULATED_FX_REPORT, SIMULATED_SIGNERS } from './fx-report.fixture';
import { fxRoutes } from './fx-routes';
import { describe, expect, it } from 'vitest';

// The fixture's feed reading is from 2026-11-06; keep it fresh for these tests
const NOW = () => new Date('2026-11-06T06:00:00Z');

const appWith = (trust: CreTrust | null) => {
  const fixed = demoFixedFx('88.40');
  if (!fixed) throw new Error('fixture rate is invalid');
  const cre = trust
    ? {
        fx: createCreFx({ fallback: fixed, config: { trust, maxAgeMs: 26 * 3_600_000 }, now: NOW }),
        trust
      }
    : null;
  return buildApp({ logger: false, routes: [fxRoutes({ fx: cre ? cre.fx.source : fixed, cre })] });
};

const post = (app: ReturnType<typeof buildApp>, remoteAddress = '127.0.0.1') =>
  app.inject({ method: 'POST', url: '/v1/fx/report', payload: SIMULATED_FX_REPORT, remoteAddress });

describe('fxRoutes', () => {
  it('reports the fixed rate while no CRE source is configured', async () => {
    const app = appWith(null);
    expect((await app.inject({ method: 'GET', url: '/v1/fx' })).json()).toMatchObject({
      inrPerUsdMicro: '88400000',
      source: 'demo-fixed'
    });
    expect((await post(app)).statusCode).toBe(503);
  });

  it("applies a report signed by the DON's signers and quotes with it", async () => {
    const app = appWith({ mode: 'signers', signers: new Set(SIMULATED_SIGNERS), minSignatures: 2 });
    const response = await post(app, '203.0.113.7');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      applied: true,
      rate: { inrPerUsdMicro: '94491166', source: CRE_FX_SOURCES.signers }
    });
    expect((await post(app, '203.0.113.7')).json()).toMatchObject({ applied: false });
    expect((await app.inject({ method: 'GET', url: '/v1/fx' })).json()).toMatchObject({
      source: CRE_FX_SOURCES.signers
    });
  });

  it('refuses a report from untrusted signers', async () => {
    const app = appWith({
      mode: 'signers',
      signers: new Set(['0x' + '1'.repeat(40)]),
      minSignatures: 1
    });
    const response = await post(app);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'fx_report_not_signed' });
  });

  it('takes simulated reports only from this machine, labelled as simulated', async () => {
    const app = appWith({ mode: 'simulation', minSignatures: 2 });
    expect((await post(app, '203.0.113.7')).statusCode).toBe(403);
    expect((await post(app)).json()).toMatchObject({
      applied: true,
      rate: { source: CRE_FX_SOURCES.simulation }
    });
  });
});
