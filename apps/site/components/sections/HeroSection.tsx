import { GlobeGround } from '@/components/elements/GlobeGround';
import { LinkButton } from '@/components/elements/LinkButton';
import { ProofStrip } from '@/components/elements/ProofStrip';
import { ReceiptCard } from '@/components/elements/ReceiptCard';
import { LINKS } from '@/content/links';
import { MAIN_ACTION, RULE_PACK, SECTION_IDS, TAGLINE_LINES } from '@/lib/constants';

/** Hero `horizon`: the words centred above a dotted globe that rises from the bottom edge, every
 *  arc a payment landing in India; the settled receipt sits on the globe */
export const HeroSection = () => (
  <section
    id={SECTION_IDS.top}
    aria-labelledby={`${SECTION_IDS.top}-h`}
    className="relative isolate flex min-h-svh flex-col overflow-hidden pt-[calc(var(--nav)+40px)] pb-8 sm:pt-[calc(var(--nav)+64px)]"
  >
    <GlobeGround calmX={0.5} calmY={0.25} className="absolute inset-0 -z-10" />
    {/* One soft light behind the words, so they read over the globe's rim */}
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70%] bg-[radial-gradient(60%_55%_at_50%_30%,color-mix(in_oklab,var(--color-accent)_14%,transparent),transparent_70%)]"
    />

    <div className="wrap flex flex-col items-center gap-6 text-center sm:gap-7">
      {/* <a
        href={LINKS.paymentsTopic}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3.5 py-1.5 text-label text-muted backdrop-blur-sm transition-colors duration-200 hover:border-line-strong hover:text-ink"
      >
        <span className="relative flex size-1.5" aria-hidden="true">
          <span className="absolute inset-0 animate-live-ring rounded-full bg-accent" />
          <span className="size-1.5 rounded-full bg-accent" />
        </span>
        Live on Hedera testnet
        <span className="text-line-strong">·</span>
        <span className="font-mono text-ui-meta">x402 v2</span>
      </a> */}

      <h1 id={`${SECTION_IDS.top}-h`} className="text-hero">
        {TAGLINE_LINES[0]}
        <br />
        <span className="text-sheen">{TAGLINE_LINES[1]}</span>
      </h1>

      <p className="max-w-[54ch] text-lead text-ink/80">
        An x402 payment gateway on Hedera. An AI agent paying an Indian API in USDC owes Indian TDS,
        and nobody withholds it today. Kosha does, in the same transaction.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <LinkButton href={LINKS.txTdsReserved}>{MAIN_ACTION}</LinkButton>
        <LinkButton href={LINKS.github} variant="secondary">
          Read the code
        </LinkButton>
      </div>

      <p className="text-small text-muted">
        1% past ₹10,000 a year, 20% without a PAN. Rule pack {RULE_PACK}, Hedera testnet.
      </p>

      <ProofStrip className="mt-2" />
    </div>

    <div className="wrap relative mt-auto flex justify-end pt-10">
      <ReceiptCard className="frame-enter hidden xl:block" />
    </div>
  </section>
);
