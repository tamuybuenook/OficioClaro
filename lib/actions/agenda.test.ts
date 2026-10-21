import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeDb, fakeSupabaseClient, type FakeDb } from '@/lib/testing/fake-supabase'

// Estas pruebas corren contra una base EN MEMORIA que emula las reglas de la migración 0022.
// Verifican la lógica de las acciones (vínculos, duplicados, validaciones, mensajes de error).
// El SQL real se prueba con supabase/tests/02_agenda.sql.
const ctx: { db: FakeDb; userId: string | null } = { db: createFakeDb(), userId: 'u1' }
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/services/access', () => ({ requireFullAccess: async () => null }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => fakeSupabaseClient(ctx.db, ctx.userId) }))

import {
  createAgendaJob, fetchAgenda, fetchAgendaJob, fetchJobForQuote, fetchQuoteScheduleDraft,
  setAgendaJobStatus, updateAgendaJob,
} from './agenda'
import type { JobInput } from '@/lib/agenda'

const jobInput = (over: Partial<JobInput> = {}): JobInput => ({
  customer_id: null, quote_id: null, description: 'Cambio de canilla', job_date: '2026-10-20', start_time: '09:00',
  duration_minutes: 60, address: null, notes: null, status: 'scheduled', ...over,
})

function seed() {
  return createFakeDb({
    customers: [
      { id: 'c1', user_id: 'u1', name: 'Ana Pérez', phone: '2236000001', address: 'Mitre 123' },
      { id: 'c2', user_id: 'u1', name: 'Beto Gómez', phone: null, address: null },
      { id: 'c9', user_id: 'u2', name: 'Cliente Ajeno', phone: null, address: null },
    ],
    quotes: [
      { id: 'q1', user_id: 'u1', customer_id: 'c1', number: 12, status: 'accepted', notes: 'Llevar escalera' },
      { id: 'q2', user_id: 'u1', customer_id: 'c1', number: 13, status: 'draft', notes: null },
      { id: 'q3', user_id: 'u2', customer_id: 'c9', number: 1, status: 'accepted', notes: null },
      { id: 'q4', user_id: 'u1', customer_id: null, number: 14, status: 'accepted', notes: null },
    ],
    services: [{ id: 's1', name: 'Cambio de canilla' }, { id: 's2', name: 'Destape de cañería' }],
    quote_items: [
      { id: 'i1', quote_id: 'q1', service_id: 's1', quantity: 2, unit_price: 1000, subtotal: 2000, description: 'Cambio de canilla' },
      { id: 'i2', quote_id: 'q1', service_id: 's2', quantity: 1, unit_price: 5000, subtotal: 5000, description: null },
    ],
    client_jobs: [{ id: 'j-other', user_id: 'u2', customer_id: 'c9', description: 'De otro usuario', job_date: '2026-10-20', status: 'scheduled', quote_id: null, created_at: '2026-10-01T00:00:00Z' }],
  })
}

beforeEach(() => { ctx.db = seed(); ctx.userId = 'u1' })

const myJobs = () => ctx.db.tables.client_jobs.filter((j) => j.user_id === 'u1')
const activity = () => ctx.db.tables.client_activity.map((a) => a.type)

describe('1. crear un trabajo directamente desde la agenda', () => {
  it('guarda un trabajo sin cliente ni presupuesto', async () => {
    const r = await createAgendaJob(jobInput())
    expect(r.error).toBeUndefined()
    expect(myJobs()).toHaveLength(1)
    expect(myJobs()[0]).toMatchObject({ user_id: 'u1', customer_id: null, quote_id: null, description: 'Cambio de canilla', job_date: '2026-10-20', status: 'scheduled' })
  })
  it('permite un trabajo pendiente de coordinación, sin fecha', async () => {
    const r = await createAgendaJob(jobInput({ job_date: null, start_time: null, status: 'pending' }))
    expect(r.error).toBeUndefined()
    expect(myJobs()[0].job_date).toBeNull()
  })
  it('rechaza Programado sin fecha y no guarda nada', async () => {
    const r = await createAgendaJob(jobInput({ job_date: null, start_time: null }))
    expect(r.error).toMatch(/elegí una fecha/)
    expect(myJobs()).toHaveLength(0)
  })
  it('rechaza descripción vacía y fecha imposible', async () => {
    expect((await createAgendaJob(jobInput({ description: '  ' }))).error).toMatch(/descripción/)
    expect((await createAgendaJob(jobInput({ job_date: '2026-02-31' }))).error).toMatch(/fecha/)
    expect(myJobs()).toHaveLength(0)
  })
  it('exige sesión', async () => {
    ctx.userId = null
    expect((await createAgendaJob(jobInput())).error).toBe('No autenticado')
  })
})

