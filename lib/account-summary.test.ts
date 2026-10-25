import { describe, it, expect } from 'vitest'
import { buildAccountSummary, daysText, paymentStatusInfo, providerLabel, stateInfo, type PaymentView } from './account-summary'
import { getTransferInstructions } from './transfer-instructions'

const NOW = new Date('2026-11-10T15:00:00Z').getTime()
const pay = (o: Partial<PaymentView> = {}): PaymentView => ({ id: 'p', createdAt: '2026-11-09T10:00:00Z', amount: 9000, status: 'pending', provider: 'transfer', planName: 'Profesional', reference: 'OP-1', proofUrl: null, ...o })
const sub = (state: any, endDate: string | null = '2026-11-20') => ({ planName: 'Profesional', state, endDate })
const sum = (s: any, daysToEnd: number | null, payments: PaymentView[] = [], locked = false) => buildAccountSummary({ subscription: s, access: { daysToEnd, locked }, payments, now: NOW })

describe('estados de cuenta', () => {
  it('cada estado real tiene texto y tono; uno desconocido cae en "Sin plan" sin romper', () => {
    expect(stateInfo('active')).toEqual({ label: 'Activa', tone: 'success' })
    expect(stateInfo('expired').label).toBe('Vencida')
    expect(stateInfo('past_due').label).toBe('Pago pendiente')
    expect(stateInfo('suspended').label).toBe('Suspendida')
    expect(stateInfo('algo_raro').label).toBe('Sin plan')
    expect(stateInfo(null).label).toBe('Sin plan')
  })
  it('días restantes / vencido, en singular y plural', () => {
    expect(daysText('active', 12)).toBe('Vence en 12 días')
    expect(daysText('active', 1)).toBe('Vence mañana')
    expect(daysText('active', 0)).toBe('Vence hoy')
    expect(daysText('expired', -1)).toBe('Venció ayer')
    expect(daysText('expired', -3)).toBe('Venció hace 3 días')
    expect(daysText('trial', 4)).toBe('Tu prueba termina en 4 días')
    expect(daysText('trial', 0)).toBe('Tu prueba termina hoy')
    expect(daysText('active', null)).toBeNull()
    expect(daysText('none', 5)).toBeNull()
  })
  it('sin suscripción: sin plan, sin fecha, acción "Elegir un plan"', () => {
    const s = sum(null, null)
    expect(s).toMatchObject({ planName: 'Sin plan', stateLabel: 'Sin plan', endLabel: '—', days: null, action: { kind: 'choose_plan' } })
  })
  it('la fecha se muestra DD/MM/AAAA, sin pasar por Date (sin corrimiento de zona horaria)', () => {
    expect(sum(sub('active', '2026-12-01'), 21).endLabel).toBe('01/12/2026')
    expect(sum(sub('expired', '2026-11-01'), -9).endCaption).toBe('Venció el')
  })
})

describe('acción sugerida', () => {
  it('activa y lejos del vencimiento: ver suscripción', () => expect(sum(sub('active'), 10).action).toMatchObject({ kind: 'view_subscription' }))
  it('activa y por vencer (≤ 5 días): pagar la renovación', () => expect(sum(sub('active'), 3).action).toMatchObject({ kind: 'pay', label: 'Pagar mi renovación' }))
  it('vencida o bloqueada: informar una transferencia', () => {
    expect(sum(sub('expired', '2026-10-01'), -40, [], true).action).toMatchObject({ kind: 'pay', label: 'Informar una transferencia' })
    expect(sum(sub('past_due'), 2).action.kind).toBe('pay')
  })
  it('prueba: elegir plan', () => expect(sum(sub('trial'), 3).action.kind).toBe('choose_plan'))
  it('suspendida: solo ver la suscripción (no se ofrece pagar)', () => expect(sum(sub('suspended'), 3).action.kind).toBe('view_subscription'))
  it('con transferencia en revisión: ver el estado del pago, aunque esté vencida', () => {
    const s = sum(sub('expired', '2026-10-01'), -40, [pay()], true)
    expect(s.action).toEqual({ kind: 'review_payment', label: 'Ver el estado de mi pago' })
  })
})

