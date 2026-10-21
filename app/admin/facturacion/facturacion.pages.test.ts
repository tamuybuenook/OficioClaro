// Pruebas de render (SSR) de las pantallas con un cliente de Supabase simulado: comprueban que las páginas
// no fallan, muestran los importes derivados de estados reales y no filtran secretos.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

type Fixture = Record<string, any[]>
let fixture: Fixture = {}
const calls: { table: string; ops: string[] }[] = []

function fakeDb() {
  return {
    from(table: string) {
      const rec = { table, ops: [] as string[] }; calls.push(rec)
      const rows = () => fixture[table] ?? []
      const q: any = new Proxy({}, {
        get: (_t, name: string) => {
          if (name === 'then') return (res: any) => res({ data: rows(), count: rows().length, error: null })
          if (name === 'maybeSingle' || name === 'single') return async () => ({ data: rows()[0] ?? null, error: null })
          return (...a: any[]) => { rec.ops.push(name); if (name === 'range') return Promise.resolve({ data: rows(), count: rows().length, error: null }); return q }
        },
      })
      return q
    },
  }
}

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: async () => ({ supabase: fakeDb(), user: { id: 'admin' } }) }))
vi.mock('@/lib/admin/billing/user-email', () => ({ fetchUserEmail: async () => 'cliente@example.com' }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') }, redirect: () => { throw new Error('REDIRECT') } }))

const U = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const pay = (o: any = {}) => ({
  id: P1, created_at: '2026-10-05T15:00:00Z', updated_at: '2026-10-05T15:00:00Z', amount: 8000, provider: 'mercadopago', status: 'reconciled', external_id: 'MP-777', reference: null, proof_url: null,
  mp_status: 'approved', mp_status_detail: 'accredited', applied_at: '2026-10-05T15:01:00Z', review_reason: null, review_resolution: null, reviewed_at: null, reviewed_by: null, plan_id: 'pl', subscription_id: 's1',
  plans: { name: 'Medium', price: 8000, billing_period: 'monthly' },
  subscriptions: { id: 's1', user_id: U, status: 'active', start_date: '2026-09-05', end_date: '2026-11-05', mp_status: 'authorized', profiles: { full_name: 'Ana Pérez', phone: '+54 11 5555', created_at: '2026-01-01T00:00:00Z' } },
  ...o,
})

beforeEach(() => {
  calls.length = 0
  fixture = {
    payments: [pay(), pay({ id: '33333333-3333-4333-8333-333333333333', amount: 5000, status: 'refunded', external_id: 'MP-888' }), pay({ id: '44444444-4444-4444-8444-444444444444', amount: 9000, applied_at: null, review_reason: 'subscription_suspended', external_id: 'MP-999' })],
    subscriptions: [{ user_id: U, status: 'active', end_date: '2026-11-05', mp_status: 'authorized', id: 's1', start_date: '2026-09-05', created_at: '2026-09-05T00:00:00Z', cancelled_at: null, trial_pending: false, mp_preapproval_id: 'PRE-1', mp_amount: 8000, plans: { name: 'Medium', price: 8000, billing_period: 'monthly' } }],
    mp_preapprovals: [{ id: 'pa1', subscription_id: 's1', preapproval_id: 'PRE-1', status: 'cancelling', last_error: 'timeout al cancelar', cancel_attempts: 2, updated_at: '2026-10-10T10:00:00Z', created_at: '2026-10-01T10:00:00Z', closed_at: null, amount: 8000, subscriptions: { user_id: U, profiles: { full_name: 'Ana Pérez' } } }],
    audit_logs: [{ id: 'a1', entity_id: P1, entity: 'payments', action: 'mp_approved', actor_id: null, new_value: { end_date: '2026-11-05' }, created_at: '2026-10-05T15:01:00Z' }, { id: 'a2', action: 'mp_incident_cancel_unconfirmed', entity: 'mp_preapprovals', entity_id: 'pa1', created_at: '2026-10-10T10:00:00Z', new_value: {} }],
    mp_webhook_events: [{ id: 'e1', topic: 'payment', data_id: 'MP-777', request_id: 'r', outcome: 'error', detail: 'db down', received_at: '2026-10-05T15:00:30Z', processed_at: null }],
    profiles: [{ id: U, full_name: 'Ana Pérez', phone: '+54 11 5555', role: 'user', created_at: '2026-01-01T00:00:00Z' }],
    bank_reconciliations: [],
  }
})

describe('/admin/facturacion', () => {
  it('muestra totales derivados de estados reales y las alertas', async () => {
    const { default: Page } = await import('./page')
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Facturación y pagos')
    expect(html).toContain('Total cobrado')
    // 3 filas en el fixture: solo la primera es cobrada (8.000); el reembolso y el retenido no suman.
    expect(html).toMatch(/\$\s?8\.000,00/)
    expect(html).toContain('1 pago(s) aprobado(s)')
    expect(html).toContain('Retenidos (revisión pendiente)')
    expect(html).toContain('cancelándose')
    expect(html).toContain('timeout al cancelar')
    expect(html).toContain('Cancelación en MP sin confirmar')
    expect(html).toContain('/admin/facturacion/pagos/')
    expect(html).toContain('MP-777')
  })
  it('vista de eventos: muestra motivo del error y enlaza al pago', async () => {
    const { default: Page } = await import('./page')
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ vista: 'eventos' }) }))
    expect(html).toContain('db down'); expect(html).toContain('Error')
  })
  it('lee todo con el cliente de sesión y nunca escribe', async () => {
    const { default: Page } = await import('./page')
    await Page({ searchParams: Promise.resolve({ estado: 'retenido', q: 'Pérez' }) })
    const writes = calls.flatMap((c) => c.ops).filter((o) => ['insert', 'update', 'delete', 'upsert', 'rpc'].includes(o))
    expect(writes).toEqual([])
  })
  it('es resistente a parámetros maliciosos', async () => {
    const { default: Page } = await import('./page')
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: '<script>alert(1)</script>', estado: "'; drop table payments;--", pagina: 'abc' }) }))
    expect(html).not.toContain('<script>alert')
  })
})

