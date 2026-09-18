import { createClient } from '@/lib/supabase/server'
import { CatalogoAdmin } from '@/components/admin/catalogo-admin'

export default async function CatalogoPage() {
  const supabase = await createClient()

  const { data: trades } = await supabase.from('trades').select('id, name, slug').order('name')
  const { data: categories } = await supabase.from('categories').select('id, trade_id, name').order('name')
  const { data: services } = await supabase
    .from('services')
    .select('id, category_id, name, unit_label, ut_coefficient')
    .order('name')
  const { data: priceLists } = await supabase.from('price_lists').select('id, trade_id')
  const { data: versions } = await supabase
    .from('price_list_versions')
    .select('id, version_label, status, effective_date, reference_ut_value, price_lists(trade_id)')
    .order('effective_date', { ascending: false })

  return (
    <CatalogoAdmin
      trades={trades ?? []}
      categories={categories ?? []}
      services={services ?? []}
      versions={(versions ?? []) as any}
      priceLists={priceLists ?? []}
    />
  )
}
