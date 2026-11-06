import { Loop } from '@/components/elements/Loop';
import { cn } from '@/lib/utils';
import type { CSSProperties } from 'react';

type FlowNode = {
  id: string;
  title: string;
  meta: string;
  value: string;
  /** Position in the 1280 x 440 box at large widths */
  x: number;
  y: number;
  tone?: 'accent';
};

// The first settled payment (README, "First settled payment"): 0.10 USDC at ₹88.4 past the
// ₹10,000 threshold, so 1% TDS, worked out in whole paise and rounded up.
const NODES: FlowNode[] = [
  {
    id: 'quote',
    title: 'Quote',
    meta: 'POST /v1/quote',
    value: '₹8.84 · pair total ₹10,113 · rate 1%',
    x: 0,
    y: 160
  },
  {
    id: 'transfer',
    title: 'One atomic transfer',
    meta: 'TransferTransaction, Core pays the fee',
    value: '0.101019 tUSDC from the agent',
    x: 265,
    y: 160
  },
  {
    id: 'api',
    title: 'The API owner',
    meta: 'receiver-in',
    value: '+0.100000 tUSDC, the full price',
    x: 530,
    y: 20
  },
  {
    id: 'reserve',
    title: 'The payer’s own reserve',
    meta: '2-of-2: agent + Kosha',
    value: '+0.001019 tUSDC, the TDS',
    x: 530,
    y: 300,
    tone: 'accent'
  },
  {
    id: 'hcs',
    title: 'HCS record',
    meta: 'topic 0.0.11342856, message #6',
    value: 'rate, reason, rule-pack hash, running total',
    x: 795,
    y: 160
  },
  {
    id: 'file',
    title: 'TDS file',
    meta: 'quarterly CSV, deductee-wise',
    value: 'what the CA files, with evidence links',
    x: 1060,
    y: 160
  }
];

const NODE_W = 220;
const NODE_H = 120;

// Edges leave a node's right edge at mid height and enter the next one's left edge
const EDGES = [
  { d: `M ${NODE_W} 220 H 265`, delay: 0 },
  { d: `M ${265 + NODE_W} 220 C 510 220 505 80 530 80`, delay: 0.3 },
  { d: `M ${265 + NODE_W} 220 C 510 220 505 360 530 360`, delay: 0.3 },
  { d: `M ${530 + NODE_W} 80 C 775 80 770 220 795 220`, delay: 0.6 },
  { d: `M ${530 + NODE_W} 360 C 775 360 770 220 795 220`, delay: 0.6 },
  { d: `M ${795 + NODE_W} 220 H 1060`, delay: 0.9 }
];

const nodeStyle = (node: FlowNode): CSSProperties => ({
  left: `${(node.x / 1280) * 100}%`,
  top: `${(node.y / 440) * 100}%`,
  width: `${(NODE_W / 1280) * 100}%`,
  height: `${(NODE_H / 440) * 100}%`
});

const FlowNodeBox = ({
  node,
  className,
  style
}: {
  node: FlowNode;
  className?: string;
  style?: CSSProperties;
}) => (
  <div
    style={style}
    className={cn(
      'ui flex flex-col justify-center gap-1 p-4',
      node.tone === 'accent' && 'border-accent/50',
      className
    )}
  >
    <span className="text-sm font-medium">{node.title}</span>
    <span className="font-mono text-ui-meta text-muted">{node.meta}</span>
    <span className={cn('text-ui', node.tone === 'accent' && 'text-accent')}>{node.value}</span>
  </div>
);

/** Quote → one split transfer → the HCS record → the TDS file, a light running along each line */
export const FlowDiagram = () => (
  <Loop label="the payment flow" className="mt-12">
    {/* Large: the bowtie in a 1280 x 440 box; the SVG lines scale with it */}
    <div className="relative hidden aspect-[1280/440] lg:block" aria-hidden="true">
      <svg
        viewBox="0 0 1280 440"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
      >
        {EDGES.map((edge) => (
          <path
            key={edge.d}
            d={edge.d}
            fill="none"
            className="stroke-line-strong"
            strokeWidth="1"
          />
        ))}
        {EDGES.map((edge) => (
          <path
            key={`light-${edge.d}`}
            d={edge.d}
            fill="none"
            pathLength={100}
            strokeDasharray="22 100"
            strokeLinecap="round"
            className="hidden stroke-accent motion-safe:block animate-comet"
            strokeWidth="2"
            style={{ '--comet-from': 122, animationDelay: `${edge.delay}s` } as CSSProperties}
          />
        ))}
      </svg>
      {NODES.map((node) => (
        <FlowNodeBox key={node.id} node={node} className="absolute" style={nodeStyle(node)} />
      ))}
    </div>

    {/* Below large: the same steps stacked, the two legs side by side */}
    <ol className="flex flex-col lg:hidden" aria-label="The payment flow">
      {[NODES[0], NODES[1]].map((node) =>
        node ? (
          <li key={node.id} className="flex flex-col">
            <FlowNodeBox node={node} />
            <span className="ml-6 h-6 w-px bg-line-strong" />
          </li>
        ) : null
      )}
      <li className="grid gap-3 sm:grid-cols-2">
        {[NODES[2], NODES[3]].map((node) =>
          node ? <FlowNodeBox key={node.id} node={node} /> : null
        )}
      </li>
      {[NODES[4], NODES[5]].map((node) =>
        node ? (
          <li key={node.id} className="flex flex-col">
            <span className="ml-6 h-6 w-px bg-line-strong" />
            <FlowNodeBox node={node} />
          </li>
        ) : null
      )}
    </ol>
  </Loop>
);
