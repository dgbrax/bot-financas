import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

/** Current user's id, or throws. Use at the top of every server action. */
export async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}
