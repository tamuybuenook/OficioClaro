import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getMpConfig } from '@/lib/mercadopago/config'
import { createMpClient } from '@/lib/mercadopago/client'
import { createSupabaseMpStore } from '@/lib/mercadopago/store'
import { reconcileIntents, recoverPreapprovals } from '@/lib/mercadopago/reconcile'
import { createAdminClient } from '@/lib/supabase/admin'
import { logReconcileRun, RECONCILE_RUN_ACTION, RECONCILE_FAILED_ACTION } from '@/lib/mercadopago/reconcile-log'

export const dynamic = 'force-dynamic'

// Conciliación periódica (Vercel Cron envía "Authorization: Bearer $CRON_SECRET"). Sin CRON_SECRET queda deshabilitada.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'disabled' }, { status: 404 })
  const got = Buffer.from(request.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${secret}`)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const started = Date.now()
  let admin: ReturnType<typeof createAdminClient> | null = null
  try {
    const config = getMpConfig()
    admin = createAdminClient()
    const deps = { mp: createMpClient(config), store: createSupabaseMpStore(admin) }
    const payments = await reconcileIntents(deps, { olderThanMinutes: 5, newerThanHours: 72, limit: 50 })
    // Cancelaciones sin confirmar y creaciones a medias de autorizaciones recurrentes.
    const preapprovals = await recoverPreapprovals(deps, { olderThanMinutes: 2, limit: 50 })
    await logReconcileRun(admin, RECONCILE_RUN_ACTION, { payments, preapprovals, mp_env: config.env, duration_ms: Date.now() - started })
    return NextResponse.json({ payments, preapprovals })
  } catch (e) {
    console.error('[mp-reconcile] error')
    // Solo el tipo de error: sin mensajes que puedan arrastrar datos de MP.
    try { await logReconcileRun(admin ?? createAdminClient(), RECONCILE_FAILED_ACTION, { error: e instanceof Error ? e.name : 'error', duration_ms: Date.now() - started }) } catch { /* sin base: solo queda el log */ }
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