describe('2. crear desde la ficha de un cliente', () => {
  it('guarda el cliente elegido y deja registro en su actividad', async () => {
    const r = await createAgendaJob(jobInput({ customer_id: 'c1', address: 'Mitre 123' }))
    expect(r.error).toBeUndefined()
    expect(myJobs()[0]).toMatchObject({ customer_id: 'c1', address: 'Mitre 123' })
    expect(activity()).toEqual(['trabajo_programado'])
  })
  it('no admite un cliente de otro profesional', async () => {
    const r = await createAgendaJob(jobInput({ customer_id: 'c9' }))
    expect(r.error).toMatch(/cliente/)
    expect(myJobs()).toHaveLength(0)
  })
})

describe('3 y 4. programar desde un presupuesto aceptado y verificar vínculos', () => {
  it('leer el borrador NO crea nada y precarga cliente, descripción y observaciones', async () => {
    const r = await fetchQuoteScheduleDraft('q1')
    expect(myJobs()).toHaveLength(0)
    expect(r.data?.quote).toMatchObject({ id: 'q1', customer_id: 'c1', customer_name: 'Ana Pérez', number: 12 })
    // ítem con snapshot + ítem sin snapshot (usa el nombre del servicio como respaldo)
    expect(r.data?.prefill.description).toBe('Cambio de canilla (x2), Destape de cañería')
    expect(r.data?.prefill).toMatchObject({ address: 'Mitre 123', notes: 'Llevar escalera' })
    expect(r.data?.existing).toBeNull()
  })
  it('crea el trabajo vinculado al presupuesto y al cliente del presupuesto', async () => {
    const r = await createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1' }))
    expect(r.error).toBeUndefined()
    expect(myJobs()).toHaveLength(1)
    expect(myJobs()[0]).toMatchObject({ quote_id: 'q1', customer_id: 'c1' })
  })
  it('ignora un cliente distinto enviado desde el navegador: manda el del presupuesto', async () => {
    await createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c2' }))
    expect(myJobs()[0].customer_id).toBe('c1')
  })
  it('no cambia el estado del presupuesto', async () => {
    await createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1' }))
    expect(ctx.db.tables.quotes.find((q) => q.id === 'q1')?.status).toBe('accepted')
  })
  it('rechaza presupuestos no aceptados y ajenos', async () => {
    expect((await createAgendaJob(jobInput({ quote_id: 'q2', customer_id: 'c1' }))).error).toMatch(/aceptado/)
    expect((await fetchQuoteScheduleDraft('q2')).error).toMatch(/aceptado/)
    expect((await createAgendaJob(jobInput({ quote_id: 'q3', customer_id: 'c9' }))).error).toMatch(/presupuesto/)
    expect((await fetchQuoteScheduleDraft('q3')).error).toMatch(/No encontramos/)
    expect(myJobs()).toHaveLength(0)
  })
  it('un presupuesto sin cliente genera un trabajo sin cliente', async () => {
    await createAgendaJob(jobInput({ quote_id: 'q4', customer_id: 'c1' }))
    expect(myJobs()[0]).toMatchObject({ quote_id: 'q4', customer_id: null })
  })
})

