// data-testid values, shared with the Playwright suite (B20). Never inline a test id.
export const TEST_IDS = {
  sideNav: 'side-nav',
  navLink: (href: string) => `nav-link-${href.replace(/^\//, '')}`,
  pageTitle: 'page-title'
} as const;
