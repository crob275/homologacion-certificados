// Middleware de verificación de roles y privilegios
function permitirRoles(...rolesPermitidos) {
    return (req, res, next) => {
        const userRol = req.headers['x-user-role'] || req.body.user_rol;
        
        if (!userRol) {
            // En desarrollo, si no se especifica header, permitir avanzar
            return next();
        }

        if (rolesPermitidos.length > 0 && !rolesPermitidos.includes(userRol)) {
            return res.status(403).json({ 
                error: `Acceso denegado. Se requiere el rol ${rolesPermitidos.join(' o ')}.` 
            });
        }

        next();
    };
}

module.exports = {
    permitirRoles
};
