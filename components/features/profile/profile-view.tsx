'use client'

import { useState, useTransition } from 'react'
import { updateMyProfile, updateMyPaymentDetails } from '@/lib/actions/profile'
import { signOut } from '@/lib/actions/auth'
import { SignOutForm } from '@/components/local-cache-session'
import { Badge } from '@/components/ui/badge'
import { parseDecimal } from '@/lib/decimal'
import type { AccountSummary } from '@/lib/account-summary'
import { setMyUnitValue, previewMyIpcUpdate, applyMyIpcUpdate, getMyUtHistory } from '@/lib/actions/userPricing'
import { money } from '@/lib/format'
import { ActionForm } from '@/components/ui/action-form'
import { ChevronRight } from 'lucide-react'
import type { View } from '@/components/types'

type ProfileData = {
  fullName: string
  phone: string | null
  email: string
  unitValue: number
  cuit: string | null
  address: string | null
  city: string | null
  province: string | null
}
type PaymentDetails = {
  bank: string | null
  alias: string | null
  cbu: string | null
  accountHolder: string | null
  holderCuit: string | null
  mercadoPagoAlias: string | null
  notes: string | null
} | null

const inputClass = 'rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-3 py-3 text-sm text-[var(--oc-ink)] outline-none focus:border-[var(--oc-brand)]'
const labelClass = 'flex flex-col gap-1 text-xs font-semibold text-[var(--oc-muted)]'

