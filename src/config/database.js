const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Configuración de Conexión MySQL Dinámica (Nube / Railway / Render / Local Workbench)
let MYSQL_CONFIGS = [];

// 1. Si existe DATABASE_URL o variables estándar de Railway / Nube
if (process.env.MYSQL_URL || process.env.DATABASE_URL) {
    const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
    try {
        const u = new URL(dbUrl);
        MYSQL_CONFIGS.push({
            host: u.hostname,
            user: u.username,
            password: u.password,
            database: u.pathname.replace(/^\//, '') || 'railway',
            port: parseInt(u.port || '3306')
        });
    } catch (e) {}
}

if (process.env.MYSQLHOST || process.env.DB_HOST) {
    MYSQL_CONFIGS.push({
        host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
        user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
        password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
        database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'railway',
        port: parseInt(process.env.MYSQLPORT || process.env.DB_PORT || '3306')
    });
}

// 2. Fallbacks estándar de MySQL Workbench Local instance
MYSQL_CONFIGS.push(
    { host: 'localhost', user: 'root', password: 'admin123', database: 'homologacion_db', port: 3306 },
    { host: 'localhost', user: 'root', password: '', database: 'homologacion_db', port: 3306 },
    { host: 'localhost', user: 'root', password: 'root', database: 'homologacion_db', port: 3306 },
    { host: 'localhost', user: 'root', password: '12345678', database: 'homologacion_db', port: 3306 },
    { host: 'localhost', user: 'root', password: '123456', database: 'homologacion_db', port: 3306 },
    { host: 'localhost', user: 'root', password: '1234', database: 'homologacion_db', port: 3306 },
    { host: 'localhost', user: 'root', password: 'admin', database: 'homologacion_db', port: 3306 },
    { host: 'localhost', user: 'root', password: 'password', database: 'homologacion_db', port: 3306 },
    { host: 'localhost', user: 'root', password: 'root123', database: 'homologacion_db', port: 3306 }
);

// Cargar configuración de archivo config_mysql.json si existe en la raíz del proyecto
const configFile = path.join(__dirname, '..', '..', 'config_mysql.json');
if (fs.existsSync(configFile)) {
    try {
        const customConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        MYSQL_CONFIGS.unshift(customConfig);
    } catch (e) {}
}

let mysqlPool = null;
let isUsingMySQL = false;

// Fallback SQLite Database
const dbPath = path.join(__dirname, '..', '..', 'database', 'homologacion_db.sqlite');
const sqliteDb = new sqlite3.Database(dbPath);

// Probar conexión con MySQL Workbench / Nube
async function initMySQLConnection() {
    for (let cfg of MYSQL_CONFIGS) {
        try {
            const dbTarget = cfg.database || 'homologacion_db';

            // Intentar conectar con la BD directamente
            mysqlPool = mysql.createPool({
                host: cfg.host,
                user: cfg.user,
                password: cfg.password,
                database: dbTarget,
                port: cfg.port,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });

            // Verificar conexión
            const [rows] = await mysqlPool.query('SELECT 1 + 1 AS solution');
            if (rows && rows[0].solution === 2) {
                isUsingMySQL = true;
                console.log(`=============================================================`);
                console.log(`🐬 ¡CONECTADO A MYSQL EXITOSAMENTE!`);
                console.log(`🗄️ Host: ${cfg.host}:${cfg.port} | BD: ${dbTarget} (Usuario: ${cfg.user})`);
                console.log(`=============================================================`);
                await setupMySQLSchemaAndSeeds();
                return true;
            }
        } catch (err) {
            // Si la base de datos no existe en local, intentar crearla
            try {
                const tempConn = await mysql.createConnection({
                    host: cfg.host,
                    user: cfg.user,
                    password: cfg.password,
                    port: cfg.port
                });
                await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database || 'homologacion_db'}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
                await tempConn.end();

                mysqlPool = mysql.createPool({
                    ...cfg,
                    waitForConnections: true,
                    connectionLimit: 10,
                    queueLimit: 0
                });
                const [r] = await mysqlPool.query('SELECT 1 + 1 AS solution');
                if (r && r[0].solution === 2) {
                    isUsingMySQL = true;
                    await setupMySQLSchemaAndSeeds();
                    return true;
                }
            } catch (err2) {}
        }
    }

    console.log(`⚠️ No se pudo conectar a MySQL. Usando BD SQLite como respaldo.`);
    await setupSQLiteSchemaAndSeeds();
    return false;
}

