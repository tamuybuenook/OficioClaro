// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountNotices, AccountSummaryCard } from './account-summary-card'
import { buildAccountSummary, type PaymentView } from '@/lib/account-summary'

const NOW = new Date('2026-11-10T15:00:00Z').getTime()
const pay = (o: Partial<PaymentView> = {}): PaymentView => ({ id: 'p', createdAt: '2026-11-09T10:00:00Z', amount: 9000, status: 'pending', provider: 'transfer', planName: 'Profesional', reference: null, proofUrl: null, ...o })
const mk = (state: any, end: string | null, days: number | null, payments: PaymentView[] = [], locked = false) =>
  buildAccountSummary({ subscription: state ? { planName: 'Profesional', state, endDate: end } : null, access: { daysToEnd: days, locked }, payments, now: NOW })
afterEach(() => cleanup())

describe('Inicio: tarjeta de estado de cuenta', () => {
  it('activa: plan, estado, vencimiento y días restantes', () => {
    render(<AccountSummaryCard summary={mk('active', '2026-11-30', 20)} onAction={() => {}} />)
    expect(screen.getByText('Profesional')).toBeTruthy()
    expect(screen.getByText('Activa')).toBeTruthy()
    expect(screen.getByTestId('end-date').textContent).toBe('30/11/2026')
    expect(screen.getByTestId('days-left').textContent).toBe('Vence en 20 días')
  })
  it('vencida: lo dice claramente y ofrece informar una transferencia', async () => {
    const onAction = vi.fn()
    render(<AccountSummaryCard summary={mk('expired', '2026-10-01', -40, [], true)} onAction={onAction} />)
    expect(screen.getByText('Vencida')).toBeTruthy()
    expect(screen.getByText('Venció el')).toBeTruthy()
    expect(screen.getByTestId('days-left').textContent).toBe('Venció hace 40 días')
    await userEvent.click(screen.getByRole('button', { name: /Informar una transferencia/ }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })
  it('sin suscripción: sin fecha inventada', () => {
    render(<AccountSummaryCard summary={mk(null, null, null)} onAction={() => {}} />)
    expect(screen.getByTestId('end-date').textContent).toBe('—')
    expect(screen.queryByTestId('days-left')).toBeNull()
    expect(screen.getByRole('button', { name: /Elegir un plan/ })).toBeTruthy()
  })
  it('con una transferencia en revisión la acción es ver su estado', () => {
    render(<AccountSummaryCard summary={mk('active', '2026-11-30', 20, [pay()])} onAction={() => {}} />)
    expect(screen.getByRole('button', { name: /Ver el estado de mi pago/ })).toBeTruthy()
  })
})

describe('Inicio: avisos internos', () => {
  it('sin avisos no renderiza nada', () => {
    const { container } = render(<AccountNotices notices={[]} onOpen={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
  it('transferencia en revisión: aviso informativo con acceso al detalle', async () => {
    const onOpen = vi.fn()
    render(<AccountNotices notices={mk('active', '2026-11-30', 20, [pay()]).notices} onOpen={onOpen} />)
    expect(screen.getByRole('status').textContent).toMatch(/transferencia de \$9\.000 está en revisión/)
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }))
    expect(onOpen).toHaveBeenCalled()
  })
  it('transferencia rechazada: aviso de atención (alert)', () => {
    render(<AccountNotices notices={mk('expired', '2026-10-01', -40, [pay({ status: 'rejected' })], true).notices} onOpen={() => {}} />)
    expect(screen.getByRole('alert').textContent).toMatch(/fue rechazada/)
  })
})
