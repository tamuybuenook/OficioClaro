// @vitest-environment jsdom
// Pruebas de la INTERFAZ del formulario único de presupuestos (jsdom + Testing Library).
// Las acciones del servidor se reemplazan por un "servidor" en memoria; la caché local usa IndexedDB simulada.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Concept, QuoteLine, SaveQuoteResult } from '@/lib/quotes'

const server = vi.hoisted(() => ({
  own: [] as any[], service: [] as any[], customers: [] as any[],
  saveCalls: [] as any[], saveImpl: null as null | ((i: any) => Promise<any>),
  catalogCalls: [] as any[], searchCalls: 0,
}))

vi.mock('@/lib/actions/quoteBuilder', () => ({
  searchConcepts: async ({ scope, q, page }: any) => {
    server.searchCalls++
    const all = (scope === 'own' ? server.own : server.service).filter((c: Concept) => c.name.toLowerCase().includes(q.toLowerCase()))
    return { items: all.slice((page - 1) * 20, page * 20), total: all.length, page, pageSize: 20 }
  },
  searchCustomers: async (q: string) => ({ data: server.customers.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) }),
  saveQuote: (i: any) => { server.saveCalls.push(i); return server.saveImpl!(i) },
  fetchSyncStamp: async () => ({ data: {} }),
  fetchLinkableQuotes: async () => ({ data: [] }),
  linkQuoteToJob: async () => ({ ok: true }),
}))
vi.mock('@/lib/actions/catalogItems', () => ({
  createCatalogItem: async (input: any) => {
    server.catalogCalls.push(['create', input])
    return { data: { id: 'cat-new', name: input.name, description: null, category: null, unit_label: input.unit_label, unit_price: Number(String(input.price).replace(',', '.')), is_active: true, updated_at: '' } }
  },
  updateCatalogItem: async () => { server.catalogCalls.push(['update']); return { error: 'no debería llamarse' } },
}))
vi.mock('@/lib/actions/customers', () => ({ createCustomer: async () => ({ error: 'no usado' }) }))

import { bindOwner, clearLocalData } from '@/lib/cache/store'
import { _clearDraftMemoryForTests } from '@/lib/cache/drafts'
import { QuoteEditor, type EditorInitial } from './quote-editor'

const concept = (over: Partial<Concept>): Concept => ({ kind: 'own', id: 'c1', name: 'Flete', description: null, category: 'Logística', unit: 'viaje', price: 1500, ...over })
const base: EditorInitial = { quote: null, customer: null, jobId: null, jobLabel: null, lockCustomer: false }
const okSave = async (i: any): Promise<SaveQuoteResult> => ({ data: { id: 'q-1', number: 7, total: i.lines.reduce((s: number, l: QuoteLine) => s + l.quantity * l.unitPrice, 0), created: true, linked: false } })

function setup(initial: EditorInitial = base, extra: Partial<React.ComponentProps<typeof QuoteEditor>> = {}) {
  const onSaved = vi.fn(), onClose = vi.fn()
  const user = userEvent.setup()
  const utils = render(<QuoteEditor initial={initial} onSaved={onSaved} onClose={onClose} {...extra} />)
  return { user, onSaved, onClose, ...utils }
}
const addBtn = (name: string) => screen.findByRole('button', { name: `Agregar ${name}` })

beforeEach(async () => {
  cleanup()
  await clearLocalData(); _clearDraftMemoryForTests()
  bindOwner('u1')
  Object.assign(server, { own: [concept({}), concept({ id: 'c2', name: 'Cable 2,5mm', unit: 'm', price: 800 })], service: [concept({ kind: 'service', id: 's1', name: 'Cambio de canilla', category: 'Plomería', unit: 'Trabajo', price: 25000 })], customers: [{ id: 'k1', name: 'Ana Pérez', phone: '1111', address: 'Mitre 1' }], saveCalls: [], saveImpl: okSave, catalogCalls: [], searchCalls: 0 })
})
afterEach(() => cleanup())

