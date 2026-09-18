export type Job = {
  id: string
  name: string
  category: string
  unit: string
  base: number
  regional: number
  personal: number
  module: string | null
}

export type View =
  | 'home' | 'prices' | 'my-list' | 'budgets' | 'clients' | 'profile'
  | 'subscription' | 'payments' | 'admin' | 'users' | 'lists' | 'ipc'
  | 'reconciliation' | 'trades'
