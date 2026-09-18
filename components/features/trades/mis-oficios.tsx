'use client'

import { useState, useTransition } from 'react'
import { enableTrade, disableTrade } from '@/lib/actions/userTrades'
import type { View } from '@/components/types'

export type TradesProp = { all: { id: string; name: string; slug: string }[]; enabledIds: string[]; limit: number | null }

export function MisOficios({ setView, trades }: { setView: (v: View) => void; trades: TradesProp }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const enabledSet = new Set(trades.enabledIds)
  const atLimit = trades.limit !== null && trades.enabledIds.length >= trades.limit

  function toggle(tradeId: string, isEnabled: boolean) {
    setError(null)
    startTransition(async () => {
      const res = isEnabled ? await disableTrade(tradeId) : await enableTrade(tradeId)
      if (res && 'error' in res && res.error) setError(res.error)
    })
  }

  return <div className="mx-auto max-w-[720px] p-5 pb-28 md:p-8">
    <p className="text-sm text-[var(--oc-muted)]">Cuenta</p>
    <h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mis oficios</h1>
    <p className="mt-1 text-sm text-[var(--oc-muted)]">{trades.limit === null ? 'Tu plan permite todos los oficios.' : `Tu plan permite hasta ${trades.limit} oficio(s) · tenés ${trades.enabledIds.length}.`}</p>
    {error && <p className="mt-3 rounded-xl bg-[#fdecea] p-3 text-sm font-semibold text-[var(--oc-coral)]">{error}</p>}
    <div className="mt-5 flex flex-col divide-y divide-[var(--oc-border-soft)] rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)]">
      {trades.all.map((trade) => {
        const isEnabled = enabledSet.has(trade.id)
        return <div key={trade.id} className="flex items-center justify-between px-4 py-4">
          <span className="text-sm font-semibold text-[var(--oc-ink)]">{trade.name}</span>
          {isEnabled ? (
            <button disabled={pending} onClick={() => toggle(trade.id, true)} className="rounded-lg border border-[var(--oc-border)] px-3 py-1.5 text-xs font-bold text-[var(--oc-muted)] disabled:opacity-60">✓ Activo</button>
          ) : atLimit ? (
            <button onClick={() => setView('subscription')} className="text-xs font-bold text-[var(--oc-brand)] underline">Ver planes</button>
          ) : (
            <button disabled={pending} onClick={() => toggle(trade.id, false)} className="rounded-lg bg-[var(--oc-brand)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">+ Agregar</button>
          )}
        </div>
      })}
    </div>
  </div>
}
