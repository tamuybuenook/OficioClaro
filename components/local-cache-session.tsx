'use client'

import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { bindOwner, clearLocalData } from '@/lib/cache/store'
import { checkSync } from '@/lib/cache/sync'
import { fetchSyncStamp } from '@/lib/actions/quoteBuilder'

// Conecta la caché local de ESTE dispositivo con la sesión:
//  - la asocia al usuario autenticado (cambiar de cuenta descarta lo del anterior);
//  - controla si otro dispositivo cambió algo (al abrir, al volver a la pestaña y al recuperar conexión);
//  - se vacía al cerrar sesión y en las pantallas de acceso.
// La caché solo acelera lecturas: el servidor y la base siguen verificando permisos y acceso en cada operación.

const stamp = async () => { const r = await fetchSyncStamp(); return 'error' in r ? null : r.data }

export function LocalCacheSession({ userId }: { userId: string }) {
  const bound = useRef<string | null>(null)
  if (bound.current !== userId) { bindOwner(userId); bound.current = userId } // síncrono: los hijos ya leen con el dueño correcto

  useEffect(() => {
    void checkSync(stamp, { force: true })
    const onVisible = () => { if (document.visibilityState === 'visible') void checkSync(stamp) }
    const onOnline = () => { void checkSync(stamp, { force: true }) }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline) }
  }, [userId])
  return null
}

/** Pantallas sin sesión (acceso, registro, inicio público) o con acceso bloqueado: no debe quedar caché de datos. */
export function PurgeLocalCache({ keepDrafts = true }: { keepDrafts?: boolean }) {
  useEffect(() => { bindOwner(null); void clearLocalData({ keepDrafts }) }, [keepDrafts])
  return null
}

/** Formulario de "Cerrar sesión": borra memoria, disco y borradores locales ANTES de enviar. */
export function SignOutForm({ action, className, children }: { action: () => void | Promise<void>; className?: string; children: ReactNode }) {
  const cleared = useRef(false)
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (cleared.current) return
    e.preventDefault()
    const form = e.currentTarget
    try { await clearLocalData() } catch { /* aun así se cierra la sesión */ }
    cleared.current = true
    form.requestSubmit()
  }
  return <form action={action} onSubmit={onSubmit} className={className}>{children}</form>
}
