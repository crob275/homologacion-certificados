const express = require('express');
const path = require('path');
const cors = require('cors');

// Módulos de Rutas
const authRoutes = require('./routes/auth.routes');
const empresasRoutes = require('./routes/empresas.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const trabajadoresRoutes = require('./routes/trabajadores.routes');
const certificadosRoutes = require('./routes/certificados.routes');
const reportesRoutes = require('./routes/reportes.routes');
const alertasRoutes = require('./routes/alertas.routes');

// Controladores adicionales para rutas directas
const certificadosController = require('./controllers/certificados.controller');
const errorHandler = require('./middleware/errorHandler');
const { allDB, runDB } = require('./config/database');

const app = express();

// Middlewares Globales
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Registro de Rutas API (v1)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/empresas', empresasRoutes);
app.use('/api/v1/usuarios', usuariosRoutes);
app.use('/api/v1/trabajadores', trabajadoresRoutes);
app.use('/api/v1/certificados', certificadosRoutes);
app.use('/api/v1/alertas', alertasRoutes);

// Rutas de Dashboard y Reportes Power BI
app.use('/api/v1/dashboard', express.Router().get('/kpis', require('./controllers/reportes.controller').getDashboardKPIs));
app.use('/api/v1/bi', express.Router().get('/reporte-powerbi', require('./controllers/reportes.controller').getReportePowerBI));
app.use('/api/v1/plantilla', express.Router().get('/descargar-excel', certificadosController.descargarPlantillaExcel));

// Ruta de Evaluación de Homologaciones
app.post('/api/v1/homologaciones/evaluar', certificadosController.evaluarHomologacion);

// Motor Cron de Alertas de Vencimientos
app.post('/api/v1/cron/ejecutar-alertas', async (req, res) => {
    try {
        const hoyStr = '2026-08-25';
        const hoy = new Date(hoyStr);
        const certs = await allDB('SELECT c.*, e.razon_social as empresa_nombre, e.email_contacto as empresa_email FROM certificados c JOIN empresas e ON c.empresa_id = e.id WHERE c.estado_validacion = "APROBADO"');
        
        let alertasGeneradas = 0;
        for (let c of certs) {
            const venc = new Date(c.fecha_vencimiento);
            const diffDays = Math.ceil((venc - hoy) / (1000 * 60 * 60 * 24));

            if (diffDays <= 90 && diffDays > 0) {
                await runDB('UPDATE certificados SET estado_vigencia = "PROXIMO_A_VENCER" WHERE id = ?', [c.id]);
                const newAltId = 'alt-' + Date.now() + '-' + Math.floor(Math.random() * 100);
                await runDB(`
                    INSERT INTO alertas_notificaciones (id, certificado_id, empresa_id, destinatario_email, tipo_alerta, fecha_programada)
                    VALUES (?, ?, ?, ?, 'VENCIMIENTO_90_DIAS', ?)
                `, [newAltId, c.id, c.empresa_id, c.empresa_email, hoyStr]);
                alertasGeneradas++;
            }
        }

        const alertas = await allDB('SELECT a.*, e.razon_social as empresa FROM alertas_notificaciones a JOIN empresas e ON a.empresa_id = e.id ORDER BY a.created_at DESC');
        res.json({ message: 'Motor Cron de Vigencias ejecutado en BD.', alertas_generadas: alertasGeneradas, alertas_totales: alertas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fallback SPA HTML Index
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Middleware Global de Manejo de Errores
app.use(errorHandler);

module.exports = app;
