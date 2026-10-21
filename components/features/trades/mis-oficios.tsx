'use client'

import { useState, useTransition } from 'react'
import { confirmTrades } from '@/lib/actions/userTrades'
import type { View } from '@/components/types'

export type TradesProp = { all: { id: string; name: string; slug: string }[]; enabledIds: string[]; limit: number | null }

export function MisOficios({ setView, trades }: { setView: (v: View) => void; trades: TradesProp }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [step, setStep] = useState<0 | 1 | 2>(0) // 0 = elegir, 1 = primera confirmación, 2 = confirmación final
  const locked = trades.enabledIds.length > 0
  const noPlan = trades.limit === 0
  // Cupo para agregar: sin selección previa = todo el límite; con selección confirmada = lo que falta hasta el límite del plan vigente.
  const room = trades.limit === null ? Infinity : Math.max(0, trades.limit - trades.enabledIds.length)
  const canPick = !noPlan && (!locked || room > 0)
  const full = locked ? picked.length >= room : trades.limit !== null && picked.length >= trades.limit
  const names = trades.all.filter((t) => picked.includes(t.id)).map((t) => t.name)

  function toggle(id: string) {
    setError(null)
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : full ? p : [...p, id]))
  }

  function confirmFinal() {
    startTransition(async () => {
      const res = await confirmTrades([...trades.enabledIds, ...picked]) // selección completa: lo confirmado se conserva
      if (res && 'error' in res && res.error) { setError(res.error); setStep(0) }
      // En éxito, revalidatePath('/') recarga los oficios habilitados y la pantalla pasa a modo bloqueado.
    })
  }

  return <div className="mx-auto max-w-[720px] p-5 pb-28 md:p-8">
    <p className="text-sm text-[var(--oc-muted)]">Cuenta</p>
    <h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mis oficios</h1>
    <p className="mt-1 text-sm text-[var(--oc-muted)]">
      {locked ? (canPick ? `Tus oficios confirmados se conservan y no se pueden quitar. Tu plan te deja agregar ${room === Infinity ? 'más' : room} oficio(s).` : noPlan ? 'Tus oficios y datos se conservan. Necesitás una suscripción vigente para agregar más.' : 'Tus oficios están confirmados. Para agregar más, ampliá tu plan.') : trades.limit === null ? 'Tu plan permite todos los oficios. Elegí los tuyos y confirmá.' : `Tu plan permite hasta ${trades.limit} oficio(s). Elegí ${trades.limit === 1 ? 'el tuyo' : 'los tuyos'} y confirmá: después no se puede cambiar.`}
    </p>
    {error && <p role="alert" className="mt-3 rounded-xl bg-[var(--oc-danger-bg)] p-3 text-sm font-semibold text-[var(--oc-coral)]">{error}</p>}
    {noPlan && <button onClick={() => setView('subscription')} className="mt-3 text-sm font-bold text-[var(--oc-brand)] underline">Necesitás una suscripción activa · Ver planes</button>}

    <div className="mt-5 flex flex-col divide-y divide-[var(--oc-border-soft)] rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)]">
      {trades.all.map((trade) => {
        const isEnabled = trades.enabledIds.includes(trade.id)
        const isPicked = picked.includes(trade.id)
        return <div key={trade.id} className="flex items-center justify-between px-4 py-4">
          <span className="text-sm font-semibold text-[var(--oc-ink)]">{trade.name}</span>
          {isEnabled ? <span className="rounded-lg border border-[var(--oc-border)] px-3 py-1.5 text-xs font-bold text-[var(--oc-muted)]">✓ Activo</span> : !canPick ? null : (
            <button type="button" aria-pressed={isPicked} disabled={noPlan || pending || (!isPicked && full)} onClick={() => toggle(trade.id)} className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-40 ${isPicked ? 'border border-[var(--oc-brand)] text-[var(--oc-brand)]' : 'bg-[var(--oc-brand)] text-[var(--oc-on-brand)]'}`}>{isPicked ? '✓ Elegido' : '+ Elegir'}</button>
          )}
        </div>
      })}
    </div>

    {canPick && <button type="button" disabled={picked.length === 0 || pending} onClick={() => setStep(1)} className="mt-5 w-full rounded-xl bg-[var(--oc-coral)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{locked ? 'Agregar oficios' : 'Confirmar selección'} ({picked.length})</button>}

    {step > 0 && <div role="dialog" aria-modal="true" aria-labelledby="oficios-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--oc-surface)] p-5 shadow-xl">
        <h2 id="oficios-dialog" className="text-lg font-bold text-[var(--oc-ink)]">{step === 1 ? '¿Confirmás estos oficios?' : 'Última confirmación'}</h2>
        <p className="mt-2 text-sm text-[var(--oc-muted)]">{step === 1 ? names.join(', ') : `Vas a fijar ${names.join(', ')}. Una vez confirmados, no vas a poder cambiarlos.`}</p>
        <div className="mt-5 flex gap-3">
          <button autoFocus type="button" disabled={pending} onClick={() => setStep(0)} className="flex-1 rounded-xl border border-[var(--oc-border)] px-4 py-2.5 text-sm font-bold text-[var(--oc-muted)]">Volver</button>
          {step === 1
            ? <button type="button" onClick={() => setStep(2)} className="flex-1 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-[var(--oc-on-brand)]">Continuar</button>
            : <button type="button" disabled={pending} onClick={confirmFinal} className="flex-1 rounded-xl bg-[var(--oc-coral)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{pending ? 'Guardando…' : 'Confirmar definitivamente'}</button>}
        </div>
      </div>
    </div>}
  </div>
}
