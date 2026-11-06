import { ROUTES } from '@/lib/routes';

export type WorkspaceId = 'owner' | 'agent' | 'ca';

export type NavItem = { href: string; label: string; description: string };

export type Workspace = { id: WorkspaceId; label: string; home: string; nav: NavItem[] };

// The three workspaces and their screens, from spec Component 4.
export const WORKSPACES: Record<WorkspaceId, Workspace> = {
  owner: {
    id: 'owner',
    label: 'API owner',
    home: ROUTES.owner.overview,
    nav: [
      {
        href: ROUTES.owner.overview,
        label: 'Overview',
        description:
          'Earnings today and this month, TDS withheld, escrow balance, payments per minute.'
      },
      {
        href: ROUTES.owner.payments,
        label: 'Payments',
        description: 'Every payment: time, agent, price, TDS, rate, reason, HashScan and HCS links.'
      },
      {
        href: ROUTES.owner.counterparties,
        label: 'Counterparties',
        description:
          "Each payer's yearly total against its threshold, residency and credential status."
      },
      {
        href: ROUTES.owner.tax,
        label: 'Tax',
        description: 'Quarter summary, deductee-wise totals, TDS file download, rule-pack version.'
      },
      {
        href: ROUTES.owner.escrow,
        label: 'Escrow and sweeps',
        description: 'Escrow balance, the monthly sweep schedule and the sweep co-sign.'
      },
      {
        href: ROUTES.owner.outside,
        label: 'Outside payments',
        description: 'USDC that arrived outside Kosha, the shortfall, and how to resolve it.'
      },
      {
        href: ROUTES.owner.settings,
        label: 'Settings',
        description:
          'Threshold or first-rupee mode, funding mode, priced routes, API keys, webhooks.'
      }
    ]
  },
  agent: {
    id: 'agent',
    label: 'Agent owner',
    home: ROUTES.agent.agents,
    nav: [
      {
        href: ROUTES.agent.agents,
        label: 'Agents',
        description: "Each agent's HCS-14 ID, credential, declared wallets and status."
      },
      {
        href: ROUTES.agent.spend,
        label: 'Spend',
        description: 'Spend by API and by day, tax paid on top, budget left.'
      },
      {
        href: ROUTES.agent.policies,
        label: 'Policies',
        description: 'Caps, allowlist, threshold action and accepted rule packs.'
      },
      {
        href: ROUTES.agent.credits,
        label: 'Tax credits and gains',
        description: "TDS credited to the owner's PAN per deductor, and gain or loss per lot."
      }
    ]
  },
  ca: {
    id: 'ca',
    label: 'Chartered accountant',
    home: ROUTES.ca.filing,
    nav: [
      {
        href: ROUTES.ca.filing,
        label: 'Filing view',
        description: 'Read-only tax screen with evidence links: HashScan and HCS sequence numbers.'
      }
    ]
  }
};

export const WORKSPACE_ORDER: readonly WorkspaceId[] = ['owner', 'agent', 'ca'];

export const findNavItem = (href: string): NavItem | undefined =>
  WORKSPACE_ORDER.flatMap((id) => WORKSPACES[id].nav).find((item) => item.href === href);
