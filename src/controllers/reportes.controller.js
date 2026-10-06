const { obtenerKPIsDashboard, obtenerReportePowerBI } = require('../services/metrics.service');
const { 
    ejecutarEscaneoAlertas90Dias, 
    obtenerHistorialAlertas, 
    setCorreoPruebaRedireccion, 
    getCorreoPruebaRedireccion, 
    enviarAlertaIndividual 
} = require('../services/email.service');

async function getDashboardKPIs(req, res) {
    try {
        const empresaId = req.query.empresa_id || null;
        const kpis = await obtenerKPIsDashboard(empresaId);
        res.json(kpis);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function getReportePowerBI(req, res) {
    try {
        const empresaId = req.query.empresa_id || null;
        const reporte = await obtenerReportePowerBI(empresaId);
        res.json(reporte);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function ejecutarEscaneoAlertas(req, res) {
    try {
        const empresaId = req.query.empresa_id || req.body.empresa_id || null;
        const emailPrueba = req.query.email_prueba || req.body.email_prueba || null;
        const resultado = await ejecutarEscaneoAlertas90Dias(empresaId, emailPrueba);
        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: 'Error ejecutando escaneo de alertas: ' + err.message });
    }
}

async function getHistorialAlertasController(req, res) {
    try {
        const empresaId = req.query.empresa_id || null;
        const alertas = await obtenerHistorialAlertas(empresaId);
        res.json(alertas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function configurarModoPruebaEmail(req, res) {
    try {
        const { email_prueba } = req.body;
        const activo = setCorreoPruebaRedireccion(email_prueba);
        res.json({
            exito: true,
            modo_prueba_activo: Boolean(activo),
            email_prueba_configurado: activo || 'Desactivado (Envíos reales a correos de BD)'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function enviarAlertaIndividualController(req, res) {
    try {
        const { certificado_id, email_prueba } = req.body;
        if (!certificado_id) return res.status(400).json({ error: 'ID de certificado obligatorio.' });
        const resultado = await enviarAlertaIndividual(certificado_id, email_prueba);
        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: 'Error al enviar correo individual: ' + err.message });
    }
}

// Descarga en vivo del Padrón General de Mina en Excel (.xlsx)
async function descargarPadronExcel(req, res) {
    try {
        const empresaId = req.query.empresa_id || null;
        const { obtenerReportePowerBI } = require('../services/metrics.service');
        const { generarExcelPadronGeneral } = require('../services/excel.service');

        const data = await obtenerReportePowerBI(empresaId);
        const excelBuffer = generarExcelPadronGeneral(data);

        const fechaStr = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Padron_General_Homologacion_Minera_${fechaStr}.xlsx"`);
        res.send(excelBuffer);
    } catch (err) {
        res.status(500).json({ error: 'Error generando archivo Excel: ' + err.message });
    }
}

// Descarga de la Plantilla Oficial Excel (.xlsx) con validaciones
function descargarPlantillaOficialExcel(req, res) {
    try {
        const { generarPlantillaOficialXLSX } = require('../services/excel.service');
        const excelBuffer = generarPlantillaOficialXLSX();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_Oficial_Carga_Cuadrillas_HSE.xlsx"');
        res.send(excelBuffer);
    } catch (err) {
        res.status(500).json({ error: 'Error generando plantilla: ' + err.message });
    }
}

// Descarga / Volcado Completo de la Base de Datos en Formato SQL (Compatible con MySQL Workbench y local)
async function descargarRespaldoSQL(req, res) {
    try {
        const { allDB } = require('../config/database');
        
        const empresas = await allDB('SELECT * FROM empresas');
        const usuarios = await allDB('SELECT * FROM usuarios');
        const trabajadores = await allDB('SELECT * FROM trabajadores');
        const certificados = await allDB('SELECT * FROM certificados');
        const solicitudes = await allDB('SELECT * FROM solicitudes_correccion');
        const alertas = await allDB('SELECT * FROM alertas_notificaciones');

        let sql = `-- ========================================================\n`;
        sql += `-- RESPALDO INTEGRAL DE BASE DE DATOS HOMOLOGACION D.S. 024\n`;
        sql += `-- Generado: ${new Date().toISOString()}\n`;
        sql += `-- ========================================================\n\n`;
        sql += `CREATE DATABASE IF NOT EXISTS \`homologacion_db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n`;
        sql += `USE \`homologacion_db\`;\n\n`;
        sql += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;

        const esc = (v) => {
            if (v === null || v === undefined) return 'NULL';
            return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        };

        const exportTable = (name, rows) => {
            if (!rows || rows.length === 0) return `-- Tabla ${name}: 0 registros\n\n`;
            let out = `-- Datos de ${name} (${rows.length} registros)\n`;
            for (let r of rows) {
                const cols = Object.keys(r);
                const vals = cols.map(c => esc(r[c])).join(', ');
                out += `INSERT INTO \`${name}\` (\`${cols.join('`, `')}\`) VALUES (${vals});\n`;
            }
            out += `\n`;
            return out;
        };

        sql += exportTable('empresas', empresas);
        sql += exportTable('usuarios', usuarios);
        sql += exportTable('trabajadores', trabajadores);
        sql += exportTable('certificados', certificados);
        sql += exportTable('solicitudes_correccion', solicitudes);
        sql += exportTable('alertas_notificaciones', alertas);

        sql += `SET FOREIGN_KEY_CHECKS = 1;\n`;

        const fecha = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/sql');
        res.setHeader('Content-Disposition', `attachment; filename="homologacion_db_respaldo_${fecha}.sql"`);
        res.send(sql);
    } catch (err) {
        res.status(500).json({ error: 'Error exportando base de datos: ' + err.message });
    }
}

module.exports = {
    getDashboardKPIs,
    getReportePowerBI,
    ejecutarEscaneoAlertas,
    getHistorialAlertasController,
    configurarModoPruebaEmail,
    enviarAlertaIndividualController,
    descargarPadronExcel,
    descargarPlantillaOficialExcel,
    descargarRespaldoSQL
};
