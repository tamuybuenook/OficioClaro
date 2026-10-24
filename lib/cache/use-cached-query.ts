'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { load, makeKey, revalidate, subscribe, getOwner } from '@/lib/cache/store'

export type CachedQueryState<T> = {
  data: T | null
  /** Primera carga sin nada guardado todavía. */
  loading: boolean
  /** Hay datos mostrados y se está actualizando en segundo plano. */
  refreshing: boolean
  /** Mensaje si la última consulta falló (si hay `data`, son datos guardados: sin conexión o error). */
  error: string | null
  reload: () => void
}

/**
 * Lista con caché local: muestra enseguida lo guardado (memoria o IndexedDB), y vuelve a pedir al servidor solo si
 * los datos pasaron el TTL, si se invalidaron, o si no había nada. Las consultas iguales y simultáneas se comparten.
 * `fetcher` debe devolver `{ error }` o lanzar si falla; si devuelve `{ error }` no se guarda en la caché.
 */
export function useCachedQuery<T>(
  scope: string, params: unknown, fetcher: () => Promise<T | { error: string }>, opts: { ttlMs: number; enabled?: boolean },
): CachedQueryState<T> {
  const enabled = opts.enabled !== false
  const key = makeKey(scope, params)
  const [state, setState] = useState<{ data: T | null; loading: boolean; refreshing: boolean; error: string | null }>({ data: null, loading: enabled, refreshing: false, error: null })
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const seq = useRef(0)
  const forceRef = useRef(false)

  const guarded = useCallback(async (): Promise<T> => {
    const r = await fetcherRef.current()
    if (r && typeof r === 'object' && 'error' in (r as object) && typeof (r as { error: unknown }).error === 'string') throw new Error((r as { error: string }).error)
    return r as T
  }, [])

  useEffect(() => subscribe(scope, () => setTick((n) => n + 1)), [scope])

  useEffect(() => {
    if (!enabled) { setState({ data: null, loading: false, refreshing: false, error: null }); return }
    const mine = ++seq.current
    const live = () => mine === seq.current
    let cancelled = false
    ;(async () => {
      try {
        if (!getOwner()) { // sin dueño asociado no se guarda nada: consulta directa
          const v = await guarded()
          if (!cancelled && live()) setState({ data: v, loading: false, refreshing: false, error: null })
          return
        }
        if (forceRef.current) { // "Reintentar": se salta lo guardado y se consulta de nuevo
          forceRef.current = false
          setState((s) => ({ ...s, loading: s.data === null, refreshing: s.data !== null, error: null }))
          const next = await revalidate<T>(key, guarded)
          if (!cancelled && live()) setState({ data: next.value, loading: false, refreshing: false, error: null })
          return
        }
        const res = await load<T>(key, guarded, opts.ttlMs)
        if (cancelled || !live()) return
        setState({ data: res.value, loading: false, refreshing: !res.fresh, error: null })
        if (!res.fresh) {
          try {
            const next = await revalidate<T>(key, guarded)
            if (!cancelled && live()) setState({ data: next.value, loading: false, refreshing: false, error: null })
          } catch (e) {
            if (!cancelled && live()) setState((s) => ({ ...s, refreshing: false, error: e instanceof Error ? e.message : 'No se pudo actualizar.' }))
          }
        }
      } catch (e) {
        if (!cancelled && live()) setState((s) => ({ ...s, loading: false, refreshing: false, error: e instanceof Error ? e.message : 'No se pudo cargar.' }))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, tick])

  return { ...state, reload: () => { forceRef.current = true; setTick((n) => n + 1) } }
}
