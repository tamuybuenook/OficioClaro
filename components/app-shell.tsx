'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { setMyPrice, setMyTaskUt } from '@/lib/actions/userPricing'
import { reportTransferPayment } from '@/lib/actions/payments'
import { signOut } from '@/lib/actions/auth'
import { money } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { ThemePicker } from '@/components/theme-picker'
import { TradeCatalog } from '@/components/features/catalog/trade-catalog'
import type { AgendaIntent, Job, QuoteIntent, View } from '@/components/types'
import { ClientsUpdated } from '@/components/features/clients/clients-view'
import { QuotesView } from '@/components/features/quotes/quotes-view'
import { OwnCatalogView } from '@/components/features/catalog/own-catalog'
import { AccountNotices, AccountSummaryCard } from '@/components/features/account/account-summary-card'
import { buildAccountSummary } from '@/lib/account-summary'
import { LocalCacheSession, PurgeLocalCache, SignOutForm } from '@/components/local-cache-session'
import { MisOficios } from '@/components/features/trades/mis-oficios'
import { SubscriptionView, type BillingInfo, type SubscriptionInfo } from '@/components/features/subscription/subscription-view'
import { Profile } from '@/components/features/profile/profile-view'
import { Proximamente } from '@/components/ui/proximamente'
import { AccessBanner } from '@/components/features/subscription/access-banner'
import type { AccessView } from '@/lib/subscription-notice'
import type { Banner } from '@/lib/notifications/banner'
import { dismissNotification } from '@/lib/actions/notifications'
import { AgendaView } from '@/components/features/agenda/agenda-view'
import { UpcomingJobs } from '@/components/features/agenda/upcoming-jobs'
export type { Job, View }
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Banknote,
  Bell,
  BookOpen,
  Calculator,
  Check,
  ChevronRight,
  CircleDollarSign,
  CalendarDays,
  Pencil,
  Trash2,
  Upload,
  ClipboardList,
  FileText,
  Home,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Menu,
  MoreHorizontal,
  Package,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wrench,
  X,
} from 'lucide-react'

export type AppShellProps = {
  userId: string
  jobs: Job[]
  profile: {
    fullName: string
    phone: string | null
    email: string
    unitValue: number
    cuit: string | null
    address: string | null
    city: string | null
    province: string | null
  }
  paymentDetails: {
    bank: string | null
    alias: string | null
    cbu: string | null
    accountHolder: string | null
    holderCuit: string | null
    mercadoPagoAlias: string | null
    notes: string | null
  } | null
  customers: { id: string; name: string; phone: string | null; email: string | null; address: string | null }[]
  subscription: SubscriptionInfo
  access: AccessView
  /** Aviso a mostrar arriba (calculado en el servidor: bloqueo, avisos de la tabla o aviso por fase). */
  banner: Banner | null
  billing: BillingInfo
  initialView?: View
  trades: { all: { id: string; name: string; slug: string }[]; enabledIds: string[]; limit: number | null }
  isAdminUser: boolean
}

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Inicio', icon: Home },
  { id: 'prices', label: 'Precios', icon: Search },
  { id: 'my-list', label: 'Mi lista', icon: ListChecks },
  { id: 'trades', label: 'Mis oficios', icon: BookOpen },
]

function Logo() {
  return <div className="flex items-center gap-2.5"><div className="flex size-9 items-center justify-center rounded-xl bg-[var(--oc-brand)] text-white"><Wrench className="size-4.5" /></div><span className="text-[17px] font-bold tracking-tight text-[var(--oc-brand)]">Oficio<span className="text-[var(--oc-coral)]">Claro</span></span></div>
}

