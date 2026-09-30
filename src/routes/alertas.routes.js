const express = require('express');
const router = express.Router();
const {
    obtenerHistorialAlertas,
    ejecutarEscaneoAlertas90Dias,
    enviarAlertaIndividual,
    setCorreoPruebaRedireccion,
    getCorreoPruebaRedireccion
} = require('../services/email.service');
const { getDB } = require('../config/database');

// Obtener historial completo de correos y alertas enviadas
router.get('/historial', async (req, res) => {
    try {
        const empresaId = req.query.empresa_id || null;
        const historial = await obtenerHistorialAlertas(empresaId);
        res.json(historial);
    } catch (err) {
        console.error('Error obteniendo historial de alertas:', err);
        res.status(500).json({ error: err.message });
    }
});

// Obtener detalle de una alerta individual por ID (incluyendo cuerpo HTML completo)
router.get('/:id', async (req, res) => {
    try {
        const alerta = await getDB('SELECT * FROM alertas_notificaciones WHERE id = ?', [req.params.id]);
        if (!alerta) return res.status(404).json({ error: 'Alerta no encontrada' });
        res.json(alerta);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ejecutar escaneo proactivo escalonado (90, 30 y 10 días)
router.post('/ejecutar-escaneo', async (req, res) => {
    try {
        const empresaId = req.query.empresa_id || req.body?.empresa_id || null;
        const testEmail = req.query.email_prueba || req.body?.email_prueba || null;
        const forzar = req.query.forzar === 'true' || req.body?.forzar === true;
        
        const { ejecutarEscaneoAlertasEscalonadas } = require('../services/email.service');
        const resultado = await ejecutarEscaneoAlertasEscalonadas(empresaId, testEmail, forzar);
        res.json(resultado);
    } catch (err) {
        console.error('Error en escaneo de alertas:', err);
        res.status(500).json({ error: err.message });
    }
});

// Enviar alerta individual de un certificado específico
router.post('/enviar-individual', async (req, res) => {
    try {
        const { certificado_id, email_prueba } = req.body;
        if (!certificado_id) {
            return res.status(400).json({ error: 'Se requiere certificado_id' });
        }
        const resultado = await enviarAlertaIndividual(certificado_id, email_prueba);
        res.json(resultado);
    } catch (err) {
        console.error('Error enviando alerta individual:', err);
        res.status(500).json({ error: err.message });
    }
});

// Configurar casilla de redirección para pruebas
router.post('/configurar-correo-prueba', (req, res) => {
    const { email } = req.body;
    const configurado = setCorreoPruebaRedireccion(email);
    res.json({ exito: true, correo_prueba_activo: configurado });
});

router.get('/configurar-correo-prueba', (req, res) => {
    res.json({ correo_prueba_activo: getCorreoPruebaRedireccion() });
});

// Diagnóstico de Conexión SMTP y Prueba en Vivo
router.get('/smtp-status', async (req, res) => {
    const { crearTransporterSMTP } = require('../services/email.service');
    const transporter = crearTransporterSMTP();
    res.json({
        smtp_configurado: Boolean(transporter),
        smtp_user: process.env.SMTP_USER || 'No configurado',
        smtp_host: process.env.SMTP_HOST || 'smtp.gmail.com',
        smtp_port: process.env.SMTP_PORT || 465,
        test_mode_activo: process.env.SMTP_TEST_MODE === 'true',
        test_email: process.env.SMTP_TEST_EMAIL || null
    });
});

router.post('/enviar-prueba-smtp', async (req, res) => {
    try {
        const { destino } = req.body;
        const target = destino || process.env.SMTP_USER || 'cristianre257@gmail.com';
        const { despacharCorreoInternet } = require('../services/email.service');
        
        const resultado = await despacharCorreoInternet({
            to: target,
            subject: '🔔 [PRUEBA CONECTIVIDAD] Notificaciones HomologaControl Activas',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; background: #0f172a; color: #fff; border-radius: 8px;">
                    <h2 style="color: #38bdf8;">Conexión SMTP Establecida con Éxito</h2>
                    <p>Este es un correo de prueba enviado desde la plataforma <strong>HomologaControl</strong>.</p>
                    <p>Servidor: <code>${process.env.SMTP_HOST || 'smtp.gmail.com'}</code></p>
                    <p>Fecha y Hora: <strong>${new Date().toLocaleString()}</strong></p>
                </div>
            `
        });

        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
