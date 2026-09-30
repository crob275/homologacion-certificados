const express = require('express');
const router = express.Router();
const usuariosController = require('../controllers/usuarios.controller');
const authController = require('../controllers/auth.controller');

router.get('/', usuariosController.listarUsuarios);
router.post('/', usuariosController.crearUsuario);
router.put('/:id', usuariosController.actualizarUsuario);
router.delete('/:id', usuariosController.eliminarUsuario);
router.post('/:id/reset-password', authController.resetPassword);

module.exports = router;
