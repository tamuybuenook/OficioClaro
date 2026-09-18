import { createClient } from '@/lib/supabase/server'

export async function getMyQuotes() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('quotes')
    .select('*, customers(name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getQuoteWithItems(quoteId: string) {
  const supabase = await createClient()
  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select('*, customers(name, phone)')
    .eq('id', quoteId)
    .single()
  if (quoteError) throw quoteError

  const { data: items, error: itemsError } = await supabase
    .from('quote_items')
    .select('*, services(name, unit_label)')
    .eq('quote_id', quoteId)
  if (itemsError) throw itemsError

  return { quote, items }
}
