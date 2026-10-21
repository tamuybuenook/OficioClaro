// Texto del aviso de suscripción según la fase (etapa 6c). Función pura: sin base, sin red, sin reloj propio.
import type { SubscriptionPhase } from '@/lib/subscription-phase'

export type AccessView = {
  phase: SubscriptionPhase
  locked: boolean
  daysToEnd: number | null
  graceEndsOn: string | null
  endDate: string | null
  subStatus: string | null
}
export type Notice = { tone: 'info' | 'warning' | 'danger'; text: string }

/** YYYY-MM-DD -> DD/MM/YYYY (sin pasar por Date: no depende de la zona horaria). */
export function fmtDay(d: string | null): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return '—'
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}
const dias = (n: number) => (n === 1 ? '1 día' : `${n} días`)

export function accessNotice(a: AccessView): Notice | null {
  if (a.locked) {
    if (a.phase === 'suspended_admin') return { tone: 'danger', text: 'Tu cuenta está suspendida. Mientras tanto solo podés ver esta pantalla; escribinos para resolverlo.' }
    if (a.subStatus === 'trial') return { tone: 'danger', text: 'Tu prueba gratuita terminó. Elegí un plan para seguir usando OficioClaro. Tus datos están guardados y no se pierden.' }
    return { tone: 'danger', text: 'Tu suscripción venció. Regularizá el pago para volver a usar OficioClaro. Mientras tanto solo podés ver esta pantalla; tus datos están guardados.' }
  }
  switch (a.phase) {
    case 'trial_ending':
      return { tone: 'info', text: a.daysToEnd === 0 ? 'Tu prueba gratuita termina hoy. Elegí un plan para no perder el acceso.' : `Tu prueba gratuita termina en ${dias(a.daysToEnd ?? 0)} (${fmtDay(a.endDate)}). Elegí un plan para no perder el acceso.` }
    case 'payment_failed':
      return { tone: 'warning', text: `No pudimos cobrar tu renovación. Regularizá el pago antes del ${fmtDay(a.endDate)} para no interrumpir el acceso.` }
    case 'grace':
      return { tone: 'warning', text: `Tu suscripción venció el ${fmtDay(a.endDate)}. Tenés acceso hasta el ${fmtDay(a.graceEndsOn)} para regularizar el pago; después solo vas a poder ver la sección Suscripción.` }
    default:
      return null
  }
}