export function Profile({ setView, profile, paymentDetails, summary }: { setView: (v: View) => void; profile: ProfileData; paymentDetails: PaymentDetails; summary: AccountSummary }) {
  const [pending, startTransition] = useTransition()
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getMyUtHistory>> | null>(null)

  async function toggleHistory() {
    if (history) { setHistory(null); return }
    setHistory(await getMyUtHistory())
  }
  const initials = profile.fullName.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('') || '·'

  // ---- Valor de UT (edición en pantalla, sin ventana emergente)
  const [editingUt, setEditingUt] = useState(false)
  const [utText, setUtText] = useState('')
  const [utMsg, setUtMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  function saveUt() {
    const next = parseDecimal(utText)
    if (!Number.isFinite(next) || next <= 0) { setUtMsg({ tone: 'error', text: 'Ingresá un valor mayor que 0 (ej.: 12500 o 12.500,50).' }); return }
    setUtMsg(null)
    startTransition(async () => {
      try {
        const res = await setMyUnitValue(next)
        if (res && 'error' in res && res.error) { setUtMsg({ tone: 'error', text: res.error }); return }
        setEditingUt(false); setUtMsg({ tone: 'ok', text: `Listo: tu UT ahora es ${money(next)}.` })
      } catch { setUtMsg({ tone: 'error', text: 'No se pudo guardar. Revisá tu conexión e intentá de nuevo.' }) }
    })
  }

  // ---- Ajuste por IPC: se muestra el cálculo y se confirma en pantalla
  type IpcPreview = { ipcId: string; ipcValue: number; period: string; currentUt: number; newUt: number; customPricesCount: number }
  const [ipc, setIpc] = useState<IpcPreview | null>(null)
  const [ipcMsg, setIpcMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  async function previewIpc() {
    setIpcMsg(null)
    try {
      const preview = await previewMyIpcUpdate()
      if ('error' in preview) { setIpcMsg({ tone: 'error', text: preview.error ?? 'No se pudo calcular el ajuste.' }); return }
      setIpc(preview.data as IpcPreview)
    } catch { setIpcMsg({ tone: 'error', text: 'No se pudo calcular el ajuste. Revisá tu conexión.' }) }
  }
  function applyIpc() {
    if (!ipc) return
    const id = ipc.ipcId
    startTransition(async () => {
      try {
        const res = await applyMyIpcUpdate(id)
        if (res && 'error' in res && res.error) { setIpcMsg({ tone: 'error', text: res.error }); return }
        setIpc(null)
        if (res?.data) setIpcMsg({ tone: 'ok', text: `Listo. Tu UT ahora es ${money(res.data.new_ut)} y se actualizaron ${res.data.prices_updated} precio(s) personalizado(s).` })
      } catch { setIpcMsg({ tone: 'error', text: 'No se pudo aplicar el ajuste. Revisá tu conexión.' }) }
    })
  }

  const card = 'rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5'
  const row = 'flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 text-left'
  const msg = (m: { tone: 'ok' | 'error'; text: string } | null) => m && <p role={m.tone === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm font-semibold ${m.tone === 'error' ? 'text-[var(--oc-coral)]' : 'text-[var(--oc-success-text)]'}`}>{m.text}</p>

  return (
    <div className="mx-auto max-w-[760px] p-5 pb-28 md:p-8">
      <p className="text-sm text-[var(--oc-muted)]">Cuenta</p>
      <h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mi perfil</h1>

      <div className="mt-6 flex items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[var(--oc-warm-chip)] text-xl font-bold text-[var(--oc-warm-text)]" aria-hidden="true">{initials}</div>
        <div className="min-w-0">
          <h2 className="truncate font-bold text-[var(--oc-ink)]">{profile.fullName}</h2>
          <p className="truncate text-sm text-[var(--oc-muted)]">{profile.email}</p>
        </div>
      </div>

      {/* 1. Mi cuenta en OficioClaro: lo que el usuario le paga a OficioClaro */}
      <section aria-labelledby="p-acct" className={`mt-6 ${card}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="p-acct" className="font-bold text-[var(--oc-ink)]">Mi suscripción a OficioClaro</h2>
            <p className="mt-1 break-words text-sm text-[var(--oc-muted)]">{summary.planName} · {summary.endCaption.toLowerCase()} {summary.endLabel}{summary.days ? ` · ${summary.days}` : ''}</p>
          </div>
          <Badge tone={summary.tone}>{summary.stateLabel}</Badge>
        </div>
        {summary.notices[0] && <p role="status" className="mt-3 rounded-xl bg-[var(--oc-surface-soft)] px-3 py-2 text-sm">{summary.notices[0].text}</p>}
        <button type="button" onClick={() => setView('subscription')} className="mt-3 flex min-h-11 items-center gap-1 text-sm font-bold text-[var(--oc-brand)]">Ver suscripción y pagos <ChevronRight className="size-4" aria-hidden="true" /></button>
      </section>

      {/* 2. Mis datos personales */}
      <ActionForm action={updateMyProfile} successMessage="Datos guardados." className={`mt-4 flex flex-col ${card}`}>
        <h2 className="font-bold text-[var(--oc-ink)]">Mis datos</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>Nombre y apellido<input name="full_name" defaultValue={profile.fullName} required className={inputClass} /></label>
          <label className={labelClass}>Teléfono<input name="phone" defaultValue={profile.phone ?? ''} className={inputClass} /></label>
          <label className={labelClass}>CUIT<input name="cuit" defaultValue={profile.cuit ?? ''} className={inputClass} /></label>
          <label className={labelClass}>Dirección<input name="address" defaultValue={profile.address ?? ''} className={inputClass} /></label>
          <label className={labelClass}>Localidad<input name="city" defaultValue={profile.city ?? ''} className={inputClass} /></label>
          <label className={labelClass}>Provincia<input name="province" defaultValue={profile.province ?? ''} className={inputClass} /></label>
        </div>
        <button type="submit" className="mt-4 min-h-11 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white">Guardar datos</button>
      </ActionForm>

      {/* 3. Cómo me pagan mis clientes (NO es el pago a OficioClaro) */}
      <ActionForm action={updateMyPaymentDetails} successMessage="Datos de cobro guardados." className={`mt-4 flex flex-col ${card}`}>
        <h2 className="font-bold text-[var(--oc-ink)]">Datos de cobro a mis clientes</h2>
        <p className="mt-1 rounded-xl bg-[var(--oc-surface-soft)] px-3 py-2 text-xs text-[var(--oc-muted)]">Son los datos que compartís con <strong>tus clientes</strong> para que te paguen a vos. No se usan para pagar tu suscripción a OficioClaro: eso se hace desde “Mi suscripción”.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>Banco<input name="bank" defaultValue={paymentDetails?.bank ?? ''} className={inputClass} /></label>
          <label className={labelClass}>Alias<input name="alias" defaultValue={paymentDetails?.alias ?? ''} className={inputClass} /></label>
          <label className={labelClass}>CBU<input name="cbu" defaultValue={paymentDetails?.cbu ?? ''} className={inputClass} /></label>
          <label className={labelClass}>Titular<input name="account_holder" defaultValue={paymentDetails?.accountHolder ?? ''} className={inputClass} /></label>
          <label className={labelClass}>CUIT del titular<input name="holder_cuit" defaultValue={paymentDetails?.holderCuit ?? ''} className={inputClass} /></label>
          <label className={labelClass}>Mercado Pago / alias<input name="mercado_pago_alias" defaultValue={paymentDetails?.mercadoPagoAlias ?? ''} className={inputClass} /></label>
        </div>
        <label className={`${labelClass} mt-3`}>Información adicional<textarea name="notes" defaultValue={paymentDetails?.notes ?? ''} className={`${inputClass} w-full`} rows={2} /></label>
        <button type="submit" className="mt-4 min-h-11 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white">Guardar datos de cobro</button>
      </ActionForm>

      {/* 4. Mi trabajo: clientes, oficios y precios */}
      <section aria-labelledby="p-work" className="mt-4">
        <h2 id="p-work" className="mb-3 font-bold text-[var(--oc-ink)]">Mi trabajo</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setView('clients')} className={row}><span><span className="block text-xs text-[var(--oc-muted)]">Mis clientes</span><span className="mt-1 block font-bold text-[var(--oc-ink)]">Gestionar contactos</span></span><ChevronRight className="size-4 text-[var(--oc-muted)]" aria-hidden="true" /></button>
          <button type="button" onClick={() => setView('trades')} className={row}><span><span className="block text-xs text-[var(--oc-muted)]">Mis oficios</span><span className="mt-1 block font-bold text-[var(--oc-ink)]">Administrar actividades</span></span><ChevronRight className="size-4 text-[var(--oc-muted)]" aria-hidden="true" /></button>
          <button type="button" onClick={() => setView('my-catalog')} className={row}><span><span className="block text-xs text-[var(--oc-muted)]">Mi catálogo</span><span className="mt-1 block font-bold text-[var(--oc-ink)]">Mis artículos y servicios</span></span><ChevronRight className="size-4 text-[var(--oc-muted)]" aria-hidden="true" /></button>
        </div>

        <div className={`mt-3 ${card}`}>
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs text-[var(--oc-muted)]">Mi valor de UT</p><p className="mt-1 font-bold text-[var(--oc-ink)]" data-testid="ut-value">{money(profile.unitValue)}{pending && '…'}</p></div>
            {!editingUt && <button type="button" onClick={() => { setEditingUt(true); setUtText(String(profile.unitValue).replace('.', ',')); setUtMsg(null) }} className="min-h-11 px-2 text-sm font-bold text-[var(--oc-brand)] underline">Cambiar</button>}
          </div>
          {editingUt && (
            <div className="mt-3 grid gap-2">
              <label className={labelClass}>Nuevo valor de tu UT<input value={utText} onChange={(e) => setUtText(e.target.value)} inputMode="decimal" className={inputClass} aria-invalid={utMsg?.tone === 'error'} /></label>
              <div className="flex gap-2"><button type="button" onClick={saveUt} disabled={pending} className="min-h-11 rounded-xl bg-[var(--oc-brand)] px-4 text-sm font-bold text-white disabled:opacity-60">Guardar</button><button type="button" onClick={() => { setEditingUt(false); setUtMsg(null) }} disabled={pending} className="min-h-11 rounded-xl border border-[var(--oc-border)] px-4 text-sm font-bold text-[var(--oc-muted)]">Cancelar</button></div>
            </div>
          )}
          {msg(utMsg)}
          <div className="mt-4 flex flex-wrap gap-4 border-t border-[var(--oc-border-soft)] pt-3">
            <button type="button" onClick={toggleHistory} className="min-h-11 text-sm font-bold text-[var(--oc-brand)] underline">{history ? 'Ocultar histórico de UT' : 'Ver histórico de UT'}</button>
            <button type="button" onClick={previewIpc} disabled={pending} className="min-h-11 text-sm font-bold text-[var(--oc-brand)] underline disabled:opacity-60">Actualizar mi UT por IPC</button>
          </div>
          {ipc && (
            <div role="group" aria-label="Confirmar ajuste por IPC" className="mt-2 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-brand-soft)] p-3 text-sm">
              <p className="font-bold text-[var(--oc-ink)]">IPC {ipc.period}: {ipc.ipcValue}%</p>
              <p className="mt-1">Tu UT{ipc.customPricesCount > 0 ? ` y ${ipc.customPricesCount} precio(s) personalizado(s)` : ''} se actualizarían {ipc.ipcValue}%. UT: {money(ipc.currentUt)} → {money(ipc.newUt)}.</p>
              <div className="mt-3 flex gap-2"><button type="button" onClick={applyIpc} disabled={pending} className="min-h-11 rounded-xl bg-[var(--oc-brand)] px-4 text-sm font-bold text-white disabled:opacity-60">Confirmar ajuste</button><button type="button" onClick={() => setIpc(null)} disabled={pending} className="min-h-11 rounded-xl border border-[var(--oc-border)] px-4 text-sm font-bold text-[var(--oc-muted)]">Cancelar</button></div>
            </div>
          )}
          {msg(ipcMsg)}
          {history && (
            <div className="mt-3 overflow-x-auto">
              {history.length === 0 ? <p className="text-sm text-[var(--oc-muted)]">Todavía no hay histórico.</p> : (
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead><tr className="text-xs text-[var(--oc-muted)]"><th className="py-1">Desde</th><th>Hasta</th><th>Valor</th><th>Observación</th></tr></thead>
                  <tbody>
                    {history.map((h: any) => (
                      <tr key={h.id} className="border-t border-[var(--oc-border-soft)]"><td className="py-2">{h.valid_from}</td><td>{h.valid_to ?? 'Vigente'}</td><td className="font-bold">{money(h.value)}</td><td className="text-[var(--oc-muted)]">{h.note ?? '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </section>

      <SignOutForm action={signOut} className="mt-6">
        <button type="submit" className="min-h-11 w-full rounded-2xl border border-[var(--oc-border)] p-3 text-sm font-bold text-[var(--oc-coral)]">Cerrar sesión</button>
      </SignOutForm>
    </div>
  )
}
