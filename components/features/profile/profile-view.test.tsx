// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const m = vi.hoisted(() => ({
  setUt: vi.fn(async (_n: number): Promise<any> => undefined),
  preview: vi.fn(async (): Promise<any> => ({ data: { ipcId: 'i1', ipcValue: 3.4, period: '2026-10', currentUt: 10000, newUt: 10340, customPricesCount: 2 } })),
  apply: vi.fn(async (_id: string): Promise<any> => ({ data: { new_ut: 10340, prices_updated: 2 } })),
  signOut: vi.fn(async () => {}),
}))
vi.mock('@/lib/actions/profile', () => ({ updateMyProfile: vi.fn(), updateMyPaymentDetails: vi.fn() }))
vi.mock('@/lib/actions/auth', () => ({ signOut: m.signOut }))
vi.mock('@/lib/actions/userPricing', () => ({ setMyUnitValue: m.setUt, previewMyIpcUpdate: m.preview, applyMyIpcUpdate: m.apply, getMyUtHistory: vi.fn(async () => []) }))

import { Profile } from './profile-view'
import { buildAccountSummary } from '@/lib/account-summary'
import { bindOwner, clearLocalData, write, read } from '@/lib/cache/store'

const profile = { fullName: 'Ana Pérez', phone: '1111', email: 'ana@t.com', unitValue: 10000, cuit: null, address: null, city: null, province: null }
const summary = buildAccountSummary({ subscription: { planName: 'Profesional', state: 'past_due', endDate: '2026-11-20' }, access: { daysToEnd: 10, locked: false }, payments: [] })
const setup = () => { const setView = vi.fn(); const user = userEvent.setup(); render(<Profile setView={setView} profile={profile} paymentDetails={null} summary={summary} />); return { user, setView } }

beforeEach(async () => {
  cleanup(); vi.clearAllMocks()
  m.setUt.mockImplementation(async () => undefined)
  vi.spyOn(window, 'prompt').mockImplementation(() => null)
  vi.spyOn(window, 'confirm').mockImplementation(() => false)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  await clearLocalData(); bindOwner('u1')
})
afterEach(() => cleanup())

describe('Mi perfil: secciones', () => {
  it('conserva todas las funciones: datos, cobro a clientes, clientes, oficios, catálogo, UT, histórico, IPC y cerrar sesión', () => {
    setup()
    for (const t of ['Mis datos', 'Datos de cobro a mis clientes', 'Mi suscripción a OficioClaro', 'Mi trabajo']) expect(screen.getByRole('heading', { name: t })).toBeTruthy()
    for (const n of [/Gestionar contactos/, /Administrar actividades/, /Mis artículos y servicios/, /Ver histórico de UT/, /Actualizar mi UT por IPC/, /Guardar datos$/, /Guardar datos de cobro/, /Cerrar sesión/]) expect(screen.getByRole('button', { name: n })).toBeTruthy()
    expect(screen.getByDisplayValue('Ana Pérez')).toBeTruthy()
  })
  it('separa claramente los datos de cobro a clientes de los pagos a OficioClaro', () => {
    setup()
    expect(screen.getByText(/No se usan para pagar tu suscripción a OficioClaro/)).toBeTruthy()
  })
  it('muestra el estado real de la suscripción en español (no el código interno)', () => {
    setup()
    expect(screen.getByText('Pago pendiente')).toBeTruthy()
    expect(screen.queryByText('past_due')).toBeNull()
    expect(screen.getByText(/Profesional · acceso hasta 20\/11\/2026 · Vence en 10 días/)).toBeTruthy()
  })
  it('los accesos navegan a las vistas reales', async () => {
    const { user, setView } = setup()
    await user.click(screen.getByRole('button', { name: /Ver suscripción y pagos/ })); expect(setView).toHaveBeenLastCalledWith('subscription')
    await user.click(screen.getByRole('button', { name: /Gestionar contactos/ })); expect(setView).toHaveBeenLastCalledWith('clients')
    await user.click(screen.getByRole('button', { name: /Administrar actividades/ })); expect(setView).toHaveBeenLastCalledWith('trades')
    await user.click(screen.getByRole('button', { name: /Mis artículos y servicios/ })); expect(setView).toHaveBeenLastCalledWith('my-catalog')
  })
})

describe('Mi perfil: valor de UT en pantalla (sin ventanas emergentes)', () => {
  it('edita con formato argentino (1.500,50) y confirma', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Cambiar' }))
    const input = screen.getByLabelText('Nuevo valor de tu UT')
    await user.clear(input); await user.type(input, '12.500,50')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(m.setUt).toHaveBeenCalledWith(12500.5))
    expect((await screen.findByRole('status')).textContent).toMatch(/tu UT ahora es/)
    expect(window.prompt).not.toHaveBeenCalled()
  })
  it('valor inválido: error junto al campo y no se envía', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Cambiar' }))
    const input = screen.getByLabelText('Nuevo valor de tu UT')
    for (const bad of ['0', 'abc', '-5']) { await user.clear(input); await user.type(input, bad); await user.click(screen.getByRole('button', { name: 'Guardar' })) }
    expect(screen.getByRole('alert').textContent).toMatch(/mayor que 0/)
    expect(m.setUt).not.toHaveBeenCalled()
  })
  it('error del servidor (por ejemplo, suscripción vencida) se muestra', async () => {
    m.setUt.mockImplementation(async () => ({ error: 'Tu suscripción venció.' }))
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Cambiar' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Tu suscripción venció.')
  })
  it('cancelar no guarda nada', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Cambiar' }))
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(m.setUt).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeTruthy()
  })
})

describe('Mi perfil: ajuste por IPC en pantalla', () => {
  it('muestra el cálculo, pide confirmación y aplica una sola vez', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /Actualizar mi UT por IPC/ }))
    const panel = await screen.findByRole('group', { name: 'Confirmar ajuste por IPC' })
    expect(panel.textContent).toMatch(/IPC 2026-10: 3\.4%/)
    expect(panel.textContent).toMatch(/2 precio\(s\) personalizado\(s\)/)
    expect(m.apply).not.toHaveBeenCalled() // todavía no se aplicó: falta confirmar
    await user.click(within(panel).getByRole('button', { name: 'Confirmar ajuste' }))
    await waitFor(() => expect(m.apply).toHaveBeenCalledTimes(1))
    expect(m.apply).toHaveBeenCalledWith('i1')
    expect((await screen.findByRole('status')).textContent).toMatch(/se actualizaron 2 precio/)
    expect(window.confirm).not.toHaveBeenCalled(); expect(window.alert).not.toHaveBeenCalled()
  })
  it('cancelar descarta el ajuste; un error del servidor se muestra en pantalla', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /Actualizar mi UT por IPC/ }))
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(m.apply).not.toHaveBeenCalled()
    m.preview.mockResolvedValueOnce({ error: 'Ya aplicaste el último IPC.' })
    await user.click(screen.getByRole('button', { name: /Actualizar mi UT por IPC/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('Ya aplicaste el último IPC.')
  })
})

describe('Mi perfil: cerrar sesión limpia los datos locales del dispositivo', () => {
  it('borra la caché local (memoria y disco) antes de cerrar la sesión', async () => {
    await write('customers', ['de-u1'])
    expect(await read('customers')).not.toBeNull()
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await waitFor(() => expect(m.signOut).toHaveBeenCalled())
    bindOwner('u1')
    expect(await read('customers')).toBeNull()
  })
})
