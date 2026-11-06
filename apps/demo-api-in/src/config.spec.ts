import { loadConfig } from './config';
import { describe, expect, it } from 'vitest';

describe('loadConfig', () => {
  it('applies the default port, Console URL and the reserve proof', () => {
    expect(loadConfig({ CORE_URL: 'http://localhost:4100', DEMO_API_IN_KEY: 'secret' })).toEqual({
      ok: true,
      data: {
        core: 'http://localhost:4100',
        apiKey: 'secret',
        port: 4101,
        registrationUrl: 'http://localhost:3000/agents',
        onChainProof: true
      }
    });
  });

  it('switches the reserve proof off for the burst script', () => {
    const result = loadConfig({
      CORE_URL: 'http://localhost:4100',
      DEMO_API_IN_KEY: 'secret',
      DEMO_API_PROOF: 'off'
    });

    expect(result.ok && result.data.onChainProof).toBe(false);
  });

  it('names every missing or invalid key, never a value', () => {
    const result = loadConfig({
      CORE_URL: 'not a url',
      DEMO_API_IN_KEY: ' ',
      DEMO_API_IN_PORT: '0',
      DEMO_API_PROOF: 'maybe'
    });

    expect(result).toEqual({
      ok: false,
      data: { problems: ['CORE_URL', 'DEMO_API_IN_KEY', 'DEMO_API_IN_PORT', 'DEMO_API_PROOF'] }
    });
  });
});
