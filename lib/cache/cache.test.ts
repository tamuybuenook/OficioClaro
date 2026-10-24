// Pruebas del caché local: IndexedDB simulada (fake-indexeddb) en entorno node.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { _resetIdbForTests, idbList, idbGet, idbPut } from './idb'
import { bindOwner, clearLocalData, dedupe, getOwner, invalidate, load, peek, read, revalidate, stats, subscribe, write, _internals } from './store'
import { deleteLocalDraft, draftKey, listLocalDrafts, loadLocalDraft, saveLocalDraft, _clearDraftMemoryForTests, type LocalQuoteDraft } from './drafts'
import { acceptLocalChange, checkSync, _resetSyncForTests } from './sync'

const line = { key: 'k1', source: 'custom' as const, serviceId: null, catalogItemId: null, description: 'Flete', unitLabel: null, quantity: 1, unitPrice: 100 }
const draft = (over: Partial<LocalQuoteDraft> = {}): LocalQuoteDraft => ({ requestId: 'r', quoteId: null, customer: null, jobId: null, notes: '', lines: [line], editedAt: Date.now(), ...over })

beforeEach(async () => {
  await clearLocalData()
  _clearDraftMemoryForTests(); _resetSyncForTests()
  stats.network = stats.memoryHits = stats.diskHits = stats.deduped = 0
})