describe('avisos internos del dashboard', () => {
  it('una transferencia en revisión genera un aviso con el importe', () => {
    const n = sum(sub('active'), 10, [pay()]).notices
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ id: 'transfer-review', tone: 'info' })
    expect(n[0].text).toContain('$9.000')
  })
  it('varias en revisión: se agrupan', () => {
    const n = sum(sub('active'), 10, [pay({ id: 'a' }), pay({ id: 'b', amount: 1000 })]).notices
    expect(n[0].text).toMatch(/2 transferencias en revisión \(\$10\.000/)
  })
  it('la última transferencia rechazada (reciente) genera aviso de atención', () => {
    const s = sum(sub('expired', '2026-10-01'), -40, [pay({ status: 'rejected' })], true)
    expect(s.notices[0]).toMatchObject({ id: 'transfer-rejected', tone: 'warning' })
    expect(s.action).toMatchObject({ kind: 'review_payment', label: 'Revisar mi pago' })
  })
  it('un rechazo viejo (más de 30 días) o anterior a un pago aprobado no molesta', () => {
    expect(sum(sub('active'), 10, [pay({ status: 'rejected', createdAt: '2026-09-01T10:00:00Z' })]).notices).toEqual([])
    expect(sum(sub('active'), 10, [pay({ status: 'reconciled', createdAt: '2026-11-09T10:00:00Z' }), pay({ id: 'x', status: 'rejected', createdAt: '2026-11-01T10:00:00Z' })]).notices).toEqual([])
  })
  it('un pago de Mercado Pago pendiente no se presenta como transferencia', () => {
    expect(sum(sub('active'), 10, [pay({ provider: 'mercadopago' })]).notices).toEqual([])
  })
  it('sin pagos: sin avisos (estado vacío)', () => expect(sum(sub('active'), 10, []).notices).toEqual([]))
})

describe('estados de pago', () => {
  it.each([
    [{ status: 'reconciled', provider: 'transfer' }, 'Aprobado', 'success'],
    [{ status: 'pending', provider: 'transfer' }, 'En revisión', 'warning'],
    [{ status: 'pending', provider: 'mercadopago' }, 'Pendiente', 'warning'],
    [{ status: 'rejected', provider: 'transfer' }, 'Rechazado', 'neutral'],
    [{ status: 'refunded', provider: 'mercadopago' }, 'Reembolsado', 'neutral'],
  ])('%j → %s', (p, label, tone) => expect(paymentStatusInfo(p)).toMatchObject({ label, tone }))
  it('un estado que no conocemos se muestra tal cual, sin inventar', () => {
    expect(paymentStatusInfo({ status: 'chargeback', provider: 'transfer' })).toEqual({ label: 'chargeback', tone: 'neutral', hint: null })
  })
  it('medios de pago', () => {
    expect(providerLabel('transfer')).toBe('Transferencia')
    expect(providerLabel('mercadopago')).toBe('Mercado Pago')
  })
})

describe('instrucciones de transferencia (variables de entorno)', () => {
  it('sin configurar: null (no se inventa ningún dato bancario)', () => {
    expect(getTransferInstructions({})).toBeNull()
    expect(getTransferInstructions({ TRANSFER_HOLDER: 'OficioClaro SAS' })).toBeNull() // sin alias ni CBU no hay a dónde transferir
  })
  it('con alias o CBU: devuelve solo lo configurado, limpio y acotado', () => {
    const t = getTransferInstructions({ TRANSFER_ALIAS: ' oficio.claro ', TRANSFER_CBU: '0000003100012345678901', TRANSFER_NOTE: 'x'.repeat(500), TRANSFER_BANK: 'Banco\n\u0000X' })
    expect(t).toMatchObject({ alias: 'oficio.claro', cbu: '0000003100012345678901', holder: null })
    expect(t!.note).toHaveLength(300)
    expect(t!.bank).toBe('Banco  X')
  })
})
