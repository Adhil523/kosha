'use client';

import { LinkButton } from '@/components/elements/LinkButton';
import { Mark } from '@/components/elements/Mark';
import { LINKS } from '@/content/links';
import { MAIN_ACTION, NAV_ITEMS, SECTION_IDS, SITE_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export const SiteNav = () => {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-10 h-(--nav) border-b border-line bg-ground">
      <div className="wrap flex h-full items-center justify-between gap-6">
        <a
          href={`#${SECTION_IDS.top}`}
          className="flex items-center gap-2.5 text-xl font-medium"
          onClick={() => setOpen(false)}
        >
          <Mark />
          {SITE_NAME}
        </a>

        <nav aria-label="Sections" className="hidden items-center gap-8 md:flex">
          {NAV_ITEMS.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="navlink text-[15px] font-medium">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <LinkButton href={LINKS.txTdsReserved} className="hidden sm:inline-flex sm:w-auto">
            {MAIN_ACTION}
          </LinkButton>
          <button
            type="button"
            className="btn btn-secondary w-auto md:hidden"
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      <div
        id="site-menu"
        hidden={!open}
        className={cn(
          'fixed inset-x-0 top-(--nav) bottom-0 bg-ground md:hidden',
          open && 'flex flex-col'
        )}
      >
        <nav aria-label="Sections" className="wrap flex flex-col pt-4">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="flex h-14 items-center border-b border-line text-lg"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="wrap mt-auto pb-8 sm:hidden">
          <LinkButton href={LINKS.txTdsReserved}>{MAIN_ACTION}</LinkButton>
        </div>
      </div>
    </header>
  );
};
