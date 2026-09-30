-- ==============================================================================
-- SCRIPT DE DATOS SEMILLA (SEEDS OFICIALES PRODUCCIÓN)
-- ==============================================================================

USE `homologacion_db`;

-- 1. EMPRESAS CONTRATISTAS
INSERT INTO empresas (id, ruc_rut, razon_social, nombre_comercial, logo_icon, color_accent, email_contacto, telefono_contacto, contacto_persona, rubro, direccion) VALUES
('emp-1', '20601234567', 'Constructora & Montajes CMI S.A.C.', 'CMI Industrial', '🏗️', '#38bdf8', 'contacto@cmiindustrial.com', '+51 987654321', 'Ing. Roberto Torres (Gerente)', 'Montaje Industrial & Estructuras', 'Av. Industrial 450, Lima'),
('emp-2', '20509876543', 'Servicios Eléctricos SELECA E.I.R.L.', 'SELECA Electricidad', '⚡', '#f59e0b', 'operaciones@seleca.com', '+51 912345678', 'Lic. Elena Gómez (RRHH)', 'Mantenimiento & Alta Tensión', 'Calle Los Metalúrgicos 120, Arequipa'),
('emp-3', '20405554433', 'Ingeniería y Mantenimiento INGEMANT S.A.', 'INGEMANT Mantenimiento', '🛠️', '#10b981', 'admin@ingemant.pe', '+51 955443322', 'Ing. Carlos Mendoza (Jefe Planta)', 'Mantenimiento Mecánico de Planta', 'Av. Argentina 1020, Callao'),
('emp-4', '20708889911', 'Servicios & Seguridad Industrial ALFA S.A.C.', 'ALFA Seguridad HSE', '🛡️', '#a855f7', 'contacto@seguridadalfa.pe', '+51 977112233', 'Ing. Fernando Silva (Jefe HSE)', 'Seguridad Ocupacional & Prevención', 'Av. Javier Prado Este 2100, Lima');

-- 2. USUARIOS CON ROLES RBAC
INSERT INTO usuarios (id, empresa_id, email, password_hash, nombre_completo, cargo, rol, debe_cambiar_password) VALUES
('u-admin', NULL, 'admin@homologacontrol.com', 'Admin2026!', 'Carlos Mendoza (Admin General)', 'Administrador del Sistema', 'ADMINISTRADOR', 0),
('u-supervisor', NULL, 'supervisor.hse@homologacontrol.com', 'SuperHSE2026!', 'Ing. Sofia Ramírez (Supervisor HSE)', 'Auditor HSE Principal', 'SUPERVISOR', 1),
('u-contratista-1', 'emp-1', 'contacto@cmiindustrial.com', 'CMI2026!Pass', 'Ing. Roberto Torres', 'Gestor CMI Industrial', 'CONTRATISTA', 1),
('u-contratista-2', 'emp-2', 'operaciones@seleca.com', 'SELECA2026!Pass', 'Lic. Elena Gómez', 'Gestor SELECA', 'CONTRATISTA', 1);

-- 3. TRABAJADORES OPERATIVOS
INSERT INTO trabajadores (id, empresa_id, tipo_documento, numero_documento, nombres, apellidos, email_personal, telefono_personal, cargo_puesto, area_trabajo, estado_habilitacion) VALUES
('tr-1', 'emp-1', 'DNI', '45891234', 'Christian renato', 'rodriguez mamani', 'jrez@gmail.com', '953651975', 'Soldador Especialista 6G', 'Planta de Fabricación', 'HABILITADO'),
('tr-2', 'emp-1', 'DNI', '71234567', 'roberto romario', 'lupaca nina', 'lupac777@hotmail.com', '993188431', 'Técnico Montajista', 'Campo / Altura', 'PROXIMO_A_VENCER'),
('tr-3', 'emp-2', 'DNI', '48990011', 'Mateo', 'Fernández Castro', 'mfernandez@outlook.com', '+51 955443322', 'Electricista Industrial', 'Mantenimiento Eléctrico', 'INHABILITADO'),
('tr-4', 'emp-4', 'DNI', '74829103', 'Sergio Alexander', 'Juarez Fuentes', 'sergio.juarez@gmail.com', '+51 987654321', 'Especialista en Soldadura Estructural', 'HSE Planta', 'HABILITADO');

-- 4. TIPOS DE CERTIFICADOS
INSERT INTO tipos_certificados (id, codigo, nombre, descripcion) VALUES
('tc-1', 'CERT-SOLD-6G', 'Soldadura Avanzada ASME IX 6G', 'Certificación de Soldadura ASME IX 6G'),
('tc-2', 'CERT-SST-ALTURA', 'Trabajos en Altura Física y Prevención', 'Certificación de Seguridad en Altura OSHA');

-- 5. CERTIFICADOS REGISTRADOS
INSERT INTO certificados (id, trabajador_id, empresa_id, tipo_certificado_id, nombre_curso, entidad_emisora, horas_lectivas, fecha_emision, fecha_vencimiento, codigo_qr_hash, pdf_filename, estado_validacion, estado_vigencia) VALUES
('cert-101', 'tr-1', 'emp-1', 'tc-1', 'Soldadura Avanzada ASME IX 6G', 'Instituto TecnoSoldar', 180, '2026-03-10', '2027-03-10', 'VALIDATED_QR_ASME_998822', 'cert_christian_soldadura.pdf', 'APROBADO', 'HABILITADO'),
('cert-102', 'tr-2', 'emp-1', 'tc-2', 'Trabajos en Altura Física y Prevención', 'Safety Academy S.A.', 280, '2026-01-15', '2027-01-15', 'VALIDATED_QR_OSHA_112233', 'cert_roberto_altura.pdf', 'APROBADO', 'PROXIMO_A_VENCER'),
('cert-103', 'tr-4', 'emp-4', 'tc-1', 'Soldadura Estructural y de Mantenimiento', 'TECSUP - Pasión por la Tecnología', 500, '2022-08-12', '2023-08-12', 'QR_TECSUP_VALIDATED_889900', 'certificado_sergio_tecsup.pdf', 'APROBADO', 'HABILITADO');
