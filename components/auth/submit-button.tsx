'use client'

import { useFormStatus } from 'react-dom'

export function SubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="lp-btn lp-btn-primary mt-1 w-full disabled:cursor-not-allowed disabled:opacity-70">
      {pending ? pendingText : children}
    </button>
  )
}
