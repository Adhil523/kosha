import { type Routes, routesSchema, usdcToMicro } from './route-match';
import { type X402_NETWORKS } from '@kosha/shared/headers';
import { type AgentLevel, type UNVERIFIED_POLICIES } from '@kosha/shared/registry';

export const TERMS_PATH = '/.well-known/kosha';

// What the API owner declares about itself; the prices come from Gate's own route table
export type TermsOptions = {
  // The rule pack the owner's Core applies, e.g. "in-2026.2"
  rulepack: string;
  unverifiedPolicy: (typeof UNVERIFIED_POLICIES)[number];
  acceptedLevels: readonly AgentLevel[];
  // Where an agent registers for Level 1 (PAN-verified, 1% instead of 20%)
  registrationUrl?: string;
};

export type KoshaTerms = {
  network: (typeof X402_NETWORKS)[keyof typeof X402_NETWORKS];
  rulepack: string;
  // Net prices: the API receives exactly this, and any TDS is added on top for the payer
  prices: {
    route: string;
    priceUsdc: string;
    priceMicroUsdc: string;
    description?: string;
  }[];
  unverifiedPolicy: TermsOptions['unverifiedPolicy'];
  acceptedLevels: AgentLevel[];
  registrationUrl?: string;
};

// The body of GET /.well-known/kosha, built once at startup
export const buildTerms = (
  routes: Routes,
  network: KoshaTerms['network'],
  options: TermsOptions
): KoshaTerms => ({
  network,
  rulepack: options.rulepack,
  prices: Object.entries(routesSchema.parse(routes)).map(([route, config]) => ({
    route,
    priceUsdc: config.priceUsdc,
    priceMicroUsdc: usdcToMicro(config.priceUsdc).toString(),
    ...(config.description ? { description: config.description } : {})
  })),
  unverifiedPolicy: options.unverifiedPolicy,
  acceptedLevels: [...options.acceptedLevels],
  ...(options.registrationUrl ? { registrationUrl: options.registrationUrl } : {})
});
