import { describe, expect, it, vi, afterEach } from 'vitest'
import { createSupabaseMpStore } from './store'

// Cliente de Supabase mínimo: cada operación devuelve el resultado indicado.
const db = (insertRes: any, updateRes: any = { error: null }) => ({
  from: () => ({
    insert: () => ({ select: () => ({ single: async () => insertRes }) }),
    update: () => ({ eq: async () => updateRes }),
  }),
}) as any
afterEach(() => vi.restoreAllMocks())

describe('persistencia de eventos: el fallo ya no es silencioso, pero no frena ni filtra datos', () => {
  it('logEvent con error: devuelve null (no frena) y registra solo operación y código', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const id = await createSupabaseMpStore(db({ data: null, error: { code: '42501', message: 'permission denied for table mp_webhook_events data_id=987' } }))
      .logEvent({ topic: 'payment', dataId: '987', requestId: 'r' })
    expect(id).toBeNull()
    const out = spy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toContain('[MP_WEBHOOK_TRACE]'); expect(out).toContain('"codigo":"42501"'); expect(out).toContain('"operacion":"logEvent"')
    expect(out).not.toContain('987'); expect(out).not.toContain('permission denied')
  })
  it('logEvent correcto: devuelve el id y no registra nada', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await createSupabaseMpStore(db({ data: { id: 'ev1' }, error: null })).logEvent({ topic: 'payment', dataId: '1', requestId: 'r' })).toBe('ev1')
    expect(spy).not.toHaveBeenCalled()
  })
  it('finishEvent con error: no lanza y registra el código', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(createSupabaseMpStore(db({ data: null, error: null }, { error: { code: 'PGRST301', message: 'x' } })).finishEvent('ev1', 'processed')).resolves.toBeUndefined()
    expect(spy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('"codigo":"PGRST301"')
  })
  it('finishEvent sin id: no hace nada', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await createSupabaseMpStore(db({ data: null, error: null })).finishEvent(null, 'x'); expect(spy).not.toHaveBeenCalled()
  })
})
