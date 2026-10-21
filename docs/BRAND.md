# Identidad visual OficioClaro

Fuente de verdad: tokens `--oc-*` en `app/globals.css` (claro en `:root`, oscuro en `.dark`). El sitio público usa alias `--lp-*` (clase `.lp`).

| Rol | Claro | Oscuro |
|---|---|---|
| Azul petróleo (marca) | #123852 | #6fc3d2 |
| Coral (acción) | #e0693f | #ff9b79 |
| Salvia (texto / fondo) | #47634f / #edf1eb | #a9cdb3 / #1b2f27 (derivados) |
| Marfil (fondo del sitio) | oklch(0.985 0.01 105) ≈ #fbfbf3 | #0a141c |

Logo: cuadrado petróleo con llave (lucide `Wrench`) + "Oficio" petróleo y "Claro" coral (`components/brand/logo.tsx`).
Tipografías del sitio público (autoalojadas en `lib/fonts`): Fraunces (títulos) y Figtree (texto).
Tema: `components/theme-picker.tsx` (clave `oficioclaro-theme`: light/dark/system) + script de `app/layout.tsx` que lo aplica antes de pintar.
Testimonios: `components/landing/testimonials.ts` (`demo: true` mientras no haya opiniones autorizadas).
Pendientes comerciales: testimonios reales, URLs de redes, términos/privacidad, contacto, recuperación de contraseña.
