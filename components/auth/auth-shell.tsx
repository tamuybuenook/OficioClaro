import { brandFontClass } from '@/lib/brand-fonts'
import { Logo } from '@/components/brand/logo'
import { ThemePicker } from '@/components/theme-picker'
import { PhoneFrame, PriceScreen } from '@/components/landing/mockups'

export function AuthShell({ title, subtitle, side, children }: { title: string; subtitle: React.ReactNode; side: { heading: string; text: string }; children: React.ReactNode }) {
  return (
    <div className={`lp ${brandFontClass} flex min-h-dvh`}>
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-[var(--lp-sand)] p-12 lg:flex">
        <a href="/" aria-label="OficioClaro, inicio"><Logo /></a>
        <div>
          <h2 className="max-w-md text-4xl leading-tight">{side.heading}</h2>
          <p className="mt-4 max-w-sm text-lg text-[var(--lp-ink-soft)]">{side.text}</p>
          <div className="mt-8"><PhoneFrame className="!mx-0 scale-90 origin-top-left"><PriceScreen /></PhoneFrame></div>
        </div>
        <p className="text-sm text-[var(--lp-ink-soft)]">© 2026 OficioClaro</p>
      </aside>
      <main className="relative flex w-full flex-col justify-center px-6 py-10 sm:px-10 lg:w-[54%] lg:px-20">
        <div className="absolute right-5 top-5"><ThemePicker large /></div>
        <div className="mx-auto w-full max-w-md">
          <a href="/" className="lg:hidden" aria-label="OficioClaro, inicio"><Logo /></a>
          <h1 className="mt-8 text-3xl">{title}</h1>
          <p className="mt-2 text-[17px] text-[var(--lp-ink-soft)]">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  )
}
