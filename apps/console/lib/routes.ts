// Every Console path, in one place. Pages, links and redirects use these, never string literals.
export const ROUTES = {
  home: '/',
  signIn: '/sign-in',
  owner: {
    overview: '/overview',
    payments: '/payments',
    counterparties: '/counterparties',
    tax: '/tax',
    escrow: '/escrow',
    outside: '/outside',
    settings: '/settings'
  },
  agent: {
    agents: '/agents',
    spend: '/spend',
    policies: '/policies',
    credits: '/credits'
  },
  ca: {
    filing: '/filing'
  }
} as const;
