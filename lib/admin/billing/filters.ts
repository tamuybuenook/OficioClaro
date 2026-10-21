// Parámetros de la pantalla (querystring) -> filtros validados. Todo lo que llega de la URL es no confiable.
import { CATEGORIES, type Category } from './classify'
import { arDayStartIso, arNextDayStartIso, todayAr } from './format'

export const PAGE_SIZE = 25
export const MAX_PAGE = 10_000
export type SearchParams = Record<string, string | string[] | undefined>
export type PeriodPreset = 'mes' | 'mes_anterior' | '30d' | 'anio' | 'todo' | 'custom'
const PRESETS: PeriodPreset[] = ['mes', 'mes_anterior', '30d', 'anio', 'todo', 'custom']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.toString().trim() ?? ''

export type BillingFilters = {
  page: number
  q: string
  qKind: 'none' | 'uuid' | 'period' | 'text'
  status: Category | null
  provider: 'mercadopago' | 'transfer' | null
  preset: PeriodPreset
  from: string | null     // YYYY-MM-DD (inclusive, día argentino)
  to: string | null       // YYYY-MM-DD (inclusive)
  range: { fromIso: string | null; toIso: string | null }  // [fromIso, toIso) sobre payments.created_at
  vista: 'pagos' | 'eventos'
  outcome: string | null
}

const isRealDate = (ymd: string) => { const d = new Date(`${ymd}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd }

/** Quita lo que rompe la sintaxis de filtros de PostgREST (coma, paréntesis, comodines) y acota el largo. */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%*\\"'`;:<>{}\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

function ymBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
}

export function parseBillingFilters(sp: SearchParams, now = new Date()): BillingFilters {
  const pageN = Number.parseInt(one(sp.pagina), 10)
  const page = Number.isFinite(pageN) ? Math.min(Math.max(pageN, 1), MAX_PAGE) : 1
  const q = sanitizeSearch(one(sp.q))
  const qKind: BillingFilters['qKind'] = !q ? 'none' : UUID_RE.test(q) ? 'uuid' : YM_RE.test(q) ? 'period' : 'text'
  const sRaw = one(sp.estado)
  const status = (CATEGORIES as string[]).includes(sRaw) ? (sRaw as Category) : null
  const pRaw = one(sp.proveedor)
  const provider = pRaw === 'mercadopago' || pRaw === 'transfer' ? pRaw : null
  const vista = one(sp.vista) === 'eventos' ? 'eventos' : 'pagos'
  const oRaw = one(sp.resultado)
  const outcome = /^[a-z_]{1,30}$/.test(oRaw) ? oRaw : null

  const today = todayAr(now)
  let preset: PeriodPreset = (PRESETS as string[]).includes(one(sp.periodo)) ? (one(sp.periodo) as PeriodPreset) : 'mes'
  let from: string | null = null
  let to: string | null = null
  if (preset === 'mes') { const b = ymBounds(today.slice(0, 7)); from = b.from; to = b.to }
  else if (preset === 'mes_anterior') {
    const [y, m] = today.split('-').map(Number)
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    const b = ymBounds(prev); from = b.from; to = b.to
  } else if (preset === '30d') {
    const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 29)
    from = d.toISOString().slice(0, 10); to = today
  } else if (preset === 'anio') { from = `${today.slice(0, 4)}-01-01`; to = `${today.slice(0, 4)}-12-31` }
  else if (preset === 'custom') {
    const f = one(sp.desde); const t = one(sp.hasta)
    from = YMD_RE.test(f) && isRealDate(f) ? f : null
    to = YMD_RE.test(t) && isRealDate(t) ? t : null
    if (from && to && from > to) [from, to] = [to, from]
  }
  // Una búsqueda por período (AAAA-MM) pisa el selector de fechas.
  if (qKind === 'period') { const b = ymBounds(q); from = b.from; to = b.to; preset = 'custom' }

  return {
    page, q, qKind, status, provider, preset, from, to, vista, outcome,
    range: { fromIso: from ? arDayStartIso(from) : null, toIso: to ? arNextDayStartIso(to) : null },
  }
}

/** Querystring estable para conservar filtros entre páginas (sin la página). */
export function filtersToQuery(f: BillingFilters, extra: Record<string, string | number | null> = {}): string {
  const p = new URLSearchParams()
  if (f.vista !== 'pagos') p.set('vista', f.vista)
  if (f.q && f.qKind !== 'period') p.set('q', f.q)
  if (f.qKind === 'period') p.set('q', f.q)
  if (f.status) p.set('estado', f.status)
  if (f.provider) p.set('proveedor', f.provider)
  if (f.outcome) p.set('resultado', f.outcome)
  if (f.qKind !== 'period') {
    if (f.preset !== 'mes') p.set('periodo', f.preset)
    if (f.preset === 'custom') { if (f.from) p.set('desde', f.from); if (f.to) p.set('hasta', f.to) }
  }
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