// Inicialización de Tablas y Semillas en SQLite (Fallback automático para la nube)
async function setupSQLiteSchemaAndSeeds() {
    return new Promise((resolve) => {
        sqliteDb.serialize(() => {
            sqliteDb.run(`
                CREATE TABLE IF NOT EXISTS empresas (
                    id TEXT PRIMARY KEY,
                    ruc_rut TEXT UNIQUE,
                    razon_social TEXT,
                    nombre_comercial TEXT,
                    logo_icon TEXT DEFAULT '🏢',
                    color_accent TEXT DEFAULT '#38bdf8',
                    email_contacto TEXT,
                    telefono_contacto TEXT,
                    contacto_persona TEXT,
                    rubro TEXT,
                    direccion TEXT,
                    estado TEXT DEFAULT 'ACTIVO',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            sqliteDb.run(`
                CREATE TABLE IF NOT EXISTS usuarios (
                    id TEXT PRIMARY KEY,
                    empresa_id TEXT,
                    email TEXT UNIQUE,
                    password_hash TEXT,
                    nombre_completo TEXT,
                    cargo TEXT,
                    rol TEXT DEFAULT 'CONTRATISTA',
                    telefono TEXT,
                    activo INTEGER DEFAULT 1,
                    debe_cambiar_password INTEGER DEFAULT 0,
                    ultimo_login DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            sqliteDb.run(`
                CREATE TABLE IF NOT EXISTS trabajadores (
                    id TEXT PRIMARY KEY,
                    empresa_id TEXT,
                    tipo_documento TEXT DEFAULT 'DNI',
                    numero_documento TEXT UNIQUE,
                    nombres TEXT,
                    apellidos TEXT,
                    email_personal TEXT,
                    telefono_personal TEXT,
                    cargo_puesto TEXT,
                    area_trabajo TEXT,
                    estado_habilitacion TEXT DEFAULT 'INHABILITADO',
                    motivo_inhabilitacion TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            sqliteDb.run(`
                CREATE TABLE IF NOT EXISTS certificados (
                    id TEXT PRIMARY KEY,
                    trabajador_id TEXT,
                    empresa_id TEXT,
                    tipo_certificado_id TEXT,
                    nombre_curso TEXT,
                    entidad_emisora TEXT,
                    horas_lectivas INTEGER DEFAULT 16,
                    fecha_emision DATE,
                    fecha_vencimiento DATE,
                    codigo_qr_hash TEXT,
                    pdf_filename TEXT,
                    url_pdf_storage TEXT,
                    estado_validacion TEXT DEFAULT 'EN_VALIDACION',
                    estado_vigencia TEXT DEFAULT 'HABILITADO',
                    alerta_90d_enviada INTEGER DEFAULT 0,
                    alerta_30d_enviada INTEGER DEFAULT 0,
                    alerta_10d_enviada INTEGER DEFAULT 0,
                    fecha_ultima_alerta DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            sqliteDb.run(`
                CREATE TABLE IF NOT EXISTS alertas_notificaciones (
                    id TEXT PRIMARY KEY,
                    certificado_id TEXT,
                    trabajador_id TEXT,
                    empresa_id TEXT,
                    email_destinatario TEXT,
                    destinatario_email TEXT,
                    asunto TEXT,
                    tipo_alerta TEXT DEFAULT 'ALERTA_90_DIAS',
                    dias_restantes INTEGER,
                    mensaje_resumen TEXT,
                    cuerpo_html TEXT,
                    estado TEXT DEFAULT 'ENVIADO',
                    fecha_envio DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            sqliteDb.run(`
                CREATE TABLE IF NOT EXISTS solicitudes_correccion (
                    id TEXT PRIMARY KEY,
                    trabajador_id TEXT NOT NULL,
                    certificado_id TEXT,
                    campo_afectado TEXT NOT NULL,
                    valor_anterior TEXT,
                    valor_solicitado TEXT NOT NULL,
                    motivo_observacion TEXT,
                    solicitante_contacto TEXT,
                    estado TEXT DEFAULT 'PENDIENTE',
                    respuesta_admin TEXT,
                    revisado_por TEXT,
                    fecha_solicitud DATETIME DEFAULT CURRENT_TIMESTAMP,
                    fecha_resolucion DATETIME
                )
            `);

            // Insertar empresas por defecto
            sqliteDb.get('SELECT COUNT(*) as count FROM empresas', (err, row) => {
                if (row && row.count === 0) {
                    sqliteDb.run(`
                        INSERT INTO empresas (id, ruc_rut, razon_social, nombre_comercial, logo_icon, color_accent, email_contacto, telefono_contacto, contacto_persona, rubro, direccion) VALUES
                        ('emp-1', '20601234567', 'Constructora & Montajes CMI S.A.C.', 'CMI Industrial', '🏗️', '#38bdf8', 'contacto@cmiindustrial.com', '+51 987654321', 'Ing. Roberto Torres (Gerente)', 'Montaje Industrial & Estructuras', 'Av. Industrial 450, Lima'),
                        ('emp-2', '20509876543', 'Servicios Eléctricos SELECA E.I.R.L.', 'SELECA Electricidad', '⚡', '#f59e0b', 'operaciones@seleca.com', '+51 912345678', 'Lic. Elena Gómez (RRHH)', 'Mantenimiento & Alta Tensión', 'Calle Los Metalúrgicos 120, Arequipa'),
                        ('emp-3', '20405554433', 'Ingeniería y Mantenimiento INGEMANT S.A.', 'INGEMANT Mantenimiento', '🛠️', '#10b981', 'admin@ingemant.pe', '+51 955443322', 'Ing. Carlos Mendoza (Jefe Planta)', 'Mantenimiento Mecánico de Planta', 'Av. Argentina 1020, Callao'),
                        ('emp-4', '20708889911', 'Servicios & Seguridad Industrial ALFA S.A.C.', 'ALFA Seguridad HSE', '🛡️', '#a855f7', 'contacto@seguridadalfa.pe', '+51 977112233', 'Ing. Fernando Silva (Jefe HSE)', 'Seguridad Ocupacional & Prevención', 'Av. Javier Prado Este 2100, Lima')
                    `);
                }
            });

            // Insertar usuarios por defecto
            sqliteDb.get('SELECT COUNT(*) as count FROM usuarios', (err, row) => {
                if (row && row.count === 0) {
                    sqliteDb.run(`
                        INSERT INTO usuarios (id, empresa_id, email, password_hash, nombre_completo, cargo, rol, debe_cambiar_password) VALUES
                        ('u-christian', 'emp-3', 'cristianre257@gmail.com', 'Admin2026!', 'Christian Renato Ortega Bernedo', 'Gestor INGEMANT', 'CONTRATISTA', 0),
                        ('u-admin', NULL, 'admin@homologacontrol.com', 'Admin2026!', 'Carlos Mendoza (Admin General)', 'Administrador del Sistema', 'ADMINISTRADOR', 0),
                        ('u-supervisor', NULL, 'supervisor.hse@homologacontrol.com', 'SuperHSE2026!', 'Ing. Sofia Ramírez (Supervisor HSE)', 'Auditor HSE Principal', 'SUPERVISOR', 0),
                        ('u-contratista-1', 'emp-1', 'contacto@cmiindustrial.com', 'CMI2026!Pass', 'Ing. Roberto Torres', 'Gestor CMI Industrial', 'CONTRATISTA', 0),
                        ('u-operador-1', 'emp-1', 'operador.cmi@cmiindustrial.com', 'Operador2026!', 'Luis Luque (Operador)', 'Operador de Carga CMI', 'OPERADOR', 0),
                        ('u-contratista-2', 'emp-2', 'operaciones@seleca.com', 'SELECA2026!Pass', 'Lic. Elena Gómez', 'Gestor SELECA', 'CONTRATISTA', 0),
                        ('u-operador-2', 'emp-2', 'operador.seleca@seleca.com', 'Operador2026!', 'Mateo Fernández', 'Operador de Carga SELECA', 'OPERADOR', 0),
                        ('u-contratista-3', 'emp-3', 'admin@ingemant.pe', 'INGEMANT2026!Pass', 'Ing. Carlos Mendoza', 'Gestor INGEMANT', 'CONTRATISTA', 0),
                        ('u-operador-3', 'emp-3', 'operador.ingemant@ingemant.pe', 'Operador2026!', 'Jorge Huanca', 'Operador de Carga INGEMANT', 'OPERADOR', 0),
                        ('u-contratista-4', 'emp-4', 'contacto@seguridadalfa.pe', 'ALFA2026!Pass', 'Ing. Fernando Silva', 'Gestor ALFA', 'CONTRATISTA', 0),
                        ('u-operador-4', 'emp-4', 'operador.alfa@seguridadalfa.pe', 'Operador2026!', 'Sergio Juárez', 'Operador de Carga ALFA', 'OPERADOR', 0)
                    `, () => resolve());
                } else {
                    resolve();
                }
            });
        });
    });
}

// Inicialización de Tablas y Semillas en MySQL 8.0
async function setupMySQLSchemaAndSeeds() {
    if (!mysqlPool) return;

    try {
        // 0. Tabla tipos_certificados
        await mysqlPool.query(`
            CREATE TABLE IF NOT EXISTS tipos_certificados (
                id VARCHAR(36) PRIMARY KEY,
                codigo VARCHAR(50) NOT NULL UNIQUE,
                nombre VARCHAR(150) NOT NULL,
                descripcion TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 1. Tabla empresas
        await mysqlPool.query(`
            CREATE TABLE IF NOT EXISTS empresas (
                id VARCHAR(36) PRIMARY KEY,
                ruc_rut VARCHAR(20) NOT NULL UNIQUE,
                razon_social VARCHAR(150) NOT NULL,
                nombre_comercial VARCHAR(150),
                logo_icon VARCHAR(10) DEFAULT '🏢',
                color_accent VARCHAR(20) DEFAULT '#38bdf8',
                email_contacto VARCHAR(100) NOT NULL,
                telefono_contacto VARCHAR(50),
                contacto_persona VARCHAR(100),
                rubro VARCHAR(100),
                direccion VARCHAR(200),
                estado ENUM('ACTIVO', 'INACTIVO') DEFAULT 'ACTIVO',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 2. Tabla usuarios
        await mysqlPool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id VARCHAR(36) PRIMARY KEY,
                empresa_id VARCHAR(36),
                email VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                nombre_completo VARCHAR(150) NOT NULL,
                cargo VARCHAR(100),
                rol ENUM('ADMINISTRADOR', 'SUPERVISOR', 'CONTRATISTA') DEFAULT 'CONTRATISTA',
                telefono VARCHAR(50),
                activo TINYINT(1) DEFAULT 1,
                debe_cambiar_password TINYINT(1) DEFAULT 1,
                ultimo_login DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 3. Tabla trabajadores
        await mysqlPool.query(`
            CREATE TABLE IF NOT EXISTS trabajadores (
                id VARCHAR(36) PRIMARY KEY,
                empresa_id VARCHAR(36) NOT NULL,
                tipo_documento VARCHAR(20) DEFAULT 'DNI',
                numero_documento VARCHAR(20) NOT NULL UNIQUE,
                nombres VARCHAR(100) NOT NULL,
                apellidos VARCHAR(100) NOT NULL,
                email_personal VARCHAR(100),
                telefono_personal VARCHAR(50),
                cargo_puesto VARCHAR(100) NOT NULL,
                area_trabajo VARCHAR(100),
                estado_habilitacion ENUM('HABILITADO', 'PROXIMO_A_VENCER', 'INHABILITADO') DEFAULT 'INHABILITADO',
                motivo_inhabilitacion TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 4. Tabla certificados
        await mysqlPool.query(`
            CREATE TABLE IF NOT EXISTS certificados (
                id VARCHAR(36) PRIMARY KEY,
                trabajador_id VARCHAR(36) NOT NULL,
                empresa_id VARCHAR(36) NOT NULL,
                tipo_certificado_id VARCHAR(36),
                nombre_curso VARCHAR(150) NOT NULL,
                entidad_emisora VARCHAR(150) NOT NULL,
                horas_lectivas INT DEFAULT 16,
                fecha_emision DATE NOT NULL,
                fecha_vencimiento DATE NOT NULL,
                codigo_qr_hash VARCHAR(100),
                pdf_filename VARCHAR(255),
                url_pdf_storage LONGTEXT,
                estado_validacion ENUM('EN_VALIDACION', 'APROBADO', 'RECHAZADO') DEFAULT 'EN_VALIDACION',
                estado_vigencia ENUM('HABILITADO', 'PROXIMO_A_VENCER', 'INHABILITADO') DEFAULT 'HABILITADO',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id) ON DELETE CASCADE,
                FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 5. Tabla alertas_notificaciones
        await mysqlPool.query(`
            CREATE TABLE IF NOT EXISTS alertas_notificaciones (
                id VARCHAR(36) PRIMARY KEY,
                certificado_id VARCHAR(36),
                trabajador_id VARCHAR(36),
                empresa_id VARCHAR(36),
                email_destinatario VARCHAR(150) NOT NULL,
                tipo_alerta VARCHAR(50) DEFAULT 'ALERTA_90_DIAS',
                dias_restantes INT,
                mensaje_resumen TEXT,
                fecha_envio DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 6. Tabla solicitudes_correccion
        await mysqlPool.query(`
            CREATE TABLE IF NOT EXISTS solicitudes_correccion (
                id VARCHAR(36) PRIMARY KEY,
                trabajador_id VARCHAR(36) NOT NULL,
                certificado_id VARCHAR(36),
                campo_afectado VARCHAR(100) NOT NULL,
                valor_anterior VARCHAR(255),
                valor_solicitado VARCHAR(255) NOT NULL,
                motivo_observacion TEXT,
                solicitante_contacto VARCHAR(150),
                estado ENUM('PENDIENTE', 'APROBADA', 'RECHAZADA') DEFAULT 'PENDIENTE',
                respuesta_admin TEXT,
                revisado_por VARCHAR(100),
                fecha_solicitud DATETIME DEFAULT CURRENT_TIMESTAMP,
                fecha_resolucion DATETIME,
                INDEX idx_sol_trab (trabajador_id),
                INDEX idx_sol_estado (estado)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // Migraciones preventivas para tablas existentes con esquemas antiguos
        const safeAddColumn = async (table, colDef) => {
            try {
                await mysqlPool.query(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
            } catch (e) {
                // Ignorar si la columna ya existe
            }
        };

        await safeAddColumn('empresas', 'nombre_comercial VARCHAR(150)');
        await safeAddColumn('empresas', "logo_icon VARCHAR(10) DEFAULT '🏢'");
        await safeAddColumn('empresas', "color_accent VARCHAR(20) DEFAULT '#38bdf8'");
        await safeAddColumn('empresas', 'email_contacto VARCHAR(100)');
        await safeAddColumn('empresas', 'telefono_contacto VARCHAR(50)');
        await safeAddColumn('empresas', 'contacto_persona VARCHAR(100)');
        await safeAddColumn('empresas', 'rubro VARCHAR(100)');
        await safeAddColumn('empresas', 'direccion VARCHAR(200)');
        await safeAddColumn('empresas', "estado ENUM('ACTIVO', 'INACTIVO') DEFAULT 'ACTIVO'");

        await safeAddColumn('usuarios', 'empresa_id VARCHAR(36)');
        await safeAddColumn('usuarios', 'debe_cambiar_password TINYINT(1) DEFAULT 1');
        await safeAddColumn('usuarios', 'ultimo_login DATETIME');

        await safeAddColumn('alertas_notificaciones', 'certificado_id VARCHAR(36)');
        await safeAddColumn('alertas_notificaciones', 'trabajador_id VARCHAR(36)');
        await safeAddColumn('alertas_notificaciones', 'empresa_id VARCHAR(36)');
        await safeAddColumn('alertas_notificaciones', 'email_destinatario VARCHAR(150)');
        await safeAddColumn('alertas_notificaciones', 'destinatario_email VARCHAR(150)');
        await safeAddColumn('alertas_notificaciones', 'asunto VARCHAR(255)');
        await safeAddColumn('alertas_notificaciones', 'cuerpo_html TEXT');
        await safeAddColumn('alertas_notificaciones', 'fecha_programada DATETIME');
        await safeAddColumn('alertas_notificaciones', "estado VARCHAR(50) DEFAULT 'ENVIADO'");
        await safeAddColumn('alertas_notificaciones', 'dias_restantes INT');
        await safeAddColumn('alertas_notificaciones', 'mensaje_resumen TEXT');
        await safeAddColumn('alertas_notificaciones', 'fecha_envio DATETIME DEFAULT CURRENT_TIMESTAMP');

        await safeAddColumn('trabajadores', 'empresa_id VARCHAR(36)');
        await safeAddColumn('trabajadores', "tipo_documento VARCHAR(20) DEFAULT 'DNI'");
        await safeAddColumn('trabajadores', 'numero_documento VARCHAR(20)');
        await safeAddColumn('trabajadores', 'nombres VARCHAR(100)');
        await safeAddColumn('trabajadores', 'apellidos VARCHAR(100)');
        await safeAddColumn('trabajadores', 'email_personal VARCHAR(100)');
        await safeAddColumn('trabajadores', 'telefono_personal VARCHAR(50)');
        await safeAddColumn('trabajadores', 'cargo_puesto VARCHAR(100)');
        await safeAddColumn('trabajadores', 'area_trabajo VARCHAR(100)');
        await safeAddColumn('trabajadores', "estado_habilitacion ENUM('HABILITADO', 'PROXIMO_A_VENCER', 'INHABILITADO') DEFAULT 'INHABILITADO'");
        await safeAddColumn('trabajadores', 'motivo_inhabilitacion TEXT');
        await safeAddColumn('trabajadores', 'foto_perfil LONGTEXT');

        await safeAddColumn('certificados', 'trabajador_id VARCHAR(36)');
        await safeAddColumn('certificados', 'empresa_id VARCHAR(36)');
        await safeAddColumn('certificados', 'tipo_certificado_id VARCHAR(36)');
        await safeAddColumn('certificados', 'url_pdf_storage LONGTEXT');
        await safeAddColumn('certificados', 'alerta_90d_enviada TINYINT(1) DEFAULT 0');
        await safeAddColumn('certificados', 'alerta_30d_enviada TINYINT(1) DEFAULT 0');
        await safeAddColumn('certificados', 'alerta_10d_enviada TINYINT(1) DEFAULT 0');
        await safeAddColumn('certificados', 'fecha_ultima_alerta DATETIME NULL');
        try { await mysqlPool.query("ALTER TABLE certificados MODIFY COLUMN tipo_certificado_id VARCHAR(36) NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE certificados MODIFY COLUMN url_pdf_storage LONGTEXT NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE certificados MODIFY COLUMN pdf_filename VARCHAR(255) NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE certificados MODIFY COLUMN codigo_qr_hash VARCHAR(100) NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE certificados MODIFY COLUMN estado_vigencia VARCHAR(50) DEFAULT 'HABILITADO'"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE trabajadores MODIFY COLUMN email_personal VARCHAR(100) NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE trabajadores MODIFY COLUMN telefono_personal VARCHAR(50) NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE trabajadores MODIFY COLUMN area_trabajo VARCHAR(100) NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE trabajadores MODIFY COLUMN estado_habilitacion VARCHAR(50) DEFAULT 'INHABILITADO'"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE alertas_notificaciones MODIFY COLUMN tipo_alerta VARCHAR(50) DEFAULT 'ALERTA_90_DIAS'"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE alertas_notificaciones MODIFY COLUMN destinatario_email VARCHAR(150) NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE alertas_notificaciones MODIFY COLUMN cuerpo_html MEDIUMTEXT NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE alertas_notificaciones MODIFY COLUMN asunto VARCHAR(255) NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE alertas_notificaciones MODIFY COLUMN fecha_programada DATETIME NULL"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE alertas_notificaciones MODIFY COLUMN estado VARCHAR(50) DEFAULT 'ENVIADO'"); } catch(e){}
        try { await mysqlPool.query("ALTER TABLE usuarios MODIFY COLUMN rol ENUM('ADMINISTRADOR', 'SUPERVISOR', 'CONTRATISTA', 'OPERADOR') DEFAULT 'CONTRATISTA'"); } catch(e){}

        // Insertar Semillas en MySQL si está vacía
        const [empRows] = await mysqlPool.query('SELECT COUNT(*) AS count FROM empresas');
        if (empRows[0].count === 0) {
            console.log('🌱 Poblando 4 Empresas Contratistas en MySQL Workbench...');
            await mysqlPool.query(`
                INSERT INTO empresas (id, ruc_rut, razon_social, nombre_comercial, logo_icon, color_accent, email_contacto, telefono_contacto, contacto_persona, rubro, direccion) VALUES
                ('emp-1', '20601234567', 'Constructora & Montajes CMI S.A.C.', 'CMI Industrial', '🏗️', '#38bdf8', 'contacto@cmiindustrial.com', '+51 987654321', 'Ing. Roberto Torres (Gerente)', 'Montaje Industrial & Estructuras', 'Av. Industrial 450, Lima'),
                ('emp-2', '20509876543', 'Servicios Eléctricos SELECA E.I.R.L.', 'SELECA Electricidad', '⚡', '#f59e0b', 'operaciones@seleca.com', '+51 912345678', 'Lic. Elena Gómez (RRHH)', 'Mantenimiento & Alta Tensión', 'Calle Los Metalúrgicos 120, Arequipa'),
                ('emp-3', '20405554433', 'Ingeniería y Mantenimiento INGEMANT S.A.', 'INGEMANT Mantenimiento', '🛠️', '#10b981', 'admin@ingemant.pe', '+51 955443322', 'Ing. Carlos Mendoza (Jefe Planta)', 'Mantenimiento Mecánico de Planta', 'Av. Argentina 1020, Callao'),
                ('emp-4', '20708889911', 'Servicios & Seguridad Industrial ALFA S.A.C.', 'ALFA Seguridad HSE', '🛡️', '#a855f7', 'contacto@seguridadalfa.pe', '+51 977112233', 'Ing. Fernando Silva (Jefe HSE)', 'Seguridad Ocupacional & Prevención', 'Av. Javier Prado Este 2100, Lima');
            `);
        }

        const [usrRows] = await mysqlPool.query('SELECT COUNT(*) AS count FROM usuarios');
        if (usrRows[0].count === 0) {
            console.log('🌱 Poblando Usuarios y Contraseñas en MySQL Workbench / Cloud...');
            await mysqlPool.query(`
                INSERT INTO usuarios (id, empresa_id, email, password_hash, nombre_completo, cargo, rol, debe_cambiar_password) VALUES
                ('u-christian', 'emp-3', 'cristianre257@gmail.com', 'Admin2026!', 'Christian Renato Ortega Bernedo', 'Gestor INGEMANT', 'CONTRATISTA', 0),
                ('u-admin', NULL, 'admin@homologacontrol.com', 'Admin2026!', 'Carlos Mendoza (Admin General)', 'Administrador del Sistema', 'ADMINISTRADOR', 0),
                ('u-supervisor', NULL, 'supervisor.hse@homologacontrol.com', 'SuperHSE2026!', 'Ing. Sofia Ramírez (Supervisor HSE)', 'Auditor HSE Principal', 'SUPERVISOR', 0),
                ('u-contratista-1', 'emp-1', 'contacto@cmiindustrial.com', 'CMI2026!Pass', 'Ing. Roberto Torres', 'Gestor CMI Industrial', 'CONTRATISTA', 0),
                ('u-operador-1', 'emp-1', 'operador.cmi@cmiindustrial.com', 'Operador2026!', 'Luis Luque (Operador)', 'Operador de Carga CMI', 'OPERADOR', 0),
                ('u-contratista-2', 'emp-2', 'operaciones@seleca.com', 'SELECA2026!Pass', 'Lic. Elena Gómez', 'Gestor SELECA', 'CONTRATISTA', 0),
                ('u-operador-2', 'emp-2', 'operador.seleca@seleca.com', 'Operador2026!', 'Mateo Fernández', 'Operador de Carga SELECA', 'OPERADOR', 0),
                ('u-contratista-3', 'emp-3', 'admin@ingemant.pe', 'INGEMANT2026!Pass', 'Ing. Carlos Mendoza', 'Gestor INGEMANT', 'CONTRATISTA', 0),
                ('u-operador-3', 'emp-3', 'operador.ingemant@ingemant.pe', 'Operador2026!', 'Jorge Huanca', 'Operador de Carga INGEMANT', 'OPERADOR', 0),
                ('u-contratista-4', 'emp-4', 'contacto@seguridadalfa.pe', 'ALFA2026!Pass', 'Ing. Fernando Silva', 'Gestor ALFA', 'CONTRATISTA', 0),
                ('u-operador-4', 'emp-4', 'operador.alfa@seguridadalfa.pe', 'Operador2026!', 'Sergio Juárez', 'Operador de Carga ALFA', 'OPERADOR', 0);
            `);
        }

        const [tcRows] = await mysqlPool.query('SELECT COUNT(*) AS count FROM tipos_certificados');
        if (tcRows[0].count === 0) {
            await mysqlPool.query(`
                INSERT INTO tipos_certificados (id, codigo, nombre, descripcion) VALUES
                ('tc-1', 'CERT-SOLD-6G', 'Soldadura Avanzada ASME IX 6G', 'Certificación de Soldadura ASME IX 6G'),
                ('tc-2', 'CERT-SST-ALTURA', 'Trabajos en Altura Física y Prevención', 'Certificación de Seguridad en Altura OSHA');
            `);
        }

        console.log('✅ Esquema homologacion_db en MySQL Workbench listo para producción (Limpio).');

    } catch (err) {
        console.error('❌ Error creando esquema en MySQL Workbench:', err.message);
    }
}

// MÉTODOS ADAPTATIVOS QUERY & EXECUTE PARA MYSQL / SQLITE
async function allDB(sql, params = []) {
    if (isUsingMySQL && mysqlPool) {
        const [rows] = await mysqlPool.query(sql, params);
        return rows;
    } else {
        return new Promise((resolve, reject) => {
            sqliteDb.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
}

async function getDB(sql, params = []) {
    if (isUsingMySQL && mysqlPool) {
        const [rows] = await mysqlPool.query(sql, params);
        return rows[0] || null;
    } else {
        return new Promise((resolve, reject) => {
            sqliteDb.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
}

async function runDB(sql, params = []) {
    if (isUsingMySQL && mysqlPool) {
        const [result] = await mysqlPool.query(sql, params);
        return { lastID: result.insertId, changes: result.affectedRows };
    } else {
        return new Promise((resolve, reject) => {
            sqliteDb.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }
}

// Función Auxiliar de Estado de Trabajador
async function recalcularEstadoTrabajadorBD(trabajadorId) {
    const certs = await allDB('SELECT * FROM certificados WHERE trabajador_id = ?', [trabajadorId]);

    if (!certs || certs.length === 0) {
        await runDB('UPDATE trabajadores SET estado_habilitacion = "INHABILITADO" WHERE id = ?', [trabajadorId]);
        return 'INHABILITADO';
    }

    const tieneRechazado = certs.some(c => c.estado_validacion === 'RECHAZADO');
    const tieneProximo = certs.some(c => c.estado_vigencia === 'PROXIMO_A_VENCER' && c.estado_validacion === 'APROBADO');
    const todosAprobados = certs.every(c => c.estado_validacion === 'APROBADO');

    let nuevoEstado = 'INHABILITADO';
    if (tieneRechazado) {
        nuevoEstado = 'INHABILITADO';
    } else if (todosAprobados && tieneProximo) {
        nuevoEstado = 'PROXIMO_A_VENCER';
    } else if (todosAprobados) {
        nuevoEstado = 'HABILITADO';
    }

    await runDB('UPDATE trabajadores SET estado_habilitacion = ? WHERE id = ?', [nuevoEstado, trabajadorId]);
    return nuevoEstado;
}

module.exports = {
    initMySQLConnection,
    allDB,
    getDB,
    runDB,
    recalcularEstadoTrabajadorBD,
    isUsingMySQL: () => isUsingMySQL
};
