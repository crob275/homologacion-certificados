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

module.exports = {
    getDashboardKPIs,
    getReportePowerBI,
    ejecutarEscaneoAlertas,
    getHistorialAlertasController,
    configurarModoPruebaEmail,
    enviarAlertaIndividualController,
    descargarPadronExcel,
    descargarPlantillaOficialExcel
};
