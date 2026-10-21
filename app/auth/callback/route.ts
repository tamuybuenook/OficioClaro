import { createClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/auth/paths'
import { redirect } from 'next/navigation'
import { type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error && next === '/reset-password') redirect('/forgot-password?error=link')
  } else if (next === '/reset-password') {
    redirect('/forgot-password?error=link')
  }

  redirect(next)
}
