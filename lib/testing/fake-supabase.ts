// SOLO PARA TESTS. Emula en memoria lo justo de supabase-js y las reglas de la migración 0022
// (constraints, índice único por presupuesto y trigger client_jobs_guard).
// Sirve para verificar la lógica de las Server Actions. NO verifica el SQL real: para eso están
// las pruebas de Postgres (supabase/tests/02_agenda.sql).

type Row = Record<string, any>
type Filter = (r: Row) => boolean
type PgErr = { code: string; message: string }

export type FakeDb = {
  tables: Record<string, Row[]>
  /** Fuerza que la próxima escritura en esa tabla falle con este error (null = apagado). */
  failNextWrite: { table: string; error: PgErr } | null
  /** Simula una base sin la migración 0022: las columnas nuevas no existen. */
  legacySchema: boolean
  seq: number
  clock: number
}

export function createFakeDb(seed: Partial<Record<string, Row[]>> = {}): FakeDb {
  return {
    tables: {
      customers: [], quotes: [], quote_items: [], services: [], client_jobs: [], client_activity: [],
      ...(seed as Record<string, Row[]>),
    },
    failNextWrite: null, legacySchema: false, seq: 0, clock: 0,
  }
}

const NEW_JOB_COLUMNS = ['start_time', 'duration_minutes', 'address', 'quote_id', 'rescheduled_count', 'cancel_reason', 'updated_at']
const STATUSES = ['pending', 'scheduled', 'in_progress', 'done', 'cancelled']

function tick(db: FakeDb) { db.clock += 1; return `2026-10-13T10:${String(db.clock).padStart(2, '0')}:00Z` }

// Reglas de la migración 0022 aplicadas a una fila de client_jobs (insert o update).
function validateJob(db: FakeDb, row: Row, op: 'insert' | 'update'): PgErr | null {
  if (!STATUSES.includes(row.status)) return { code: '23514', message: 'client_jobs_status_chk' }
  if (['scheduled', 'in_progress'].includes(row.status) && !row.job_date) return { code: '23514', message: 'client_jobs_schedule_chk' }
  if (row.start_time && !row.job_date) return { code: '23514', message: 'client_jobs_time_needs_date_chk' }
  if (row.duration_minutes != null && (row.duration_minutes < 5 || row.duration_minutes > 1440)) return { code: '23514', message: 'duration check' }

  // trigger client_jobs_guard
  if (row.customer_id) {
    const c = db.tables.customers.find((x) => x.id === row.customer_id)
    if (!c || c.user_id !== row.user_id) return { code: 'P0001', message: 'El cliente no pertenece a este profesional.' }
  }
  if (row.quote_id) {
    const q = db.tables.quotes.find((x) => x.id === row.quote_id)
    if (!q || q.user_id !== row.user_id) return { code: 'P0001', message: 'El presupuesto no pertenece a este profesional.' }
    if ((q.customer_id ?? null) !== (row.customer_id ?? null)) return { code: 'P0001', message: 'El cliente del trabajo no coincide con el del presupuesto.' }
    if (op === 'insert' && q.status !== 'accepted') return { code: 'P0001', message: 'Solo se puede programar un trabajo desde un presupuesto aceptado.' }
  }
  // índice único parcial client_jobs_one_active_per_quote
  if (row.quote_id && row.status !== 'cancelled') {
    const dup = db.tables.client_jobs.find((j) => j.id !== row.id && j.quote_id === row.quote_id && j.status !== 'cancelled')
    if (dup) return { code: '23505', message: 'duplicate key value violates unique constraint "client_jobs_one_active_per_quote"' }
  }
  return null
}

function embed(db: FakeDb, table: string, cols: string, rows: Row[]): Row[] {
  return rows.map((r) => {
    const out = { ...r }
    if (table === 'client_jobs' && cols.includes('customers(')) {
      const c = db.tables.customers.find((x) => x.id === r.customer_id)
      out.customers = c ? { id: c.id, name: c.name, phone: c.phone ?? null } : null
    }
    if (table === 'quotes' && cols.includes('customers(')) {
      const c = db.tables.customers.find((x) => x.id === r.customer_id)
      out.customers = c ? { name: c.name, address: c.address ?? null } : null
    }
    if (table === 'quote_items' && cols.includes('services(')) {
      const s = db.tables.services.find((x) => x.id === r.service_id)
      out.services = s ? { name: s.name } : null
    }
    return out
  })
}

