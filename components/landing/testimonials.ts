// Testimonios de la landing.
// IMPORTANTE: mientras un testimonio tenga `demo: true` se muestra como "contenido de demostración".
// Para publicar uno real: reemplazar el objeto (demo: false), con el nombre, el rubro y el texto
// que la persona haya AUTORIZADO por escrito. No agregar fotos, cifras ni verificaciones sin respaldo.
export type Testimonial = { id: string; name: string; trade: string; quote: string; demo: boolean }

export const testimonials: Testimonial[] = [
  {
    id: 'demo-1',
    name: 'Mariana López',
    trade: 'Electricidad domiciliaria',
    quote: 'Me gusta poder organizar los trabajos y tener los presupuestos más ordenados. Antes anotaba muchas cosas por separado y terminaba perdiendo tiempo buscando información.',
    demo: true,
  },
  {
    id: 'demo-2',
    name: 'Diego Fernández',
    trade: 'Plomería y sanitarios',
    quote: 'Lo que más me interesa es tener los trabajos pendientes en un mismo lugar y poder consultar los presupuestos sin depender de varios cuadernos o archivos.',
    demo: true,
  },
  {
    id: 'demo-3',
    name: 'Carolina Méndez',
    trade: 'Pintura y mantenimiento',
    quote: 'Me resulta práctica la idea de organizar los trabajos y dejar registrada la información de cada cliente. Quiero dedicar más tiempo al trabajo y menos a ordenar papeles.',
    demo: true,
  },
]
