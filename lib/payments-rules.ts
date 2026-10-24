// Reglas de la decisión manual sobre transferencias. Módulo aparte porque un archivo 'use server'
// solo puede exportar funciones asíncronas.
export const MIN_REJECT_REASON = 5
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
