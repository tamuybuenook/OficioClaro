# Propuesta: vínculo seguro entre pagos y comprobantes fiscales — NO APLICADA

Mercado Pago registra el cobro pero no emite facturas de ARCA. La emisión se hará desde NexoFactory en una etapa posterior; OficioClaro no implementa ARCA.

## Qué hay hoy
`/admin/facturacion/pagos/[id]` muestra los datos que habrá que enviar al emisor: pago, importe ARS, concepto (plan + período), fecha de cobro, medio y referencia, nombre y email del receptor. Indica «Comprobante vinculado: Ninguno» y avisa que no hay factura emitida.

## Qué falta en el esquema
1. **Datos fiscales del receptor**: no existen CUIT/DNI ni condición frente al IVA del usuario (`payment_details.holder_cuit` es del profesional para sus propios cobros, no del comprador).
2. **Dónde guardar el comprobante**: número, punto de venta, CAE, vencimiento, estado y el id en el emisor.
3. **No perderlo**: hoy borrar un usuario borra en cascada sus pagos; un comprobante fiscal no puede desaparecer con ellos.

## Migración propuesta (sin aplicar)
`docs/propuestas/0031_comprobantes_fiscales.propuesta.sql`, con pruebas en `…propuesta.test.sql` (20/20 en una base local 0001–0030). Contenido:
- `billing_valid_cuit()`: valida largo y dígito verificador.
- `billing_tax_profiles`: datos fiscales del receptor (admin-only por ahora).
- `billing_documents`: comprobante con copia (`payment_snapshot`, `receiver_snapshot`), `ON DELETE SET NULL` hacia pago y usuario, un comprobante vivo por pago y tipo, numeración única, estado `issued` exige CAE/número/fecha, **inmutable una vez emitido, sin DELETE ni TRUNCATE**, escritura solo `service_role`, lectura solo admin.

## Decisiones previas a aplicar
- Plazo de conservación fiscal (confirmar con el contador) y qué hacer al borrar un usuario con comprobantes (el diseño los conserva con su copia).
- Tipo de comprobante y tratamiento del IVA según condición del receptor.
- Si el usuario carga sus datos fiscales (requiere pantalla y política propias).
- Cómo autentica NexoFactory contra OficioClaro (se sugiere una ruta firmada análoga al webhook), a definir en la etapa de integración.
