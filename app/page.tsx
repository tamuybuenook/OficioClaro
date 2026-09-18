import { createClient } from '@/lib/supabase/server'
import { getMyList } from '@/lib/services/myList'
import { getMyCustomers } from '@/lib/services/customers'
import { getMySubscription } from '@/lib/services/subscriptions'
import { getMyEnabledTradeIds, getMyTradeLimit } from '@/lib/services/userTrades'
import { AppShell, type Job } from '@/components/app-shell'
import { LandingPage } from '@/components/landing/landing-page'

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const { data: plans } = await supabase.from('plans').select('*').eq('is_active', true).order('price')
    return <LandingPage plans={plans ?? []} />
  }

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('full_name, phone, unit_value, cuit, address, city, province')
    .eq('id', user?.id ?? '')
    .maybeSingle()

  const { data: paymentRow } = await supabase
    .from('payment_details')
    .select('bank, alias, cbu, account_holder, holder_cuit, mercado_pago_alias, notes')
    .eq('user_id', user?.id ?? '')
    .maybeSingle()

  const { data: allTrades } = await supabase.from('trades').select('id, name, slug').order('name')

  const [list, customers, subscription, enabledTradeIds, tradeLimit] = await Promise.all([
    getMyList(),
    getMyCustomers().catch(() => []),
    getMySubscription().catch(() => null),
    user ? getMyEnabledTradeIds(user.id) : Promise.resolve([]),
    user ? getMyTradeLimit(user.id) : Promise.resolve(0),
  ])

  const jobs: Job[] = list.map(({ service, pricing }) => ({
    id: service.id,
    name: service.name,
    category: (service as any).categories?.name ?? 'General',
    unit: service.unit_label,
    base: pricing!.basePrice,
    regional: pricing!.referencePrice,
    personal: pricing!.personalPrice,
    module: (service as any).ut_coefficient != null ? `${(service as any).ut_coefficient} UT` : null,
  }))

  const profile = {
    fullName: profileRow?.full_name || user?.email?.split('@')[0] || 'Profesional',
    phone: profileRow?.phone ?? null,
    email: user?.email ?? '',
    unitValue: profileRow?.unit_value ?? 0,
    cuit: profileRow?.cuit ?? null,
    address: profileRow?.address ?? null,
    city: profileRow?.city ?? null,
    province: profileRow?.province ?? null,
  }

  const paymentDetails = paymentRow
    ? {
        bank: paymentRow.bank,
        alias: paymentRow.alias,
        cbu: paymentRow.cbu,
        accountHolder: paymentRow.account_holder,
        holderCuit: paymentRow.holder_cuit,
        mercadoPagoAlias: paymentRow.mercado_pago_alias,
        notes: paymentRow.notes,
      }
    : null

  const trades = { all: allTrades ?? [], enabledIds: enabledTradeIds, limit: tradeLimit }

  return (
    <AppShell
      jobs={jobs}
      profile={profile}
      paymentDetails={paymentDetails}
      customers={customers ?? []}
      trades={trades}
      subscription={
        subscription
          ? { id: subscription.id, planName: (subscription as any).plans?.name ?? 'Plan', status: subscription.status, endDate: subscription.end_date }
          : null
      }
    />
  )
}
