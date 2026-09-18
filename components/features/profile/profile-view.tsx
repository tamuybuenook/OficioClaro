'use client'

import { useTransition } from 'react'
import { updateMyProfile, updateMyPaymentDetails } from '@/lib/actions/profile'
import { setMyUnitValue, previewMyIpcUpdate, applyMyIpcUpdate } from '@/lib/actions/userPricing'
import { money } from '@/lib/format'
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
type Subscription = { id: string; planName: string; status: string; endDate: string | null } | null

const inputClass = 'rounded-xl border border-[var(--oc-border)] bg-transparent px-3 py-3 text-sm text-[var(--oc-ink)] outline-none'

export function Profile({ setView, profile, paymentDetails, subscription }: { setView: (v: View) => void; profile: ProfileData; paymentDetails: PaymentDetails; subscription: Subscription }) {
  const [pending, startTransition] = useTransition()
  const initials = profile.fullName.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('') || '·'

  async function handleIpcUpdate() {
    const preview = await previewMyIpcUpdate()
    if ('error' in preview) { window.alert(preview.error); return }
    const { ipcId, ipcValue, period, currentUt, newUt, customPricesCount } = preview.data
    const extra = customPricesCount > 0 ? ` y ${customPricesCount} precio(s) personalizado(s)` : ''
    const ok = window.confirm(`IPC ${period}: ${ipcValue}%.\nTu UT${extra} se actualizarían ${ipcValue}%.\nUT: ${money(currentUt)} → ${money(newUt)}.\n¿Confirmás el ajuste?`)
    if (!ok) return
    startTransition(() => { applyMyIpcUpdate(ipcId, newUt, ipcValue) })
  }

  return (
    <div className="mx-auto max-w-[760px] p-5 pb-28 md:p-8">
      <p className="text-sm text-[var(--oc-muted)]">Cuenta</p>
      <h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mi perfil</h1>

      <div className="mt-7 flex items-center gap-4">
        <div className="flex size-16 items-center justify-center rounded-full bg-[#f1d9c9] text-xl font-bold text-[#744838]">{initials}</div>
        <div>
          <h2 className="font-bold text-[var(--oc-ink)]">{profile.fullName}</h2>
          <p className="text-sm text-[var(--oc-muted)]">{profile.email}</p>
        </div>
      </div>

      <form action={updateMyProfile} className="mt-6 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
        <h2 className="font-bold text-[var(--oc-ink)]">Mis datos</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input name="full_name" defaultValue={profile.fullName} required placeholder="Nombre y apellido" className={inputClass} />
          <input name="phone" defaultValue={profile.phone ?? ''} placeholder="Teléfono" className={inputClass} />
          <input name="cuit" defaultValue={profile.cuit ?? ''} placeholder="CUIT" className={inputClass} />
          <input name="address" defaultValue={profile.address ?? ''} placeholder="Dirección" className={inputClass} />
          <input name="city" defaultValue={profile.city ?? ''} placeholder="Localidad" className={inputClass} />
          <input name="province" defaultValue={profile.province ?? ''} placeholder="Provincia" className={inputClass} />
        </div>
        <button type="submit" className="mt-4 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white">Guardar datos</button>
      </form>

      <form action={updateMyPaymentDetails} className="mt-4 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
        <h2 className="font-bold text-[var(--oc-ink)]">Datos de cobro</h2>
        <p className="mt-1 text-xs text-[var(--oc-muted)]">Para compartirlos con tus clientes. No es facturación de OficioClaro.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input name="bank" defaultValue={paymentDetails?.bank ?? ''} placeholder="Banco" className={inputClass} />
          <input name="alias" defaultValue={paymentDetails?.alias ?? ''} placeholder="Alias" className={inputClass} />
          <input name="cbu" defaultValue={paymentDetails?.cbu ?? ''} placeholder="CBU" className={inputClass} />
          <input name="account_holder" defaultValue={paymentDetails?.accountHolder ?? ''} placeholder="Titular" className={inputClass} />
          <input name="holder_cuit" defaultValue={paymentDetails?.holderCuit ?? ''} placeholder="CUIT del titular" className={inputClass} />
          <input name="mercado_pago_alias" defaultValue={paymentDetails?.mercadoPagoAlias ?? ''} placeholder="Mercado Pago / alias" className={inputClass} />
        </div>
        <textarea name="notes" defaultValue={paymentDetails?.notes ?? ''} placeholder="Información adicional" className={`${inputClass} mt-3 w-full`} rows={2} />
        <button type="submit" className="mt-4 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white">Guardar datos de cobro</button>
      </form>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <button onClick={() => setView('trades')} className="flex items-center justify-between rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 text-left"><span><span className="block text-xs text-[var(--oc-muted)]">Mis oficios</span><span className="mt-1 block font-bold text-[var(--oc-ink)]">Administrar actividades</span></span><ChevronRight className="size-4 text-[var(--oc-muted)]" /></button>
        <button onClick={() => setView('subscription')} className="flex items-center justify-between rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 text-left"><span><span className="block text-xs text-[var(--oc-muted)]">Suscripción</span><span className="mt-1 block font-bold text-[var(--oc-ink)]">{subscription ? `${subscription.planName} · ${subscription.status === 'active' ? 'Activa' : subscription.status}` : 'Sin plan'}</span></span><ChevronRight className="size-4 text-[var(--oc-muted)]" /></button>
        <button onClick={() => { const value = window.prompt('Nuevo valor de tu UT', String(profile.unitValue)); if (!value) return; const next = Number(value.replace(/\D/g, '')); if (next > 0) startTransition(() => { setMyUnitValue(next) }) }} className="flex items-center justify-between rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-4 text-left"><span><span className="block text-xs text-[var(--oc-muted)]">Mi valor de UT</span><span className="mt-1 block font-bold text-[var(--oc-ink)]">{money(profile.unitValue)}{pending && '…'}</span></span><ChevronRight className="size-4 text-[var(--oc-muted)]" /></button>
        <button onClick={handleIpcUpdate} className="flex items-center justify-between rounded-2xl border border-dashed border-[var(--oc-brand)] bg-[var(--oc-brand-soft)] p-4 text-left"><span><span className="block text-xs text-[var(--oc-brand)]">Actualizar mi UT por IPC</span><span className="mt-1 block text-xs text-[#557985]">Te mostramos el ajuste antes de aplicarlo</span></span><ChevronRight className="size-4 text-[var(--oc-brand)]" /></button>
      </div>
    </div>
  )
}
