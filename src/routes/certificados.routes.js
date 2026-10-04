const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const certificadosController = require('../controllers/certificados.controller');

router.get('/', certificadosController.listarCertificados);
router.post('/upload', upload.single('pdfFile'), certificadosController.uploadPDFOCR);
router.post('/upload-batch', upload.array('pdfFiles', 50), certificadosController.uploadBatchPDFOCR);
router.post('/carga-masiva-excel', upload.single('excelFile'), certificadosController.cargarMasivaExcel);
router.put('/:id', certificadosController.actualizarCertificado);
router.delete('/:id', certificadosController.eliminarCertificado);

module.exports = router;
