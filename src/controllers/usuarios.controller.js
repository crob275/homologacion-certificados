const { allDB, getDB, runDB } = require('../config/database');

async function listarUsuarios(req, res) {
    try {
        const { empresa_id } = req.query;
        let query = `
            SELECT u.id, u.empresa_id, u.email, u.nombre_completo, u.cargo, u.rol, u.telefono, u.activo, u.debe_cambiar_password, u.ultimo_login, u.created_at, e.razon_social as empresa_nombre, e.logo_icon as empresa_logo
            FROM usuarios u
            LEFT JOIN empresas e ON u.empresa_id = e.id
        `;
        const params = [];
        if (empresa_id) {
            query += ` WHERE u.empresa_id = ? `;
            params.push(empresa_id);
        }
        query += ` ORDER BY u.created_at DESC `;

        const users = await allDB(query, params);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function crearUsuario(req, res) {
    try {
        const { email, password, nombre_completo, cargo, rol, empresa_id, telefono } = req.body;

        if (!email || !nombre_completo || !rol) {
            return res.status(400).json({ error: 'Email, Nombre Completo y Rol son obligatorios.' });
        }

        const userExist = await getDB('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?)', [email.trim()]);
        if (userExist) {
            return res.status(400).json({ error: 'El correo electrónico ya se encuentra registrado.' });
        }

        const newId = 'u-' + Date.now();
        const initialPass = password || 'TempPass2026!';

        await runDB(`
            INSERT INTO usuarios (id, empresa_id, email, password_hash, nombre_completo, cargo, rol, telefono, activo, debe_cambiar_password)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
        `, [newId, empresa_id || null, email.trim(), initialPass, nombre_completo, cargo || 'Usuario', rol, telefono || '+51 900000000']);

        const nuevoUsuario = await getDB('SELECT * FROM usuarios WHERE id = ?', [newId]);
        res.status(201).json({
            message: `Usuario creado en BD con contraseña temporal "${initialPass}". El usuario cambiará su clave en su primer ingreso.`,
            usuario: nuevoUsuario
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al crear usuario: ' + err.message });
    }
}

async function actualizarUsuario(req, res) {
    try {
        const { id } = req.params;
        const { email, nombre_completo, cargo, rol, empresa_id, telefono, activo } = req.body;

        await runDB(`
            UPDATE usuarios SET
                email = COALESCE(?, email),
                nombre_completo = COALESCE(?, nombre_completo),
                cargo = COALESCE(?, cargo),
                rol = COALESCE(?, rol),
                empresa_id = COALESCE(?, empresa_id),
                telefono = COALESCE(?, telefono),
                activo = COALESCE(?, activo),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [email, nombre_completo, cargo, rol, empresa_id, telefono, activo, id]);

        const userAct = await getDB('SELECT * FROM usuarios WHERE id = ?', [id]);
        res.json({ message: 'Usuario y rol actualizado en BD.', usuario: userAct });
    } catch (err) {
        res.status(500).json({ error: 'Error actualizando usuario: ' + err.message });
    }
}

async function eliminarUsuario(req, res) {
    try {
        const { id } = req.params;
        await runDB('DELETE FROM usuarios WHERE id = ?', [id]);
        res.json({ message: 'Usuario eliminado de la Base de Datos.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    listarUsuarios,
    crearUsuario,
    actualizarUsuario,
    eliminarUsuario
};
