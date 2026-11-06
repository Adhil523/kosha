import { hostAllowed } from './check-policy';

export type TargetRefusal = 'policy_allowlist' | 'blocked_host';

export type CheckTargetResult =
  { ok: true; data: URL } | { ok: false; data: { reason: TargetRefusal; message: string } };

const WEB_PROTOCOLS = ['http:', 'https:'];
// [first octet, lowest second octet, highest second octet]: this network, private, carrier-grade
// NAT (Alibaba's metadata service), loopback, link-local (AWS, GCP and Azure metadata), private
const PRIVATE_IPV4: [number, number, number][] = [
  [0, 0, 255],
  [10, 0, 255],
  [100, 64, 127],
  [127, 0, 255],
  [169, 254, 254],
  [172, 16, 31],
  [192, 168, 168]
];
// The URL parser has already normalised every IPv4 spelling (decimal, hex, short) to dotted quads
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;
// An IPv6 literal that carries an IPv4 address in its last 32 bits (::1, ::ffff:7f00:1, ...)
const IPV6_EMBEDDING_IPV4 = /^::(?:ffff:)?(?:([0-9a-f]{1,4}):)?[0-9a-f]{0,4}$/;
const OCTET = 256;
const HEX = 16;
// fc00::/7 is unique-local (AWS's IPv6 metadata is fd00:ec2::254); fe80::/10 is link-local
const PRIVATE_IPV6_FIRST_GROUP: [number, number][] = [
  [0xfc00, 0xfdff],
  [0xfe80, 0xfebf]
];

const isPrivateIpv4 = (first: number, second: number): boolean =>
  PRIVATE_IPV4.some(([octet, from, to]) => first === octet && second >= from && second <= to);

const isPrivateIpv6 = (address: string): boolean => {
  const embedded = IPV6_EMBEDDING_IPV4.exec(address);
  if (embedded) {
    const high = parseInt(embedded[1] ?? '0', HEX);
    return isPrivateIpv4(Math.floor(high / OCTET), high % OCTET);
  }
  const first = parseInt(address.split(':')[0] || '0', HEX);
  return PRIVATE_IPV6_FIRST_GROUP.some(([from, to]) => first >= from && first <= to);
};

// True for an IP-literal host no public API lives at. Host names are left to the allowlist.
const isPrivateAddress = (hostname: string): boolean => {
  if (hostname.startsWith('[')) return isPrivateIpv6(hostname.slice(1, -1));
  const ipv4 = IPV4.exec(hostname);
  return ipv4 ? isPrivateIpv4(Number(ipv4[1]), Number(ipv4[2])) : false;
};

const refuse = (reason: TargetRefusal, message: string): CheckTargetResult => ({
  ok: false,
  data: { reason, message }
});

// Runs before Pay contacts a host at all. The URL can come from an LLM and a non-402 answer goes
// straight back to it, so an unchecked fetch would let injected text read cloud metadata or an
// internal service, or leak data through a query string to any host.
export const checkTarget = (url: string, allowlist: readonly string[]): CheckTargetResult => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse('blocked_host', `${url} is not a URL`);
  }
  if (!WEB_PROTOCOLS.includes(parsed.protocol)) {
    return refuse('blocked_host', `${parsed.protocol} URLs are not fetched`);
  }
  // Refused even when allowlisted: a metadata address is never a paid API
  if (isPrivateAddress(parsed.hostname)) {
    return refuse('blocked_host', `${parsed.hostname} is a private or link-local address`);
  }
  if (!hostAllowed(url, allowlist)) {
    return refuse('policy_allowlist', `${url} is not on the allowlist`);
  }
  return { ok: true, data: parsed };
};
