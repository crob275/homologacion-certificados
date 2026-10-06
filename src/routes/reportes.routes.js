const express = require('express');
const router = express.Router();
const reportesController = require('../controllers/reportes.controller');
const certificadosController = require('../controllers/certificados.controller');

router.get('/dashboard-kpis', reportesController.getDashboardKPIs);
router.get('/powerbi-metrics', reportesController.getReportePowerBI);
router.get('/plantilla-excel', certificadosController.descargarPlantillaExcel);
router.get('/descargar-plantilla-xlsx', reportesController.descargarPlantillaOficialExcel);
router.get('/descargar-padron-excel', reportesController.descargarPadronExcel);
router.get('/descargar-respaldo-sql', reportesController.descargarRespaldoSQL);

// Rutas de Alertas Automatizadas y Correo 90 Días
router.post('/alertas/ejecutar-escaneo', reportesController.ejecutarEscaneoAlertas);
router.get('/alertas/ejecutar-escaneo', reportesController.ejecutarEscaneoAlertas);
router.get('/alertas/historial', reportesController.getHistorialAlertasController);
router.post('/alertas/configurar-modo-prueba', reportesController.configurarModoPruebaEmail);
router.post('/alertas/enviar-individual', reportesController.enviarAlertaIndividualController);

module.exports = router;
