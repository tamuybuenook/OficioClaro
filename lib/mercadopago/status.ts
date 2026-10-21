// Estados de pago de MP -> estados de payments.status (misma tabla que record_mp_payment en SQL).
export type LocalPaymentStatus = 'pending' | 'reconciled' | 'rejected' | 'refunded'

export function mapPaymentStatus(mp: string | null | undefined): LocalPaymentStatus | null {
  switch (mp) {
    case 'approved': return 'reconciled'
    case 'pending': case 'in_process': case 'authorized': case 'in_mediation': return 'pending'
    case 'rejected': case 'cancelled': return 'rejected'
    case 'refunded': case 'charged_back': return 'refunded'
    default: return null
  }
}
