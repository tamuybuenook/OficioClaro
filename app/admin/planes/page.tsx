import { createClient } from '@/lib/supabase/server'
import { PlanesPanel } from '@/components/admin/planes-panel'

export default async function PlanesPage() {
  const supabase = await createClient()
  const { data: plans } = await supabase.from('plans').select('*').order('price')

  return (
    <div>
      <p className="text-sm text-[var(--oc-muted)]"><a href="/admin" className="hover:underline">Admin</a> &gt; Planes</p>
      <h1 className="mt-1 text-2xl font-bold">Planes</h1>
      <PlanesPanel plans={plans ?? []} />
    </div>
  )
}
