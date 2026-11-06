// Every external URL on the site lives here (U01). A null link renders as "coming soon";
// filling one in later is a one-file change.

const GITHUB_REPO = 'https://github.com/Adhil523/kosha';
const HASHSCAN = 'https://hashscan.io/testnet';

export const LINKS = {
  /** The deployed Console (filled in after H6) */
  console: null,
  github: GITHUB_REPO,
  readme: `${GITHUB_REPO}#readme`,
  gateDocs: `${GITHUB_REPO}/tree/main/packages/gate`,
  payDocs: `${GITHUB_REPO}/tree/main/packages/pay`,
  coreDocs: `${GITHUB_REPO}/tree/main/apps/core`,
  consoleDocs: `${GITHUB_REPO}/tree/main/apps/console`,
  rulePack: `${GITHUB_REPO}/tree/main/rulepacks`,
  /** A payment under the threshold: one leg, no TDS */
  txUnderThreshold: `${HASHSCAN}/transaction/0.0.11341449-1793987958-456000000`,
  /** A payment past the threshold: price to the API, 1% TDS to the agent's reserve */
  txTdsReserved: `${HASHSCAN}/transaction/0.0.11341449-1793987971-680000000`,
  /** The co-signed scheduled transaction releasing a reserve (after the monthly close) */
  txReserveRelease: null,
  paymentsTopic: `${HASHSCAN}/topic/0.0.11342856`,
  demoVideo: null,
  /** Validation action V5: the interest form */
  waitlist: null
} as const satisfies Record<string, string | null>;

export type LinkKey = keyof typeof LINKS;
