// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const nav = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh }) }))
vi.mock('@/lib/actions/mercadopago', () => ({ startMpCheckout: vi.fn(), cancelMpRenewal: vi.fn(), syncMyPayments: vi.fn(async () => ({})) }))

import { SubscriptionView, type BillingInfo, type SubscriptionInfo } from './subscription-view'
import type { PaymentView } from '@/lib/account-summary'

const sub = (o: Partial<NonNullable<SubscriptionInfo>> = {}): SubscriptionInfo => ({ id: 's1', planName: 'Profesional', status: 'active', endDate: '2026-12-01', state: 'active', planId: 'pl1', autoRenew: false, autoRenewPending: false, ...o })
const pay = (o: Partial<PaymentView> = {}): PaymentView => ({ id: 'p1', createdAt: '2026-11-09T15:00:00Z', amount: 9000, status: 'reconciled', provider: 'transfer', planName: 'Profesional', reference: 'OP-77', proofUrl: null, ...o })
const billing = (o: Partial<BillingInfo> = {}): BillingInfo => ({ mpAvailable: false, plans: [{ id: 'pl1', name: 'Profesional', price: 9000, billingPeriod: 'monthly', maxTrades: 3 }], payments: [], transfer: null, mpReturn: null, ...o })
const TRANSFER = { bank: 'Banco Ejemplo', alias: 'oficio.claro', cbu: '0000003100012345678901', holder: 'OficioClaro SAS', holderCuit: '30-12345678-9', note: null }

let onReport: ReturnType<typeof vi.fn>
const setup = (p: { subscription?: SubscriptionInfo; billing?: BillingInfo; daysToEnd?: number | null } = {}) => {
  const user = userEvent.setup()
  const utils = render(<SubscriptionView subscription={p.subscription === undefined ? sub() : p.subscription} billing={p.billing ?? billing()} onReportPayment={onReport as any} reportPending={false} daysToEnd={p.daysToEnd ?? null} />)
  return { user, ...utils }
}
beforeEach(() => { cleanup(); nav.refresh.mockClear(); onReport = vi.fn(async () => ({ data: {} })) })
afterEach(() => cleanup())

