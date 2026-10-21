'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

export async function signUp(formData: FormData) {
  const supabase = await createClient()
  const email = String(formData.get('email'))
  const password = String(formData.get('password'))
  const fullName = String(formData.get('full_name') ?? '')

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })

  if (error) return { error: error.message }
  redirect('/')
}

export async function signIn(formData: FormData) {
  const supabase = await createClient()
  const email = String(formData.get('email'))
  const password = String(formData.get('password'))

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return { error: error.message }
  redirect('/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email || email.length > 254 || !email.includes('@')) return { error: 'Ingresá un correo válido.' }

  const supabase = await createClient()
  const base = (process.env.APP_URL ?? '').replace(/\/$/, '') || (await headers()).get('origin') || ''
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${base}/auth/callback?next=/reset-password` })
  // Los errores de Supabase se registran, pero al usuario se le responde igual (sin revelar si existe la cuenta).
  if (error) console.error('[auth] resetPasswordForEmail:', error.status ?? '', error.code ?? '')
  redirect('/forgot-password?sent=1')
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  if (password.length < 6) return { error: 'La contraseña debe tener al menos 6 caracteres.' }
  if (password.length > 72) return { error: 'La contraseña es demasiado larga (máximo 72 caracteres).' }
  if (password !== confirm) return { error: 'Las contraseñas no coinciden.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'El enlace venció. Pedí uno nuevo desde «Olvidé mi contraseña».' }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    if (error.code === 'same_password') return { error: 'La contraseña nueva debe ser distinta de la anterior.' }
    if (error.code === 'weak_password') return { error: 'La contraseña es muy débil. Probá con una más larga o con números y letras.' }
    console.error('[auth] updateUser:', error.status ?? '', error.code ?? '')
    return { error: 'No se pudo cambiar la contraseña. Pedí un enlace nuevo e intentá de nuevo.' }
  }
  await supabase.auth.signOut()
  redirect('/login?reset=ok')
}
