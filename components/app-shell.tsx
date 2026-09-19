'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { setMyPrice, setMyTaskUt } from '@/lib/actions/userPricing'
import { reportTransferPayment } from '@/lib/actions/payments'
import { signOut } from '@/lib/actions/auth'
import { money } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import type { Job, View } from '@/components/types'
import { ClientsUpdated } from '@/components/features/clients/clients-view'
import { MisOficios } from '@/components/features/trades/mis-oficios'
import { Profile } from '@/components/features/profile/profile-view'
import { Proximamente } from '@/components/ui/proximamente'
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
  subscription: { id: string; planName: string; status: string; endDate: string | null } | null
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

function PriceCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  return <button onClick={onOpen} className="group flex w-full flex-col gap-3 rounded-2xl border border-[#e4e8e7] bg-[var(--oc-surface)] p-4 text-left transition hover:border-[#abc5d4] hover:shadow-sm">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-[var(--oc-ink)]">{job.name}</h3><p className="mt-1 text-xs text-[var(--oc-muted)]">{job.category} · {job.unit}</p></div><ChevronRight className="mt-0.5 size-4 text-[#9aa7ac] transition group-hover:translate-x-0.5" /></div>
    <div className="flex items-end justify-between border-t border-[var(--oc-border-soft)] pt-3"><div><p className="text-[11px] text-[var(--oc-muted)]">Mi precio</p><p className="text-xl font-bold tracking-tight text-[var(--oc-brand)]">{money(job.personal)}</p></div><div className="text-right"><p className="text-[11px] text-[var(--oc-muted)]">General</p><p className="text-sm font-semibold text-[var(--oc-ink)]">{money(job.regional)}</p></div></div>
  </button>
}

function SearchBox({ value, onChange, placeholder = 'Buscar un trabajo...' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <div className="flex h-14 items-center gap-3 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] px-4 shadow-sm focus-within:border-[#6593a8] focus-within:ring-4 focus-within:ring-[#dcebf2]"><Search className="size-5 shrink-0 text-[#73858d]" /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--oc-ink)] outline-none placeholder:text-[#96a2a6]" /><span className="hidden rounded-md bg-[var(--oc-brand-soft)] px-2.5 py-1 text-[10px] font-bold text-[var(--oc-brand)] sm:block">Ir</span></div>
}

