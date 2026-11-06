import { LINKS } from '@/content/links';
import { cn } from '@/lib/utils';

// Real testnet evidence, each a click from HashScan: what the hero claims, already done
const PROOFS = [
  { label: 'Price and 1% TDS in one transaction', meta: 'kosha-split', href: LINKS.txTdsReserved },
  { label: 'A stock x402 client paid', meta: 'exact, forwarded', href: LINKS.txCompatForward },
  { label: 'Every payment on the audit log', meta: 'HCS topic', href: LINKS.paymentsTopic }
] as const;

type ProofStripProps = {
  className?: string;
};

/** Three links to settled testnet evidence, under the hero's actions */
export const ProofStrip = ({ className }: ProofStripProps) => (
  <ul className={cn('flex flex-wrap justify-center gap-2 sm:gap-3', className)}>
    {PROOFS.map((proof) => (
      <li key={proof.href}>
        <a
          href={proof.href}
          target="_blank"
          rel="noreferrer"
          className="group flex items-center gap-2.5 rounded-full border border-line bg-ground/70 py-1.5 pr-3.5 pl-2 text-small backdrop-blur-sm transition-[border-color,translate] duration-200 ease-ui hover:-translate-y-px hover:border-line-strong"
        >
          <span className="relative flex size-2 items-center justify-center" aria-hidden="true">
            <span className="absolute inset-0 animate-live-ring rounded-full bg-accent" />
            <span className="size-2 rounded-full bg-accent" />
          </span>
          <span className="text-ink">{proof.label}</span>
          <span className="hidden font-mono text-ui-meta text-muted group-hover:text-accent sm:inline">
            {proof.meta} ↗
          </span>
        </a>
      </li>
    ))}
  </ul>
);
