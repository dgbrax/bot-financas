import 'server-only'
import { secretMatches } from './protocol'

/** Default off, including automatic Preview deployments and pre-migration builds. */
export function telegramEnabled() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''
  return process.env.TELEGRAM_ENABLED === 'true' &&
    /^\d+:[A-Za-z0-9_-]+$/.test(process.env.TELEGRAM_BOT_TOKEN ?? '') &&
    secretMatches(secret, secret)
}
