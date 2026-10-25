import { createClient } from '@/lib/supabase/server'
import { getMyList } from '@/lib/services/myList'
import { getMyCustomers } from '@/lib/services/customers'
import { getActivePlans, getMySubscription } from '@/lib/services/subscriptions'
import { getMyPayments } from '@/lib/services/payments'
import { getMpConfig } from '@/lib/mercadopago/config'
import { displayState } from '@/lib/subscription-access'
import { getMyEnabledTradeIds } from '@/lib/services/userTrades'
import { getMyAccess } from '@/lib/services/access'
import { syncNotifications } from '@/lib/notifications/sync'
import { buildBanner, type NotificationRow } from '@/lib/notifications/banner'
import { getMasterUtCurrent } from '@/lib/services/masterUt'
import { getTransferInstructions } from '@/lib/transfer-instructions'
import { PAYMENT_CONFIG_KEYS, paymentConfigFromRows, transferFromBank, type PaymentConfig } from '@/lib/settings/payment-config'
import { AppShell, type Job } from '@/components/app-shell'
import { LandingPage } from '@/components/landing/landing-page'
import { PurgeLocalCache } from '@/components/local-cache-session'

export default async function Page({ searchParams }: { searchParams: Promise<{ vista?: string; mp?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    const { data: plans } = await supabase.from('plans').select('*').eq('is_active', true).order('price')
    return <><PurgeLocalCache keepDrafts /><LandingPage plans={plans ?? []} /></>
  }

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('full_name, phone, unit_value, cuit, address, city, province, role')
    .eq('id', user?.id ?? '')
    .maybeSingle()

  const { data: paymentRow } = await supabase
    .from('payment_details')
    .select('bank, alias, cbu, account_holder, holder_cuit, mercado_pago_alias, notes')
    .eq('user_id', user?.id ?? '')
    .maybeSingle()

  const { data: allTrades } = await supabase.from('trades').select('id, name, slug').eq('is_active', true).order('name')

  // Acceso según la fase de la suscripción. Bloqueado = solo ve Suscripción/pago: no se cargan sus datos de trabajo.
  const access = await getMyAccess()
  const locked = access.locked

  let mpAvailable = false
  try { getMpConfig(); mpAvailable = true } catch { /* sin configurar: la UI ofrece solo transferencia */ }

  // Configuración editable por el admin (migración 0036). Si no se puede leer: MP visible y datos de transferencia de las variables de entorno.
  let payConfig: PaymentConfig = { bank: null, mpHidden: false }
  try { const r = await supabase.from('app_settings').select('key, value, text_value').in('key', [...PAYMENT_CONFIG_KEYS]); if (!r.error) payConfig = paymentConfigFromRows(r.data) } catch { /* valores por defecto */ }
  if (payConfig.mpHidden) mpAvailable = false // solo oculta la sección de pago; no toca suscripciones ni webhooks

  const [list, customers, subscription, enabledTradeIds, tradeLimit, masterUtValue, plans, payments, notifSync] = await Promise.all([
    locked ? Promise.resolve([]) : getMyList(),
    locked ? Promise.resolve([]) : getMyCustomers().catch(() => []),
    getMySubscription().catch((e) => { console.error('[page] no se pudo leer la suscripción:', e?.code ?? 'sin_codigo'); return null }),
    locked ? Promise.resolve([]) : getMyEnabledTradeIds(user.id),
    Promise.resolve(access.hasAccess ? access.maxTrades : 0),
    getMasterUtCurrent(),
    getActivePlans().catch(() => []),
    getMyPayments().catch((e) => { console.error('[page] no se pudo leer el historial de pagos:', e?.code ?? 'sin_codigo'); return [] }),
    // Avisos: se sincronizan con la situación real (reutiliza el acceso ya calculado). Nunca lanza.
    syncNotifications(user.id, { access }),
  ])

  // Avisos abiertos del usuario (RLS: solo los suyos). Si no se pudo sincronizar o leer, el banner usa el aviso por fase.
  let openNotifications: NotificationRow[] | null = null
  if (notifSync.ok && !locked) {
    const { data: nrows, error: nerr } = await supabase.from('notifications').select('id, kind, severity, due_date, payload').eq('user_id', user.id).eq('status', 'open')
    openNotifications = nerr ? null : ((nrows ?? []) as NotificationRow[])
  }
  const accessView = { phase: access.phase, locked, daysToEnd: access.daysToEnd, graceEndsOn: access.graceEndsOn, endDate: subscription?.end_date ?? null, subStatus: access.subStatus }

  const jobs: Job[] = list.map(({ service, pricing }) => ({
    id: service.id,
    name: service.name,
    category: (service as any).categories?.name ?? 'General',
    trade: (service as any).categories?.trades?.name ?? 'General',
    unit: service.unit_label,
    base: pricing!.basePrice,
    regional: pricing!.referencePrice,
    personal: pricing!.personalPrice,
    module: (service as any).ut_coefficient != null ? `${(service as any).ut_coefficient} UT` : null,
    masterUtQty: (service as any).ut_coefficient ?? null,
    masterUtValue,
    personalUtQty: pricing!.personalUtCoefficient,
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

  const trades = { all: locked ? [] : allTrades ?? [], enabledIds: enabledTradeIds, limit: tradeLimit }

  return (
    <AppShell
      userId={user.id}
      jobs={jobs}
      profile={profile}
      paymentDetails={paymentDetails}
      customers={customers ?? []}
      trades={trades}
      isAdminUser={profileRow?.role === 'admin'}
      subscription={
        subscription
          ? {
              id: subscription.id,
              planName: (subscription as any).plans?.name ?? 'Plan',
              status: subscription.status,
              endDate: subscription.end_date,
              state: access.phase === 'grace' ? 'past_due' : displayState(subscription),
              planId: subscription.plan_id,
              autoRenew: subscription.mp_status === 'authorized',
              autoRenewPending: subscription.mp_status === 'pending',
            }
          : null
      }
      access={accessView}
      banner={buildBanner(accessView, openNotifications)}
      billing={{
        mpAvailable,
        plans: plans.map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price), billingPeriod: p.billing_period, maxTrades: p.max_trades ?? null })),
        payments: (payments as any[])
          .filter((x) => x.mp_status !== 'creation_failed' && x.mp_status !== 'created')
          .slice(0, 30)
          .map((x) => ({ id: x.id, createdAt: x.created_at, amount: Number(x.amount), status: x.status, provider: x.provider, planName: x.plan?.name ?? x.subscriptions?.plans?.name ?? null, reference: x.reference ?? null, proofUrl: x.proof_url ?? null })),
        transfer: payConfig.bank ? transferFromBank(payConfig.bank) : getTransferInstructions(),
        mpReturn: sp.mp === 'ok' || sp.mp === 'pending' || sp.mp === 'error' ? sp.mp : null,
      }}
      initialView={sp.vista === 'suscripcion' ? 'subscription' : undefined}
    />
  )
}
