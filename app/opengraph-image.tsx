import { ImageResponse } from 'next/og'

export const alt = 'OficioClaro — Tu oficio vale. Organizarlo no debería ser complicado.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Colores oficiales de la marca (ver --oc-* en app/globals.css): petróleo #123852, coral #e0693f, marfil, tinta #1c2e38.
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, background: '#fbfbf3', color: '#1c2e38' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 76, height: 76, borderRadius: 20, background: '#123852', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" /></svg>
          </div>
          <div style={{ fontSize: 52, fontWeight: 700, display: 'flex', color: '#123852' }}>Oficio<span style={{ color: '#e0693f' }}>Claro</span></div>
        </div>
        <div style={{ fontSize: 74, fontWeight: 700, lineHeight: 1.1, marginTop: 48, display: 'flex', color: '#123852' }}>Tu oficio vale. Organizarlo no debería ser complicado.</div>
        <div style={{ fontSize: 34, marginTop: 36, color: '#64767d', display: 'flex' }}>Precios de referencia, presupuestos y clientes. Sin instalar nada.</div>
      </div>
    ),
    size,
  )
}
