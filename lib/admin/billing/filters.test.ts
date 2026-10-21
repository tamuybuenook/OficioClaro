import { describe, it, expect } from 'vitest'
import { parseBillingFilters, sanitizeSearch, filtersToQuery, MAX_PAGE } from './filters'

const NOW = new Date('2026-10-18T15:00:00-03:00')

describe('parseBillingFilters', () => {
  it('por defecto: mes actual en hora argentina, página 1', () => {
    const f = parseBillingFilters({}, NOW)
    expect(f).toMatchObject({ page: 1, preset: 'mes', from: '2026-10-01', to: '2026-10-31', status: null, provider: null, vista: 'pagos' })
    expect(f.range).toEqual({ fromIso: '2026-10-01T03:00:00.000Z', toIso: '2026-11-01T03:00:00.000Z' })
  })
  it('a las 23:30 del 31/10 en Argentina sigue siendo octubre (UTC ya es noviembre)', () => {
    const f = parseBillingFilters({}, new Date('2026-10-31T23:30:00-03:00'))
    expect(f.from).toBe('2026-10-01'); expect(f.to).toBe('2026-10-31')
  })
  it('mes anterior en enero cruza de año', () => {
    const f = parseBillingFilters({ periodo: 'mes_anterior' }, new Date('2027-01-10T12:00:00-03:00'))
    expect([f.from, f.to]).toEqual(['2026-12-01', '2026-12-31'])
  })
  it('últimos 30 días incluye hoy; todo = sin rango', () => {
    expect(parseBillingFilters({ periodo: '30d' }, NOW)).toMatchObject({ from: '2026-09-19', to: '2026-10-18' })
    expect(parseBillingFilters({ periodo: 'todo' }, NOW).range).toEqual({ fromIso: null, toIso: null })
  })
  it('rango personalizado: valida fechas, invierte si vienen al revés, ignora basura', () => {
    expect(parseBillingFilters({ periodo: 'custom', desde: '2026-10-10', hasta: '2026-09-01' }, NOW)).toMatchObject({ from: '2026-09-01', to: '2026-10-10' })
    expect(parseBillingFilters({ periodo: 'custom', desde: '2026-02-31', hasta: 'x' }, NOW)).toMatchObject({ from: null, to: null })
  })
  it('búsqueda por período AAAA-MM fija el rango; uuid se reconoce', () => {
    const f = parseBillingFilters({ q: '2026-02' }, NOW)
    expect([f.qKind, f.from, f.to]).toEqual(['period', '2026-02-01', '2026-02-28'])
    expect(parseBillingFilters({ q: '3F2504E0-4F89-41D3-9A0C-0305E82C3301' }, NOW).qKind).toBe('uuid')
  })
  it('estado/proveedor/vista inválidos se descartan; página acotada', () => {
    const f = parseBillingFilters({ estado: 'hack', proveedor: 'paypal', vista: 'x', pagina: '-5' }, NOW)
    expect([f.status, f.provider, f.vista, f.page]).toEqual([null, null, 'pagos', 1])
    expect(parseBillingFilters({ pagina: '99999999' }, NOW).page).toBe(MAX_PAGE)
    expect(parseBillingFilters({ estado: 'retenido', proveedor: 'transfer', pagina: '3' }, NOW)).toMatchObject({ status: 'retenido', provider: 'transfer', page: 3 })
  })
  it('sanitiza la búsqueda para no inyectar sintaxis de filtros', () => {
    expect(sanitizeSearch('a,b).or(id.eq.1%*')).not.toMatch(/[,()%*]/)
    expect(sanitizeSearch('x'.repeat(200)).length).toBe(60)
  })
  it('arma querystring conservando filtros', () => {
    const f = parseBillingFilters({ estado: 'cobrado', proveedor: 'mercadopago', periodo: 'anio' }, NOW)
    expect(filtersToQuery(f, { pagina: 2 })).toBe('?estado=cobrado&proveedor=mercadopago&periodo=anio&pagina=2')
  })
})
