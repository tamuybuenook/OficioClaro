# Propuesta: pagar un plan distinto con tiempo ya abonado

**No implementada. Requiere decisión comercial.** Hoy (`record_mp_payment`, `reconcile_transfer_payment`): al aprobarse un pago, el plan cambia **de inmediato** y el período se suma desde el vencimiento vigente (+1 mes). Precios actuales: Básico $5.000 (1 oficio), Medium $8.000 (3), Profesional $9.000 (todos).

**Efectos del comportamiento actual**
- Subir de plan a mitad de período: los días ya pagados del plan viejo pasan a valer como plan nuevo, gratis (p. ej. Básico con 20 días restantes paga Profesional: obtiene 20 días de Profesional sin pagarlos + 1 mes).
- Bajar de plan: pierde de inmediato las ventajas del plan alto aunque tenga días pagados (se conservan los datos; solo no puede agregar oficios).

| Opción | Cómo funciona | Pros | Contras |
|---|---|---|---|
| **A. Sin cambios** (actual) | Cambia ya; suma +1 mes | Simple | Fuga en upgrades; downgrade injusto |
| **B. El plan nuevo empieza hoy** | Si el plan difiere: `end_date = hoy + período`; los días restantes se pierden | Sin fuga, simple | Penaliza al que sube/baja (pierde días ya pagados) |
| **C. Prorrateo con crédito** | Crédito = días restantes × precio diario del plan viejo; el plan nuevo cobra `precio − crédito` (mínimo a definir) y arranca hoy | Justo | Cobro de monto variable: el monto "esperado" de MP deja de ser el precio de lista (cambia la validación de `amount_mismatch`); más lógica y más pruebas |
| **D. Cambio al renovar** | Upgrade: inmediato pagando la diferencia; downgrade: se programa para el próximo período | Intuitivo | Requiere estado "cambio programado" |

**Recomendación:** B como primer paso (no cambia montos ni validaciones; elimina la fuga) y evaluar C/D cuando haya volumen. Mientras tanto, que el pago de un plan distinto muestre una confirmación explícita ("tus días restantes pasarán al plan nuevo / se pierden").

**Ejemplo B con precios reales:** Básico con 20 días restantes paga Medium ($8.000) ⇒ Medium hasta hoy + 1 mes; los 20 días de Básico no se acreditan. Con C: crédito = 20/30 × $5.000 ≈ $3.333 ⇒ cobra ≈ $4.667.

Cualquiera de las opciones se implementa en `record_mp_payment` y `reconcile_transfer_payment` (cálculo de `v_new_end`) y en el monto esperado en el caso C. Necesita su propia migración y pruebas.
