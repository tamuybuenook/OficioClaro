import { NextResponse, type NextRequest } from 'next/server'
import { getMpConfig } from '@/lib/mercadopago/config'
import { verifyMpSignature } from '@/lib/mercadopago/signature'
import { createMpClient } from '@/lib/mercadopago/client'
import { createSupabaseMpStore } from '@/lib/mercadopago/store'
import { processMpEvent } from '@/lib/mercadopago/process-event'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Webhook de Mercado Pago. Respuestas: 401 firma inválida · 200 procesada/ignorada/rechazada por negocio · 500 error transitorio (MP reintenta).
export async function POST(request: NextRequest) {
  let config
  try { config = getMpConfig() } catch {
    console.error('[mp-webhook] configuración incompleta')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  const url = new URL(request.url)
  const dataId = url.searchParams.get('data.id')
  const requestId = request.headers.get('x-request-id')

  if (!verifyMpSignature({ secret: config.webhookSecret, signatureHeader: request.headers.get('x-signature'), requestId, dataId })) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let topic = url.searchParams.get('type') ?? url.searchParams.get('topic')
  if (!topic) {
    try { topic = ((await request.json()) as { type?: string })?.type ?? null } catch { /* sin cuerpo */ }
  }

  const store = createSupabaseMpStore(createAdminClient())
  const eventId = await store.logEvent({ topic, dataId, requestId })
  try {
    const result = await processMpEvent({ mp: createMpClient(config), store }, { topic, dataId: dataId! })
    await store.finishEvent(eventId, result.outcome, result.detail)
    return NextResponse.json({ ok: true, outcome: result.outcome })
  } catch (e: any) {
    await store.finishEvent(eventId, 'error', e?.message ?? 'error')
    console.error('[mp-webhook] error transitorio', topic, dataId, e?.message) // sin tokens ni payloads
    return NextResponse.json({ error: 'retry' }, { status: 500 })
  }
}
