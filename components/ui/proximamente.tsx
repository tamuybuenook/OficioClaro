export function Proximamente({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-md p-8 pb-28 text-center">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--oc-brand)]">Próximamente</p>
      <h1 className="mt-2 text-xl font-bold text-[var(--oc-ink)]">{title}</h1>
      <p className="mt-2 text-sm text-[var(--oc-muted)]">Estamos trabajando para incorporar esta funcionalidad.</p>
    </div>
  )
}
