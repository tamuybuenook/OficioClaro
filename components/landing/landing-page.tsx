import { Check, Droplets, Flame, Zap, PaintRoller, Search, FileText, Users, Smartphone, SlidersHorizontal, Globe } from 'lucide-react'
import { brandFontClass } from '@/lib/brand-fonts'
import { Logo } from '@/components/brand/logo'
import { SiteHeader } from './site-header'
import { PhoneFrame, PriceScreen, QuoteScreen } from './mockups'
import { testimonials } from './testimonials'
import { periodUnit } from '@/lib/plan-period'

type Plan = { id: string; name: string; price: number; billing_period: string; max_trades: number | null; trial_days: number }

const money = (v: number) => `$${v.toLocaleString('es-AR')}`

const steps = [
  { icon: Search, title: 'Consultá el precio de referencia', text: 'Elegí tu oficio, buscá el trabajo y mirá cuánto se toma como referencia.' },
  { icon: SlidersHorizontal, title: 'Definí tu propio precio', text: 'Usá la referencia tal cual o ajustala. Vos decidís cuánto cobrar.' },
  { icon: FileText, title: 'Prepará el presupuesto', text: 'Armalo para tu cliente con los trabajos y cantidades, y enviáselo por WhatsApp.' },
  { icon: Users, title: 'Tené tus clientes a mano', text: 'Guardá tus clientes y volvé a tus presupuestos cuando los necesites.' },
]

const features = [
  { icon: Search, title: 'Precios de referencia', text: 'Buscás un trabajo y ves enseguida una referencia de precio.' },
  { icon: SlidersHorizontal, title: 'Tu lista personal', text: 'Ajustás los valores a tu criterio y mantenés tu propia lista.' },
  { icon: FileText, title: 'Presupuestos ordenados', text: 'Prepará presupuestos numerados y compartilos por WhatsApp.' },
  { icon: Users, title: 'Clientes y trabajos', text: 'Tus clientes y presupuestos, en un solo lugar.' },
]

const trades = [
  { icon: Droplets, name: 'Plomería', text: 'Un cliente te pregunta cuánto sale cambiar una canilla. Buscás el trabajo y respondés con un precio claro.' },
  { icon: Flame, name: 'Gasista', text: 'Vas a presupuestar una instalación de calefón: consultás la referencia y la ajustás a tu zona.' },
  { icon: Zap, name: 'Electricidad', text: 'Para instalar un artefacto, tenés una referencia a mano antes de pasar el precio.' },
  { icon: PaintRoller, name: 'Pintura', text: 'Pintar un ambiente se cotiza por m²: consultás el valor y armás el presupuesto.' },
]

const faqs = [
  ['¿Necesito instalar algo?', 'No. Se usa desde el navegador de tu celular o computadora, con conexión a internet. Si querés, podés agregarlo a la pantalla de inicio para abrirlo más rápido, pero no es obligatorio.'],
  ['¿Puedo usarlo desde el celular?', 'Sí. Está pensado para usarse desde el teléfono, también en medio de un trabajo.'],
  ['¿Cómo empiezo?', 'Tocá “Empezar gratis”, creá tu cuenta con tu email o con Google, elegí tu oficio y buscá el trabajo que necesitás.'],
  ['¿Qué incluye cada plan?', 'Los planes se diferencian por la cantidad de oficios que podés usar. Los valores y condiciones están en la sección Planes.'],
  ['¿Puedo consultar precios de referencia?', 'Sí. Son una guía: podés usarlos, subirlos, bajarlos o poner tu propio precio. No te obligamos a cobrar un monto determinado.'],
  ['¿Puedo armar presupuestos?', 'Sí. Podés crear presupuestos para tus clientes y enviarlos por WhatsApp.'],
]

