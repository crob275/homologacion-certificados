const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

router.post('/login', authController.login);
router.post('/cambiar-password', authController.cambiarPassword);
router.get('/info-bd', (req, res) => {
    const { isUsingMySQL } = require('../config/database');
    res.json({
        motor_actual: isUsingMySQL() ? 'MYSQL_PRODUCCION' : 'SQLITE_RESPALDO',
        db_host: process.env.MYSQLHOST || 'No definido',
        db_port: process.env.MYSQLPORT || 'No definido',
        db_name: process.env.MYSQLDATABASE || 'No definido',
        node_env: process.env.NODE_ENV || 'production'
    });
});

module.exports = router;
