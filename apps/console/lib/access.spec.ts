import { resolveAccess } from '@/lib/access';
import { ROUTES } from '@/lib/routes';
import { describe, expect, it } from 'vitest';

describe('resolveAccess', () => {
  it('lets everything through when demo auth is off', () => {
    expect(resolveAccess({ pathname: ROUTES.owner.settings, role: null, demoAuth: false })).toEqual(
      { action: 'allow' }
    );
  });

  it('sends a signed-out viewer to sign-in', () => {
    expect(resolveAccess({ pathname: ROUTES.owner.tax, role: null, demoAuth: true })).toEqual({
      action: 'redirect',
      to: ROUTES.signIn
    });
  });

  it('always allows the sign-in page', () => {
    expect(resolveAccess({ pathname: ROUTES.signIn, role: null, demoAuth: true })).toEqual({
      action: 'allow'
    });
  });

  it.each([
    ['owner', ROUTES.owner.overview],
    ['agent', ROUTES.agent.agents],
    ['ca', ROUTES.ca.filing]
  ] as const)('sends a %s from the root to their workspace home', (role, home) => {
    expect(resolveAccess({ pathname: ROUTES.home, role, demoAuth: true })).toEqual({
      action: 'redirect',
      to: home
    });
  });

  it('keeps a CA out of the API owner settings', () => {
    expect(resolveAccess({ pathname: ROUTES.owner.settings, role: 'ca', demoAuth: true })).toEqual({
      action: 'redirect',
      to: ROUTES.ca.filing
    });
  });

  it('keeps an agent owner out of nested API owner paths', () => {
    expect(
      resolveAccess({ pathname: `${ROUTES.owner.payments}/p_1`, role: 'agent', demoAuth: true })
    ).toEqual({ action: 'redirect', to: ROUTES.agent.agents });
  });

  it('allows a role into its own workspace', () => {
    expect(
      resolveAccess({ pathname: ROUTES.agent.policies, role: 'agent', demoAuth: true })
    ).toEqual({ action: 'allow' });
  });
});
