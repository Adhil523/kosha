import { type CreTrust, FX_REPORT_ERRORS, verifyFxReport } from './fx-report';
import { SIMULATED_FX_REPORT, SIMULATED_SIGNERS } from './fx-report.fixture';
import { describe, expect, it } from 'vitest';

const TRUST_SIGNERS: CreTrust = {
  mode: 'signers',
  signers: new Set(SIMULATED_SIGNERS),
  minSignatures: 2
};

describe('verifyFxReport', () => {
  it('decodes the rate kosha-fx reported, once enough trusted nodes signed', async () => {
    const verified = await verifyFxReport(SIMULATED_FX_REPORT, TRUST_SIGNERS);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.data.inrPerUsdMicro).toBe(94_491_166n);
    expect(verified.data.referenceInrPerUsdMicro).toBe(93_920_000n);
    expect(verified.data.feedDecimals).toBe(8);
    expect(verified.data.feed).toBe('0xDA0F8Df6F5dB15b346f4B8D1156722027E194E60');
  });

  it('refuses a report signed by nodes it does not trust', async () => {
    const strangers: CreTrust = {
      mode: 'signers',
      signers: new Set(['0x' + '1'.repeat(40)]),
      minSignatures: 1
    };
    const verified = await verifyFxReport(SIMULATED_FX_REPORT, strangers);
    expect(verified).toEqual({
      ok: false,
      data: { error: FX_REPORT_ERRORS.notSigned, message: '0 trusted signatures, 1 required' }
    });
  });

  it('counts a repeated signature once', async () => {
    const [first = ''] = SIMULATED_FX_REPORT.signatures;
    const repeated = { ...SIMULATED_FX_REPORT, signatures: [first, first, first] };
    const verified = await verifyFxReport(repeated, TRUST_SIGNERS);
    expect(verified.ok).toBe(false);
  });

  it('refuses a tampered body: the signatures no longer recover to the trusted nodes', async () => {
    const report = SIMULATED_FX_REPORT.report;
    const tampered = { ...SIMULATED_FX_REPORT, report: report.slice(0, -2) + 'ff' };
    const verified = await verifyFxReport(tampered, TRUST_SIGNERS);
    expect(verified.ok).toBe(false);
  });

  it('in simulation mode, accepts the throwaway signers it cannot trust', async () => {
    const verified = await verifyFxReport(SIMULATED_FX_REPORT, {
      mode: 'simulation',
      minSignatures: 2
    });
    expect(verified.ok).toBe(true);
  });
});
