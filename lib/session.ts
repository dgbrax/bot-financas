import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

/**
 * Current user's id. Without a valid session (e.g. it expired while the page
 * was open) it redirects to /sign-in, both from server actions and pages.
 */
export async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  return session.user.id
}
