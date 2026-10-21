// Maquetas ilustrativas construidas con la misma estructura de pantallas que la app real
// (buscador de precios, precio de referencia vs. mi precio, presupuesto). Los importes son de ejemplo.
import { Search } from 'lucide-react'

export function PhoneFrame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-[280px] rounded-[2.4rem] border-[7px] border-[var(--lp-deep)] bg-[var(--lp-deep)] shadow-[0_30px_60px_-25px_rgba(43,30,22,.55)] ${className}`}>
      <div className="overflow-hidden rounded-[1.8rem] bg-[var(--lp-ivory)]">
        <div className="mx-auto mt-2 h-1.5 w-16 rounded-full bg-[var(--lp-line)]" />
        <div className="p-4 pb-5">{children}</div>
      </div>
    </div>
  )
}

export function PriceScreen() {
  return (
    <div role="img" aria-label="Ejemplo ilustrativo: búsqueda de 'canilla' con precio de referencia y precio propio">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--lp-salvia)]">Precios</p>
      <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-[var(--lp-line)] bg-[var(--lp-paper)] px-3 py-2.5 text-sm text-[var(--lp-ink-soft)]">
        <Search className="size-4" aria-hidden="true" /> canilla
      </div>
      <div className="mt-3 rounded-2xl border border-[var(--lp-line)] bg-[var(--lp-paper)] p-3.5">
        <p className="text-[11px] font-semibold text-[var(--lp-salvia)]">Plomería</p>
        <p className="mt-0.5 font-display text-base font-semibold">Cambio de canilla</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[var(--lp-sand)] p-2.5"><p className="text-[10px] text-[var(--lp-ink-soft)]">Precio de referencia</p><p className="mt-0.5 text-base font-bold">$40.000</p></div>
          <div className="rounded-xl border-2 border-[var(--oc-warm-border)] bg-[var(--oc-warm-card)] p-2.5"><p className="text-[10px] font-semibold text-[var(--oc-warm-label)]">Mi precio</p><p className="mt-0.5 text-base font-bold text-[var(--oc-warm-strong)]">$45.000</p></div>
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] text-[var(--lp-ink-soft)]">Ejemplo ilustrativo</p>
    </div>
  )
}

export function QuoteScreen() {
  return (
    <div role="img" aria-label="Ejemplo ilustrativo de presupuesto con dos trabajos y botón para enviar por WhatsApp">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--lp-salvia)]">Presupuesto</p>
      <p className="mt-1 font-display text-base font-semibold">Presupuesto Nº 00001</p>
      <p className="text-xs text-[var(--lp-ink-soft)]">Cliente de ejemplo · Borrador</p>
      <ul className="mt-3 space-y-2">
        {[['Cambio de canilla', '1 × $45.000'], ['Reparación de pérdida', '1 × $50.000']].map(([n, q]) => (
          <li key={n} className="flex items-center justify-between rounded-xl border border-[var(--lp-line)] bg-[var(--lp-paper)] px-3 py-2.5 text-xs"><span className="font-semibold">{n}</span><span className="text-[var(--lp-ink-soft)]">{q}</span></li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--lp-line)] pt-3"><span className="text-xs text-[var(--lp-ink-soft)]">Total</span><span className="text-lg font-bold">$95.000</span></div>
      <div className="mt-3 rounded-xl bg-[#25D366] py-2.5 text-center text-xs font-bold text-white">Enviar por WhatsApp</div>
      <p className="mt-3 text-center text-[10px] text-[var(--lp-ink-soft)]">Ejemplo ilustrativo</p>
    </div>
  )
}
