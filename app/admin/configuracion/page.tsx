import { requireAdmin } from '@/lib/auth/require-admin'
import { computeMpSettings, RECONCILE_CRON_SCHEDULE, WEBHOOK_EVENTS } from '@/lib/admin/billing/mp-settings'
import { fetchReconcileStatus } from '@/lib/admin/billing/reconcile-status'
import { formatDateTimeAr } from '@/lib/admin/billing/format'
import { Badge } from '@/components/ui/badge'
import { Crumbs, KeyValue, Mono, card } from '@/components/admin/billing/ui'
import { PolicyForm } from '@/components/admin/policy-form'
import { settingsFromRows } from '@/lib/settings/policy'

export const dynamic = 'force-dynamic'

const RECON_TONE = { ok: 'success', failed: 'warning', stale: 'warning', never: 'neutral', disabled: 'neutral' } as const
const RECON_LABEL = { ok: 'Última ejecución correcta', failed: 'Última ejecución fallida', stale: 'Atrasada', never: 'Sin ejecuciones registradas', disabled: 'Deshabilitada' } as const

export default async function ConfiguracionPage() {
  const { supabase } = await requireAdmin()
  const s = computeMpSettings()
  let recon: Awaited<ReturnType<typeof fetchReconcileStatus>> | null = null
  let reconError = false
  try { recon = await fetchReconcileStatus(supabase, s.cronSecretPresent) } catch { reconError = true }

  let policyRows: unknown = null
  try { policyRows = (await supabase.from('app_settings').select('key, value')).data } catch { /* valores iniciales */ }
  const policy = settingsFromRows(policyRows)

  return (
    <div className="max-w-4xl">
      <Crumbs items={[{ href: '/admin', label: 'Admin' }, { label: 'Configuración' }]} />
      <h1 className="mt-1 text-2xl font-bold">Configuración</h1>

      <h2 className="mt-6 text-lg font-bold">Política de suscripciones</h2>
      <p className="mt-1 text-xs text-[var(--oc-muted)]">Valores iniciales: aviso 5 días, gracia 5 días. La duración de la prueba se edita por plan en Planes. Los avisos por email salen con el cron diario, por lo que pueden demorar hasta ~24 h.</p>
      <div className={`${card} mt-4 p-5`}><PolicyForm noticeDays={policy.noticeDays} graceDays={policy.graceDays} /></div>

      <h2 className="mt-8 text-lg font-bold">Mercado Pago</h2>
      <p className="mt-1 text-xs text-[var(--oc-muted)]">Diagnóstico de solo lectura. Nunca se muestran tokens ni secretos y no se cargan desde acá: las credenciales se configuran en Vercel (guía en docs/VERCEL_MERCADOPAGO.md). Que la configuración esté completa no significa que la integración esté validada contra Mercado Pago.</p>

      <div className={`${card} mt-4 p-5`}>
        <h3 className="mb-4 font-bold">Entorno</h3>
        <KeyValue rows={[
          ['Entorno detectado (MP_ENV)', s.env === 'test' ? <Badge key="e" tone="blue">Prueba</Badge> : s.env === 'production' ? <Badge key="e" tone="warning">Producción (cobros reales)</Badge> : s.env === 'invalid' ? <Badge key="e" tone="warning">Valor inválido</Badge> : <Badge key="e" tone="neutral">No definido</Badge>],
          ['Entorno de Vercel (VERCEL_ENV)', s.vercelEnv ?? 'No detectado (local)'],
          ['Coherencia MP_ENV ↔ Vercel', <Badge key="c" tone={s.coherence.state === 'ok' ? 'success' : s.coherence.state === 'mismatch' ? 'warning' : 'neutral'}>{s.coherence.state === 'ok' ? 'Coherente' : s.coherence.state === 'mismatch' ? 'Incoherente' : 'No verificable'}</Badge>],
          ['Detalle', s.coherence.message],
          ['Configuración operativa', s.ready ? <Badge key="r" tone="success">Completa y coherente</Badge> : <Badge key="r" tone="warning">Incompleta o incoherente</Badge>],
        ]} />
        {s.configError && <p className="mt-3 text-xs text-[var(--oc-warning-text)]">{s.configError}</p>}
      </div>

      <div className={`${card} mt-4 p-5`}>
        <h3 className="mb-3 font-bold">Variables de entorno (solo presencia)</h3>
        <ul className="flex flex-col gap-2 text-sm">
          {s.vars.map((v) => (
            <li key={v.name} className="flex flex-wrap items-center gap-3 border-b border-[var(--oc-border-soft)] pb-2 last:border-0">
              <Mono>{v.name}</Mono>
              <Badge tone={v.present ? 'success' : v.required ? 'warning' : 'neutral'}>{v.present ? 'Presente' : v.required ? 'Ausente' : 'Ausente (opcional)'}</Badge>
              <span className="text-xs text-[var(--oc-muted)]">{v.purpose}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={`${card} mt-4 p-5`}>
        <h3 className="mb-4 font-bold">URL pública y webhook</h3>
        <KeyValue rows={[
          ['URL pública (APP_URL)', s.appUrl.value ? <Mono key="a">{s.appUrl.value}</Mono> : 'No definida'],
          ['URL del webhook a registrar en Mercado Pago', s.webhookUrl ? <Mono key="w">{s.webhookUrl}</Mono> : 'No disponible hasta definir una APP_URL válida'],
        ]} />
        {s.appUrl.issues.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-[var(--oc-warning-text)]">{s.appUrl.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        <p className="mt-4 text-sm font-semibold">Eventos que deben activarse en el panel de Webhooks</p>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {WEBHOOK_EVENTS.map((e) => <li key={e.topic}><span className="font-medium">{e.topic}</span> <span className="text-xs text-[var(--oc-muted)]">— {e.why}</span></li>)}
        </ul>
        <p className="mt-3 text-xs text-[var(--oc-muted)]">Registrar el webhook en modo prueba para Preview y en modo producción para Production, cada uno con su propia clave secreta.</p>
      </div>

      <div className={`${card} mt-4 p-5`}>
        <h3 className="mb-4 font-bold">Conciliación periódica</h3>
        {reconError || !recon ? <p className="text-sm text-[var(--oc-warning-text)]">No se pudo leer el registro de ejecuciones.</p> : (
          <>
            <p className="mb-3"><Badge tone={RECON_TONE[recon.state]}>{RECON_LABEL[recon.state]}</Badge></p>
            <p className="mb-4 text-sm">{recon.message}</p>
            <KeyValue rows={[
              ['Programación declarada en vercel.json', <Mono key="c">{RECONCILE_CRON_SCHEDULE} (UTC, diaria)</Mono>],
              ['Ruta', <Mono key="r">{s.reconcileUrl ?? '/api/mercadopago/reconcile'}</Mono>],
              ['Último registro', recon.last ? `${formatDateTimeAr(recon.last.created_at)} · ${recon.last.action === 'mp_reconcile_run' ? 'correcto' : 'fallido'}` : '—'],
              ['Última ejecución correcta', recon.lastSuccess ? formatDateTimeAr(recon.lastSuccess.created_at) : '—'],
              ['Pagos revisados / procesados / con error (última correcta)', recon.lastSuccess?.new_value?.payments ? `${recon.lastSuccess.new_value.payments.checked} / ${recon.lastSuccess.new_value.payments.processed} / ${recon.lastSuccess.new_value.payments.errors}` : '—'],
            ]} />
          </>
        )}
        <p className="mt-3 text-xs text-[var(--oc-muted)]">Vercel ejecuta los cron solo en el despliegue de Production. El plan Hobby admite una ejecución por día con precisión de ±59 min; con Pro se puede subir la frecuencia. Pasos y límites: docs/VERCEL_MERCADOPAGO.md.</p>
      </div>
    </div>
  )
}
