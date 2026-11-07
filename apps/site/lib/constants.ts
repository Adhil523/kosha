export const SITE_NAME = 'Kosha';

/** The hero sets the tagline on two lines, the second in the accent */
export const TAGLINE_LINES = ['Every agent payment,', 'tax-ready.'] as const;

export const TAGLINE = TAGLINE_LINES.join(' ');

/** The one main action: the same words in the nav, the hero and the close */
export const MAIN_ACTION = 'See a settled payment';

export const RULE_PACK = 'in-2026.2';

/** Shown on every page, in the footer's legal row */
export const LABELS = [
  'Testnet only',
  `Rule pack ${RULE_PACK} unreviewed`,
  'Not tax advice'
] as const;

export const SECTION_IDS = {
  top: 'top',
  flow: 'flow',
  products: 'products',
  evidence: 'evidence',
  directory: 'directory',
  hedera: 'hedera',
  close: 'close'
} as const;

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];

export const NAV_ITEMS = [
  { label: 'Flow', id: SECTION_IDS.flow },
  { label: 'Products', id: SECTION_IDS.products },
  { label: 'Evidence', id: SECTION_IDS.evidence },
  { label: 'Directory', id: SECTION_IDS.directory },
  { label: 'Hedera', id: SECTION_IDS.hedera }
] as const;

export const COMING_SOON = 'coming soon';