function usesMissingColumn(db: FakeDb, table: string, payloadOrCols: Row | string | null): boolean {
  if (!db.legacySchema) return false
  const names = typeof payloadOrCols === 'string' ? payloadOrCols.split(/[,\s()]+/) : Object.keys(payloadOrCols ?? {})
  if (table === 'client_jobs') return names.some((n) => NEW_JOB_COLUMNS.includes(n))
  if (table === 'quote_items') return names.includes('description')
  return false
}

class Query implements PromiseLike<{ data: any; error: PgErr | null }> {
  private filters: Filter[] = []
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private cols = '*'
  private payload: Row | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private returning = false
  private limitN: number | null = null

  constructor(private db: FakeDb, private table: string) {}

  select(cols = '*') { if (this.op === 'select') this.cols = cols; else { this.returning = true; this.cols = cols } return this }
  insert(row: Row) { this.op = 'insert'; this.payload = row; return this }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this }
  delete() { this.op = 'delete'; return this }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this }
  is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] < v); return this }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] >= v); return this }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] <= v); return this }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this }
  order(c: string, o?: { ascending?: boolean }) { this.sortKeys.push([c, o?.ascending === false ? -1 : 1]); return this }
  private sortKeys: [string, number][] = []
  limit(n: number) { this.limitN = n; return this }
  single() { this.mode = 'single'; return this.run() }
  maybeSingle() { this.mode = 'maybe'; return this.run() }
  then<A, B>(ok?: (v: { data: any; error: PgErr | null }) => A | PromiseLike<A>, bad?: (e: any) => B | PromiseLike<B>) { return this.run().then(ok, bad) }

  private async run(): Promise<{ data: any; error: PgErr | null }> {
    const { db, table } = this
    await Promise.resolve() // cede el turno: permite probar envíos simultáneos
    const rows = db.tables[table] ?? (db.tables[table] = [])

    if (usesMissingColumn(db, table, this.op === 'select' ? this.cols : this.payload)) {
      return { data: null, error: { code: '42703', message: `column of relation "${table}" does not exist` } }
    }
    if (this.op !== 'select' && db.failNextWrite?.table === table) {
      const error = db.failNextWrite.error
      db.failNextWrite = null
      return { data: null, error }
    }

    let affected: Row[] = []
    if (this.op === 'insert') {
      const row: Row = { id: `${table}-${++db.seq}`, created_at: tick(db), ...this.payload }
      if (table === 'client_jobs') {
        Object.assign(row, { start_time: null, duration_minutes: null, address: null, quote_id: null, rescheduled_count: 0, cancel_reason: null, notes: null, customer_id: null, job_date: null, ...this.payload })
        row.updated_at = row.created_at
        const err = validateJob(db, row, 'insert')
        if (err) return { data: null, error: err }
      }
      rows.push(row)
      affected = [row]
    } else if (this.op === 'update') {
      const targets = rows.filter((r) => this.filters.every((f) => f(r)))
      const updated: Row[] = []
      for (const t of targets) {
        const next = { ...t, ...this.payload }
        if (table === 'client_jobs') {
          next.updated_at = tick(db)
          const err = validateJob(db, next, 'update')
          if (err) return { data: null, error: err }
        }
        Object.assign(t, next)
        updated.push(t)
      }
      affected = updated
    } else if (this.op === 'delete') {
      db.tables[table] = rows.filter((r) => !this.filters.every((f) => f(r)))
      return { data: null, error: null }
    } else {
      affected = rows.filter((r) => this.filters.every((f) => f(r)))
      for (const [k, dir] of [...this.sortKeys].reverse()) {
        affected = [...affected].sort((a, b) => (a[k] === b[k] ? 0 : (a[k] ?? '￿') < (b[k] ?? '￿') ? -dir : dir))
      }
      if (this.limitN != null) affected = affected.slice(0, this.limitN)
    }

    if (this.op !== 'select' && !this.returning) return { data: null, error: null }
    const out = embed(db, table, this.cols, affected).map((r) => ({ ...r }))
    if (this.mode === 'many') return { data: out, error: null }
    if (out.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
    if (out.length === 0) return this.mode === 'maybe' ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    return { data: out[0], error: null }
  }
}

/** Cliente de Supabase falso, autenticado como `userId` (null = sin sesión). */
export function fakeSupabaseClient(db: FakeDb, userId: string | null) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => new Query(db, table),
  }
}