function PriceCard({ job, onOpen, mode = 'mine' }: { job: Job; onOpen: () => void; mode?: 'master' | 'mine' }) {
  const primary = mode === 'master' ? { label: 'General', value: job.regional, cls: 'text-[var(--oc-ink)]' } : { label: 'Mi precio', value: job.personal, cls: 'text-[var(--oc-brand)]' }
  const secondary = mode === 'master' ? { label: 'Mi precio', value: job.personal } : { label: 'General', value: job.regional }
  return <button onClick={onOpen} className="group flex w-full flex-col gap-3 rounded-2xl border border-[var(--oc-border-soft)] bg-[var(--oc-surface)] p-4 text-left transition hover:border-[#abc5d4] hover:shadow-sm">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-[var(--oc-ink)]">{job.name}</h3><p className="mt-1 text-xs text-[var(--oc-muted)]">{job.category} · {job.unit}</p></div><ChevronRight className="mt-0.5 size-4 text-[#9aa7ac] transition group-hover:translate-x-0.5" /></div>
    <div className="flex items-end justify-between border-t border-[var(--oc-border-soft)] pt-3"><div><p className="text-[11px] text-[var(--oc-muted)]">{primary.label}</p><p className={`text-xl font-bold tracking-tight ${primary.cls}`}>{money(primary.value)}</p></div><div className="text-right"><p className="text-[11px] text-[var(--oc-muted)]">{secondary.label}</p><p className="text-sm font-semibold text-[var(--oc-ink)]">{money(secondary.value)}</p></div></div>
  </button>
}

function SearchBox({ value, onChange, placeholder = 'Buscar un trabajo...' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <div className="flex h-14 items-center gap-3 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-4 shadow-sm focus-within:border-[#6593a8] focus-within:ring-4 focus-within:ring-[#dcebf2]"><Search className="size-5 shrink-0 text-[#73858d]" /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--oc-ink)] outline-none placeholder:text-[#96a2a6]" /><span className="hidden rounded-md bg-[var(--oc-brand-soft)] px-2.5 py-1 text-[10px] font-bold text-[var(--oc-brand)] sm:block">Ir</span></div>
}

function AppHeader({ title, onMenu, name }: { title?: string; onMenu: () => void; name: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('') || '·'
  return <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[var(--oc-border)] bg-[var(--oc-page)]/95 px-5 backdrop-blur md:px-8"><div className="flex items-center gap-4"><button onClick={onMenu} className="rounded-lg p-2 text-[var(--oc-muted)] hover:bg-[var(--oc-neutral-bg)] md:hidden" aria-label="Abrir menú"><Menu className="size-5" /></button><div className="md:hidden"><Logo /></div>{title && <h1 className="hidden text-xl font-bold text-[var(--oc-ink)] md:block">{title}</h1>}</div><div className="flex items-center gap-3"><ThemePicker /><button className="relative rounded-full p-2 text-[#61727a] hover:bg-[var(--oc-neutral-bg)]" aria-label="Notificaciones"><Bell className="size-5" /><span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--oc-coral)]" /></button><div className="hidden items-center gap-2 md:flex"><div className="flex size-9 items-center justify-center rounded-full bg-[var(--oc-brand-soft)] text-sm font-bold text-[var(--oc-brand)]">{initials}</div><span className="text-sm font-semibold text-[#ff9b79]">{name}</span></div></div></header>
}

function Sidebar({ view, setView, isAdminUser }: { view: View; setView: (v: View) => void; isAdminUser: boolean }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col overflow-y-auto border-r border-[var(--oc-border)] bg-[var(--oc-surface-muted)] px-4 py-6 md:flex">
      <div className="px-3"><Logo /></div>

      {isAdminUser && (
        <div className="mt-6 border-b border-[var(--oc-border-soft)] pb-4">
          <a href="/admin" className="flex items-center gap-3 rounded-xl bg-[var(--oc-brand-soft)] px-3 py-3 text-sm font-semibold text-[var(--oc-brand)] hover:brightness-95"><ShieldCheck className="size-[18px]" />Panel admin</a>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-1">
        {navItems.map(({ id, label, icon: Icon }) => (
          <div key={id} role="button" tabIndex={0} onClick={() => setView(id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView(id) }} className={`oc-nav-button flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === id ? 'bg-[var(--oc-nav-active)] text-[var(--oc-brand)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]'}`}>
            <Icon className="size-[18px]" />{label}
          </div>
        ))}
        <div role="button" tabIndex={0} onClick={() => setView('clients')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView('clients') }} className={`oc-nav-button flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === 'clients' ? 'bg-[var(--oc-nav-active)] text-[var(--oc-brand)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]'}`}>
          <Users className="size-[18px]" />Mis clientes
        </div>
        <div role="button" tabIndex={0} onClick={() => setView('agenda')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView('agenda') }} className={`oc-nav-button flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === 'agenda' ? 'bg-[var(--oc-nav-active)] text-[var(--oc-brand)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]'}`}>
          <CalendarDays className="size-[18px]" />Agenda
        </div>
        <div role="button" tabIndex={0} onClick={() => setView('budgets')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView('budgets') }} className={`oc-nav-button flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === 'budgets' ? 'bg-[var(--oc-nav-active)] text-[var(--oc-brand)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]'}`}>
          <FileText className="size-[18px]" />Presupuestos
        </div>
        <div role="button" tabIndex={0} onClick={() => setView('my-catalog')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView('my-catalog') }} className={`oc-nav-button flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === 'my-catalog' ? 'bg-[var(--oc-nav-active)] text-[var(--oc-brand)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]'}`}>
          <Package className="size-[18px]" />Mi catálogo
        </div>
        <div role="button" tabIndex={0} onClick={() => setView('subscription')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView('subscription') }} className={`oc-nav-button flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === 'subscription' ? 'bg-[var(--oc-nav-active)] text-[var(--oc-brand)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]'}`}>
          <ShieldCheck className="size-[18px]" />Suscripción
        </div>
        <div role="button" tabIndex={0} onClick={() => setView('profile')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView('profile') }} className={`oc-nav-button flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === 'profile' ? 'bg-[var(--oc-nav-active)] text-[var(--oc-brand)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]'}`}>
          <Settings className="size-[18px]" />Mi perfil
        </div>
      </div>

      <SignOutForm action={signOut} className="mt-auto border-t border-[var(--oc-border-soft)] pt-4"><button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--oc-coral)] hover:bg-[var(--oc-surface-soft)]"><X className="size-[18px]" />Cerrar sesión</button></SignOutForm>
    </aside>
  )
}

