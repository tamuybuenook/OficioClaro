import { createClient } from '@/lib/supabase/server'
import { targetEffectiveDate } from '@/lib/services/ipc'
import { IpcPanel } from '@/components/admin/ipc-panel'

export default async function IpcPage() {
  const supabase = await createClient()
  const { data: ipcs } = await supabase.from('ipc_indexes').select('*').order('published_date', { ascending: false })
  const { data: sample } = await supabase
    .from('price_items')
    .select('base_price, services(name)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const last = ipcs?.[0] ?? null
  const appliedLabel = last ? targetEffectiveDate(last.published_date).label : null

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--oc-muted)]"><a href="/admin" className="hover:underline">Admin</a> &gt; IPC</p>
          <h1 className="mt-1 text-2xl font-bold">IPC y actualizaciones</h1>
          <p className="mt-1 text-sm text-[var(--oc-muted)]">IPC publicado → actualización futura → nueva Lista Maestra</p>
        </div>
      </div>
      <IpcPanel
        ipcs={ipcs ?? []}
        appliedLabel={appliedLabel}
        sample={sample ? { name: (sample as any).services?.name ?? 'Trabajo', basePrice: sample.base_price } : null}
      />
    </div>
  )
}
