// Datos para que el usuario transfiera a OficioClaro. NO existe una tabla para esto en la base (y no se creó una:
// no hace falta migración): se leen de variables de entorno del servidor, que configura el dueño en Vercel.
// Son datos de cobro (alias/CBU), no secretos, y solo se envían a usuarios autenticados. Nunca se inventan valores.
export type TransferInstructions = { bank: string | null; alias: string | null; cbu: string | null; holder: string | null; holderCuit: string | null; note: string | null }

const clean = (v: string | undefined, max: number): string | null => {
  const s = (v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
  return s || null
}

export function getTransferInstructions(env: Record<string, string | undefined> = process.env): TransferInstructions | null {
  const t: TransferInstructions = {
    bank: clean(env.TRANSFER_BANK, 80),
    alias: clean(env.TRANSFER_ALIAS, 60),
    cbu: clean(env.TRANSFER_CBU, 30),
    holder: clean(env.TRANSFER_HOLDER, 120),
    holderCuit: clean(env.TRANSFER_HOLDER_CUIT, 20),
    note: clean(env.TRANSFER_NOTE, 300),
  }
  // Sin alias ni CBU no hay a dónde transferir: no se muestra un bloque incompleto.
  return t.alias || t.cbu ? t : null
}
