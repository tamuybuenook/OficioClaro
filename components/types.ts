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
}

export type View =
  | 'home' | 'prices' | 'my-list' | 'budgets' | 'clients' | 'profile'
  | 'subscription' | 'trades'