describe('/admin/facturacion/pagos/[id]', () => {
  it('detalle: identificadores, período cubierto, y datos para factura futura sin simular emisión', async () => {
    fixture.payments = [pay()]
    const { default: Page } = await import('./pagos/[id]/page')
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: P1 }) }))
    expect(html).toContain(P1); expect(html).toContain('MP-777')
    expect(html).toContain('hasta 05/11/2026')
    expect(html).toContain('cliente@example.com')
    expect(html).toContain('No hay ninguna factura emitida')
    expect(html).toContain('Comprobante vinculado'); expect(html).toContain('Ninguno')
    expect(html).toContain('No registrado en OficioClaro')
    expect(html).toContain('Sí: cobro confirmado')
  })
  it('un pago reembolsado no es facturable', async () => {
    fixture.payments = [pay({ status: 'refunded' })]
    const { default: Page } = await import('./pagos/[id]/page')
    expect(renderToStaticMarkup(await Page({ params: Promise.resolve({ id: P1 }) }))).toContain('No por ahora')
  })
  it('id inválido o inexistente: 404', async () => {
    const { default: Page } = await import('./pagos/[id]/page')
    await expect(Page({ params: Promise.resolve({ id: 'no-uuid' }) })).rejects.toThrow('NOT_FOUND')
    fixture.payments = []
    await expect(Page({ params: Promise.resolve({ id: P1 }) })).rejects.toThrow('NOT_FOUND')
  })
})

describe('/admin/facturacion/clientes/[userId]', () => {
  it('detalle: plan, autorización recurrente, incidencias e historial', async () => {
    const { default: Page } = await import('./clientes/[userId]/page')
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ userId: U }), searchParams: Promise.resolve({}) }))
    expect(html).toContain('Ana Pérez'); expect(html).toContain('cliente@example.com'); expect(html).toContain('Medium')
    expect(html).toContain('Cancelándose (sin confirmar)'); expect(html).toContain('timeout al cancelar')
    expect(html).toContain('Historial de pagos'); expect(html).toContain('Para revisar')
  })
  it('usuario inexistente: 404', async () => {
    fixture.profiles = []
    const { default: Page } = await import('./clientes/[userId]/page')
    await expect(Page({ params: Promise.resolve({ userId: U }), searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND')
  })
})
