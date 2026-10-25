import { describe, it, expect, vi, beforeEach } from 'vitest'

const OLD_ROWS = [
  { key: 'mp_hidden', value: 0, text_value: null }, { key: 'bank_holder', value: 0, text_value: 'Viejo SA' },
  { key: 'bank_cuit', value: 0, text_value: '30-71234567-8' }, { key: 'bank_cbu', value: 0, text_value: '0000003100012345678901' }, { key: 'bank_alias', value: 0, text_value: null },
]
const st = { admin: true, user: true, updates: [] as any[], audits: [] as any[], failKey: null as string | null, missingRows: false, readError: false }
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/assert-admin', () => ({
  cleanDbError: (m: string) => m,
  getAdminContext: async () => {
    if (!st.user) return { error: 'No autenticado' }
    if (!st.admin) return { error: 'Solo un administrador puede realizar esta acción.' }
    return {
      user: { id: 'adm' },
      supabase: {
        from: (t: string) => t === 'audit_logs'
          ? { insert: async (r: any) => { st.audits.push(r); return { error: null } } }
          : {
              select: () => ({ in: async () => st.readError ? { data: null, error: { message: 'column text_value does not exist' } } : { data: OLD_ROWS, error: null } }),
              update: (patch: any) => ({ eq: (_c: string, key: string) => ({ select: async () => {
                if (st.failKey === key) return { data: null, error: { message: 'boom' } }
                if (st.missingRows) return { data: [], error: null }
                st.updates.push({ key, ...patch }); return { data: [{ key }], error: null }
              } }) }),
            },
      },
    }
  },
}))

const fd = (o: Record<string, string>) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.set(k, v)); return f }
const BANK = { holder: 'OficioClaro SAS', cuit: '30712345678', cbu: '0000003100012345678901', alias: 'oficio.claro' }
beforeEach(() => Object.assign(st, { admin: true, user: true, updates: [], audits: [], failKey: null, missingRows: false, readError: false }))

describe('updateBankDetails', () => {
  it('un no-admin y un anónimo no escriben nada', async () => {
    const { updateBankDetails } = await import('./appSettings')
    st.admin = false
    expect(await updateBankDetails(fd(BANK))).toEqual({ error: expect.stringMatching(/administrador/) })
    st.admin = true; st.user = false
    expect(await updateBankDetails(fd(BANK))).toEqual({ error: 'No autenticado' })
    expect(st.updates).toEqual([]); expect(st.audits).toEqual([])
  })
  it('valida en el servidor: CBU de 21 dígitos, CUIT faltante o titular vacío no escriben', async () => {
    const { updateBankDetails } = await import('./appSettings')
    for (const bad of [{ cbu: '000000310001234567890' }, { cuit: '' }, { holder: '' }, { alias: 'x' }]) {
      expect(await updateBankDetails(fd({ ...BANK, ...bad }))).toEqual({ error: expect.any(String) })
    }
    expect(st.updates).toEqual([]); expect(st.audits).toEqual([])
  })
  it('guarda los 4 campos normalizados y audita antes/después; solo toca claves bank_*', async () => {
    const { updateBankDetails } = await import('./appSettings')
    expect(await updateBankDetails(fd(BANK))).toBeUndefined()
    expect(st.updates).toEqual([
      { key: 'bank_holder', value: 0, text_value: 'OficioClaro SAS' }, { key: 'bank_cuit', value: 0, text_value: '30-71234567-8' },
      { key: 'bank_cbu', value: 0, text_value: '0000003100012345678901' }, { key: 'bank_alias', value: 0, text_value: 'oficio.claro' },
    ])
    expect(st.audits[0]).toMatchObject({ actor_id: 'adm', entity: 'app_settings', action: 'update_bank_details', old_value: { holder: 'Viejo SA' }, new_value: { holder: 'OficioClaro SAS', alias: 'oficio.claro' } })
  })
  it('alias vacío se guarda como null', async () => {
    const { updateBankDetails } = await import('./appSettings')
    expect(await updateBankDetails(fd({ ...BANK, alias: '' }))).toBeUndefined()
    expect(st.updates.at(-1)).toEqual({ key: 'bank_alias', value: 0, text_value: null })
  })
  it('migración sin aplicar (no se puede leer o no hay filas): error claro y sin auditoría', async () => {
    const { updateBankDetails } = await import('./appSettings')
    st.readError = true
    expect(await updateBankDetails(fd(BANK))).toEqual({ error: expect.stringMatching(/migración 0036/) })
    st.readError = false; st.missingRows = true
    expect(await updateBankDetails(fd(BANK))).toEqual({ error: expect.stringMatching(/migración 0036/) })
    expect(st.audits).toEqual([])
  })
  it('si falla una escritura a mitad de camino lo informa y no audita como éxito', async () => {
    const { updateBankDetails } = await import('./appSettings')
    st.failKey = 'bank_cbu'
    expect(await updateBankDetails(fd(BANK))).toEqual({ error: expect.stringMatching(/solo una parte/) })
    expect(st.audits).toEqual([])
  })
})

describe('setMpHidden', () => {
  it('un no-admin no escribe nada', async () => {
    const { setMpHidden } = await import('./appSettings')
    st.admin = false
    expect(await setMpHidden(fd({ hidden: 'true' }))).toEqual({ error: expect.stringMatching(/administrador/) })
    expect(st.updates).toEqual([]); expect(st.audits).toEqual([])
  })
  it('valor inválido no escribe', async () => {
    const { setMpHidden } = await import('./appSettings')
    for (const v of ['1', 'si', '']) expect(await setMpHidden(fd({ hidden: v }))).toEqual({ error: 'Valor inválido.' })
    expect(await setMpHidden(new FormData())).toEqual({ error: 'Valor inválido.' })
    expect(st.updates).toEqual([])
  })
  it('oculta y vuelve a mostrar: solo escribe mp_hidden (nunca suscripciones, MP ni banco) y audita', async () => {
    const { setMpHidden } = await import('./appSettings')
    expect(await setMpHidden(fd({ hidden: 'true' }))).toBeUndefined()
    expect(await setMpHidden(fd({ hidden: 'false' }))).toBeUndefined()
    expect(st.updates).toEqual([{ key: 'mp_hidden', value: 1 }, { key: 'mp_hidden', value: 0 }])
    expect(st.audits.map((a) => a.action)).toEqual(['set_mp_hidden', 'set_mp_hidden'])
    expect(st.audits[0]).toMatchObject({ old_value: { mpHidden: false }, new_value: { mpHidden: true } })
  })
  it('migración sin aplicar: error claro', async () => {
    const { setMpHidden } = await import('./appSettings')
    st.missingRows = true
    expect(await setMpHidden(fd({ hidden: 'true' }))).toEqual({ error: expect.stringMatching(/migración 0036/) })
    expect(st.audits).toEqual([])
  })
})
