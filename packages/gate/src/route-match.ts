import { z } from 'zod';

const MICRO_PER_USDC = 1_000_000n;
const USDC_DECIMALS = 6;
const USDC_PATTERN = new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${USDC_DECIMALS}})?$`);
const ROUTE_KEY_PATTERN = /^([A-Z]+) (\/[^\s?#]*)$/;

export const routeConfigSchema = z.strictObject({
  // The API's net price in USDC, e.g. "0.10". Core adds any TDS on top for the payer.
  priceUsdc: z.string().regex(USDC_PATTERN, 'expected a USDC amount with up to 6 decimals'),
  description: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional()
});
// e.g. { 'GET /v1/gst-lookup': { priceUsdc: '0.10' }, 'GET /v1/company/:cin': { priceUsdc: '0.25' } }
export const routesSchema = z.record(z.string().regex(ROUTE_KEY_PATTERN), routeConfigSchema);

export type RouteConfig = z.input<typeof routeConfigSchema>;
export type Routes = z.input<typeof routesSchema>;

export type MatchedRoute = {
  key: string;
  priceMicroUsdc: bigint;
  description?: string;
  mimeType?: string;
  params: Record<string, string>;
};

type CompiledRoute = {
  key: string;
  method: string;
  segments: string[];
  priceMicroUsdc: bigint;
  description?: string;
  mimeType?: string;
};

// "0.10" → 100000n, exactly, without a float
export const usdcToMicro = (usdc: string): bigint => {
  if (!USDC_PATTERN.test(usdc)) {
    throw new RangeError(`[route-match]: "${usdc}" is not a USDC amount`);
  }
  const [whole = '0', fraction = ''] = usdc.split('.');
  return BigInt(whole) * MICRO_PER_USDC + BigInt(fraction.padEnd(USDC_DECIMALS, '0'));
};

const splitPath = (path: string): string[] => path.split('/').filter((segment) => segment !== '');

// A malformed escape (e.g. "%E0") never matches, rather than throwing out of the handler
const decodeSegment = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

const matchSegments = (
  pattern: readonly string[],
  actual: readonly string[]
): Record<string, string> | null => {
  if (pattern.length !== actual.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, expected] of pattern.entries()) {
    const segment = actual[index] ?? '';
    if (expected.startsWith(':')) {
      const decoded = decodeSegment(segment);
      if (decoded === null) {
        return null;
      }
      params[expected.slice(1)] = decoded;
    } else if (expected !== segment) {
      return null;
    }
  }
  return params;
};

// Validates the route table once, at startup, so a typo in a price fails loudly before any request.
export const compileRoutes = (routes: Routes) => {
  const parsed = routesSchema.safeParse(routes);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`[route-match]: invalid routes: ${issues.join('; ')}`);
  }

  const compiled: CompiledRoute[] = Object.entries(parsed.data).map(([key, config]) => {
    const [, method = '', path = ''] = ROUTE_KEY_PATTERN.exec(key) ?? [];
    return {
      key,
      method,
      segments: splitPath(path),
      priceMicroUsdc: usdcToMicro(config.priceUsdc),
      description: config.description,
      mimeType: config.mimeType
    };
  });

  // The first priced route that matches, or null for a free route
  return (method: string, path: string): MatchedRoute | null => {
    const actual = splitPath(path.split(/[?#]/)[0] ?? '');
    for (const route of compiled) {
      if (route.method !== method.toUpperCase()) {
        continue;
      }
      const params = matchSegments(route.segments, actual);
      if (params) {
        const { key, priceMicroUsdc, description, mimeType } = route;
        return { key, priceMicroUsdc, description, mimeType, params };
      }
    }
    return null;
  };
};

export type RouteMatcher = ReturnType<typeof compileRoutes>;
