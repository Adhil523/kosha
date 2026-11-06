'use server';

import { ROUTES } from '@/lib/routes';
import { parseRole, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/lib/session';
import { WORKSPACES } from '@/lib/workspaces';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const signIn = async (formData: FormData) => {
  const role = parseRole(formData.get('role'));
  if (!role) {
    redirect(ROUTES.signIn);
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, role, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  });
  redirect(WORKSPACES[role].home);
};

export const signOut = async () => {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect(ROUTES.signIn);
};
