const express = require('express');
const router = express.Router();
const empresasController = require('../controllers/empresas.controller');

router.get('/', empresasController.listarEmpresas);
router.post('/', empresasController.crearEmpresa);
router.put('/:id', empresasController.actualizarEmpresa);

module.exports = router;
