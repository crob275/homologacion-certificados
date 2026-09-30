const { allDB, getDB, runDB } = require('../config/database');
const { normalizarTelefonoPeru } = require('../services/excel.service');

async function listarTrabajadores(req, res) {
    try {
        const empresaId = req.query.empresa_id || null;
        let query = `
            SELECT t.*, e.razon_social as empresa_nombre, e.email_contacto as empresa_email, e.telefono_contacto as empresa_telefono
            FROM trabajadores t
            JOIN empresas e ON t.empresa_id = e.id
        `;
        let params = [];

        if (empresaId) {
            query += ` WHERE t.empresa_id = ? `;
            params.push(empresaId);
        }

        query += ` ORDER BY t.created_at DESC `;

        const trabajadores = await allDB(query, params);
        res.json(trabajadores);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function crearTrabajador(req, res) {
    try {
        const { empresa_id, tipo_documento, numero_documento, nombres, apellidos, email_personal, telefono_personal, cargo_puesto, area_trabajo } = req.body;

        if (!empresa_id || !numero_documento || !nombres || !apellidos) {
            return res.status(400).json({ error: 'Empresa, Documento, Nombres y Apellidos son obligatorios.' });
        }

        const telNorm = normalizarTelefonoPeru(telefono_personal);
        const newId = 'tr-' + Date.now();
        await runDB(`
            INSERT INTO trabajadores (id, empresa_id, tipo_documento, numero_documento, nombres, apellidos, email_personal, telefono_personal, cargo_puesto, area_trabajo, estado_habilitacion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INHABILITADO')
        `, [newId, empresa_id, tipo_documento || 'DNI', numero_documento, nombres, apellidos, email_personal, telNorm, cargo_puesto || 'Técnico', area_trabajo || 'Planta']);

        const nuevoTrabajador = await getDB('SELECT * FROM trabajadores WHERE id = ?', [newId]);
        res.status(201).json({ message: 'Trabajador registrado en BD.', trabajador: nuevoTrabajador });
    } catch (err) {
        res.status(500).json({ error: 'Error creando trabajador: ' + err.message });
    }
}

async function actualizarTrabajador(req, res) {
    try {
        const { id } = req.params;
        const { empresa_id, tipo_documento, numero_documento, nombres, apellidos, email_personal, telefono_personal, cargo_puesto, area_trabajo } = req.body;

        const telNorm = telefono_personal !== undefined ? normalizarTelefonoPeru(telefono_personal) : undefined;

        await runDB(`
            UPDATE trabajadores SET
                empresa_id = COALESCE(?, empresa_id),
                tipo_documento = COALESCE(?, tipo_documento),
                numero_documento = COALESCE(?, numero_documento),
                nombres = COALESCE(?, nombres),
                apellidos = COALESCE(?, apellidos),
                email_personal = COALESCE(?, email_personal),
                telefono_personal = COALESCE(?, telefono_personal),
                cargo_puesto = COALESCE(?, cargo_puesto),
                area_trabajo = COALESCE(?, area_trabajo),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [empresa_id, tipo_documento, numero_documento, nombres, apellidos, email_personal, telNorm, cargo_puesto, area_trabajo, id]);

        const trabActualizado = await getDB('SELECT * FROM trabajadores WHERE id = ?', [id]);
        res.json({ message: 'Trabajador actualizado en BD.', trabajador: trabActualizado });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function eliminarTrabajador(req, res) {
    try {
        const { id } = req.params;
        await runDB('DELETE FROM trabajadores WHERE id = ?', [id]);
        res.json({ message: 'Trabajador eliminado de la Base de Datos.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    listarTrabajadores,
    crearTrabajador,
    actualizarTrabajador,
    eliminarTrabajador
};
