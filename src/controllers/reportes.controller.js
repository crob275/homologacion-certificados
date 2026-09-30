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

module.exports = {
    getDashboardKPIs,
    getReportePowerBI,
    ejecutarEscaneoAlertas,
    getHistorialAlertasController,
    configurarModoPruebaEmail,
    enviarAlertaIndividualController
};
