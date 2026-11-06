import { Loop } from '@/components/elements/Loop';
import type { CSSProperties } from 'react';

// The native services Kosha uses, round Core; no smart contract anywhere
const SPOKES = [
  { label: 'HTS transfer', meta: 'one transfer, two legs', angle: -90 },
  { label: 'HCS topic', meta: 'ordered, append-only log', angle: -18 },
  { label: 'Scheduled transaction', meta: '2-of-2 reserve release', angle: 54 },
  { label: 'Mirror Node', meta: 'the reserve proof', angle: 126 },
  { label: 'Agent Kit v4', meta: 'policy-enforced spending', angle: 198 }
];

const SIZE = 560;
const CENTRE = SIZE / 2;
const CORE_R = 64;
const RADIUS = 212;
const NODE_W = 176;
const NODE_H = 56;

const toPoint = (angle: number, radius: number) => {
  const rad = (angle * Math.PI) / 180;
  return { x: CENTRE + Math.cos(rad) * radius, y: CENTRE + Math.sin(rad) * radius };
};

/** A hub: Kosha Core in the middle, one spoke per Hedera service, a light running out each */
export const HederaDiagram = () => (
  <Loop label="the Hedera services" className="relative mx-auto w-full max-w-[560px]">
    <div className="relative aspect-square" aria-hidden="true">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 size-full">
        <circle cx={CENTRE} cy={CENTRE} r={RADIUS} fill="none" className="stroke-line" />
        {SPOKES.map((spoke, index) => {
          const from = toPoint(spoke.angle, CORE_R);
          const to = toPoint(spoke.angle, RADIUS - NODE_H / 2);
          const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
          return (
            <g key={spoke.label}>
              <path d={d} className="stroke-line-strong" strokeWidth="1" />
              <path
                d={d}
                pathLength={100}
                strokeDasharray="30 100"
                strokeLinecap="round"
                className="hidden stroke-accent motion-safe:block animate-comet"
                strokeWidth="2"
                style={{ '--comet-from': 130, animationDelay: `${index * 0.3}s` } as CSSProperties}
              />
            </g>
          );
        })}
      </svg>
      <div
        className="ui absolute flex flex-col items-center justify-center rounded-full text-center"
        style={{
          left: `${((CENTRE - CORE_R) / SIZE) * 100}%`,
          top: `${((CENTRE - CORE_R) / SIZE) * 100}%`,
          width: `${((CORE_R * 2) / SIZE) * 100}%`,
          height: `${((CORE_R * 2) / SIZE) * 100}%`
        }}
      >
        <span className="text-sm font-medium">Kosha Core</span>
        <span className="text-ui-meta text-muted">fee payer</span>
      </div>
      {SPOKES.map((spoke) => {
        const point = toPoint(spoke.angle, RADIUS);
        return (
          <div
            key={spoke.label}
            className="ui absolute flex flex-col justify-center px-3 py-2 leading-tight"
            style={{
              left: `${((point.x - NODE_W / 2) / SIZE) * 100}%`,
              top: `${((point.y - NODE_H / 2) / SIZE) * 100}%`,
              width: `${(NODE_W / SIZE) * 100}%`,
              minHeight: `${(NODE_H / SIZE) * 100}%`
            }}
          >
            <span className="text-ui font-medium">{spoke.label}</span>
            <span className="hidden text-ui-meta text-muted sm:block">{spoke.meta}</span>
          </div>
        );
      })}
    </div>
  </Loop>
);
