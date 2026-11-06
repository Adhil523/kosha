// data-testid values, shared with the Playwright suite (B20). Never inline a test id.
export const TEST_IDS = {
  sideNav: 'side-nav',
  navLink: (href: string) => `nav-link-${href.replace(/^\//, '')}`,
  pageTitle: 'page-title',
  signInRole: (role: string) => `sign-in-${role}`,
  signOut: 'sign-out',
  footerLabels: 'footer-labels',
  rulePackBadge: 'rule-pack-badge',
  queryRetry: 'query-retry',
  paymentsFeed: 'payments-feed',
  feedStatus: 'feed-status',
  paymentRow: (paymentId: string) => `payment-row-${paymentId}`,
  thresholdCounter: (agentId: string) => `threshold-counter-${agentId}`,
  thresholdStatus: (agentId: string) => `threshold-status-${agentId}`,
  overviewStat: (id: string) => `overview-stat-${id}`,
  counterparty: (agentId: string) => `counterparty-${agentId}`,
  agentCard: (agentId: string) => `agent-card-${agentId}`,
  verifyPrompt: (agentId: string) => `verify-prompt-${agentId}`,
  agentTab: (agentId: string) => `agent-tab-${agentId}`,
  spendStat: (id: string) => `spend-stat-${id}`
} as const;
