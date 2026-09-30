require('dotenv').config();
const app = require('./src/app');
const { initMySQLConnection } = require('./src/config/database');
const { ejecutarEscaneoAlertasEscalonadas } = require('./src/services/email.service');

const PORT = process.env.PORT || 4400;

// Inicializar Conexión a MySQL 8.0 Workbench Local o Fallback SQLite
initMySQLConnection().then(async (mysqlSuccess) => {
    if (!mysqlSuccess) {
        console.log('🚀 Usando Base de Datos SQLite respaldada.');
    }

    // Función del Cron Diario (Escaneo 90, 30 y 10 días de certificados existentes en BD)
    const correrCronEscalonado = async () => {
        try {
            console.log('🔍 [CRON AUTOMÁTICO] Escaneando certificados en BD (Escala: 90d, 30d, 10d)...');
            const res = await ejecutarEscaneoAlertasEscalonadas();
            console.log(`✅ [CRON DIARIO OK] Certificados: ${res.total_certificados_escaneados} | 90d: ${res.en_rango_90_dias} | 30d: ${res.en_rango_30_dias} | 10d: ${res.en_rango_10_dias} | Correos despachados: ${res.correos_alertas_enviados}`);
        } catch (e) {
            console.error('❌ Error en ejecución de cron diario:', e.message);
        }
    };

    // 1. Ejecutar escaneo al arrancar el servidor (tras 3 segundos de calentamiento)
    setTimeout(correrCronEscalonado, 3000);

    // 2. Programar escaneo automático cada 24 horas continuas
    const INTERVALO_24_HORAS = 24 * 60 * 60 * 1000;
    setInterval(correrCronEscalonado, INTERVALO_24_HORAS);
}).catch(err => {
    console.error('❌ Error iniciando base de datos:', err);
});

// Arrancar Servidor Web Express
app.listen(PORT, () => {
    console.log(`=============================================================`);
    console.log(`🚀 SISTEMA DE HOMOLOGACIÓN DE CERTIFICADOS NODE.JS INICIADO (ARQUITECTURA LIMPIA)`);
    console.log(`🌐 Servidor Web disponible en: http://localhost:${PORT}`);
    console.log(`=============================================================`);
});
