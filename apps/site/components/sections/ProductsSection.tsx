import { CodeBlock } from '@/components/elements/CodeBlock';
import { ConsoleWindow } from '@/components/elements/ConsoleWindow';
import { DecisionLog } from '@/components/elements/DecisionLog';
import { Loop } from '@/components/elements/Loop';
import { Section, SectionHead } from '@/components/elements/Section';
import { LINKS } from '@/content/links';
import { SECTION_IDS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/** A tool the product runs on; a wordmark (Express) has no glyph, so it shows its name only */
type Tool = { name: string; icon?: string };

type Product = {
  name: string;
  title: string;
  body: string;
  href: string;
  tools: Tool[];
  visual: ReactNode;
  /** The card that hosts the section's one loop */
  loop?: boolean;
};

// Real snippets from the package READMEs, cut to what fits the panel
const GATE_LINES = [
  "import { koshaGate } from '@kosha/gate';",
  '',
  'app.use(',
  '  koshaGate({',
  '    core: process.env.KOSHA_CORE_URL,',
  '    apiKey: process.env.KOSHA_API_KEY,',
  '    routes: {',
  '      // Net prices: you receive exactly this',
  "      'GET /v1/gst-lookup': { priceUsdc: '0.10' },",
  "      'GET /v1/company/:cin': { priceUsdc: '0.25' }",
  '    }',
  '  })',
  ');'
];

const PAY_LINES = [
  'const pay = createKoshaPay({',
  "  network: 'testnet',",
  '  reserveAccountId: AGENT_RESERVE_ID, // the TDS leg lands here',
  '  trustedFacilitators: [CORE_ACCOUNT_ID],',
  '  policy: {',
  "    perPaymentUsdc: '0.50',",
  "    dailyUsdc: '5',",
  "    fyBudgetUsdc: '200',",
  "    allowlist: ['api.demo-in.example'],",
  "    onThreshold: 'warn'",
  '  }',
  '});',
  '',
  "const res = await pay.fetch(API + '/v1/gst-lookup?gstin=29AAKCK4821M1ZQ');"
];

const PRODUCTS: Product[] = [
  {
    name: 'Kosha Gate',
    title: 'Prices your routes, net',
    body: 'Express or Hono middleware. Unpaid requests get a 402 quote; paid ones pass once Core has settled them on Hedera.',
    href: LINKS.gateDocs,
    tools: [{ name: 'Express' }, { name: 'Hono', icon: 'hono' }],
    visual: <CodeBlock title="server.ts" lines={GATE_LINES} mark={9} />
  },
  {
    name: 'Kosha Pay',
    title: 'Pays within the owner’s rules',
    body: 'A drop-in fetch for agents: caps, an allowlist, and the TDS leg checked before signing. Also a Hedera Agent Kit tool.',
    href: LINKS.payDocs,
    tools: [{ name: 'LangChain', icon: 'langchain' }],
    visual: <CodeBlock title="agent.ts" lines={PAY_LINES} mark={3} />
  },
  {
    name: 'Kosha Core',
    title: 'Quotes, verifies and settles',
    body: 'The facilitator: a verifier that protects the fee payer, the tax engine on versioned rule packs, every decision logged to HCS.',
    href: LINKS.coreDocs,
    tools: [
      { name: 'Hedera', icon: 'hedera' },
      { name: 'PostgreSQL', icon: 'postgres' }
    ],
    visual: <DecisionLog />,
    loop: true
  },
  {
    name: 'Kosha Console',
    title: 'Shows owners and CAs the ledger',
    body: 'Live payments, each payer’s progress towards the threshold, and the quarter’s TDS file to download.',
    href: LINKS.consoleDocs,
    tools: [{ name: 'Next.js', icon: 'nextjs' }],
    visual: <ConsoleWindow />
  }
];

const ToolChip = ({ name, icon }: Tool) => (
  <li
    className={cn(
      'chip flex items-center gap-2 rounded-sm border border-line py-1 pr-2.5 text-label text-muted',
      icon ? 'pl-1' : 'pl-2.5'
    )}
  >
    {icon ? (
      // Every mark on a light tile in its own colours: one treatment, no inverted logos
      <span className="flex size-5 items-center justify-center rounded-[4px] bg-paper">
        <img src={`/icons/${icon}.svg`} alt="" className="size-3.5 object-contain" />
      </span>
    ) : null}
    {name}
  </li>
);

/* The panel runs flush to the card's sides and bottom (x.ai's cards): the window sits 32px in,
   cut by the right and bottom edges, a glimpse of something bigger */
const PANEL = 'lit relative -mx-6 -mb-6 mt-6 h-[240px] lg:-mx-8 lg:-mb-8 lg:h-[332px] xl:h-[368px]';
const WINDOW = 'lit-ui absolute top-8 left-8 w-[calc(100%+8px)] min-w-[440px]';

const ProductCard = ({ name, title, body, href, tools, visual, loop }: Product) => (
  <article className="card card-link relative flex flex-col overflow-hidden p-6 lg:p-8">
    <span className="text-label font-medium text-accent">{name}</span>
    <h3 className="mt-2 text-lead leading-tight font-medium">
      {/* The title is the link; its ::after covers the card, so the whole card is the target */}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="after:absolute after:inset-0 after:content-['']"
      >
        {title}
      </a>
    </h3>
    <p className="mt-2 max-w-[46ch] text-body text-ink/85">{body}</p>
    <ul className="mt-4 flex flex-wrap gap-2">
      {tools.map((tool) => (
        <ToolChip key={tool.name} {...tool} />
      ))}
    </ul>
    {loop ? (
      <Loop label={`${name} log`} className={PANEL}>
        <div className={WINDOW}>{visual}</div>
      </Loop>
    ) : (
      <div className={PANEL}>
        <div className={WINDOW}>{visual}</div>
      </div>
    )}
  </article>
);

export const ProductsSection = () => (
  <Section id={SECTION_IDS.products} h={2}>
    <SectionHead
      id={SECTION_IDS.products}
      title="Four products, one gateway"
      lead="Gate for the API owner, Pay for the agent, Core between them, and the Console for the people who file."
    />
    {/* Two screens as two groups: the second row starts a screen down (layout-v4 .g2) */}
    <div className="mt-12 grid gap-6 md:grid-cols-2 xl:gap-y-56">
      {PRODUCTS.map((product) => (
        <ProductCard key={product.name} {...product} />
      ))}
    </div>
  </Section>
);