describe('formulario de presupuesto: búsqueda y carga', () => {
  it('busca en el catálogo propio y agrega líneas; el total se calcula', async () => {
    const { user } = setup()
    await user.click(await addBtn('Flete'))
    await user.click(await addBtn('Cable 2,5mm'))
    expect(screen.getByTestId('quote-total').textContent).toContain('2.300')
    await user.click(await addBtn('Flete')) // el mismo concepto suma cantidad, no duplica la línea
    expect(screen.getAllByLabelText(/^Descripción/)).toHaveLength(2)
    expect(screen.getByTestId('quote-total').textContent).toContain('3.800')
  })

  it('cambia a la lista de precios sin perder lo cargado', async () => {
    const { user } = setup()
    await user.click(await addBtn('Flete'))
    await user.click(screen.getByRole('tab', { name: 'Lista de precios' }))
    await user.click(await addBtn('Cambio de canilla'))
    expect(screen.getAllByLabelText(/^Descripción/)).toHaveLength(2)
    expect(screen.getByTestId('quote-total').textContent).toContain('26.500')
  })

  it('muestra estado vacío claro cuando no hay resultados', async () => {
    const { user } = setup()
    await user.type(screen.getByPlaceholderText(/Buscar en tu catálogo/), 'zzzz')
    expect(await screen.findByText(/No encontramos resultados para “zzzz”/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Crear un concepto nuevo' }).length).toBeGreaterThan(0)
  })

  it('catálogo vacío: invita a crear el primer concepto', async () => {
    server.own = []
    setup()
    expect(await screen.findByText(/Todavía no cargaste conceptos propios/)).toBeTruthy()
  })

  it('un error de búsqueda se ve y permite reintentar; no rompe el formulario', async () => {
    const mod = await import('@/lib/actions/quoteBuilder')
    const spy = vi.spyOn(mod, 'searchConcepts').mockResolvedValueOnce({ error: 'No se pudo cargar tu catálogo.' } as any)
    const { user } = setup()
    expect(await screen.findByText('No se pudo cargar tu catálogo.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await addBtn('Flete')).toBeTruthy()
    spy.mockRestore()
  })
})

describe('líneas y conceptos propios', () => {
  it('modificar precio y cantidad de una línea NO toca el catálogo', async () => {
    const { user } = setup()
    await user.click(await addBtn('Flete'))
    const price = screen.getByLabelText(/^Precio unitario/)
    await user.clear(price); await user.type(price, '2000')
    const qty = screen.getByLabelText(/^Cantidad/)
    await user.clear(qty); await user.type(qty, '3')
    expect(screen.getByTestId('quote-total').textContent).toContain('6.000')
    expect(server.catalogCalls).toHaveLength(0)
    expect(server.own[0].price).toBe(1500)
  })

  it('crea un concepto personalizado desde el presupuesto sin perder lo cargado, y lo guarda en el catálogo', async () => {
    const { user } = setup()
    await user.click(await addBtn('Flete'))
    await user.click(screen.getAllByRole('button', { name: 'Crear un concepto nuevo' })[0])
    const form = screen.getByRole('group', { name: 'Concepto nuevo' })
    await user.type(within(form).getByLabelText(/^Nombre/), 'Visita técnica')
    await user.type(within(form).getByLabelText(/^Precio unitario/), '12500')
    await user.click(within(form).getByRole('button', { name: 'Agregar al presupuesto' }))
    await waitFor(() => expect(screen.getAllByLabelText(/^Descripción/)).toHaveLength(2))
    expect(server.catalogCalls).toEqual([['create', expect.objectContaining({ name: 'Visita técnica' })]])
    expect(screen.getByTestId('quote-total').textContent).toContain('14.000')
  })

  it('concepto solo para este presupuesto (sin guardarlo en el catálogo)', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Crear un concepto nuevo' }))
    const form = screen.getByRole('group', { name: 'Concepto nuevo' })
    await user.type(within(form).getByLabelText(/^Nombre/), 'Descuento por pago contado')
    await user.type(within(form).getByLabelText(/^Precio unitario/), '500')
    await user.click(within(form).getByLabelText(/Guardarlo también/))
    await user.click(within(form).getByRole('button', { name: 'Agregar al presupuesto' }))
    expect(await screen.findByDisplayValue('Descuento por pago contado')).toBeTruthy()
    expect(server.catalogCalls).toHaveLength(0)
  })

  it('valida junto al campo: nombre y precio del concepto nuevo', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Crear un concepto nuevo' }))
    const form = screen.getByRole('group', { name: 'Concepto nuevo' })
    await user.type(within(form).getByLabelText(/^Precio unitario/), 'abc')
    await user.click(within(form).getByRole('button', { name: 'Agregar al presupuesto' }))
    expect(within(form).getByText('Escribí el nombre.')).toBeTruthy()
    expect(within(form).getByText(/Ingresá un precio válido/)).toBeTruthy()
  })

  it('quitar una línea se puede deshacer', async () => {
    const { user } = setup()
    await user.click(await addBtn('Flete'))
    await user.click(screen.getByRole('button', { name: /^Quitar Flete/ }))
    expect(screen.queryByLabelText(/^Descripción/)).toBeNull()
    await user.click(screen.getByRole('button', { name: /Deshacer/ }))
    expect(screen.getByDisplayValue('Flete')).toBeTruthy()
  })

  it('errores de línea se muestran junto al campo y no se envía nada', async () => {
    const { user } = setup()
    await user.click(await addBtn('Flete'))
    const qty = screen.getByLabelText(/^Cantidad/)
    await user.clear(qty); await user.type(qty, '0')
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    expect(await screen.findByText('La cantidad debe ser mayor que 0.')).toBeTruthy()
    expect(server.saveCalls).toHaveLength(0)
  })
})

describe('guardado: sin duplicados', () => {
  it('doble clic en Guardar envía UNA sola solicitud', async () => {
    let release!: () => void
    server.saveImpl = (i) => new Promise((res) => { release = () => res(okSave(i)) })
    const { user } = setup()
    await user.click(await addBtn('Flete'))
    const btn = screen.getByRole('button', { name: 'Guardar borrador' })
    await user.dblClick(btn)
    expect(server.saveCalls).toHaveLength(1)
    release()
    expect(await screen.findByText(/Guardado: presupuesto Nº 00007/)).toBeTruthy()
  })

  it('si falla la conexión, conserva todo y el reintento usa la MISMA clave (no duplica)', async () => {
    server.saveImpl = async () => { throw new Error('network') }
    const { user } = setup()
    await user.click(await addBtn('Flete'))
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    expect(await screen.findByText(/No se pudo guardar. Revisá tu conexión/)).toBeTruthy()
    expect(screen.getByDisplayValue('Flete')).toBeTruthy()
    server.saveImpl = okSave
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    await screen.findByText(/Guardado: presupuesto/)
    expect(server.saveCalls).toHaveLength(2)
    expect(server.saveCalls[1].requestId).toBe(server.saveCalls[0].requestId)
  })

  it('el cliente y las líneas viajan en el pedido; los totales NO (los calcula la base)', async () => {
    const { user } = setup({ ...base, customer: { id: 'k1', name: 'Ana Pérez', phone: null, address: null } })
    await user.click(await addBtn('Flete'))
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    await screen.findByText(/Guardado:/)
    const sent = server.saveCalls[0]
    expect(sent.customerId).toBe('k1')
    expect(sent.lines[0]).toMatchObject({ catalogItemId: 'c1', description: 'Flete', quantity: 1, unitPrice: 1500 })
    expect(JSON.stringify(sent)).not.toMatch(/user_id|userId|"total"/)
  })

  it('un error del servidor se muestra y no cierra el formulario', async () => {
    server.saveImpl = async () => ({ error: 'El presupuesto ya no es un borrador: no se puede modificar.' })
    const { user, onSaved } = setup()
    await user.click(await addBtn('Flete'))
    await user.click(screen.getByRole('button', { name: 'Guardar y ver presupuesto' }))
    expect(await screen.findByText(/ya no es un borrador/)).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('"Guardar y ver presupuesto" avisa a quien llama con el id guardado', async () => {
    const { user, onSaved } = setup()
    await user.click(await addBtn('Flete'))
    await user.click(screen.getByRole('button', { name: 'Guardar y ver presupuesto' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('q-1'))
  })
})

describe('borrador local: se recupera después de recargar', () => {
  it('desmontar (recarga) y volver a abrir ofrece restaurar lo no guardado', async () => {
    const first = setup()
    await first.user.click(await addBtn('Flete'))
    await first.user.type(screen.getByLabelText(/^Observaciones/), 'Pintura incluida')
    await new Promise((r) => setTimeout(r, 900)) // autoguardado (600 ms)
    first.unmount()
    _clearDraftMemoryForTests() // la memoria se pierde al recargar; queda IndexedDB

    const second = setup()
    expect(await screen.findByText(/Encontramos cambios sin guardar de este dispositivo/)).toBeTruthy()
    await second.user.click(screen.getByRole('button', { name: 'Restaurar' }))
    expect(screen.getByDisplayValue('Flete')).toBeTruthy()
    expect((screen.getByLabelText(/^Observaciones/) as HTMLTextAreaElement).value).toBe('Pintura incluida')
  })

  it('Descartar borra el borrador local', async () => {
    const first = setup()
    await first.user.click(await addBtn('Flete'))
    await new Promise((r) => setTimeout(r, 900))
    first.unmount(); _clearDraftMemoryForTests()
    const second = setup()
    await second.user.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(screen.queryByText(/Encontramos cambios/)).toBeNull()
    second.unmount()
    setup()
    await screen.findByRole('button', { name: 'Agregar Flete' })
    expect(screen.queryByText(/Encontramos cambios/)).toBeNull()
  })

  it('al guardar en el servidor, el borrador local se elimina', async () => {
    const first = setup()
    await first.user.click(await addBtn('Flete'))
    await first.user.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    await screen.findByText(/Guardado:/)
    first.unmount(); _clearDraftMemoryForTests()
    setup()
    await screen.findByRole('button', { name: 'Agregar Flete' })
    expect(screen.queryByText(/Encontramos cambios/)).toBeNull()
  })

  it('otro usuario en el mismo dispositivo no ve el borrador', async () => {
    const first = setup()
    await first.user.click(await addBtn('Flete'))
    await new Promise((r) => setTimeout(r, 900))
    first.unmount(); _clearDraftMemoryForTests()
    bindOwner('u2')
    setup()
    await screen.findByRole('button', { name: 'Agregar Flete' })
    expect(screen.queryByText(/Encontramos cambios/)).toBeNull()
  })
})

describe('cliente y trabajo de la agenda', () => {
  it('desde Clientes: el cliente queda asociado y se puede cambiar', async () => {
    setup({ ...base, customer: { id: 'k1', name: 'Ana Pérez', phone: '1111', address: 'Mitre 1' } })
    expect(screen.getByText('Ana Pérez')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeTruthy()
  })

  it('desde un trabajo con cliente: el cliente viene fijado y no se puede cambiar', async () => {
    setup({ ...base, customer: { id: 'k1', name: 'Ana Pérez', phone: null, address: null }, jobId: 'j1', jobLabel: 'Cambio de canilla', lockCustomer: true })
    expect(screen.queryByRole('button', { name: 'Cambiar' })).toBeNull()
    expect(screen.getByText(/El cliente es el del trabajo/)).toBeTruthy()
  })

  it('al guardar desde un trabajo se envía el jobId para vincularlo, y se avisa si no se pudo vincular', async () => {
    server.saveImpl = async (i) => ({ data: { id: 'q-9', number: 3, total: 1500, created: true, linked: false, linkError: 'Este trabajo ya tiene otro presupuesto vinculado.' } })
    const { user, onSaved } = setup({ ...base, jobId: 'j1', jobLabel: 'Trabajo X' })
    await user.click(await addBtn('Flete'))
    await user.click(screen.getByRole('button', { name: 'Guardar y ver presupuesto' }))
    expect(await screen.findByText(/no se pudo vincular al trabajo: Este trabajo ya tiene otro presupuesto/)).toBeTruthy()
    expect(server.saveCalls[0].jobId).toBe('j1')
    expect(onSaved).not.toHaveBeenCalled() // se queda para que el usuario lo vea
  })

  it('busca un cliente dentro del formulario (sin modal) y lo selecciona', async () => {
    const { user } = setup()
    await user.type(screen.getByPlaceholderText(/Buscar cliente/), 'ana')
    await user.click(await screen.findByRole('option', { name: /Ana Pérez/ }))
    expect(screen.getByText('Ana Pérez')).toBeTruthy()
    await user.click(await addBtn('Flete'))
    await user.click(screen.getByRole('button', { name: 'Guardar borrador' }))
    await screen.findByText(/Guardado:/)
    expect(server.saveCalls[0].customerId).toBe('k1')
  })
})

describe('caché: no repite consultas innecesarias', () => {
  it('volver a abrir el formulario reutiliza lo guardado (sin nueva consulta de la misma búsqueda)', async () => {
    const a = setup()
    await addBtn('Flete')
    const after = server.searchCalls
    a.unmount()
    setup()
    await addBtn('Flete')
    expect(server.searchCalls).toBe(after)
  })
})