describe('Mi suscripción: estado de cuenta', () => {
  it('plan, estado, vencimiento DD/MM/AAAA y días restantes (calculados por el servidor)', () => {
    setup({ daysToEnd: 12 })
    expect(screen.getByText('Profesional')).toBeTruthy()
    expect(screen.getByText('Activa')).toBeTruthy()
    expect(screen.getByText('01/12/2026')).toBeTruthy()
    expect(screen.getByTestId('days-left').textContent).toBe('Vence en 12 días')
  })
  it('vencida: "Venció el" y días vencidos', () => {
    setup({ subscription: sub({ state: 'expired', endDate: '2026-11-01' }), daysToEnd: -9 })
    expect(screen.getByText('Venció el')).toBeTruthy()
    expect(screen.getByTestId('days-left').textContent).toBe('Venció hace 9 días')
    expect(screen.getByText(/Tu acceso venció/)).toBeTruthy()
  })
  it('sin suscripción: "Sin plan", sin fecha y no se puede informar un pago', () => {
    setup({ subscription: null })
    expect(screen.getAllByText('Sin plan').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('days-left')).toBeNull()
    expect((screen.getByRole('button', { name: /informar pago/i }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('suspendida: avisa y no ofrece Mercado Pago', () => {
    setup({ subscription: sub({ state: 'suspended' }), billing: billing({ mpAvailable: true }) })
    expect(screen.getByText(/Tu cuenta está suspendida/)).toBeTruthy()
    expect(screen.queryByText('Pagar con Mercado Pago')).toBeNull()
  })
})

describe('Mi suscripción: historial de pagos', () => {
  it('estado vacío comprensible', () => {
    setup()
    expect(screen.getByText(/Todavía no hay pagos registrados/)).toBeTruthy()
  })
  it('muestra fecha, importe, medio, estado y referencia; explica cada estado', () => {
    setup({ billing: billing({ payments: [
      pay({ id: 'a', status: 'reconciled', reference: 'OP-77' }),
      pay({ id: 'b', status: 'pending', amount: 9500, reference: null }),
      pay({ id: 'c', status: 'rejected', amount: 100 }),
      pay({ id: 'd', status: 'refunded', provider: 'mercadopago', amount: 200 }),
    ] }) })
    const items = within(screen.getByRole('region', { name: 'Historial de pagos' })).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(within(items[0]).getByText('Aprobado')).toBeTruthy()
    expect(items[0].textContent).toMatch(/\$9\.000 · Transferencia/)
    expect(items[0].textContent).toContain('Ref. OP-77')
    expect(items[0].textContent).toMatch(/9\/11\/2026|09\/11\/2026/)
    expect(within(items[1]).getByText('En revisión')).toBeTruthy()
    expect(items[1].textContent).toContain('Administración está verificando')
    expect(within(items[2]).getByText('Rechazado')).toBeTruthy()
    expect(items[3].textContent).toMatch(/Reembolsado/)
    expect(items[3].textContent).toMatch(/Mercado Pago/)
  })
  it('un estado desconocido se muestra tal cual', () => {
    setup({ billing: billing({ payments: [pay({ status: 'chargeback' })] }) })
    expect(screen.getByText('chargeback')).toBeTruthy()
  })
  it('enlace al comprobante solo si existe, y seguro (noopener)', () => {
    setup({ billing: billing({ payments: [pay({ proofUrl: 'https://x.test/c.png' })] }) })
    const a = screen.getByRole('link', { name: /comprobante/ }) as HTMLAnchorElement
    expect(a.rel).toContain('noopener')
    cleanup()
    setup({ billing: billing({ payments: [pay()] }) })
    expect(screen.queryByRole('link', { name: /comprobante/ })).toBeNull()
  })
  it('pagina de a 10', async () => {
    const many = Array.from({ length: 12 }, (_, i) => pay({ id: `p${i}`, amount: 1000 + i }))
    const { user } = setup({ billing: billing({ payments: many }) })
    expect(within(screen.getByRole('region', { name: 'Historial de pagos' })).getAllByRole('listitem')).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: 'Ver pagos anteriores' }))
    expect(within(screen.getByRole('region', { name: 'Historial de pagos' })).getAllByRole('listitem')).toHaveLength(12)
    expect(screen.queryByRole('button', { name: 'Ver pagos anteriores' })).toBeNull()
  })
  it('una transferencia pendiente muestra el aviso de revisión', () => {
    setup({ billing: billing({ payments: [pay({ status: 'pending' })] }) })
    expect(screen.getByRole('status', { name: 'Transferencia en revisión' }).textContent).toMatch(/Tu transferencia está en revisión/)
  })
})

describe('Mi suscripción: pagar por transferencia', () => {
  it('muestra Cuenta de, CUIT/CUIL, CBU/CVU con Copiar y el alias si está informado', () => {
    setup({ billing: billing({ transfer: TRANSFER }) })
    expect(screen.getByText('Cuenta de')).toBeTruthy()
    expect(screen.getByText('OficioClaro SAS')).toBeTruthy()
    expect(screen.getByText('CUIT/CUIL')).toBeTruthy()
    expect(screen.getByText('30-12345678-9')).toBeTruthy()
    expect(screen.getByText('CBU/CVU')).toBeTruthy()
    expect(screen.getByText('0000003100012345678901')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar CBU/CVU' })).toBeTruthy()
    expect(screen.getByText('Alias')).toBeTruthy()
    expect(screen.getByText('oficio.claro')).toBeTruthy()
  })
  it('sin alias informado: no muestra la fila Alias', () => {
    setup({ billing: billing({ transfer: { ...TRANSFER, alias: null } }) })
    expect(screen.queryByText('Alias')).toBeNull()
    expect(screen.getByText('0000003100012345678901')).toBeTruthy()
  })
  it('Copiar CBU/CVU copia el número y confirma con "Copiado"', async () => {
    const { user } = setup({ billing: billing({ transfer: TRANSFER }) })
    await user.click(screen.getByRole('button', { name: 'Copiar CBU/CVU' }))
    expect(await navigator.clipboard.readText()).toBe('0000003100012345678901')
    await waitFor(() => expect(within(screen.getByRole('button', { name: 'Copiar CBU/CVU' })).getByText('Copiado')).toBeTruthy())
  })
  it('datos incompletos (sin titular, CUIT o CBU): mensaje claro, no muestra datos parciales ni inventa valores', () => {
    for (const missing of ['holder', 'holderCuit', 'cbu'] as const) {
      cleanup()
      setup({ billing: billing({ transfer: { ...TRANSFER, [missing]: null } }) })
      expect(screen.getByText(/incompletos o todavía no fueron cargados/)).toBeTruthy()
      expect(screen.queryByText('Cuenta de')).toBeNull()
      expect(screen.queryByRole('button', { name: /Copiar/ })).toBeNull()
      expect(screen.getByRole('button', { name: /informar pago/i })).toBeTruthy()
    }
  })
  it('sin datos configurados: lo dice, no inventa una cuenta', () => {
    setup()
    expect(screen.getByText(/incompletos o todavía no fueron cargados/)).toBeTruthy()
    expect(screen.queryByText(/CBU/)).toBeNull()
  })
  it('el monto viene sugerido con el precio del plan y explica que nada se activa solo', () => {
    setup()
    expect((screen.getByLabelText('Monto transferido') as HTMLInputElement).value).toBe('9000')
    expect(screen.getByText(/Nada se activa solo por avisar/)).toBeTruthy()
  })
  it('informar: envía monto, referencia y comprobante; confirma y recarga los datos', async () => {
    const { user } = setup({ billing: billing({ transfer: TRANSFER }) })
    await user.type(screen.getByLabelText(/Nº de operación/), 'OP-123')
    await user.type(screen.getByLabelText(/Enlace al comprobante/), 'https://x.test/c.png')
    await user.click(screen.getByRole('button', { name: /informar pago/i }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Recibimos tu aviso/)
    const fd = onReport.mock.calls[0][0] as FormData
    expect([fd.get('amount'), fd.get('reference'), fd.get('proof_url')]).toEqual(['9000', 'OP-123', 'https://x.test/c.png'])
    expect(nav.refresh).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText(/Nº de operación/) as HTMLInputElement).value).toBe('') // limpia para no reenviar lo mismo
  })
  it('doble clic: una sola solicitud', async () => {
    let release!: () => void
    onReport = vi.fn(() => new Promise((res) => { release = () => res({ data: {} }) }))
    const { user } = setup()
    await user.dblClick(screen.getByRole('button', { name: /informar pago/i }))
    expect(onReport).toHaveBeenCalledTimes(1)
    release()
    await screen.findByText(/Recibimos tu aviso/)
  })
  it('error del servidor (monto inválido, límite de frecuencia…) se ve y NO se muestra como enviado', async () => {
    onReport = vi.fn(async () => ({ error: 'Demasiados intentos. Probá más tarde.' }))
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /informar pago/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('Demasiados intentos')
    expect(screen.queryByText(/Recibimos tu aviso/)).toBeNull()
    expect(nav.refresh).not.toHaveBeenCalled()
  })
  it('error de red: mensaje claro', async () => {
    onReport = vi.fn(async () => { throw new Error('network') })
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /informar pago/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Revisá tu conexión/)
  })
  it('monto vacío o inválido: error junto al campo y no se envía', async () => {
    const { user } = setup()
    const amount = screen.getByLabelText('Monto transferido')
    await user.clear(amount)
    await user.click(screen.getByRole('button', { name: /informar pago/i }))
    expect(screen.getByRole('alert').textContent).toMatch(/Ingresá el monto/)
    await user.type(amount, '-5')
    await user.click(screen.getByRole('button', { name: /informar pago/i }))
    expect(onReport).not.toHaveBeenCalled()
  })
  it('el usuario no tiene ningún control para aprobar o rechazar pagos', () => {
    setup({ billing: billing({ payments: [pay({ status: 'pending' })] }) })
    expect(screen.queryByRole('button', { name: /aprobar|rechazar|conciliar/i })).toBeNull()
  })
})

describe('Mi suscripción: Mercado Pago oculto por el admin (mpAvailable = false)', () => {
  it('con MP disponible se ofrece; oculto no aparece pero la transferencia y cancelar la renovación siguen', () => {
    setup({ subscription: sub({ autoRenew: true }), billing: billing({ mpAvailable: true, transfer: TRANSFER }) })
    expect(screen.getByText('Pagar con Mercado Pago')).toBeTruthy()
    cleanup()
    setup({ subscription: sub({ autoRenew: true }), billing: billing({ mpAvailable: false, transfer: TRANSFER }) })
    expect(screen.queryByText('Pagar con Mercado Pago')).toBeNull()
    expect(screen.getByText('Pagar por transferencia')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar CBU/CVU' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar renovación automática' })).toBeTruthy()
  })
})
