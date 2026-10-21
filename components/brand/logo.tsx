import { Wrench } from 'lucide-react'

// Logo oficial de OficioClaro (idéntico al de la app): cuadrado azul petróleo con llave + "Oficio" petróleo y "Claro" coral.
export function LogoMark({ className = 'size-9' }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center rounded-xl bg-[var(--oc-brand)] text-[var(--oc-on-brand)] ${className}`} aria-hidden="true">
      <Wrench className="size-[18px]" />
    </span>
  )
}

export function Logo({ className = '', onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className={`text-[17px] font-bold tracking-tight ${onDark ? 'text-[var(--lp-on-deep)]' : 'text-[var(--oc-brand)]'}`}>Oficio<span className="text-[var(--oc-coral)]">Claro</span></span>
    </span>
  )
}
