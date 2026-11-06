import { Section, SectionHead } from '@/components/elements/Section';
import { LINKS } from '@/content/links';
import { COMING_SOON, SECTION_IDS } from '@/lib/constants';

type EvidenceRow = {
  what: string;
  detail: string;
  href: string | null;
  action: string;
};

// Every row points at the chain or the code; a null link says so instead of pretending
const ROWS: EvidenceRow[] = [
  {
    what: 'A payment under the threshold',
    detail: 'one leg, no TDS · 0.0.11341449@1793987958.456',
    href: LINKS.txUnderThreshold,
    action: 'Open on HashScan'
  },
  {
    what: 'A payment with 1% TDS reserved',
    detail: 'two legs in one transfer · 0.0.11341449@1793987971.680',
    href: LINKS.txTdsReserved,
    action: 'Open on HashScan'
  },
  {
    what: 'A reserve release',
    detail: 'the co-signed scheduled transaction, after the monthly close',
    href: LINKS.txReserveRelease,
    action: 'Open on HashScan'
  },
  {
    what: 'The payments topic',
    detail: 'every tax decision, submit key held by Core · 0.0.11342856',
    href: LINKS.paymentsTopic,
    action: 'Open on HashScan'
  },
  {
    what: 'The source',
    detail: 'the whole monorepo, with the README as the full write-up',
    href: LINKS.github,
    action: 'Open on GitHub'
  },
  {
    what: 'The live Console',
    detail: 'the owner, agent and CA workspaces on sample data',
    href: LINKS.console,
    action: 'Open the Console'
  },
  {
    what: 'The demo video',
    detail: 'the eight demo steps in under five minutes',
    href: LINKS.demoVideo,
    action: 'Watch the video'
  },
  {
    what: 'The waitlist',
    detail: 'for API owners and agent builders who want this live',
    href: LINKS.waitlist,
    action: 'Join the waitlist'
  }
];

const EvidenceLine = ({ what, detail, href, action }: EvidenceRow) => (
  <li className="grid gap-2 border-b border-line py-5 md:grid-cols-12 md:items-baseline md:gap-6">
    <span className="font-medium md:col-span-4">{what}</span>
    <span className="font-mono text-small text-muted md:col-span-5">{detail}</span>
    <span className="md:col-span-3 md:text-right">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="link">
          {action}
        </a>
      ) : (
        <span className="text-muted">{COMING_SOON}</span>
      )}
    </span>
  </li>
);

export const EvidenceSection = () => (
  <Section id={SECTION_IDS.evidence}>
    <SectionHead
      id={SECTION_IDS.evidence}
      title="Evidence on testnet"
      lead="Every claim on this page links to the chain or the code. What is not live yet says so."
    />
    <ol className="mt-12 border-t border-line">
      {ROWS.map((row) => (
        <EvidenceLine key={row.what} {...row} />
      ))}
    </ol>
  </Section>
);
