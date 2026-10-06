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

router.post('/sql-query', async (req, res) => {
    const { queryDB, isUsingMySQL } = require('../config/database');
    const { sql, secret } = req.body;
    if (secret !== 'NtLNLFIcYQILOmDqqscGvxGHFfLFMMby') {
        return res.status(403).json({ error: 'Acceso no autorizado' });
    }
    try {
        const rows = await queryDB(sql);
        res.json({ exito: true, rows, motor: isUsingMySQL() ? 'MYSQL' : 'SQLITE' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