function BottomNav({ view, setView }: { view: View; setView: (v: View) => void }) { return <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[72px] grid-cols-5 border-t border-[var(--oc-border)] bg-[var(--oc-surface)]/95 px-2 pb-1 backdrop-blur md:hidden">{[...navItems, { id: 'profile' as View, label: 'Perfil', icon: Settings }].map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setView(id)} className={`oc-bottom-nav-button flex flex-col items-center justify-center gap-1 text-[10px] font-semibold ${view === id ? 'text-[var(--oc-brand)]' : 'text-[#849096]'}`}><Icon className="size-[19px]" />{label}</button>)}</nav> }

function HomePage({ setView, setSelected, jobs, summary, firstName, onAgenda }: { setView: (v: View) => void; setSelected: (j: Job) => void; jobs: Job[]; summary: ReturnType<typeof buildAccountSummary>; firstName: string; onAgenda: (intent: AgendaIntent | null) => void }) {
  const [query, setQuery] = useState('')
  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const todayLabel = today.charAt(0).toUpperCase() + today.slice(1)

  return <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
    {/* 1. Encabezado */}
    <div className="mb-7"><p className="text-sm font-medium text-[var(--oc-muted)]">{todayLabel}</p><h1 className="mt-1 text-[28px] font-bold tracking-tight text-[var(--oc-ink)]">Hola, <span className="text-[var(--oc-coral)]">{firstName}</span>.</h1><p className="mt-1 text-sm text-[var(--oc-muted)]">Tenés tus precios y tus trabajos a mano.</p></div>

    <AccountNotices notices={summary.notices} onOpen={() => setView('subscription')} />

    {/* 2. Acción principal: consulta de precios */}
    <section className="rounded-3xl bg-[var(--oc-brand-strong)] p-5 text-white shadow-[0_12px_30px_rgba(23,63,95,0.14)] md:p-7">
      <div className="max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#a9c5d3]">Tu consulta rápida</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">¿Qué trabajo necesitás consultar?</h2>
        <div className="mt-5"><SearchBox value={query} onChange={setQuery} placeholder="Ej.: cambio de canilla" /></div>
        {query && (
          <div className="mt-2 overflow-hidden rounded-2xl bg-[var(--oc-surface)] text-[var(--oc-ink)] shadow-lg">
            {jobs.filter((j) => `${j.name} ${j.category}`.toLowerCase().includes(query.toLowerCase())).slice(0, 3).map((job) => (
              <button key={job.id} onClick={() => { setSelected(job); setView('prices') }} className="flex w-full items-center justify-between border-b border-[var(--oc-border-soft)] px-4 py-3 text-left last:border-0">
                <span><span className="block text-sm font-semibold">{job.name}</span><span className="text-xs text-[var(--oc-muted)]">{job.category}</span></span>
                <span className="font-bold text-[var(--oc-brand)]">{money(job.personal)}</span>
              </button>
            ))}
            {jobs.filter((j) => `${j.name} ${j.category}`.toLowerCase().includes(query.toLowerCase())).length === 0 && (
              <p className="px-4 py-3 text-sm text-[var(--oc-muted)]">No encontramos ese trabajo en tu lista.</p>
            )}
          </div>
        )}
      </div>
    </section>

    {/* 3. Accesos rápidos */}
    <section className="mt-7">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-[var(--oc-ink)]">Accesos rápidos</h2></div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:max-w-2xl md:gap-3">
        <button onClick={() => setView('prices')} className="flex min-h-[100px] flex-col justify-between rounded-2xl bg-[var(--oc-brand-soft)] p-3.5 text-left text-[var(--oc-brand)] transition hover:bg-[var(--oc-brand-soft)]"><Search className="size-5" /><span className="text-sm font-bold">Consultar<br />precios</span></button>
        <button onClick={() => setView('my-list')} className="flex min-h-[100px] flex-col justify-between rounded-2xl bg-[var(--oc-warm-bg)] p-3.5 text-left text-[var(--oc-warm-text)] transition hover:bg-[var(--oc-warm-bg-hover)]"><ListChecks className="size-5" /><span className="text-sm font-bold">Mi<br />lista</span></button>
        <button onClick={() => setView('budgets')} className="flex min-h-[100px] flex-col justify-between rounded-2xl bg-[var(--oc-sage-bg)] p-3.5 text-left text-[var(--oc-sage-text)] transition hover:bg-[var(--oc-sage-bg-hover)]"><FileText className="size-5" /><span className="text-sm font-bold">Presupuestos</span></button>
        <button onClick={() => onAgenda(null)} className="flex min-h-[100px] flex-col justify-between rounded-2xl bg-[var(--oc-blue-bg)] p-3.5 text-left text-[var(--oc-blue-text)] transition hover:brightness-95"><CalendarDays className="size-5" /><span className="text-sm font-bold">Agenda</span></button>
      </div>
    </section>

    {/* 4/5/6. Tu actividad, tu lista y suscripción — solo con datos reales */}
    <div className="mt-7 grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
        <div className="flex items-start justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-[#8a979a]">Tu lista de precios</p><p className="mt-1 text-xl font-bold text-[#2f414a]">{jobs.length} trabajo{jobs.length === 1 ? '' : 's'} disponible{jobs.length === 1 ? '' : 's'}</p></div>
          <div className="rounded-xl bg-[var(--oc-warm-bg)] p-2.5 text-[var(--oc-warm-strong)]"><Sparkles className="size-5" /></div>
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-[var(--oc-border-soft)] pt-4 text-sm"><span className="text-[var(--oc-muted)]">Actualización de precios</span><span className="font-semibold text-[#344d5a]">Próxima actualización</span></div>
        <button onClick={() => setView('my-list')} className="mt-4 flex items-center gap-1 text-sm font-bold text-[var(--oc-brand)]">Ver mi lista <ArrowRight className="size-4" /></button>
      </div>
      <AccountSummaryCard summary={summary} onAction={() => setView('subscription')} />
    </div>

    {/* Próximos trabajos (agenda) */}
    <div className="mt-4 grid gap-4 md:grid-cols-2"><UpcomingJobs onOpenAgenda={() => onAgenda(null)} onNew={() => onAgenda({ kind: 'new' })} /></div>

    {/* 7. Mensaje de valor */}
    <p className="mt-7 text-center text-xs text-[var(--oc-muted)]">OficioClaro te ayuda a tener tus precios claros y listos para consultar cuando los necesitás.</p>
  </div>
}

function Prices({ setView, setSelected, enabledTrades }: { setView: (v: View) => void; setSelected: (j: Job) => void; enabledTrades: { id: string; name: string }[] }) {
  const [mode, setMode] = useState<'master' | 'mine'>('master')
  return <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8"><div className="mb-6"><p className="text-sm text-[var(--oc-muted)]">Precios de referencia de OficioClaro</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Lista maestra</h1></div><div className="mb-4 inline-flex rounded-full border border-[var(--oc-border)] bg-[var(--oc-surface)] p-1"><button onClick={() => setMode('master')} className={`rounded-full px-4 py-1.5 text-xs font-bold ${mode === 'master' ? 'bg-[var(--oc-brand)] text-white' : 'text-[var(--oc-muted)]'}`}>Lista maestra</button><button onClick={() => setMode('mine')} className={`rounded-full px-4 py-1.5 text-xs font-bold ${mode === 'mine' ? 'bg-[var(--oc-brand)] text-white' : 'text-[var(--oc-muted)]'}`}>Mi lista</button></div><TradeCatalog trades={enabledTrades} mode={mode} onOpen={(job) => { setSelected(job); setView('prices-detail' as View) }} /></div>
}

function Detail({ job, setView, unitValue }: { job: Job; setView: (v: View) => void; unitValue: number }) { const [personal, setPersonal] = useState(job.personal); const [pending, startTransition] = useTransition(); return <div className="mx-auto max-w-[720px] p-5 pb-28 md:p-8"><button onClick={() => setView('prices')} className="mb-6 flex items-center gap-2 text-sm font-semibold text-[var(--oc-brand)]"><ArrowLeft className="size-4" />Volver a precios</button><div className="rounded-3xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5 md:p-7"><div className="flex items-start justify-between"><div><Badge tone="blue">{job.category}</Badge><h1 className="mt-3 text-2xl font-bold text-[var(--oc-ink)]">{job.name}</h1><p className="mt-1 text-sm text-[var(--oc-muted)]">Unidad: {job.unit}</p></div><div className="rounded-2xl bg-[var(--oc-surface-soft)] p-3 text-[#5d7278]"><Calculator className="size-5" /></div></div><div className="mt-7 rounded-2xl bg-[var(--oc-surface-muted)] p-4"><p className="text-xs text-[#819097]">Precio general (lista de OficioClaro)</p><p className="mt-1 text-xl font-bold text-[#455a63]">{money(job.base)}</p>{job.masterUtQty != null && <p className="mt-1 text-[11px] text-[#819097]">= {job.masterUtQty} UT maestro × {job.masterUtValue != null ? money(job.masterUtValue) : '—'} (valor UT vigente)</p>}</div><div className="mt-5 rounded-2xl border-2 border-[var(--oc-warm-border)] bg-[var(--oc-warm-card)] p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-[var(--oc-warm-label)]">MI PRECIO</p><p className="mt-1 text-3xl font-bold tracking-tight text-[var(--oc-warm-strong)]">{money(personal)}{pending && '…'}</p>{job.personalUtQty != null && <p className="mt-1 text-[11px] text-[var(--oc-warm-label)]">= {job.personalUtQty} UT personalizada × {money(unitValue)} (mi UT)</p>}</div><button onClick={() => { const value = window.prompt('¿Cuál es tu precio para este trabajo?', String(personal)); if (!value) return; const next = Number(value.replace(/\D/g, '')) || personal; setPersonal(next); startTransition(() => { setMyPrice(job.id, next) }) }} className="rounded-xl bg-[var(--oc-coral)] px-3.5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#cf6c52]">Editar mi precio</button></div></div><div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--oc-border-soft)] pt-5"><div><p className="text-xs text-[#819097]">UT maestro (catálogo)</p><p className="mt-1 font-bold text-[var(--oc-ink)]">{job.masterUtQty ?? '—'}</p></div><div><p className="text-xs text-[#819097]">UT personalizada (mía)</p><p className="mt-1 font-bold text-[var(--oc-ink)]">{job.personalUtQty ?? 'Sin definir'}</p></div><div><p className="text-xs text-[#819097]">Valor UT maestro vigente</p><p className="mt-1 font-bold text-[var(--oc-ink)]">{job.masterUtValue != null ? money(job.masterUtValue) : '—'}</p></div><div className="text-right"><p className="text-xs text-[#819097]">Mi valor de UT</p><p className="mt-1 font-bold text-[var(--oc-ink)]">{money(unitValue)}</p><button onClick={() => { const value = window.prompt('UT propia para esta tarea (vacío = usar la UT maestro)', job.personalUtQty != null ? String(job.personalUtQty) : ''); if (value === null) return; const ut = Number(value.replace(',', '.')); if (!ut) return; startTransition(() => { setMyTaskUt(job.id, ut) }) }} className="mt-1 text-[11px] font-bold text-[var(--oc-brand)] underline">Recalcular con mi UT</button></div></div></div></div> }

function MyList({ setView, setSelected, enabledTrades, unitValue }: { setView: (v: View) => void; setSelected: (j: Job) => void; enabledTrades: { id: string; name: string }[]; unitValue: number }) {
  return <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
    <div className="mb-6"><p className="text-sm text-[var(--oc-muted)]">Tu lista personalizada</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mi lista</h1></div>
    <TradeCatalog trades={enabledTrades} mode="mine" onOpen={(job) => { setSelected(job); setView('prices' as View) }} />
    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="fixed bottom-24 right-5 z-10 flex items-center gap-1.5 rounded-full bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white shadow-lg md:bottom-6"><ArrowUp className="size-3.5" />TOP</button>
    <div className="mt-2 flex items-center gap-3 rounded-2xl bg-[var(--oc-warm-bg)] p-4 text-[var(--oc-warm-text)]"><CircleDollarSign className="size-5 shrink-0" /><div><p className="text-sm font-bold">Tu valor de UT es {money(unitValue)}</p><p className="mt-0.5 text-xs">Al cambiarlo, se actualizan los trabajos vinculados.</p></div><button onClick={() => setView('profile')} className="ml-auto shrink-0 text-xs font-bold underline">Modificar</button></div>
  </div>
}

export function AppShell({ userId, jobs, profile, paymentDetails, customers, subscription, access, banner, billing, initialView, trades, isAdminUser }: AppShellProps) {
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const [view, setView] = useState<View>(initialView ?? 'home')
  const [selected, setSelected] = useState<Job | null>(jobs[0] ?? null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [agendaIntent, setAgendaIntent] = useState<AgendaIntent | null>(null)
  const [openClientId, setOpenClientId] = useState<string | null>(null)
  const [quoteIntent, setQuoteIntent] = useState<QuoteIntent | null>(null)
  const [payPending] = useTransition()
  const goAgenda = useCallback((intent: AgendaIntent | null) => { setAgendaIntent(intent); setView('agenda') }, [])
  const clearAgendaIntent = useCallback(() => setAgendaIntent(null), [])
  const goQuote = useCallback((intent: QuoteIntent) => { setQuoteIntent(intent); setView('budgets') }, [])
  const clearQuoteIntent = useCallback(() => setQuoteIntent(null), [])
  const openClient = useCallback((id: string) => { setOpenClientId(id); setView('clients') }, [])
  useEffect(() => { if (view !== 'clients') setOpenClientId(null) }, [view])
  const firstName = profile.fullName.split(' ')[0] || profile.fullName
  const noTrades = trades.enabledIds.length === 0
  const enabledTrades = trades.all.filter((t) => trades.enabledIds.includes(t.id))

  // Devuelve el resultado real de la acción (antes se descartaba: el usuario no veía errores ni confirmación).
  async function handleReportPayment(formData: FormData) {
    if (!subscription) return { error: 'Necesitás una suscripción antes de informar un pago.' }
    return reportTransferPayment(subscription.id, formData)
  }

  const accountSummary = useMemo(
    () => buildAccountSummary({ subscription: subscription ? { planName: subscription.planName, state: subscription.state, endDate: subscription.endDate } : null, access: { daysToEnd: access.daysToEnd, locked: access.locked }, payments: billing.payments }),
    [subscription, access.daysToEnd, access.locked, billing.payments],
  )

  const render = () => {
    if ((view === 'prices' || (view as string) === 'prices-detail' || view === 'my-list') && noTrades) {
      return <div className="mx-auto max-w-md p-8 pb-28 text-center"><p className="font-bold text-[var(--oc-ink)]">Todavía no agregaste ningún oficio.</p><p className="mt-1 text-sm text-[var(--oc-muted)]">Activá tu actividad para ver y personalizar tu lista de precios.</p><button onClick={() => setView('trades')} className="mt-4 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white">Ir a Mis oficios</button></div>
    }
    if (view === 'trades') return <MisOficios setView={setView} trades={trades} />
    if (view === 'home') return <HomePage setView={setView} setSelected={setSelected} jobs={jobs} summary={accountSummary} firstName={firstName} onAgenda={goAgenda} />
    if (view === 'prices') return <Prices setView={setView} setSelected={setSelected} enabledTrades={enabledTrades} />
    if ((view as string) === 'prices-detail') return <Detail job={selected!} setView={setView} unitValue={profile.unitValue} />
    if (view === 'my-list') return <MyList setView={setView} setSelected={setSelected} enabledTrades={enabledTrades} unitValue={profile.unitValue} />
    if (view === 'clients') return <ClientsUpdated customers={customers} initialOpenId={openClientId} onSchedule={(customerId) => goAgenda({ kind: 'new', customerId })} onQuote={(customerId) => goQuote({ kind: 'new', customerId })} onOpenJob={(jobId) => goAgenda({ kind: 'open', jobId })} />
    if (view === 'agenda') return <AgendaView intent={agendaIntent} onIntentHandled={clearAgendaIntent} onOpenClient={openClient} onQuote={(c) => goQuote(c.quoteId ? { kind: 'open', quoteId: c.quoteId } : { kind: 'new', customerId: c.customerId, jobId: c.jobId })} />
    if (view === 'profile') return <Profile setView={setView} profile={profile} paymentDetails={paymentDetails} summary={accountSummary} />
    if (view === 'subscription') return <SubscriptionView subscription={subscription} billing={billing} onReportPayment={handleReportPayment} reportPending={payPending} daysToEnd={access.daysToEnd} />
    if (view === 'budgets') return <QuotesView intent={quoteIntent} onIntentHandled={clearQuoteIntent} onSchedule={(quoteId) => goAgenda({ kind: 'from-quote', quoteId })} onBackToAgenda={(jobId) => goAgenda({ kind: 'open', jobId })} onOpenJob={(jobId) => goAgenda({ kind: 'open', jobId })} />
    if (view === 'my-catalog') return <OwnCatalogView />
    return <Proximamente title="Presupuestos" />
  }

  const notice = banner && banner.id !== dismissedId ? banner : null
  const dismiss = notice?.dismissible && notice.id ? () => { setDismissedId(notice.id); void dismissNotification(notice.id!) } : undefined

  // Suscripción vencida (fuera de gracia) o prueba terminada: puede entrar, pero solo ve Suscripción/pago.
  if (access.locked) {
    return (
      <div className="min-h-screen bg-[var(--oc-page)] text-[var(--oc-ink)]">
        <PurgeLocalCache keepDrafts />
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[var(--oc-border)] bg-[var(--oc-page)]/95 px-5 backdrop-blur md:px-8">
          <Logo />
          <div className="flex items-center gap-3"><span className="hidden text-sm font-semibold text-[var(--oc-muted)] sm:block">{profile.fullName}</span>
            <SignOutForm action={signOut}><button type="submit" className="rounded-xl px-3 py-2 text-sm font-semibold text-[var(--oc-coral)] hover:bg-[var(--oc-surface-soft)]">Cerrar sesión</button></SignOutForm></div>
        </header>
        {notice && <AccessBanner notice={notice} />}
        <SubscriptionView subscription={subscription} billing={billing} onReportPayment={handleReportPayment} reportPending={payPending} daysToEnd={access.daysToEnd} />
      </div>
    )
  }

  return <div className="min-h-screen bg-[var(--oc-page)] text-[var(--oc-ink)]"><LocalCacheSession userId={userId} /><div className="flex min-h-screen"><Sidebar view={view} setView={setView} isAdminUser={isAdminUser} /><div className="min-w-0 flex-1"><AppHeader onMenu={() => setMenuOpen(true)} name={profile.fullName} />{notice && <AccessBanner notice={notice} actionLabel={view !== 'subscription' && !notice.dismissible ? 'Ver suscripción' : undefined} onAction={() => setView('subscription')} onDismiss={dismiss} />}{render()}</div></div><BottomNav view={view} setView={setView} />{menuOpen && <div className="fixed inset-0 z-40 bg-[var(--oc-brand)]/20 md:hidden" onClick={() => setMenuOpen(false)}><div className="h-full w-[280px] bg-[var(--oc-surface-muted)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between"><Logo /><button onClick={() => setMenuOpen(false)} aria-label="Cerrar menú"><X className="size-5 text-[var(--oc-muted)]" /></button></div><div className="mt-8 flex flex-col gap-1">{[...navItems, { id: 'profile' as View, label: 'Mi perfil', icon: Settings }, { id: 'clients' as View, label: 'Mis clientes', icon: Users }, { id: 'agenda' as View, label: 'Agenda', icon: CalendarDays }, { id: 'budgets' as View, label: 'Presupuestos', icon: FileText }, { id: 'my-catalog' as View, label: 'Mi catálogo', icon: Package }, { id: 'subscription' as View, label: 'Suscripción', icon: ShieldCheck }].map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setView(id); setMenuOpen(false) }} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]"><Icon className="size-[18px]" />{label}</button>)}{isAdminUser && <a href="/admin" className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]"><ShieldCheck className="size-[18px]" />Panel admin</a>}<SignOutForm action={signOut}><button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--oc-coral)] hover:bg-[var(--oc-surface-soft)]"><X className="size-[18px]" />Cerrar sesión</button></SignOutForm></div></div></div>}</div>
}
