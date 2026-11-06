'use client';

import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';

// The design-taste dotted globe (public/fx), loaded at run time from the static export rather than
// bundled. Its `focus` parameter is Kosha's: the globe faces India and every arc lands in Mumbai,
// one payment at a time, from agents anywhere into an Indian API.
const FX_URL = '/fx/fx.js';
const EFFECT_ID = 'dotted-globe';
// A fixed seed, so every visit and every screenshot shows the same globe
const GLOBE_SEED = 402;

type FxController = { destroy: () => void };
type FxModule = {
  default: {
    mount: (
      el: HTMLElement,
      effect: string,
      options: { seed: number; params: Record<string, number> }
    ) => Promise<FxController>;
  };
};

type GlobeGroundProps = {
  className?: string;
  /** Where the text sits, as a share of the frame; the globe keeps that area calm */
  calmX: number;
  calmY: number;
};

/** The hero's one effect: a WebGL dotted globe in the page's palette, with a CSS still without WebGL */
export const GlobeGround = ({ className, calmX, calmY }: GlobeGroundProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let controller: FxController | null = null;

    const start = async () => {
      const fx = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ FX_URL
      )) as FxModule;
      if (cancelled) return;
      controller = await fx.default.mount(el, EFFECT_ID, {
        seed: GLOBE_SEED,
        params: {
          focus: 1,
          speed: 0,
          size: 1.08,
          spacing: 6,
          dot: 1.3,
          sea: 0.1,
          arcs: 2.2,
          glow: 0.75,
          // The north pole leans a little away: India (19° N) sits just above the bottom edge,
          // and arcs reach it sideways from the Gulf, Europe and East Asia, clear of the words
          tilt: -8,
          // A small calm area: a larger one would switch off India's hub, and with it every arc
          calm: 0.35,
          calmX,
          calmY
        }
      });
      if (cancelled) controller.destroy();
    };
    start().catch((error: unknown) => {
      console.error('[globe]: the effect did not load; the ground stays plain', error);
    });

    return () => {
      cancelled = true;
      controller?.destroy();
    };
  }, [calmX, calmY]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      // fx.js reads its palette from these, so the globe follows the site's tokens
      className={cn(
        '[--fx-accent:var(--color-accent)] [--fx-accent-ink:var(--color-accent-ink)] [--fx-bg:var(--color-ground)] [--fx-ink:var(--color-ink)] [--fx-muted:var(--color-muted)] [--fx-surface:var(--color-surface)]',
        className
      )}
    />
  );
};
