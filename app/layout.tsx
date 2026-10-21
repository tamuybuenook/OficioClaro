import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://oficioclaro.vercel.app'),
  title: 'OficioClaro — Precios y presupuestos para tu oficio',
  description: 'Consultá precios de referencia, prepará presupuestos y organizá tus clientes desde el celular, sin instalar nada. Probalo gratis.',
  openGraph: {
    title: 'OficioClaro — Tu oficio vale. Organizarlo no debería ser complicado.',
    description: 'Precios de referencia, presupuestos y clientes en un solo lugar. Sin instalar nada.',
    siteName: 'OficioClaro',
    locale: 'es_AR',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
  manifest: '/manifest.json',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

// Aplica el tema guardado antes del primer pintado (evita el destello del tema equivocado).
const themeInitScript = `try{var t=localStorage.getItem('oficioclaro-theme')||'system';var r=document.documentElement;r.classList.toggle('dark',t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches));r.classList.toggle('light',t==='light')}catch(e){}`

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: '#14232b' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
        <Script id="pwa-sw" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js')) }`}
        </Script>
      </body>
    </html>
  )
}