describe('caché por dispositivo (memoria + IndexedDB)', () => {
  it('guarda y recupera; tras "recargar" (se vacía solo la memoria) lee de IndexedDB', async () => {
    bindOwner('u1')
    await write('concepts:own|{"q":"a"}', [{ id: 1 }])
    _internals.memory.clear() // simula recargar la página
    const r = await read<{ id: number }[]>('concepts:own|{"q":"a"}')
    expect(r?.value).toEqual([{ id: 1 }])
    expect(r?.source).toBe('disk')
    expect(peek('concepts:own|{"q":"a"}')).not.toBeNull() // y vuelve a memoria
  })

  it('dentro del TTL NO consulta la red; vencido devuelve lo guardado y marca "no fresco"', async () => {
    bindOwner('u1')
    const fetcher = vi.fn(async () => ['x'])
    await load('k', fetcher, 60_000)
    await load('k', fetcher, 60_000)
    const again = await load('k', fetcher, 60_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(again).toMatchObject({ value: ['x'], fresh: true, source: 'memory' })
    const stale = await load('k', fetcher, -1)
    expect(stale).toMatchObject({ value: ['x'], fresh: false })
    expect(fetcher).toHaveBeenCalledTimes(1) // devolver lo viejo no consulta: lo hace revalidate()
  })

  it('consultas simultáneas iguales comparten UNA sola solicitud', async () => {
    bindOwner('u1')
    let n = 0
    const fetcher = () => new Promise<number>((res) => setTimeout(() => res(++n), 10))
    const [a, b, c] = await Promise.all([revalidate('same', fetcher), revalidate('same', fetcher), dedupe('same', fetcher)])
    expect(n).toBe(1)
    expect([a.value, b.value, c]).toEqual([1, 1, 1])
    expect(stats.deduped).toBeGreaterThanOrEqual(2)
  })

  it('un error de red no se guarda en la caché', async () => {
    bindOwner('u1')
    await expect(revalidate('boom', async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(await read('boom')).toBeNull()
  })

  it('invalidar borra memoria y disco, avisa a los suscriptores y fuerza nueva consulta', async () => {
    bindOwner('u1')
    const fetcher = vi.fn(async () => Date.now())
    await load('concepts:own|a', fetcher, 60_000)
    await load('concepts:own|b', fetcher, 60_000)
    await load('concepts:service|a', fetcher, 60_000)
    const cb = vi.fn()
    const off = subscribe('concepts:own', cb)
    await invalidate('concepts:own')
    expect(cb).toHaveBeenCalled()
    off()
    expect(await read('concepts:own|a')).toBeNull()
    expect(await read('concepts:own|b')).toBeNull()
    expect(await read('concepts:service|a')).not.toBeNull() // lo demás se conserva
    await load('concepts:own|a', fetcher, 60_000)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
})

describe('aislamiento por usuario', () => {
  it('un usuario nunca lee lo del otro, ni de memoria ni de disco', async () => {
    bindOwner('u1')
    await write('customers', ['de-u1'])
    bindOwner('u2')
    expect(await read('customers')).toBeNull()
    expect(await idbGet('cache', 'u2', 'customers')).toBeNull()
    expect(await idbGet('cache', 'u1', 'customers')).toBeNull() // al cambiar de cuenta se purgó lo del anterior
  })

  it('al cambiar de cuenta se descartan caché y borradores del usuario anterior', async () => {
    bindOwner('u1')
    await write('customers', ['de-u1'])
    await saveLocalDraft('new:-:-', draft())
    bindOwner('u2')
    await new Promise((r) => setTimeout(r, 30)) // la purga de disco es asíncrona
    expect(await idbList('cache', 'u1')).toHaveLength(0)
    expect(await idbList('drafts', 'u1')).toHaveLength(0)
  })

  it('un registro de otro dueño no se devuelve aunque la clave coincida', async () => {
    await idbPut('cache', 'u1', 'k', 'secreto')
    expect(await idbGet('cache', 'u2', 'k')).toBeNull()
  })

  it('cerrar sesión borra memoria, disco y borradores', async () => {
    bindOwner('u1')
    await write('customers', ['x'])
    await saveLocalDraft('new:-:-', draft())
    await clearLocalData()
    expect(getOwner()).toBeNull()
    expect(await idbList('cache', 'u1')).toHaveLength(0)
    expect(await idbList('drafts', 'u1')).toHaveLength(0)
    bindOwner('u1')
    expect(await read('customers')).toBeNull()
  })

  it('la pantalla de acceso conserva borradores (keepDrafts) pero borra la caché de datos', async () => {
    bindOwner('u1')
    await write('customers', ['x'])
    await saveLocalDraft('new:-:-', draft())
    await clearLocalData({ keepDrafts: true })
    expect(await idbList('cache', 'u1')).toHaveLength(0)
    expect(await idbList('drafts', 'u1')).toHaveLength(1)
  })

  it('sin usuario asociado no se guarda nada', async () => {
    bindOwner(null)
    await write('x', 1)
    expect(await idbList('cache', 'null')).toHaveLength(0)
    expect(peek('x')).toBeNull()
  })
})

describe('borradores locales de presupuestos', () => {
  it('se recuperan después de una recarga', async () => {
    bindOwner('u1')
    const k = draftKey({ customerId: 'c1', jobId: null })
    await saveLocalDraft(k, draft({ notes: 'pintura', customer: { id: 'c1', name: 'Ana', phone: null, address: null } }))
    _clearDraftMemoryForTests() // la memoria se pierde al recargar
    const back = await loadLocalDraft(k)
    expect(back?.notes).toBe('pintura')
    expect(back?.lines).toHaveLength(1)
    expect(back?.requestId).toBe('r')
  })
  it('un borrador vacío no se guarda y borra el anterior', async () => {
    bindOwner('u1')
    await saveLocalDraft('new:-:-', draft())
    await saveLocalDraft('new:-:-', draft({ lines: [], notes: ' ' }))
    expect(await loadLocalDraft('new:-:-')).toBeNull()
  })
  it('se descarta tras guardar en el servidor y cuando es muy viejo (30 días)', async () => {
    bindOwner('u1')
    await saveLocalDraft('a', draft())
    await deleteLocalDraft('a')
    expect(await loadLocalDraft('a')).toBeNull()
    await saveLocalDraft('b', draft({ editedAt: Date.now() - 31 * 24 * 3600 * 1000 }))
    expect(await loadLocalDraft('b')).toBeNull()
  })
  it('un borrador es por presupuesto o por (cliente, trabajo)', () => {
    expect(draftKey({ quoteId: 'q1', customerId: 'c' })).toBe('quote:q1')
    expect(draftKey({ customerId: 'c1', jobId: 'j1' })).toBe('new:c1:j1')
    expect(draftKey({})).toBe('new:-:-')
  })
  it('otro usuario no ve los borradores', async () => {
    bindOwner('u1')
    await saveLocalDraft('x', draft())
    bindOwner('u2')
    expect(await loadLocalDraft('x')).toBeNull()
    expect(await listLocalDrafts()).toHaveLength(0)
  })
})

describe('sincronización entre dispositivos (sello)', () => {
  const stamp = (cat: string) => ({ own_catalog: cat, own_prices: '0:', trades: '1:a', ut: '1000', master: '5:x:90' })

  it('la primera vez solo anota el sello; no invalida', async () => {
    bindOwner('u1')
    await write('concepts:own|q', [1])
    const changed = await checkSync(async () => stamp('1:a'), { force: true })
    expect(changed).toEqual([])
    expect(await read('concepts:own|q')).not.toBeNull()
  })

  it('si otro dispositivo cambió el catálogo propio, se invalida la lista local y no lo demás', async () => {
    bindOwner('u1')
    await checkSync(async () => stamp('1:a'), { force: true })
    await write('concepts:own|q', [1]); await write('concepts:service|q', [2])
    const changed = await checkSync(async () => stamp('2:b'), { force: true })
    expect(changed).toContain('concepts:own')
    expect(await read('concepts:own|q')).toBeNull()
    expect(await read('concepts:service|q')).not.toBeNull()
  })

  it('un cambio de UT o de precios invalida los conceptos de la lista de precios', async () => {
    bindOwner('u1')
    await checkSync(async () => stamp('1:a'), { force: true })
    await write('concepts:service|q', [2])
    const changed = await checkSync(async () => ({ ...stamp('1:a'), ut: '2000' }), { force: true })
    expect(changed).toContain('concepts:service')
    expect(await read('concepts:service|q')).toBeNull()
  })

  it('si el sello no cambió, no se invalida nada', async () => {
    bindOwner('u1')
    await checkSync(async () => stamp('1:a'), { force: true })
    await write('concepts:own|q', [1])
    expect(await checkSync(async () => stamp('1:a'), { force: true })).toEqual([])
    expect(await read('concepts:own|q')).not.toBeNull()
  })

  it('sin conexión (el sello falla) se conservan los datos guardados', async () => {
    bindOwner('u1')
    await write('concepts:own|q', [1])
    expect(await checkSync(async () => { throw new Error('offline') }, { force: true })).toEqual([])
    expect(await read('concepts:own|q')).not.toBeNull()
  })

  it('un cambio hecho en ESTE dispositivo no se cuenta después como ajeno', async () => {
    bindOwner('u1')
    await checkSync(async () => stamp('1:a'), { force: true })
    await acceptLocalChange(async () => stamp('2:b'))
    await write('concepts:own|q', [1])
    expect(await checkSync(async () => stamp('2:b'), { force: true })).toEqual([])
    expect(await read('concepts:own|q')).not.toBeNull()
  })

  it('respeta el intervalo mínimo entre controles (no consulta de más)', async () => {
    bindOwner('u1')
    const f = vi.fn(async () => stamp('1:a'))
    await checkSync(f, { force: true })
    await checkSync(f); await checkSync(f)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('el sello es por usuario: otro usuario arranca sin sello', async () => {
    bindOwner('u1'); await checkSync(async () => stamp('1:a'), { force: true })
    bindOwner('u2'); _resetSyncForTests()
    await write('concepts:own|q', [9])
    expect(await checkSync(async () => stamp('7:z'), { force: true })).toEqual([]) // primera vez de u2
  })
})
