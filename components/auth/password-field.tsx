'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function PasswordField({ id = 'password', name = 'password', label = 'Contraseña', autoComplete, minLength, hint }: { id?: string; name?: string; label?: string; autoComplete: string; minLength?: number; hint?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[15px] font-bold">{label}</label>
      <div className="relative">
        <input id={id} name={name} type={show ? 'text' : 'password'} required minLength={minLength} autoComplete={autoComplete} aria-describedby={hint ? `${id}-hint` : undefined} className="lp-input pr-14" />
        <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="absolute right-1 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--lp-ink-soft)] hover:text-[var(--lp-brand)]">
          {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-sm text-[var(--lp-ink-soft)]">{hint}</p>}
    </div>
  )
}
