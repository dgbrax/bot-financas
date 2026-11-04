import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

// Optimistic check only: no session cookie -> real HTTP redirect to /sign-in
// before any rendering/streaming starts. Pages and server actions still
// validate the session itself (see lib/session.ts), so a forged or expired
// cookie gets nothing.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/contas/:path*'],
}