describe('5. repetir la operación no duplica', () => {
  it('la segunda vez devuelve el trabajo existente', async () => {
    const a = await createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1' }))
    const b = await createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1', job_date: '2026-10-25' }))
    expect(b.duplicate).toBe(true)
    expect(b.data?.id).toBe(a.data?.id)
    expect(myJobs()).toHaveLength(1)
    expect(myJobs()[0].job_date).toBe('2026-10-20') // no pisa lo ya guardado
  })
  it('dos envíos simultáneos (doble toque) dejan un solo trabajo', async () => {
    const [a, b] = await Promise.all([
      createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1' })),
      createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1' })),
    ])
    expect(myJobs()).toHaveLength(1)
    expect(a.data?.id).toBe(b.data?.id)
    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1)
  })
  it('fetchQuoteScheduleDraft informa el trabajo existente (la UI lo abre en vez de crear otro)', async () => {
    const a = await createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1' }))
    expect((await fetchQuoteScheduleDraft('q1')).data?.existing?.id).toBe(a.data?.id)
    expect((await fetchJobForQuote('q1')).data?.id).toBe(a.data?.id)
  })
  it('si el trabajo se cancela, el presupuesto puede volver a programarse', async () => {
    const a = await createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1' }))
    await setAgendaJobStatus(a.data!.id, 'cancelled', 'El cliente se mudó')
    const b = await createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1', job_date: '2026-11-02' }))
    expect(b.duplicate).toBeUndefined()
    expect(myJobs()).toHaveLength(2)
    // Reactivar el viejo mientras el nuevo está activo se rechaza (un solo trabajo activo por presupuesto)
    const r = await setAgendaJobStatus(a.data!.id, 'scheduled')
    expect(r.error).toMatch(/otro trabajo activo/)
  })
})

describe('6. editar y reprogramar', () => {
  it('editar conserva id, cliente y vínculo; refresca updated_at', async () => {
    const a = await createAgendaJob(jobInput({ quote_id: 'q1', customer_id: 'c1' }))
    const before = a.data!.updated_at
    const r = await updateAgendaJob(a.data!.id, jobInput({ quote_id: null, customer_id: 'c2', description: 'Cambio de canilla y sifón', notes: 'Portón verde' }))
    expect(r.error).toBeUndefined()
    expect(myJobs()).toHaveLength(1)
    expect(myJobs()[0]).toMatchObject({ id: a.data!.id, quote_id: 'q1', customer_id: 'c1', description: 'Cambio de canilla y sifón', notes: 'Portón verde' })
    expect(myJobs()[0].updated_at > before).toBe(true)
  })
  it('cambiar fecha u hora reprograma: cuenta, registra y no duplica', async () => {
    const a = await createAgendaJob(jobInput({ customer_id: 'c1' }))
    const r = await updateAgendaJob(a.data!.id, jobInput({ customer_id: 'c1', job_date: '2026-10-22', start_time: '15:30' }))
    expect(r.data?.rescheduled_count).toBe(1)
    expect(myJobs()).toHaveLength(1)
    expect(myJobs()[0]).toMatchObject({ job_date: '2026-10-22', start_time: '15:30', description: 'Cambio de canilla' })
    expect(activity()).toEqual(['trabajo_programado', 'trabajo_reprogramado'])
    const again = await updateAgendaJob(a.data!.id, jobInput({ customer_id: 'c1', job_date: '2026-10-23', start_time: '15:30' }))
    expect(again.data?.rescheduled_count).toBe(2)
  })
  it('editar sin tocar fecha/hora no cuenta como reprogramación', async () => {
    const a = await createAgendaJob(jobInput())
    const r = await updateAgendaJob(a.data!.id, jobInput({ notes: 'Solo una nota' }))
    expect(r.data?.rescheduled_count).toBe(0)
  })
  it('ponerle fecha a un pendiente es la primera programación, no una reprogramación', async () => {
    const a = await createAgendaJob(jobInput({ job_date: null, start_time: null, status: 'pending' }))
    const r = await updateAgendaJob(a.data!.id, jobInput({ job_date: '2026-10-21', status: 'scheduled' }))
    expect(r.data).toMatchObject({ job_date: '2026-10-21', status: 'scheduled', rescheduled_count: 0 })
  })
  it('no se puede editar el trabajo de otro profesional', async () => {
    const r = await updateAgendaJob('j-other', jobInput())
    expect(r.error).toMatch(/No encontramos/)
    expect(ctx.db.tables.client_jobs.find((j) => j.id === 'j-other')?.description).toBe('De otro usuario')
  })
  it('no se puede pasar a un cliente ajeno', async () => {
    const a = await createAgendaJob(jobInput())
    expect((await updateAgendaJob(a.data!.id, jobInput({ customer_id: 'c9' }))).error).toMatch(/cliente/)
    expect(myJobs()[0].customer_id).toBeNull()
  })
})

