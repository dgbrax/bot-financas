import { NextResponse, type NextRequest } from 'next/server'
import { verifyCronAuthorization } from '@/lib/cron'
import { runScheduledSync } from '@/lib/pluggy/scheduled'

// Daily bank sync. Vercel Cron calls GET with `Authorization: Bearer
// $CRON_SECRET`; on a VPS, call it from crontab with the same header.
// 300 s is the Hobby maximum; stop starting new items well before that.
export const maxDuration = 300
export const dynamic = 'force-dynamic'
const BUDGET_MS = 240_000

export async function GET(request: NextRequest) {
  if (!verifyCronAuthorization(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // Counts only: no user ids or financial data in the response/logs.
  const summary = await runScheduledSync({ budgetMs: BUDGET_MS })
  console.info('cron sync', summary)
  return NextResponse.json(summary)
}
