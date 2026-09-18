type Plan = { id: string; name: string; price: number; billing_period: string; max_trades: number | null; trial_days: number }

const money = (v: number) => `$${v.toLocaleString('es-AR')}`

export function LandingPage({ plans }: { plans: Plan[] }) {
  return (
    <main className="min-h-dvh bg-[var(--oc-page)] text-[var(--oc-ink)]">
      {/* HERO */}
      <section className="mx-auto max-w-[720px] px-5 pb-10 pt-16 text-center md:pt-24">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--oc-brand)]">OficioClaro</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-5xl">Precios claros para tu oficio.</h1>
        <p className="mx-auto mt-4 max-w-md text-[var(--oc-muted)]">
          Encontrá rápidamente una referencia de cuánto cobrar por los trabajos de tu actividad. Vos decidís tu propio precio.
        </p>
        <div className="mt-7 flex flex-col items-center gap-3">
          <a href="/register" className="rounded-xl bg-[var(--oc-coral)] px-6 py-3.5 text-sm font-bold text-white shadow-sm">Empezar gratis</a>
          <span className="text-xs font-semibold text-[var(--oc-brand)]">30 días gratis · sin tarjeta</span>
        </div>
      </section>

      {/* QUÉ ES */}
      <section className="mx-auto max-w-[640px] px-5 py-10">
        <h2 className="text-xl font-bold">¿Qué es OficioClaro?</h2>
        <p className="mt-3 text-[var(--oc-muted)]">
          Una herramienta para profesionales y trabajadores de distintos oficios que necesitan consultar rápidamente
          cuánto se toma como referencia para determinados trabajos. OficioClaro ofrece precios de referencia: cada
          profesional puede usarlos, aumentarlos, reducirlos o definir su propio precio. No obligamos a cobrar un
          monto determinado.
        </p>
      </section>

      {/* CÓMO FUNCIONA */}
      <section className="border-y border-[var(--oc-border)] bg-[var(--oc-surface)] px-5 py-10">
        <div className="mx-auto max-w-[640px]">
          <h2 className="text-xl font-bold">¿Cómo funciona?</h2>
          <ol className="mt-5 flex flex-col gap-3">
            {['Registrate', 'Elegí tu oficio', 'Buscá el trabajo', 'Consultá el precio de referencia', 'Definí tu propio precio'].map((step, i) => (
              <li key={step} className="flex items-center gap-3 rounded-xl border border-[var(--oc-border-soft)] bg-[var(--oc-page)] p-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--oc-brand-soft)] text-xs font-bold text-[var(--oc-brand)]">{i + 1}</span>
                <span className="text-sm font-semibold">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* EJEMPLO */}
      <section className="mx-auto max-w-[480px] px-5 py-10">
        <h2 className="text-center text-xl font-bold">Así de simple</h2>
        <div className="mt-5 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
          <p className="text-xs font-semibold text-[var(--oc-muted)]">Buscar: "canilla"</p>
          <p className="mt-3 font-bold">Cambio de canilla</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[var(--oc-surface-muted)] p-3"><p className="text-xs text-[var(--oc-muted)]">Precio de referencia</p><p className="mt-1 font-bold">$40.000</p></div>
            <div className="rounded-xl border-2 border-[#e8c7b6] bg-[#fffaf7] p-3"><p className="text-xs font-semibold text-[#93624d]">Mi precio</p><p className="mt-1 font-bold text-[#ad6245]">$45.000</p></div>
          </div>
        </div>
      </section>

      {/* PLANES */}
      <section className="border-t border-[var(--oc-border)] bg-[var(--oc-surface)] px-5 py-10">
        <div className="mx-auto max-w-[880px]">
          <h2 className="text-center text-xl font-bold">Planes</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-page)] p-5">
                <p className="font-bold">{plan.name}</p>
                <p className="mt-2 text-2xl font-bold text-[var(--oc-brand)]">{money(plan.price)}<span className="text-sm font-normal text-[var(--oc-muted)]">/{plan.billing_period === 'monthly' ? 'mes' : 'año'}</span></p>
                <p className="mt-2 text-sm text-[var(--oc-muted)]">{plan.max_trades === null ? 'Todos los oficios' : `${plan.max_trades} oficio${plan.max_trades > 1 ? 's' : ''}`}</p>
                <p className="mt-1 text-xs text-[var(--oc-muted)]">{plan.trial_days} días gratis</p>
                <a href="/register" className="mt-4 block rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-center text-sm font-bold text-white">Empezar</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ESTADO DEL PRODUCTO */}
      <section className="mx-auto max-w-[560px] px-5 py-10 text-center">
        <p className="text-sm font-semibold text-[var(--oc-brand)]">Estamos en etapa inicial.</p>
        <p className="mt-2 text-sm text-[var(--oc-muted)]">
          OficioClaro está creciendo y sumando nuevos oficios y servicios. Registrate y probalo gratis durante 30 días.
        </p>
        <a href="/register" className="mt-5 inline-block rounded-xl bg-[var(--oc-coral)] px-6 py-3.5 text-sm font-bold text-white">Empezar gratis</a>
      </section>

      <footer className="border-t border-[var(--oc-border)] px-5 py-6 text-center text-xs text-[var(--oc-muted)]">
        OficioClaro © 2026 · <a href="/login" className="underline">Ya tengo cuenta</a>
      </footer>
    </main>
  )
}
