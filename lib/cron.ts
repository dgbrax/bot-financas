import { timingSafeEqual } from 'node:crypto'

/**
 * Checks `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends; a
 * VPS crontab can send the same header with curl). Constant-time compare;
 * an unset or short secret never authorizes.
 */
export function verifyCronAuthorization(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 16 || !header) return false
  const a = Buffer.from(header)
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
}
