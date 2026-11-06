import { LinkButton } from '@/components/elements/LinkButton';
import { Mark } from '@/components/elements/Mark';
import { LINKS } from '@/content/links';
import { COMING_SOON, LABELS, MAIN_ACTION, SECTION_IDS, SITE_NAME } from '@/lib/constants';
import type { CSSProperties } from 'react';

type FooterLink = { label: string; href: string | null };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Products',
    links: [
      { label: 'Kosha Gate', href: LINKS.gateDocs },
      { label: 'Kosha Pay', href: LINKS.payDocs },
      { label: 'Kosha Core', href: LINKS.coreDocs },
      { label: 'Kosha Console', href: LINKS.consoleDocs }
    ]
  },
  {
    title: 'Evidence',
    links: [
      { label: 'A payment with TDS', href: LINKS.txTdsReserved },
      { label: 'The payments topic', href: LINKS.paymentsTopic },
      { label: 'Demo video', href: LINKS.demoVideo },
      { label: 'Live Console', href: LINKS.console }
    ]
  },
  {
    title: 'Read',
    links: [
      { label: 'README', href: LINKS.readme },
      { label: 'Source on GitHub', href: LINKS.github },
      { label: 'Rule packs', href: LINKS.rulePack },
      { label: 'Join the waitlist', href: LINKS.waitlist }
    ]
  }
];

const FooterLinkItem = ({ label, href }: FooterLink) =>
  href ? (
    <a href={href} target="_blank" rel="noreferrer" className="navlink text-body">
      {label}
    </a>
  ) : (
    <span className="text-muted">
      {label} <span className="text-label">· {COMING_SOON}</span>
    </span>
  );

export const SiteFooter = () => (
  <footer
    id={SECTION_IDS.close}
    aria-labelledby={`${SECTION_IDS.close}-h`}
    className="section flex flex-col border-t border-line"
    style={{ '--h': 1 } as CSSProperties}
  >
    <div className="wrap flex flex-1 flex-col justify-between gap-16">
      <div className="flex flex-col gap-8">
        <h2 id={`${SECTION_IDS.close}-h`} className="max-w-[20ch] text-h2">
          Watch an agent pay an Indian API with the tax already withheld
        </h2>
        <p className="text-small text-muted">
          A real testnet transaction on HashScan: two token transfers, one HCS message.
        </p>
        <LinkButton href={LINKS.txTdsReserved} size="xl">
          {MAIN_ACTION}
        </LinkButton>
      </div>

      <div className="grid gap-10 border-t border-line pt-10 md:grid-cols-12 md:gap-6">
        <div className="md:col-span-4">
          <a href={`#${SECTION_IDS.top}`} className="flex items-center gap-3 text-h3 font-medium">
            <Mark className="size-8" />
            {SITE_NAME}
          </a>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-3 md:col-span-2">
            <p className="text-label font-medium text-muted">{column.title}</p>
            {column.links.map((link) => (
              <FooterLinkItem key={link.label} {...link} />
            ))}
          </div>
        ))}
        <div className="flex flex-col gap-2 text-label text-muted md:col-span-12">
          <p>{LABELS.join(' · ')}</p>
          <p>
            © 2026 {SITE_NAME}. Product names and logos are trademarks of their owners. Built for
            ETHGlobal.
          </p>
        </div>
      </div>
    </div>
  </footer>
);
