import { FlowDiagram } from '@/components/elements/FlowDiagram';
import { Section, SectionHead } from '@/components/elements/Section';
import { SECTION_IDS } from '@/lib/constants';

export const FlowSection = () => (
  <Section id={SECTION_IDS.flow}>
    <SectionHead
      id={SECTION_IDS.flow}
      title="One payment, four records"
      lead="Core quotes the tax, settles the price and the TDS in one Hedera transfer, logs the decision to HCS, and turns the quarter into the file a chartered accountant needs."
    />
    <FlowDiagram />
  </Section>
);
