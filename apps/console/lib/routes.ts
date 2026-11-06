// Every Console path, in one place. Pages, links and redirects use these, never string literals.
export const ROUTES = {
  home: '/',
  signIn: '/sign-in',
  owner: {
    overview: '/overview',
    payments: '/payments',
    counterparties: '/counterparties',
    tax: '/tax',
    monthly: '/monthly',
    outside: '/outside',
    settings: '/settings'
  },
  agent: {
    agents: '/agents',
    reserve: '/reserve',
    spend: '/spend',
    policies: '/policies',
    credits: '/credits'
  },
  ca: {
    filing: '/filing'
  }
} as const;