function ThemePicker() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')

  useEffect(() => {
    const saved = window.localStorage.getItem('oficioclaro-theme') as 'light' | 'dark' | 'system' | null
    const next = saved || 'system'
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark' || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.toggle('light', next === 'light')
  }, [])

  const updateTheme = (next: 'light' | 'dark' | 'system') => {
    setTheme(next)
    window.localStorage.setItem('oficioclaro-theme', next)
    document.documentElement.classList.toggle('dark', next === 'dark' || (next === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.toggle('light', next === 'light')
  }

  return <div className="flex items-center gap-1 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-surface-muted)] p-1" aria-label="Tema de color">
    {([['light', 'Claro'], ['dark', 'Oscuro'], ['system', 'Sistema']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => updateTheme(value)} aria-pressed={theme === value} className={`rounded-lg px-1.5 py-1.5 text-[10px] font-semibold transition sm:px-2 sm:text-[11px] ${value === 'system' ? 'hidden sm:block' : ''} ${theme === value ? 'bg-[var(--oc-surface)] text-[var(--oc-brand)] shadow-sm' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface)]'}`}>{label}</button>)}
  </div>
}

function AppHeader({ title, onMenu, name }: { title?: string; onMenu: () => void; name: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('') || '·'
  return <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[var(--oc-border)] bg-[var(--oc-page)]/95 px-5 backdrop-blur md:px-8"><div className="flex items-center gap-4"><button onClick={onMenu} className="rounded-lg p-2 text-[var(--oc-muted)] hover:bg-[#eef2f1] md:hidden" aria-label="Abrir menú"><Menu className="size-5" /></button><div className="md:hidden"><Logo /></div>{title && <h1 className="hidden text-xl font-bold text-[var(--oc-ink)] md:block">{title}</h1>}</div><div className="flex items-center gap-3"><ThemePicker /><button className="relative rounded-full p-2 text-[#61727a] hover:bg-[#eef2f1]" aria-label="Notificaciones"><Bell className="size-5" /><span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--oc-coral)]" /></button><div className="hidden items-center gap-2 md:flex"><div className="flex size-9 items-center justify-center rounded-full bg-[var(--oc-brand-soft)] text-sm font-bold text-[var(--oc-brand)]">{initials}</div><span className="text-sm font-semibold text-[#ff9b79]">{name}</span></div></div></header>
}

function Sidebar({ view, setView, isAdminUser }: { view: View; setView: (v: View) => void; isAdminUser: boolean }) {
  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[var(--oc-border)] bg-[var(--oc-surface-muted)] px-4 py-6 md:flex">
      <div className="px-3"><Logo /></div>
      <div className="mt-10 flex flex-col gap-1">
        {navItems.map(({ id, label, icon: Icon }) => (
          <div key={id} role="button" tabIndex={0} onClick={() => setView(id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView(id) }} className={`oc-nav-button flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${view === id ? 'bg-[var(--oc-nav-active)] text-[var(--oc-brand)]' : 'text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]'}`}>
            <Icon className="size-[18px]" />{label}
          </div>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t border-[#e1e7e4] pt-4">
        <button type="button" onClick={() => setView('profile')} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]"><Settings className="size-[18px]" />Mi perfil</button>
        {isAdminUser && <a href="/admin" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]"><ShieldCheck className="size-[18px]" />Panel admin</a>}
        <form action={signOut}><button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--oc-coral)] hover:bg-[var(--oc-surface-soft)]"><X className="size-[18px]" />Cerrar sesión</button></form>
      </div>
    </aside>
  )
}

function BottomNav({ view, setView }: { view: View; setView: (v: View) => void }) { return <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[72px] grid-cols-5 border-t border-[var(--oc-border)] bg-[var(--oc-surface)]/95 px-2 pb-1 backdrop-blur md:hidden">{[...navItems, { id: 'profile' as View, label: 'Perfil', icon: Settings }].map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setView(id)} className={`oc-bottom-nav-button flex flex-col items-center justify-center gap-1 text-[10px] font-semibold ${view === id ? 'text-[var(--oc-brand)]' : 'text-[#849096]'}`}><Icon className="size-[19px]" />{label}</button>)}</nav> }

function HomePage({ setView, setSelected, jobs, subscription, firstName }: { setView: (v: View) => void; setSelected: (j: Job) => void; jobs: Job[]; subscription: AppShellProps['subscription']; firstName: string }) {
  const [query, setQuery] = useState('')
  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  const todayLabel = today.charAt(0).toUpperCase() + today.slice(1)
  const subLabel = subscription?.status === 'active' ? 'Activa' : subscription?.status === 'trial' ? 'Prueba' : subscription ? subscription.status : 'Sin plan'

  return <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
    {/* 1. Encabezado */}
    <div className="mb-7"><p className="text-sm font-medium text-[var(--oc-muted)]">{todayLabel}</p><h1 className="mt-1 text-[28px] font-bold tracking-tight text-[var(--oc-ink)]">Hola, <span className="text-[var(--oc-coral)]">{firstName}</span>.</h1><p className="mt-1 text-sm text-[var(--oc-muted)]">Tenés tus precios y tus trabajos a mano.</p></div>

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
      <div className="grid grid-cols-3 gap-2.5 md:max-w-lg md:gap-3">
        <button onClick={() => setView('prices')} className="flex min-h-[100px] flex-col justify-between rounded-2xl bg-[var(--oc-brand-soft)] p-3.5 text-left text-[var(--oc-brand)] transition hover:bg-[#dceaf0]"><Search className="size-5" /><span className="text-sm font-bold">Consultar<br />precios</span></button>
        <button onClick={() => setView('my-list')} className="flex min-h-[100px] flex-col justify-between rounded-2xl bg-[#f5eee7] p-3.5 text-left text-[#754936] transition hover:bg-[#f1e5db]"><ListChecks className="size-5" /><span className="text-sm font-bold">Mi<br />lista</span></button>
        <button onClick={() => setView('budgets')} className="flex min-h-[100px] flex-col justify-between rounded-2xl bg-[#edf1eb] p-3.5 text-left text-[#47634f] transition hover:bg-[#e3eae1]"><FileText className="size-5" /><span className="text-sm font-bold">Presupuestos</span><span className="text-[11px] font-semibold opacity-70">Próximamente</span></button>
      </div>
    </section>

    {/* 4/5/6. Tu actividad, tu lista y suscripción — solo con datos reales */}
    <div className="mt-7 grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
        <div className="flex items-start justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-[#8a979a]">Tu lista de precios</p><p className="mt-1 text-xl font-bold text-[#2f414a]">{jobs.length} trabajo{jobs.length === 1 ? '' : 's'} disponible{jobs.length === 1 ? '' : 's'}</p></div>
          <div className="rounded-xl bg-[#f5eee7] p-2.5 text-[#b56e4e]"><Sparkles className="size-5" /></div>
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-[var(--oc-border-soft)] pt-4 text-sm"><span className="text-[var(--oc-muted)]">Actualización de precios</span><span className="font-semibold text-[#344d5a]">Próxima actualización</span></div>
        <button onClick={() => setView('my-list')} className="mt-4 flex items-center gap-1 text-sm font-bold text-[var(--oc-brand)]">Ver mi lista <ArrowRight className="size-4" /></button>
      </div>
      <div className="rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5">
        <div className="flex items-start justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-[#8a979a]">Estado de cuenta</p><p className="mt-1 text-xl font-bold text-[#2f414a]">{subscription?.planName ?? 'Sin plan'}</p></div>
          <Badge tone={subscription?.status === 'active' ? 'success' : 'warning'}>{subLabel}</Badge>
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-[var(--oc-border-soft)] pt-4 text-sm"><span className="text-[var(--oc-muted)]">Próximo vencimiento</span><span className="font-semibold text-[#344d5a]">{subscription?.endDate ?? '—'}</span></div>
        <button onClick={() => setView('subscription')} className="mt-4 flex items-center gap-1 text-sm font-bold text-[var(--oc-brand)]">Ver mi suscripción <ArrowRight className="size-4" /></button>
      </div>
    </div>

    {/* 7. Mensaje de valor */}
    <p className="mt-7 text-center text-xs text-[var(--oc-muted)]">OficioClaro te ayuda a tener tus precios claros y listos para consultar cuando los necesitás.</p>
  </div>
}

function Prices({ setView, selected, setSelected, jobs }: { setView: (v: View) => void; selected: Job; setSelected: (j: Job) => void; jobs: Job[] }) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => jobs.filter((j) => `${j.name} ${j.category}`.toLowerCase().includes(query.toLowerCase())), [query])
  return <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8"><div className="mb-6"><p className="text-sm text-[var(--oc-muted)]">Lista maestra</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Consultar precios</h1></div><SearchBox value={query} onChange={setQuery} /><div className="mt-5 flex items-center justify-between"><p className="text-sm font-semibold text-[var(--oc-muted)]">{filtered.length} trabajos encontrados</p><button className="flex items-center gap-1.5 text-sm font-semibold text-[var(--oc-brand)]"><SlidersHorizontal className="size-4" />Filtrar</button></div><div className="mt-3 flex flex-col gap-3">{filtered.map((job) => <PriceCard key={job.id} job={job} onOpen={() => { setSelected(job); setView('prices-detail' as View) }} />)}{filtered.length === 0 && <div className="rounded-2xl border border-dashed border-[#cfdad6] p-10 text-center"><Search className="mx-auto size-8 text-[#a1afb0]" /><p className="mt-3 font-semibold text-[#52636a]">No encontramos ese trabajo</p><p className="mt-1 text-sm text-[var(--oc-muted)]">Probá con otra palabra, como “canilla” o “calefón”.</p></div>}</div></div>
}

function Detail({ job, setView, unitValue }: { job: Job; setView: (v: View) => void; unitValue: number }) { const [personal, setPersonal] = useState(job.personal); const [pending, startTransition] = useTransition(); return <div className="mx-auto max-w-[720px] p-5 pb-28 md:p-8"><button onClick={() => setView('prices')} className="mb-6 flex items-center gap-2 text-sm font-semibold text-[var(--oc-brand)]"><ArrowLeft className="size-4" />Volver a precios</button><div className="rounded-3xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5 md:p-7"><div className="flex items-start justify-between"><div><Badge tone="blue">{job.category}</Badge><h1 className="mt-3 text-2xl font-bold text-[var(--oc-ink)]">{job.name}</h1><p className="mt-1 text-sm text-[var(--oc-muted)]">Unidad: {job.unit}</p></div><div className="rounded-2xl bg-[var(--oc-surface-soft)] p-3 text-[#5d7278]"><Calculator className="size-5" /></div></div><div className="mt-7 rounded-2xl bg-[var(--oc-surface-muted)] p-4"><p className="text-xs text-[#819097]">Precio general (lista de OficioClaro)</p><p className="mt-1 text-xl font-bold text-[#455a63]">{money(job.base)}</p></div><div className="mt-5 rounded-2xl border-2 border-[#e8c7b6] bg-[#fffaf7] p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-[#93624d]">MI PRECIO</p><p className="mt-1 text-3xl font-bold tracking-tight text-[#ad6245]">{money(personal)}{pending && '…'}</p></div><button onClick={() => { const value = window.prompt('¿Cuál es tu precio para este trabajo?', String(personal)); if (!value) return; const next = Number(value.replace(/\D/g, '')) || personal; setPersonal(next); startTransition(() => { setMyPrice(job.id, next) }) }} className="rounded-xl bg-[var(--oc-coral)] px-3.5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#cf6c52]">Editar mi precio</button></div></div><div className="mt-6 flex items-center justify-between border-t border-[var(--oc-border-soft)] pt-5"><div><p className="text-xs text-[#819097]">Módulo utilizado</p><p className="mt-1 font-bold text-[var(--oc-ink)]">{job.module ?? '—'}</p></div><div className="text-right"><p className="text-xs text-[#819097]">Valor actual UT</p><p className="mt-1 font-bold text-[var(--oc-ink)]">{money(unitValue)}</p><button onClick={() => { const value = window.prompt('UT propia para esta tarea (vacío = usar la UT general)', job.module ? job.module.replace(' UT', '') : ''); if (value === null) return; const ut = Number(value.replace(',', '.')); if (!ut) return; startTransition(() => { setMyTaskUt(job.id, ut) }) }} className="mt-1 text-[11px] font-bold text-[var(--oc-brand)] underline">Recalcular con mi UT</button></div></div></div></div> }

function MyList({ setView, setSelected, jobs, unitValue }: { setView: (v: View) => void; setSelected: (j: Job) => void; jobs: Job[]; unitValue: number }) {
  const groups = jobs.reduce<Record<string, Job[]>>((acc, job) => { (acc[job.trade] ??= []).push(job); return acc }, {})
  return <div className="mx-auto max-w-[1040px] p-5 pb-28 md:p-8">
    <div className="mb-6"><p className="text-sm text-[var(--oc-muted)]">Tu lista personalizada</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mi lista</h1></div>
    {jobs.length === 0 ? <div className="rounded-2xl border border-dashed border-[#cfdad6] p-10 text-center"><p className="font-semibold text-[#52636a]">Todavía no tenés trabajos en tu lista.</p></div> : Object.entries(groups).map(([trade, tradeJobs]) => (
      <div key={trade} className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--oc-brand)]">{trade}</p>
        <div className="flex flex-col divide-y divide-[var(--oc-border-soft)] rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)]">
          {tradeJobs.map((job) => <button key={job.id} onClick={() => { setSelected(job); setView('prices' as View) }} className="flex min-h-14 items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-[var(--oc-surface-muted)] sm:px-4 sm:py-4"><span className="min-w-0"><span className="block truncate text-sm font-semibold text-[var(--oc-ink)]">{job.name}</span><span className="mt-1 block text-xs text-[var(--oc-muted)]">{job.category} · {job.unit}</span></span><span className="shrink-0 text-right"><span className="block text-sm font-bold text-[var(--oc-brand)]">{money(job.personal)}</span><span className="text-[11px] text-[var(--oc-muted)]">Mi precio</span></span></button>)}
        </div>
      </div>
    ))}
    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="fixed bottom-24 right-5 z-10 flex items-center gap-1.5 rounded-full bg-[var(--oc-brand)] px-3 py-2 text-xs font-bold text-white shadow-lg md:bottom-6"><ArrowUp className="size-3.5" />TOP</button>
    <div className="mt-2 flex items-center gap-3 rounded-2xl bg-[#f5eee7] p-4 text-[#754936]"><CircleDollarSign className="size-5 shrink-0" /><div><p className="text-sm font-bold">Tu valor de UT es {money(unitValue)}</p><p className="mt-0.5 text-xs">Al cambiarlo, se actualizan los trabajos vinculados.</p></div><button onClick={() => setView('profile')} className="ml-auto shrink-0 text-xs font-bold underline">Modificar</button></div>
  </div>
}

export function AppShell({ jobs, profile, paymentDetails, customers, subscription, trades, isAdminUser }: AppShellProps) {
  const [view, setView] = useState<View>('home')
  const [selected, setSelected] = useState<Job | null>(jobs[0] ?? null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [payPending, startPayTransition] = useTransition()
  const firstName = profile.fullName.split(' ')[0] || profile.fullName
  const noTrades = trades.enabledIds.length === 0

  function handleReportPayment(formData: FormData) {
    if (!subscription) return
    startPayTransition(() => { reportTransferPayment(subscription.id, formData) })
  }

  const render = () => {
    if ((view === 'prices' || (view as string) === 'prices-detail' || view === 'my-list') && noTrades) {
      return <div className="mx-auto max-w-md p-8 pb-28 text-center"><p className="font-bold text-[var(--oc-ink)]">Todavía no agregaste ningún oficio.</p><p className="mt-1 text-sm text-[var(--oc-muted)]">Activá tu actividad para ver y personalizar tu lista de precios.</p><button onClick={() => setView('trades')} className="mt-4 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white">Ir a Mis oficios</button></div>
    }
    if (view === 'trades') return <MisOficios setView={setView} trades={trades} />
    if (view === 'home') return <HomePage setView={setView} setSelected={setSelected} jobs={jobs} subscription={subscription} firstName={firstName} />
    if (view === 'prices') return <Prices setView={setView} selected={selected!} setSelected={setSelected} jobs={jobs} />
    if ((view as string) === 'prices-detail') return <Detail job={selected!} setView={setView} unitValue={profile.unitValue} />
    if (view === 'my-list') return <MyList setView={setView} setSelected={setSelected} jobs={jobs} unitValue={profile.unitValue} />
    if (view === 'clients') return <ClientsUpdated customers={customers} />
    if (view === 'profile') return <Profile setView={setView} profile={profile} paymentDetails={paymentDetails} subscription={subscription} />
    if (view === 'subscription') return <div className="mx-auto max-w-[760px] p-5 pb-28 md:p-8"><p className="text-sm text-[var(--oc-muted)]">Cuenta</p><h1 className="mt-1 text-2xl font-bold text-[var(--oc-ink)]">Mi suscripción</h1><div className="mt-6 rounded-2xl border border-[var(--oc-border)] bg-[var(--oc-surface)] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold text-[var(--oc-muted)]">Estado de cuenta</p><p className="mt-1 text-lg font-bold text-[var(--oc-ink)]">{subscription?.planName ?? 'Sin plan'}</p><span className="mt-2 inline-flex rounded-full bg-[var(--oc-success-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--oc-success-text)]">{subscription?.status === 'active' ? 'Activa' : subscription?.status ?? 'Sin plan'}</span></div><div className="text-left sm:text-right"><p className="text-xs text-[var(--oc-muted)]">Próximo vencimiento</p><p className="mt-1 font-bold text-[var(--oc-ink)]">{subscription?.endDate ?? '—'}</p></div></div><form action={handleReportPayment} className="mt-6 border-t border-[var(--oc-border-soft)] pt-5"><h2 className="font-bold text-[var(--oc-ink)]">Informar un pago</h2><p className="mt-1 text-sm text-[var(--oc-muted)]">Cargá el monto transferido y la referencia para que Administración lo concilie.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><input name="amount" type="number" required placeholder="Monto transferido" className="rounded-xl border border-[var(--oc-border)] bg-transparent px-3 py-3 text-sm text-[var(--oc-ink)] outline-none" /><input name="reference" placeholder="Nº de operación" className="rounded-xl border border-[var(--oc-border)] bg-transparent px-3 py-3 text-sm text-[var(--oc-ink)] outline-none" /></div><button type="submit" disabled={payPending || !subscription} className="mt-4 rounded-xl bg-[var(--oc-brand)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">Informar pago</button>{!subscription && <p className="mt-2 text-xs text-[var(--oc-coral)]">Necesitás una suscripción activa o en prueba antes de informar un pago.</p>}</form></div></div>
    return <Proximamente title="Presupuestos" />
  }

  return <div className="min-h-screen bg-[var(--oc-page)] text-[var(--oc-ink)]"><div className="flex min-h-screen"><Sidebar view={view} setView={setView} isAdminUser={isAdminUser} /><div className="min-w-0 flex-1"><AppHeader onMenu={() => setMenuOpen(true)} name={profile.fullName} />{render()}</div></div><BottomNav view={view} setView={setView} />{menuOpen && <div className="fixed inset-0 z-40 bg-[var(--oc-brand)]/20 md:hidden" onClick={() => setMenuOpen(false)}><div className="h-full w-[280px] bg-[var(--oc-surface-muted)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between"><Logo /><button onClick={() => setMenuOpen(false)} aria-label="Cerrar menú"><X className="size-5 text-[var(--oc-muted)]" /></button></div><div className="mt-8 flex flex-col gap-1">{[...navItems, { id: 'profile' as View, label: 'Mi perfil', icon: Settings }, { id: 'clients' as View, label: 'Mis clientes', icon: Users }, { id: 'subscription' as View, label: 'Suscripción', icon: ShieldCheck }].map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setView(id); setMenuOpen(false) }} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]"><Icon className="size-[18px]" />{label}</button>)}{isAdminUser && <a href="/admin" className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--oc-muted)] hover:bg-[var(--oc-surface-soft)]"><ShieldCheck className="size-[18px]" />Panel admin</a>}<form action={signOut}><button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-[var(--oc-coral)] hover:bg-[var(--oc-surface-soft)]"><X className="size-[18px]" />Cerrar sesión</button></form></div></div></div>}</div>
}