export function LandingPage({ plans }: { plans: Plan[] }) {
  const trialPlan = [...plans].sort((a, b) => Number(b.max_trades === null) - Number(a.max_trades === null) || a.price - b.price)[0]
  const trialDays = trialPlan?.trial_days ?? 30
  const hasDemo = testimonials.some((t) => t.demo)

  return (
    <div className={`lp ${brandFontClass} min-h-dvh`}>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">Ir al contenido</a>
      <SiteHeader />
      <main id="contenido">
        {/* HERO */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-12 md:pt-20 lg:grid-cols-[1.1fr_.9fr] lg:pb-24">
          <div>
            <p className="inline-block rounded-full bg-[var(--lp-salvia-soft)] px-3.5 py-1.5 text-sm font-bold text-[var(--lp-salvia)]">{trialDays} días gratis · sin tarjeta</p>
            <h1 className="mt-5 text-[2.5rem] leading-[1.08] md:text-6xl">Tu oficio vale. Organizarlo no debería ser complicado.</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--lp-ink-soft)]">
              Consultá precios de referencia, prepará presupuestos y tené tus clientes en un solo lugar. OficioClaro te ayuda a trabajar con más claridad, sin complicarte con la tecnología.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="/register" className="lp-btn lp-btn-primary">Empezar gratis</a>
              <a href="#como-funciona" className="lp-btn lp-btn-ghost">Conocer cómo funciona</a>
            </div>
            <p className="mt-5 flex items-start gap-2 text-[15px] text-[var(--lp-ink-soft)]">
              <Smartphone className="mt-0.5 size-5 shrink-0 text-[var(--lp-salvia)]" aria-hidden="true" />
              Desde tu celular o computadora. Sin instalar una aplicación ni ocupar espacio en tu teléfono.
            </p>
          </div>
          <div className="relative">
            <div className="absolute inset-x-6 bottom-0 top-10 rounded-[2rem] bg-[var(--lp-sand)]" aria-hidden="true" />
            <div className="relative grid grid-cols-1 items-start gap-6 sm:grid-cols-2 sm:gap-4">
              <PhoneFrame><PriceScreen /></PhoneFrame>
              <PhoneFrame className="hidden sm:block sm:mt-10"><QuoteScreen /></PhoneFrame>
            </div>
          </div>
        </section>

        {/* FUNCIONALIDADES */}
        <section id="funcionalidades" className="border-y border-[var(--lp-line)] bg-[var(--lp-paper)] py-16">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="max-w-2xl text-3xl md:text-4xl">Menos tiempo buscando, más tiempo trabajando.</h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, text }) => (
                <div key={title}>
                  <span className="flex size-12 items-center justify-center rounded-xl bg-[var(--lp-coral-soft)] text-[var(--lp-coral)]"><Icon className="size-6" aria-hidden="true" /></span>
                  <h3 className="mt-4 text-xl">{title}</h3>
                  <p className="mt-2 leading-relaxed text-[var(--lp-ink-soft)]">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CÓMO FUNCIONA */}
        <section id="como-funciona" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <h2 className="max-w-2xl text-3xl md:text-4xl">Así de simple.</h2>
          <p className="mt-3 max-w-xl text-lg text-[var(--lp-ink-soft)]">Entendés cómo se usa sin leer ningún manual.</p>
          <ol className="mt-10 grid gap-5 md:grid-cols-2">
            {steps.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="flex gap-4 rounded-2xl border border-[var(--lp-line)] bg-[var(--lp-paper)] p-6">
                <span className="font-display flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--lp-brand)] text-xl text-[var(--oc-on-brand)]">{i + 1}</span>
                <div>
                  <h3 className="flex items-center gap-2 text-xl"><Icon className="size-5 text-[var(--lp-coral)]" aria-hidden="true" />{title}</h3>
                  <p className="mt-2 leading-relaxed text-[var(--lp-ink-soft)]">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* SIN INSTALAR */}
        <section className="bg-[var(--lp-deep)] py-16 text-[var(--lp-on-deep)]">
          <div className="mx-auto grid max-w-6xl items-center gap-8 px-5 md:grid-cols-[auto_1fr]">
            <span className="flex size-20 items-center justify-center rounded-3xl bg-[var(--lp-on-deep)] text-[var(--lp-deep)]"><Globe className="size-10" aria-hidden="true" /></span>
            <div>
              <h2 className="text-3xl md:text-4xl">No necesitás instalar nada.</h2>
              <p className="mt-3 max-w-2xl text-lg leading-relaxed text-[var(--lp-on-deep)]/85">Entrá desde el navegador de tu celular o computadora. No necesitás descargar una aplicación ni reservar espacio en tu teléfono. Solo necesitás conexión a internet.</p>
            </div>
          </div>
        </section>

        {/* OFICIOS */}
        <section className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <h2 className="max-w-2xl text-3xl md:text-4xl">Pensado para quienes trabajan con las manos.</h2>
          <p className="mt-3 max-w-xl text-lg text-[var(--lp-ink-soft)]">Estos son los oficios disponibles hoy. Seguimos sumando más.</p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {trades.map(({ icon: Icon, name, text }) => (
              <article key={name} className="rounded-2xl bg-[var(--lp-salvia-soft)] p-6">
                <Icon className="size-8 text-[var(--lp-salvia)]" aria-hidden="true" />
                <h3 className="mt-4 text-xl">{name}</h3>
                <p className="mt-2 leading-relaxed text-[var(--lp-ink-soft)]">{text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* EXPERIENCIAS */}
        <section id="experiencias" className="border-y border-[var(--lp-line)] bg-[var(--lp-paper)] py-16">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="max-w-2xl text-3xl md:text-4xl">Una herramienta pensada para el trabajo de todos los días.</h2>
            {hasDemo && (
              <p className="mt-4 inline-block rounded-xl bg-[var(--lp-salvia-soft)] px-4 py-2.5 text-[15px] font-semibold text-[var(--lp-salvia)]">
                Testimonios de ejemplo · Contenido de demostración. No son opiniones de clientes reales.
              </p>
            )}
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {testimonials.map((t) => (
                <figure key={t.id} className="flex flex-col rounded-2xl border border-[var(--lp-line)] bg-[var(--lp-ivory)] p-6">
                  <blockquote className="flex-1 leading-relaxed text-[var(--lp-ink)]">«{t.quote}»</blockquote>
                  <figcaption className="mt-5 flex items-center gap-3">
                    <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--oc-brand-soft)] font-bold text-[var(--lp-brand)]">{t.name.split(' ').map((n) => n[0]).join('')}</span>
                    <span>
                      <span className="block font-bold">{t.name}</span>
                      <span className="block text-sm text-[var(--lp-ink-soft)]">{t.trade}</span>
                      {t.demo && <span className="mt-1 inline-block rounded-full border border-[var(--lp-line)] px-2 py-0.5 text-xs font-semibold text-[var(--lp-ink-soft)]">Ejemplo</span>}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-8 text-[var(--lp-ink-soft)]">OficioClaro está en sus primeras etapas. Si lo probás, nos encantaría conocer tu opinión.</p>
          </div>
        </section>

        {/* PLANES */}
        <section id="planes" className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <h2 className="text-3xl md:text-4xl">Planes simples, sin letra chica.</h2>
          <p className="mt-3 max-w-xl text-lg text-[var(--lp-ink-soft)]">Probalo gratis durante {trialDays} días, sin cargar tarjeta.</p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.id} className="flex flex-col rounded-2xl border-2 border-[var(--lp-line)] bg-[var(--lp-paper)] p-7">
                <h3 className="text-2xl">{plan.name}</h3>
                <p className="mt-3"><span className="font-display text-4xl font-semibold">{money(plan.price)}</span><span className="text-[var(--lp-ink-soft)]"> / {periodUnit(plan.billing_period)}</span></p>
                <ul className="mt-5 space-y-2.5 text-[var(--lp-ink-soft)]">
                  <li className="flex items-start gap-2"><Check className="mt-0.5 size-5 shrink-0 text-[var(--lp-salvia)]" aria-hidden="true" />{plan.max_trades === null ? 'Todos los oficios disponibles' : `${plan.max_trades} oficio${plan.max_trades > 1 ? 's' : ''}`}</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 size-5 shrink-0 text-[var(--lp-salvia)]" aria-hidden="true" />{plan.trial_days} días gratis para empezar</li>
                </ul>
                <a href="/register" className="lp-btn lp-btn-primary mt-7">Empezar gratis</a>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="preguntas" className="border-t border-[var(--lp-line)] bg-[var(--lp-paper)] py-16">
          <div className="mx-auto max-w-3xl px-5">
            <h2 className="text-3xl md:text-4xl">Preguntas frecuentes</h2>
            <div className="mt-8 divide-y divide-[var(--lp-line)] border-y border-[var(--lp-line)]">
              {faqs.map(([q, a]) => (
                <details key={q} className="group py-4">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold">{q}<span className="text-2xl text-[var(--lp-brand)] transition group-open:rotate-45" aria-hidden="true">+</span></summary>
                  <p className="pb-2 pt-1 leading-relaxed text-[var(--lp-ink-soft)]">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CIERRE */}
        <section className="bg-[linear-gradient(155deg,var(--oc-hero-from),var(--oc-hero-via)_55%,var(--oc-hero-to))] py-16 text-center text-[var(--lp-on-deep)]">
          <div className="mx-auto max-w-2xl px-5">
            <h2 className="text-3xl md:text-4xl">Dedicáte a tu oficio. De la organización te ayudamos nosotros.</h2>
            <a href="/register" className="lp-btn lp-btn-primary mt-8">Empezar gratis</a>
          </div>
        </section>
      </main>

      <footer className="bg-[var(--oc-hero-from)] py-10 text-[var(--lp-on-deep)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 md:flex-row md:items-center md:justify-between">
          <Logo onDark />
          <nav aria-label="Pie de página" className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] font-semibold">
            <a href="#funcionalidades" className="hover:underline">Funcionalidades</a>
            <a href="#como-funciona" className="hover:underline">Cómo funciona</a>
            <a href="#planes" className="hover:underline">Planes</a>
            <a href="/login" className="hover:underline">Ingresar</a>
            <a href="/register" className="hover:underline">Crear cuenta</a>
          </nav>
          <p className="text-sm text-[var(--lp-on-deep)]/70">© 2026 OficioClaro</p>
        </div>
      </footer>
    </div>
  )
}
