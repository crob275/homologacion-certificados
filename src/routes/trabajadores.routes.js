const express = require('express');
const router = express.Router();
const trabajadoresController = require('../controllers/trabajadores.controller');

router.get('/', trabajadoresController.listarTrabajadores);
router.get('/consulta-dni/:dni', trabajadoresController.consultarPorDNI);
router.post('/reenviar-notificacion', trabajadoresController.reenviarNotificacionTrabajador);

// Solicitudes de Corrección
router.post('/solicitudes-correccion', trabajadoresController.crearSolicitudCorreccion);
router.get('/solicitudes-correccion', trabajadoresController.listarSolicitudesCorreccion);
router.put('/solicitudes-correccion/:id/resolver', trabajadoresController.resolverSolicitudCorreccion);

router.post('/', trabajadoresController.crearTrabajador);
router.put('/:id', trabajadoresController.actualizarTrabajador);
router.delete('/:id', trabajadoresController.eliminarTrabajador);

module.exports = router;
