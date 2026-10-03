---
name: excel-mining-homologation
description: Diagnostica, limpia y procesa matrices de homologación masivas en Excel para contratas mineras. Valida formatos de fecha (DD/MM/AAAA vs serial Excel), DNIs de 8 dígitos, RUCs de 11 dígitos, cursos requeridos y genera reportes consolidados sin inconsistencias.
---

# Skill: Procesamiento de Matrices Excel de Homologación Minera

Este skill asiste en la ingesta, limpieza de datos y generación de reportes masivos de acreditación para empresas contratistas mineras.

## Validaciones Estrictas de Datos
1. **Identificación de Personal**:
   - DNI peruano: Exactamente 8 dígitos numéricos.
   - Carné de Extranjería (CE) o PTP: 9 a 12 caracteres alfanuméricos.
   - Nombres y Apellidos en mayúsculas limpias, sin caracteres especiales corruptos (tildes mal codificadas).
2. **Empresas Contratistas**:
   - RUC: 11 dígitos (comienzo con 20 para jurídicas o 10 para naturales).
   - Razón Social oficial según SUNAT.
   - Correo de contacto HSE / RRHH válido.
3. **Fechas de Emisión y Caducidad**:
   - Detección de fechas seriales de Excel (ej: 45200) vs strings (`YYYY-MM-DD`, `DD/MM/YYYY`).
   - Regla de consistencia: `fecha_vencimiento` debe ser posterior a `fecha_emision` (normalmente exactamente 1 año después).
