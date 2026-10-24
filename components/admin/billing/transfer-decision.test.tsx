// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const m = vi.hoisted(() => ({ calls: [] as any[], impl: null as null | ((i: any) => Promise<any>), refresh: vi.fn() }))
vi.mock('@/lib/actions/payments', () => ({ reconcilePayment: (i: any) => { m.calls.push(i); return m.impl!(i) } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }))

import { TransferDecision, type TransferFacts } from './transfer-decision'

const PID = '11111111-2222-4333-8444-555555555555'
const facts: TransferFacts = { paymentId: PID, amountLabel: '$ 9.000', reference: 'OP-123', proofUrl: 'https://ejemplo.com/c.png', userLabel: 'Ana Pérez (ana@t.com)', planLabel: 'Profesional', currentEndLabel: '26/11/2026' }
const setup = (f: Partial<TransferFacts> = {}) => { const user = userEvent.setup(); render(<TransferDecision facts={{ ...facts, ...f }} />); return user }

beforeEach(() => { cleanup(); m.calls = []; m.refresh.mockClear(); m.impl = async (i) => ({ ok: true, status: i.decision, endDate: i.decision === 'reconciled' ? '2026-12-26' : null }) })
afterEach(() => cleanup())

describe('TransferDecision', () => {
  it('muestra todo lo necesario para decidir: usuario, importe, referencia y comprobante', () => {
    setup()
    expect(screen.getByText('Ana Pérez (ana@t.com)')).toBeTruthy()
    expect(screen.getAllByText('$ 9.000').length).toBeGreaterThan(0)
    expect(screen.getByText('OP-123')).toBeTruthy()
    expect((screen.getByRole('link', { name: 'abrir comprobante' }) as HTMLAnchorElement).rel).toContain('noopener')
  })
  it('sin comprobante ni referencia lo dice claramente', () => {
    setup({ proofUrl: null, reference: null })
    expect(screen.getByText('No adjuntado')).toBeTruthy()
    expect(screen.getByText('No informada')).toBeTruthy()
  })
  it('aprobar exige confirmar que el dinero ingresó: sin tildar no se puede enviar', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Aprobar…' }))
    const confirm = screen.getByRole('button', { name: 'Confirmar aprobación' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await user.click(confirm)
    expect(m.calls).toHaveLength(0)
    await user.click(screen.getByRole('checkbox'))
    expect(confirm.disabled).toBe(false)
  })
  it('aprobación válida: llama una vez con la confirmación y muestra el nuevo vencimiento; recarga el detalle', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Aprobar…' }))
    await user.click(screen.getByRole('checkbox'))
    await user.type(screen.getByLabelText(/Nota interna/), 'Ingresó 10:32')
    await user.click(screen.getByRole('button', { name: 'Confirmar aprobación' }))
    expect(await screen.findByText('Transferencia aprobada')).toBeTruthy()
    expect(screen.getByText(/hasta el 26\/12\/2026/)).toBeTruthy()
    expect(m.calls).toEqual([{ paymentId: PID, decision: 'reconciled', notes: 'Ingresó 10:32', confirmFundsReceived: true }])
    expect(m.refresh).toHaveBeenCalledTimes(1)
  })
  it('doble clic en confirmar: una sola solicitud', async () => {
    let release!: () => void
    m.impl = (i) => new Promise((res) => { release = () => res({ ok: true, status: i.decision, endDate: '2026-12-26' }) })
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Aprobar…' }))
    await user.click(screen.getByRole('checkbox'))
    await user.dblClick(screen.getByRole('button', { name: 'Confirmar aprobación' }))
    expect(m.calls).toHaveLength(1)
    release()
    await screen.findByText('Transferencia aprobada')
    expect(m.calls).toHaveLength(1)
  })
  it('rechazar exige motivo (mínimo 5 caracteres) y lo envía', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Rechazar…' }))
    const confirm = screen.getByRole('button', { name: 'Confirmar rechazo' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await user.type(screen.getByLabelText(/Motivo del rechazo/), 'no')
    expect(screen.getByRole('alert').textContent).toMatch(/Mínimo 5/)
    expect(confirm.disabled).toBe(true)
    await user.type(screen.getByLabelText(/Motivo del rechazo/), ' figura el ingreso')
    expect(confirm.disabled).toBe(false)
    await user.click(confirm)
    expect(await screen.findByText('Transferencia rechazada')).toBeTruthy()
    expect(m.calls).toEqual([{ paymentId: PID, decision: 'rejected', notes: 'no figura el ingreso', confirmFundsReceived: false }])
    expect(screen.getByText(/la suscripción no se modificó/)).toBeTruthy()
  })
  it('si otra persona ya resolvió el pago, se muestra el motivo del servidor y se puede reintentar sin duplicar', async () => {
    m.impl = async () => ({ error: 'Ese pago ya fue resuelto.' })
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Aprobar…' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Confirmar aprobación' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Ese pago ya fue resuelto.')
    expect(screen.queryByText('Transferencia aprobada')).toBeNull()
    expect(m.refresh).not.toHaveBeenCalled()
  })
  it('error de red: mensaje claro, no se muestra como aprobado', async () => {
    m.impl = async () => { throw new Error('network') }
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Aprobar…' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Confirmar aprobación' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/verificá el estado del pago/)
    expect(screen.queryByText('Transferencia aprobada')).toBeNull()
  })
  it('Cancelar vuelve al inicio sin enviar nada', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Aprobar…' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('button', { name: 'Aprobar…' })).toBeTruthy()
    expect(m.calls).toHaveLength(0)
  })
})
