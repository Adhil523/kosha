import { HederaDiagram } from '@/components/elements/HederaDiagram';
import { Section } from '@/components/elements/Section';
import { SECTION_IDS } from '@/lib/constants';

// hackathon-readiness.md §5, kept short
const REASONS = [
  {
    title: 'Fixed, tiny fees',
    body: 'Withholding 1% of an ₹8 call only pays when the fee is cents, not gas.'
  },
  {
    title: 'A native multi-party transfer',
    body: 'One TransferTransaction does the atomic split. No smart contract, no Solidity.'
  },
  {
    title: 'HCS as the evidence log',
    body: 'Ordered, timestamped, append-only, with a submit key so only Kosha can write.'
  },
  {
    title: 'Scheduled transactions',
    body: 'The 2-of-2 reserve release without custody code.'
  },
  {
    title: 'Agent Kit, HCS-14 and HCS-11',
    body: 'Agent identity and policy-enforced spending out of the box.'
  }
];

export const HederaSection = () => (
  <Section id={SECTION_IDS.hedera}>
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-6">
      <div className="flex flex-col gap-10 lg:col-span-5">
        <h2 id={`${SECTION_IDS.hedera}-h`} className="text-h2">
          Why Hedera
        </h2>
        <ol className="flex flex-col divide-y divide-line border-y border-line">
          {REASONS.map((reason, index) => (
            <li key={reason.title} className="grid grid-cols-[2rem_1fr] gap-2 py-4">
              <span className="font-mono text-small text-muted">{index + 1}</span>
              <div className="flex flex-col gap-1">
                <span className="font-medium">{reason.title}</span>
                <span className="text-body text-ink/85">{reason.body}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="lg:col-span-6 lg:col-start-7">
        <HederaDiagram />
      </div>
    </div>
  </Section>
);