describe('7. cambiar el estado', () => {
  it('recorre Programado → En curso → Terminado', async () => {
    const a = await createAgendaJob(jobInput({ customer_id: 'c1' }))
    expect((await setAgendaJobStatus(a.data!.id, 'in_progress')).data?.status).toBe('in_progress')
    expect((await setAgendaJobStatus(a.data!.id, 'done')).data?.status).toBe('done')
    expect(myJobs()[0].status).toBe('done')
  })
  it('cancelar guarda el motivo y conserva el trabajo; reactivar limpia el motivo', async () => {
    const a = await createAgendaJob(jobInput({ customer_id: 'c1' }))
    const c = await setAgendaJobStatus(a.data!.id, 'cancelled', '  Lluvia  ')
    expect(c.data).toMatchObject({ status: 'cancelled', cancel_reason: 'Lluvia', job_date: '2026-10-20' })
    expect(activity()).toContain('trabajo_cancelado')
    const r = await setAgendaJobStatus(a.data!.id, 'scheduled')
    expect(r.data).toMatchObject({ status: 'scheduled', cancel_reason: null })
  })
  it('no pasa a Programado/En curso sin fecha', async () => {
    const a = await createAgendaJob(jobInput({ job_date: null, start_time: null, status: 'pending' }))
    expect((await setAgendaJobStatus(a.data!.id, 'in_progress')).error).toMatch(/elegí una fecha/)
    expect(myJobs()[0].status).toBe('pending')
  })
  it('rechaza estados inventados', async () => {
    const a = await createAgendaJob(jobInput())
    expect((await setAgendaJobStatus(a.data!.id, 'borrado' as any)).error).toMatch(/estado/)
  })
})

describe('errores de guardado: nunca se informa éxito si falló', () => {
  it('un fallo de la base devuelve error y no queda nada guardado', async () => {
    ctx.db.failNextWrite = { table: 'client_jobs', error: { code: '08006', message: 'connection failure' } }
    const r = await createAgendaJob(jobInput())
    expect(r.data).toBeUndefined()
    expect(r.error).toMatch(/No se pudo guardar/)
    expect(myJobs()).toHaveLength(0)
  })
  it('sin la migración 0022 aplicada, avisa claramente y no guarda', async () => {
    ctx.db.legacySchema = true
    const r = await createAgendaJob(jobInput())
    expect(r.error).toMatch(/actualización de la base de datos/)
    expect(myJobs()).toHaveLength(0)
    expect((await fetchAgenda('2026-10-01', '2026-10-31', '2026-10-13')).error).toMatch(/actualización de la base de datos/)
  })
})

describe('consultas', () => {
  it('fetchAgenda devuelve solo los trabajos del profesional, por rango, con sin-fecha y atrasados', async () => {
    await createAgendaJob(jobInput({ description: 'En rango', job_date: '2026-10-20' }))
    await createAgendaJob(jobInput({ description: 'Fuera de rango', job_date: '2026-12-20' }))
    await createAgendaJob(jobInput({ description: 'Sin fecha', job_date: null, start_time: null, status: 'pending' }))
    await createAgendaJob(jobInput({ description: 'Atrasado', job_date: '2026-10-05' }))
    const r = await fetchAgenda('2026-10-14', '2026-10-31', '2026-10-13')
    expect(r.data?.jobs.map((j) => j.description)).toEqual(['En rango'])
    expect(r.data?.unscheduled.map((j) => j.description)).toEqual(['Sin fecha'])
    expect(r.data?.overdue.map((j) => j.description)).toEqual(['Atrasado']) // 2026-10-05 < hoy (2026-10-13) y sigue Programado
  })
  it('un trabajo de otro profesional no es visible', async () => {
    expect((await fetchAgendaJob('j-other')).error).toMatch(/No encontramos/)
    const r = await fetchAgenda('2026-10-01', '2026-10-31', '2026-10-13')
    expect(r.data?.jobs.find((j) => j.id === 'j-other')).toBeUndefined()
  })
})
