// data-testid values, shared with the Playwright suite (B20). Never inline a test id.
export const TEST_IDS = {
  sideNav: 'side-nav',
  navLink: (href: string) => `nav-link-${href.replace(/^\//, '')}`,
  pageTitle: 'page-title',
  signInRole: (role: string) => `sign-in-${role}`,
  signOut: 'sign-out',
  footerLabels: 'footer-labels'
} as const;
