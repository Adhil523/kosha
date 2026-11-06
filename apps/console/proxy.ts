import { resolveAccess } from '@/lib/access';
import { isDemoAuthEnabled, parseRole, SESSION_COOKIE } from '@/lib/session';
import { type NextRequest, NextResponse } from 'next/server';

export const proxy = (request: NextRequest) => {
  const access = resolveAccess({
    pathname: request.nextUrl.pathname,
    role: parseRole(request.cookies.get(SESSION_COOKIE)?.value),
    demoAuth: isDemoAuthEnabled()
  });
  if (access.action === 'redirect') {
    return NextResponse.redirect(new URL(access.to, request.url));
  }
  return NextResponse.next();
};

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)']
};
