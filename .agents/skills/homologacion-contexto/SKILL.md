---
name: homologacion-contexto
description: Memoria continua y especificaciones del proyecto HomologaControl Minería (D.S. 024-2016-EM). Activar para recordar el historial de cambios, requerimientos normativos del cliente, usuarios, persistencia en Railway y reglas de negocio.
---

# Skill: HomologaControl Minería - Memoria y Reglas de Proyecto

Esta habilidad almacena el contexto histórico de desarrollo, decisiones de arquitectura y las preferencias del cliente.

## 📌 Historial y Requerimientos Acumulados

1. **Gestión de Certificados sin DNI Impreso:**
   - Hay certificados emitidos por plataformas de capacitación donde no se imprime el DNI, únicamente el nombre y apellido.
   - En la subida masiva, el sistema vincula por coincidencia de nombre o crea un registro temporal.
   - Al final de la carga, la tabla muestra accesos para **`[ 📄 PDF ]`** y **`[ ✏️ Editar ]`** para regularizar.
   - Desde el Kiosco, el trabajador puede solicitar la corrección enviando su DNI real.

2. **Módulo de Solicitudes de Corrección de Datos:**
   - Tablas: `solicitudes_correccion` en SQLite y MySQL.
   - Endpoints:
     - `POST /api/v1/trabajadores/solicitudes-correccion`
     - `GET /api/v1/trabajadores/solicitudes-correccion`
     - `PUT /api/v1/trabajadores/solicitudes-correccion/:id/resolver`
   - Interfaz: Pestaña `Solicitudes de Corrección` en el panel principal con contador de pendientes.

3. **Arquitectura y Despliegue:**
   - Hospedaje: **Railway** (`https://homologacion-certificados-production.up.railway.app/`).
   - Los archivos subidos no se mantienen en disco local tras reinicios; se utiliza el almacenamiento en BD en la columna `url_pdf_storage` con Data URI base64.
   - Repositorio remoto: `https://github.com/crob275/homologacion-certificados.git` en rama `main`.

4. **Reglas de Oro del Usuario:**
   - **NUNCA romper funcionalidades previas** (OCR, Excel, Alertas, PowerBI).
   - Mantener la separación de roles: los operarios no modifican la BD de forma directa; el Administrador / Supervisor HSE aprueba.
