---
name: garita-gate-pass-verifier
description: Verifica pases de ingreso y control de accesos en garitas mineras. Consolida el estado de aptitud del trabajador comprobando que NINGÚN certificado obligatorio esté vencido, genera pases QR de validación en tiempo real y notifica bloqueos a supervisión HSE.
---

# Skill: Control de Garita y Verificación de Pases de Acceso Minero

Este skill rige la lógica de control de garita de acceso para campamentos y operaciones mina (tajo abierto y subterráneo).

## Reglas de Admisión en Garita
1. **Regla de Cero Tolerancia**:
   - Para que un trabajador reciba el estatus **`HABILITADO / APTO`**, el 100% de sus certificados obligatorios para su puesto deben encontrarse con días de vigencia > 0.
   - Si tan solo **UN (1)** certificado está vencido (`diasRestantes <= 0`), el estatus general del trabajador pasa automáticamente a **`INHABILITADO`** en el sistema de garita.
2. **Notificación Proactiva en Garita**:
   - Trabajadores con alerta de 10 días reciben advertencia visual al momento de marcar ingreso en garita para que pasen por el área de Seguridad de la contrata.
3. **Pase Rápido Digital**:
   - Emisión de comprobante digital / QR de habilitación vigente para agilizar el ingreso vehicular o peatonal de las guardias de turno.
