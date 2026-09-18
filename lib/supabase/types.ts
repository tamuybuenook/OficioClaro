// Tipado manual mínimo del esquema (0001_schema.sql).
// Reemplazar por `supabase gen types typescript` apenas exista el proyecto real.

export type ProfileRole = 'user' | 'admin'
export type VersionStatus = 'draft' | 'published'
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
export type PaymentStatus = 'pending' | 'reconciled' | 'rejected'
export type PaymentProvider = 'transfer' | 'mercadopago'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          phone: string | null
          role: ProfileRole
          region_id: string | null
          unit_value: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string }
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
      }
      regions: {
        Row: { id: string; name: string; adjustment_percent: number; created_at: string }
        Insert: Partial<Database['public']['Tables']['regions']['Row']>
        Update: Partial<Database['public']['Tables']['regions']['Row']>
      }
      trades: {
        Row: { id: string; name: string; slug: string; created_at: string }
        Insert: Partial<Database['public']['Tables']['trades']['Row']>
        Update: Partial<Database['public']['Tables']['trades']['Row']>
      }
      categories: {
        Row: { id: string; trade_id: string; name: string; created_at: string }
        Insert: Partial<Database['public']['Tables']['categories']['Row']>
        Update: Partial<Database['public']['Tables']['categories']['Row']>
      }
      services: {
        Row: {
          id: string
          category_id: string
          name: string
          unit_label: string
          ut_coefficient: number | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['services']['Row']>
        Update: Partial<Database['public']['Tables']['services']['Row']>
      }
      price_lists: {
        Row: { id: string; trade_id: string; name: string; created_at: string }
        Insert: Partial<Database['public']['Tables']['price_lists']['Row']>
        Update: Partial<Database['public']['Tables']['price_lists']['Row']>
      }
      price_list_versions: {
        Row: {
          id: string
          price_list_id: string
          version_label: string
          status: VersionStatus
          effective_date: string
          published_at: string | null
          source_ipc_id: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['price_list_versions']['Row']>
        Update: Partial<Database['public']['Tables']['price_list_versions']['Row']>
      }
      price_items: {
        Row: {
          id: string
          price_list_version_id: string
          service_id: string
          base_price: number
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['price_items']['Row']>
        Update: Partial<Database['public']['Tables']['price_items']['Row']>
      }
      ipc_indexes: {
        Row: {
          id: string
          year: number
          month: number
          value: number
          published_date: string
          status: 'pending' | 'applied'
          applies_to_version_id: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['ipc_indexes']['Row']>
        Update: Partial<Database['public']['Tables']['ipc_indexes']['Row']>
      }
      user_price_items: {
        Row: {
          id: string
          user_id: string
          service_id: string
          custom_price: number
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['user_price_items']['Row']>
        Update: Partial<Database['public']['Tables']['user_price_items']['Row']>
      }
      customers: {
        Row: {
          id: string
          user_id: string
          name: string
          phone: string | null
          email: string | null
          address: string | null
          notes: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['customers']['Row']>
        Update: Partial<Database['public']['Tables']['customers']['Row']>
      }
      quotes: {
        Row: {
          id: string
          user_id: string
          customer_id: string | null
          total: number
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['quotes']['Row']>
        Update: Partial<Database['public']['Tables']['quotes']['Row']>
      }
      quote_items: {
        Row: {
          id: string
          quote_id: string
          service_id: string
          quantity: number
          unit_price: number
          subtotal: number
        }
        Insert: Partial<Database['public']['Tables']['quote_items']['Row']>
        Update: Partial<Database['public']['Tables']['quote_items']['Row']>
      }
      plans: {
        Row: {
          id: string
          name: string
          price: number
          billing_period: 'monthly' | 'yearly'
          is_active: boolean
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['plans']['Row']>
        Update: Partial<Database['public']['Tables']['plans']['Row']>
      }
      subscriptions: {
        Row: {
          id: string
          user_id: string
          plan_id: string
          status: SubscriptionStatus
          start_date: string
          end_date: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['subscriptions']['Row']>
        Update: Partial<Database['public']['Tables']['subscriptions']['Row']>
      }
      payments: {
        Row: {
          id: string
          subscription_id: string
          provider: PaymentProvider
          amount: number
          reference: string | null
          proof_url: string | null
          status: PaymentStatus
          external_id: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['payments']['Row']>
        Update: Partial<Database['public']['Tables']['payments']['Row']>
      }
      bank_reconciliations: {
        Row: {
          id: string
          payment_id: string
          reconciled_by: string | null
          status: 'reconciled' | 'rejected'
          notes: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['bank_reconciliations']['Row']>
        Update: Partial<Database['public']['Tables']['bank_reconciliations']['Row']>
      }
      audit_logs: {
        Row: {
          id: string
          actor_id: string | null
          entity: string
          entity_id: string | null
          action: string
          old_value: unknown
          new_value: unknown
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['audit_logs']['Row']>
        Update: Partial<Database['public']['Tables']['audit_logs']['Row']>
      }
    }
  }
}
