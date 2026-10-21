export type Job = {
  id: string
  name: string
  category: string
  trade: string
  unit: string
  base: number
  regional: number
  personal: number
  module: string | null
  masterUtQty: number | null
  masterUtValue: number | null
  personalUtQty: number | null
}

export type View =
  | 'home' | 'prices' | 'my-list' | 'budgets' | 'clients' | 'profile'
  | 'subscription' | 'trades' | 'agenda'

// Pedido de navegación hacia la agenda desde otras pantallas (cliente, presupuesto).
// Abrir la agenda con un pedido solo abre el formulario/trabajo: no crea registros.
export type AgendaIntent =
  | { kind: 'new'; customerId?: string | null }
  | { kind: 'from-quote'; quoteId: string }
  | { kind: 'open'; jobId: string }
