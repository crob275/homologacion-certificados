# REGLAS Y MEMORIA PERMANENTE DEL PROYECTO (HOMOLOGACION-CERTIFICADOS)

Este archivo define las reglas obligatorias, decisiones arquitecturales, normativas legales y memoria de contexto para este repositorio. El asistente (Antigravity) DEBE leer y respetar estas pautas en cada respuesta e iteración.

---

## 1. CONTEXTO GENERAL DEL SISTEMA
- **Nombre:** HomologaControl Minería (`homologacion-certificados`)
- **Propósito:** Plataforma de Control Normativo según el Decreto Supremo **D.S. 024-2016-EM** (Reglamento de Seguridad y Salud Ocupacional en Minería), **Ley 29783**, y acreditación de cuadrillas contratistas para ingreso a planta/mina en Perú.
- **Entorno de Producción:** Desplegado en **Railway**: `https://homologacion-certificados-production.up.railway.app/`
- **Repositorio Git:** `https://github.com/crob275/homologacion-certificados.git` (rama activa: `main`).

---

## 2. REGLAS NORMATIVAS Y DE SEGURIDAD (CRÍTICAS)
1. **Separación Estricta de Roles:**
   - **TRABAJADOR / OPERARIO:** Acceso de sólo lectura para consultar su pase de habilitación y ver sus certificados PDF. **NO PUEDE editar directamente sus datos**. Si detecta un error (ej. falta de DNI en su certificado), debe usar el botón **`[ ⚠️ Solicitar Corrección de Datos ]`**.
   - **ADMINISTRADOR GENERAL / SUPERVISOR HSE:** Es la única entidad con facultad legal para autorizar y consolidar cambios en las fichas del personal o aprobar solicitudes de corrección en la base de datos.
   - **ADMIN EMPRESA (CONTRATISTA):** Gestiona cuadrillas y carga masiva de su empresa asignada (ej. INGEMANT).
2. **Auditoría Documental y Visor de PDF:**
   - Los certificados deben poder visualizarse en cualquier momento mediante el visor oficial (`#modal-visor-pdf`).
   - El backend almacena el PDF en base64 (`url_pdf_storage`) para garantizar persistencia y evitar pérdidas por el sistema de archivos efímero de Railway.
3. **No dañar funcionalidades existentes:**
   - Carga masiva de Excel (.xlsx, .csv).
   - Motor OCR de PDF (individual y lote multi-PDF).
   - Motor de alertas escalonadas (90d, 30d, 10d).
   - Conector Power BI.
   - Compatibilidad dual SQLite (desarrollo/Railway fallback) y MySQL (producción).

---

## 3. USUARIOS Y CREDENCIALES CLAVE DE PRUEBA
- **Super Administrador:** `admin@homologacontrol.com` / `Admin2026!`
- **Supervisor HSE:** `supervisor.hse@homologacontrol.com` / `SuperHSE2026!`
- **Admin Empresa INGEMANT (Usuario del titular):** `cristianre257@gmail.com` (Christian Renato Ortega Bernedo - DNI 70352752)
- **Consulta Kiosco / Garita:** Público (sin clave, únicamente con DNI del operario).
