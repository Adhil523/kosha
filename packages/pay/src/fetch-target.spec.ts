import { checkTarget } from './fetch-target';
import { describe, expect, it } from 'vitest';

// The metadata address is allowlisted on purpose: a private address is refused regardless
const ALLOWLIST = ['api.demo-in.dev', 'localhost', '169.254.169.254', '8.8.8.8'];

describe('checkTarget', () => {
  it.each([
    'https://api.demo-in.dev/v1/gst-lookup?gstin=29AAKCK4821M1ZQ',
    'http://localhost:4101/v1/gst-lookup',
    'http://8.8.8.8/'
  ])('lets an allowlisted public host through: %s', (url) => {
    expect(checkTarget(url, ALLOWLIST).ok).toBe(true);
  });

  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['metadata spelled as a decimal', 'http://2852039166/'],
    ['loopback', 'http://127.0.0.1:4000/admin'],
    ['loopback spelled short and in hex', 'http://0x7f.1/'],
    ['the unspecified address', 'http://0.0.0.0/'],
    ['10/8', 'http://10.0.0.5/'],
    ['172.16/12', 'http://172.31.255.1/'],
    ['192.168/16', 'http://192.168.1.1/'],
    ["carrier-grade NAT (Alibaba's metadata)", 'http://100.100.100.200/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
    ["AWS's IPv6 metadata", 'http://[fd00:ec2::254]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['a file URL', 'file:///etc/passwd'],
    ['not a URL', 'nope']
  ])('refuses %s before any fetch', (_label, url) => {
    const result = checkTarget(url, ALLOWLIST);

    expect(!result.ok && result.data.reason).toBe('blocked_host');
  });

  it('refuses a public host that is not on the allowlist', () => {
    const result = checkTarget('https://attacker.example/?leak=secret', ALLOWLIST);

    expect(!result.ok && result.data.reason).toBe('policy_allowlist');
  });

  it.each(['http://[::ffff:8.8.8.8]/', 'http://[2606:4700::1111]/'])(
    'leaves a public IPv6 literal to the allowlist: %s',
    (url) => {
      const result = checkTarget(url, ALLOWLIST);

      expect(!result.ok && result.data.reason).toBe('policy_allowlist');
    }
  );
});
