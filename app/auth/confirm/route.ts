import { createClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/auth/paths'
import { redirect } from 'next/navigation'
import { type NextRequest } from 'next/server'
import { type EmailOtpType } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const isRecovery = type === 'recovery'
  // Recuperación: siempre a la pantalla de contraseña nueva, sin depender del parámetro `next`.
  const next = isRecovery ? '/reset-password' : safeNext(searchParams.get('next'))

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) redirect(next)
  }

  redirect(isRecovery ? '/forgot-password?error=link' : '/login')
}
