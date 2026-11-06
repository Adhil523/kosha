import { CodeBlock } from '@/components/elements/CodeBlock';
import { Section, SectionHead } from '@/components/elements/Section';
import { TdsTable } from '@/components/elements/TdsTable';
import { LINKS } from '@/content/links';
import { SECTION_IDS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type Tool = { name: string; icon: string; ink?: boolean; wide?: boolean };

type Product = {
  name: string;
  title: string;
  body: string;
  href: string;
  tools: Tool[];
  visual: ReactNode;
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
  '  reserveAccountId: AGENT_RESERVE_ID, // the TDS leg must land here',
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

const CORE_LINES = [
  '// HCS topic 0.0.11342856, message #6',
  '{',
  '  "quoteId": "q_w7813xvnr9jqkt8w140p5nsd",',
  '  "payer": "0.0.11342842",',
  '  "receiver": "0.0.11342839",',
  '  "priceMicro": 100000,',
  '  "tdsMicro": 1019,',
  '  "rate": "1%",',
  '  "reason": "threshold_crossed",',
  '  "rulePack": "in-2026.2",',
  '  "rulePackHash": "sha256:3f9c…b2e1",',
  '  "agg": { "fyTotalPaise": 1011300 }',
  '}'
];

const PRODUCTS: Product[] = [
  {
    name: 'Kosha Gate',
    title: 'Prices your routes, net',
    body: 'Express or Hono middleware. Unpaid requests get a 402 quote; paid ones pass once Core has settled them on Hedera.',
    href: LINKS.gateDocs,
    tools: [
      { name: 'Express', icon: 'express', ink: true, wide: true },
      { name: 'Hono', icon: 'hono' }
    ],
    visual: <CodeBlock title="server.ts" lines={GATE_LINES} />
  },
  {
    name: 'Kosha Pay',
    title: 'Pays within the owner’s rules',
    body: 'A drop-in fetch for agents: caps, an allowlist, and the TDS leg checked before signing. Also a Hedera Agent Kit tool.',
    href: LINKS.payDocs,
    tools: [{ name: 'LangChain', icon: 'langchain', ink: true }],
    visual: <CodeBlock title="agent.ts" lines={PAY_LINES} />
  },
  {
    name: 'Kosha Core',
    title: 'Quotes, verifies and settles',
    body: 'The facilitator: a verifier that protects the fee payer, the tax engine on versioned rule packs, every decision logged to HCS.',
    href: LINKS.coreDocs,
    tools: [
      { name: 'Hedera', icon: 'hedera', ink: true },
      { name: 'PostgreSQL', icon: 'postgres' }
    ],
    visual: <CodeBlock title="hcs-message.json" lines={CORE_LINES} />
  },
  {
    name: 'Kosha Console',
    title: 'Shows owners and CAs the ledger',
    body: 'Live payments, each payer’s progress towards the threshold, and the quarter’s TDS file to download.',
    href: LINKS.consoleDocs,
    tools: [{ name: 'Next.js', icon: 'nextjs', ink: true }],
    visual: <TdsTable />
  }
];

const ProductCard = ({ name, title, body, href, tools, visual }: Product) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="card card-link flex flex-col overflow-hidden p-6 lg:p-8"
  >
    <span className="text-label font-medium text-accent">{name}</span>
    <h3 className="mt-2 text-lead leading-tight font-medium">{title}</h3>
    <p className="mt-2 max-w-[46ch] text-body text-ink/85">{body}</p>
    <ul className="mt-4 flex flex-wrap gap-2">
      {tools.map((tool) => (
        <li
          key={tool.name}
          className="flex items-center gap-2 rounded-sm border border-line px-2 py-1 text-label text-muted"
        >
          <img
            src={`/icons/${tool.icon}.svg`}
            alt=""
            className={cn('h-4 object-contain', tool.wide ? 'w-10' : 'w-4', tool.ink && 'ic-ink')}
          />
          {tool.name}
        </li>
      ))}
    </ul>
    {/* The panel: one soft light, the window cut by its right and bottom edges */}
    <div className="lit relative mt-6 h-[336px] overflow-hidden rounded-md">
      <div className="absolute top-7 left-7 w-[calc(100%-28px+40px)] min-w-[420px]">{visual}</div>
    </div>
  </a>
);

export const ProductsSection = () => (
  <Section id={SECTION_IDS.products} h={2}>
    <SectionHead
      id={SECTION_IDS.products}
      title="Four products, one gateway"
      lead="Gate for the API owner, Pay for the agent, Core between them, and the Console for the people who file."
    />
    {/* Two screens as two groups: the second row starts a screen down (layout-v4 .g2) */}
    <div className="mt-12 grid gap-6 md:grid-cols-2 lg:gap-y-56">
      {PRODUCTS.map((product) => (
        <ProductCard key={product.name} {...product} />
      ))}
    </div>
  </Section>
);
