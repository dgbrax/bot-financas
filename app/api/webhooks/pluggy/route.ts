import { after, NextResponse, type NextRequest } from 'next/server'
import {
  parseWebhookPayload,
  processWebhookEvent,
  recordWebhookEvent,
  verifyWebhookSecret,
  WEBHOOK_SECRET_HEADER,
} from '@/lib/pluggy/webhook'

// Pluggy needs a 2xx within 10 s and retries 5xx/timeouts (not 4xx), so:
// authenticate, record (idempotent on eventId), answer, then process.
export async function POST(request: NextRequest) {
  if (
    !verifyWebhookSecret(
      request.headers.get(WEBHOOK_SECRET_HEADER),
      process.env.PLUGGY_WEBHOOK_SECRET,
    )
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const payload = parseWebhookPayload(await request.json().catch(() => null))
  if (!payload) return NextResponse.json({ error: 'invalid payload' }, { status: 400 })

  // Filter (not authentication): events for another Pluggy client. With
  // per-user credentials (no env client) the item lookup does the scoping.
  const envClientId = process.env.PLUGGY_CLIENT_ID
  if (envClientId && payload.clientId && payload.clientId !== envClientId) {
    return NextResponse.json({ ignored: true })
  }

  let shouldProcess: boolean
  try {
    shouldProcess = await recordWebhookEvent(payload)
  } catch {
    // Database unavailable: let Pluggy retry.
    return NextResponse.json({ error: 'temporarily unavailable' }, { status: 503 })
  }
  if (!shouldProcess) return NextResponse.json({ duplicate: true })

  after(() => processWebhookEvent(payload))
  return NextResponse.json({ received: true })
}
