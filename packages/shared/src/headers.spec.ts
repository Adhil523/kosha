import { decodeHeader, encodeHeader } from './headers';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const sampleSchema = z.object({ url: z.string(), note: z.string() });

describe('header codec', () => {
  it('round-trips JSON, including non-ASCII text', () => {
    const value = { url: 'https://api.demo-in.dev/v1/gst-lookup', note: '₹8.84 कोश' };

    const decoded = decodeHeader(sampleSchema, encodeHeader(value));

    expect(decoded).toEqual({ ok: true, data: value });
  });

  it('uses the standard base64 alphabet', () => {
    expect(encodeHeader({ a: '>>>?' })).toBe(btoa('{"a":">>>?"}'));
  });

  it('reports a value that is not base64 JSON', () => {
    expect(decodeHeader(sampleSchema, 'not base64!')).toEqual({
      ok: false,
      data: { reason: 'not_base64_json' }
    });
    expect(decodeHeader(sampleSchema, btoa('not json'))).toEqual({
      ok: false,
      data: { reason: 'not_base64_json' }
    });
  });

  it('reports JSON with the wrong shape, with the issues', () => {
    const decoded = decodeHeader(sampleSchema, encodeHeader({ url: 1 }));

    expect(decoded.ok).toBe(false);
    expect(!decoded.ok && decoded.data.reason).toBe('invalid_shape');
    expect(!decoded.ok && decoded.data.issues?.length).toBeGreaterThan(0);
  });
});
