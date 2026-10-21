// Textos de los avisos (se reutilizan en los correos de la etapa 8). Español rioplatense, sin datos sensibles.
import { fmtDay } from '@/lib/subscription-notice'
import type { NotificationKind } from './rules'

type P = Record<string, unknown> | null | undefined
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const dias = (n: number) => (n === 1 ? '1 día' : `${n} días`)

export function notificationText(kind: NotificationKind, payload: P, dueDate: string | null): string {
  const end = fmtDay(str(payload?.end_date) ?? dueDate)
  const days = num(payload?.days)
  switch (kind) {
    case 'trial_ending':
      return days === 0 ? 'Tu prueba gratuita termina hoy. Elegí un plan para no perder el acceso.' : `Tu prueba gratuita termina en ${dias(days ?? 0)} (${end}). Elegí un plan para no perder el acceso.`
    case 'auto_charge_upcoming':
      return `El ${end} se va a cobrar tu renovación automática por Mercado Pago. Si no querés renovar, cancelala antes desde Suscripción.`
    case 'renewal_not_authorized':
      return `Tu período vence el ${end} y no tenés la renovación automática activa. Pagá o autorizá la renovación para no perder el acceso.`
    case 'manual_due_soon':
      return days === 0 ? 'Tu suscripción vence hoy. Pagá para seguir usando OficioClaro.' : `Tu suscripción vence el ${end}${days !== null ? ` (en ${dias(days)})` : ''}. Pagá para seguir usando OficioClaro.`
    case 'payment_failed':
      return `No pudimos cobrar tu renovación. Regularizá el pago antes del ${end} para no interrumpir el acceso.`
    case 'grace_period':
      return `Tu suscripción venció el ${end}. Tenés acceso hasta el ${fmtDay(str(payload?.grace_ends_on) ?? dueDate)} para regularizar el pago; después solo vas a poder ver la sección Suscripción.`
    case 'suspended_nonpayment':
      return payload?.reason === 'trial_ended'
        ? 'Tu prueba gratuita terminó. Elegí un plan para seguir usando OficioClaro. Tus datos están guardados y no se pierden.'
        : 'Tu suscripción venció. Regularizá el pago para volver a usar OficioClaro. Mientras tanto solo podés ver la sección Suscripción; tus datos están guardados.'
    case 'payment_confirmed':
      return `¡Recibimos tu pago! Tu suscripción está al día hasta el ${end}.`
  }
}
