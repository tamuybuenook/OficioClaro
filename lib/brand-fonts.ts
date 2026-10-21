import localFont from 'next/font/local'

// Tipografías de la identidad pública (landing, login, registro), autoalojadas (OFL) para no depender
// de Google Fonts en el build. Fuente: paquetes @fontsource-variable (subset latin, variable).
export const fraunces = localFont({ src: './fonts/fraunces-latin-wght-normal.woff2', weight: '100 900', variable: '--font-fraunces', display: 'swap' })
export const figtree = localFont({ src: './fonts/figtree-latin-wght-normal.woff2', weight: '300 900', variable: '--font-figtree', display: 'swap' })
export const brandFontClass = `${fraunces.variable} ${figtree.variable}`
