-- ==============================================================================
-- SISTEMA DE CONTROL Y GESTIÓN DE HOMOLOGACIONES DE CERTIFICADOS PARA CONTRATISTAS
-- SCRIPT DDL OFICIAL - MYSQL 8.0+
-- Arquitectura: Base de Datos Relacional Normalizada (3NF) - Engine InnoDB
-- ==============================================================================

CREATE DATABASE IF NOT EXISTS `homologacion_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `homologacion_db`;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `audit_logs`;
DROP TABLE IF EXISTS `alertas_notificaciones`;
DROP TABLE IF EXISTS `homologaciones`;
DROP TABLE IF EXISTS `certificados`;
DROP TABLE IF EXISTS `trabajadores`;
DROP TABLE IF EXISTS `tipos_certificados`;
DROP TABLE IF EXISTS `usuarios`;
DROP TABLE IF EXISTS `empresas`;

SET FOREIGN_KEY_CHECKS = 1;

-- TABLA 1: EMPRESAS (Proveedores y Contratistas)
CREATE TABLE `empresas` (
    `id` VARCHAR(36) NOT NULL,
    `ruc_rut` VARCHAR(25) NOT NULL,
    `razon_social` VARCHAR(200) NOT NULL,
    `nombre_comercial` VARCHAR(200) DEFAULT NULL,
    `logo_icon` VARCHAR(10) DEFAULT '🏢',
    `color_accent` VARCHAR(20) DEFAULT '#38bdf8',
    `email_contacto` VARCHAR(150) NOT NULL,
    `telefono_contacto` VARCHAR(50) DEFAULT NULL,
    `contacto_persona` VARCHAR(100) DEFAULT NULL,
    `rubro` VARCHAR(100) DEFAULT NULL,
    `direccion` TEXT DEFAULT NULL,
    `estado` ENUM('ACTIVO', 'SUSPENDIDO', 'INACTIVO') NOT NULL DEFAULT 'ACTIVO',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_empresas_ruc` (`ruc_rut`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TABLA 2: USUARIOS (RBAC)
CREATE TABLE `usuarios` (
    `id` VARCHAR(36) NOT NULL,
    `empresa_id` VARCHAR(36) DEFAULT NULL,
    `email` VARCHAR(150) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `nombre_completo` VARCHAR(150) NOT NULL,
    `cargo` VARCHAR(100) DEFAULT NULL,
    `rol` ENUM('ADMINISTRADOR', 'SUPERVISOR', 'CONTRATISTA') NOT NULL DEFAULT 'CONTRATISTA',
    `telefono` VARCHAR(50) DEFAULT NULL,
    `activo` TINYINT(1) NOT NULL DEFAULT 1,
    `debe_cambiar_password` TINYINT(1) NOT NULL DEFAULT 1,
    `ultimo_login` DATETIME DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_usuarios_email` (`email`),
    FOREIGN KEY (`empresa_id`) REFERENCES `empresas` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TABLA 3: TIPOS DE CERTIFICADOS
CREATE TABLE `tipos_certificados` (
    `id` VARCHAR(36) NOT NULL,
    `codigo` VARCHAR(50) NOT NULL,
    `nombre` VARCHAR(150) NOT NULL,
    `descripcion` TEXT DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tipos_codigo` (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TABLA 4: TRABAJADORES
CREATE TABLE `trabajadores` (
    `id` VARCHAR(36) NOT NULL,
    `empresa_id` VARCHAR(36) NOT NULL,
    `tipo_documento` VARCHAR(20) NOT NULL DEFAULT 'DNI',
    `numero_documento` VARCHAR(30) NOT NULL,
    `nombres` VARCHAR(100) NOT NULL,
    `apellidos` VARCHAR(100) NOT NULL,
    `email_personal` VARCHAR(150) DEFAULT NULL,
    `telefono_personal` VARCHAR(50) DEFAULT NULL,
    `cargo_puesto` VARCHAR(100) NOT NULL,
    `area_trabajo` VARCHAR(100) DEFAULT NULL,
    `estado_habilitacion` ENUM('HABILITADO', 'PROXIMO_A_VENCER', 'INHABILITADO') NOT NULL DEFAULT 'INHABILITADO',
    `motivo_inhabilitacion` TEXT DEFAULT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_trabajadores_doc` (`numero_documento`),
    FOREIGN KEY (`empresa_id`) REFERENCES `empresas` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TABLA 5: CERTIFICADOS
CREATE TABLE `certificados` (
    `id` VARCHAR(36) NOT NULL,
    `trabajador_id` VARCHAR(36) NOT NULL,
    `empresa_id` VARCHAR(36) NOT NULL,
    `tipo_certificado_id` VARCHAR(36) DEFAULT NULL,
    `nombre_curso` VARCHAR(255) NOT NULL,
    `entidad_emisora` VARCHAR(255) NOT NULL,
    `horas_lectivas` INT DEFAULT 16,
    `fecha_emision` DATE NOT NULL,
    `fecha_vencimiento` DATE NOT NULL,
    `codigo_qr_hash` VARCHAR(255) DEFAULT NULL,
    `pdf_filename` VARCHAR(255) DEFAULT NULL,
    `url_pdf_storage` VARCHAR(500) DEFAULT NULL,
    `estado_validacion` ENUM('EN_VALIDACION', 'APROBADO', 'RECHAZADO') NOT NULL DEFAULT 'EN_VALIDACION',
    `estado_vigencia` ENUM('HABILITADO', 'PROXIMO_A_VENCER', 'INHABILITADO') NOT NULL DEFAULT 'HABILITADO',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`trabajador_id`) REFERENCES `trabajadores` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (`empresa_id`) REFERENCES `empresas` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
