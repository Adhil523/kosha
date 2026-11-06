import { ConsoleWindow } from '@/components/elements/ConsoleWindow';
import { LinkButton } from '@/components/elements/LinkButton';
import { Loop } from '@/components/elements/Loop';
import { ReceiptCard } from '@/components/elements/ReceiptCard';
import { LINKS } from '@/content/links';
import { MAIN_ACTION, RULE_PACK, SECTION_IDS, TAGLINE } from '@/lib/constants';

/** Hero `collage`: the words on five columns, the product window cut by a lit frame on six */
export const HeroSection = () => (
  <section
    id={SECTION_IDS.top}
    aria-labelledby={`${SECTION_IDS.top}-h`}
    className="relative min-h-svh overflow-hidden pt-[calc(var(--nav)+48px)] pb-16"
  >
    <div className="wrap grid gap-10 lg:grid-cols-12 lg:gap-x-6">
      <div className="flex flex-col gap-8 lg:col-span-5">
        <h1 id={`${SECTION_IDS.top}-h`} className="text-h1">
          {TAGLINE}
        </h1>
        <p className="max-w-[46ch] text-lead">
          An x402 payment gateway on Hedera. An AI agent paying an Indian API in USDC owes Indian
          TDS, and nobody withholds it today. Kosha does, in the same transaction.
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
      </div>

      <Loop
        label="the receipt"
        className="lit frame-enter relative h-[380px] overflow-hidden rounded-lg sm:h-[560px] lg:col-span-6 lg:col-start-7 lg:h-[716px]"
      >
        <ConsoleWindow className="absolute top-4 left-4 w-[calc(100%-16px)] sm:top-16 sm:left-16 sm:w-[calc(100%-64px+28px)]" />
        <ReceiptCard className="absolute bottom-8 left-8 hidden sm:block" />
      </Loop>
    </div>
  </section>
);
