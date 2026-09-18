'use server'

import { createClient } from '@/lib/supabase/server'
import { getServicePricing } from '@/lib/services/pricing'
import { round2 } from '@/lib/services/pricing'
import { revalidatePath } from 'next/cache'

export async function createQuote(customerId: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data, error } = await supabase
    .from('quotes')
    .insert({ user_id: user.id, customer_id: customerId, total: 0 })
    .select()
    .single()
  if (error) return { error: error.message }
  revalidatePath('/presupuestos')
  return { data }
}

async function recalculateTotal(quoteId: string) {
  const supabase = await createClient()
  const { data: items } = await supabase.from('quote_items').select('subtotal').eq('quote_id', quoteId)
  const total = round2((items ?? []).reduce((sum, i) => sum + Number(i.subtotal), 0))
  await supabase.from('quotes').update({ total }).eq('id', quoteId)
}

// Agrega un ítem usando "mi precio" (personalizado/UT/referencia, sección 11) como precio unitario por defecto.
export async function addQuoteItem(quoteId: string, serviceId: string, quantity: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const pricing = await getServicePricing(serviceId, user?.id)
  if (!pricing) return { error: 'El servicio no tiene un precio vigente.' }

  const subtotal = round2(pricing.personalPrice * quantity)
  const { error } = await supabase.from('quote_items').insert({
    quote_id: quoteId,
    service_id: serviceId,
    quantity,
    unit_price: pricing.personalPrice,
    subtotal,
  })
  if (error) return { error: error.message }

  await recalculateTotal(quoteId)
  revalidatePath(`/presupuestos/${quoteId}`)
}

export async function updateQuoteItemQuantity(itemId: string, quoteId: string, quantity: number) {
  const supabase = await createClient()
  const { data: item, error: itemError } = await supabase.from('quote_items').select('unit_price').eq('id', itemId).single()
  if (itemError || !item) return { error: itemError?.message ?? 'Ítem no encontrado' }

  const subtotal = round2(item.unit_price * quantity)
  const { error } = await supabase.from('quote_items').update({ quantity, subtotal }).eq('id', itemId)
  if (error) return { error: error.message }

  await recalculateTotal(quoteId)
  revalidatePath(`/presupuestos/${quoteId}`)
}

export async function removeQuoteItem(itemId: string, quoteId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('quote_items').delete().eq('id', itemId)
  if (error) return { error: error.message }

  await recalculateTotal(quoteId)
  revalidatePath(`/presupuestos/${quoteId}`)
}

export async function deleteQuote(quoteId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('quotes').delete().eq('id', quoteId)
  if (error) return { error: error.message }
  revalidatePath('/presupuestos')
}
