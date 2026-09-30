function errorHandler(err, req, res, next) {
    console.error('❌ Error capturado en API Middleware:', err);
    
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Error interno del servidor.';

    res.status(statusCode).json({
        exito: false,
        error: message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
}

module.exports = errorHandler;
