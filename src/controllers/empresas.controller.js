const { allDB, getDB, runDB } = require('../config/database');

async function listarEmpresas(req, res) {
    try {
        const empresaId = req.query.empresa_id || null;
        let empresas;
        if (empresaId) {
            empresas = await allDB('SELECT * FROM empresas WHERE id = ? ORDER BY created_at ASC', [empresaId]);
        } else {
            empresas = await allDB('SELECT * FROM empresas ORDER BY created_at ASC');
        }

        const data = await Promise.all(empresas.map(async emp => {
            const trabs = await allDB(`
                SELECT t.* FROM trabajadores t
                JOIN certificados c ON c.trabajador_id = t.id
                WHERE t.empresa_id = ?
                GROUP BY t.id
            `, [emp.id]);
            const hab = trabs.filter(t => t.estado_habilitacion === 'HABILITADO').length;
            const certs = await allDB('SELECT * FROM certificados WHERE empresa_id = ?', [emp.id]);
            return {
                ...emp,
                total_trabajadores: trabs.length,
                trabajadores_habilitados: hab,
                total_certificados: certs.length
            };
        }));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function crearEmpresa(req, res) {
    try {
        const { ruc_rut, razon_social, nombre_comercial, logo_icon, color_accent, email_contacto, telefono_contacto, contacto_persona, rubro, direccion } = req.body;
        
        if (!ruc_rut || !razon_social || !email_contacto) {
            return res.status(400).json({ error: 'RUC, Razón Social y Email son campos obligatorios.' });
        }

        if (!logo_icon || !logo_icon.trim()) {
            return res.status(400).json({ error: 'El logo o ícono de la empresa es un campo obligatorio.' });
        }

        const newId = 'emp-' + Date.now();
        await runDB(`
            INSERT INTO empresas (id, ruc_rut, razon_social, nombre_comercial, logo_icon, color_accent, email_contacto, telefono_contacto, contacto_persona, rubro, direccion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            newId, 
            ruc_rut, 
            razon_social, 
            nombre_comercial || razon_social, 
            logo_icon.trim(), 
            color_accent || '#38bdf8', 
            email_contacto, 
            telefono_contacto || '+51 900000000', 
            contacto_persona || 'Gestor de Contratistas', 
            rubro || 'Servicios Generales', 
            direccion || 'Av. Principal'
        ]);

        const nuevaEmpresa = await getDB('SELECT * FROM empresas WHERE id = ?', [newId]);
        res.status(201).json({ message: 'Empresa contratista creada exitosamente en BD.', empresa: nuevaEmpresa });
    } catch (err) {
        res.status(500).json({ error: 'Error al crear empresa: ' + err.message });
    }
}

async function actualizarEmpresa(req, res) {
    try {
        const { id } = req.params;
        const { ruc_rut, razon_social, nombre_comercial, logo_icon, color_accent, email_contacto, telefono_contacto, contacto_persona, rubro, direccion, estado } = req.body;

        const empExist = await getDB('SELECT * FROM empresas WHERE id = ?', [id]);
        if (!empExist) return res.status(404).json({ error: 'Empresa no encontrada.' });

        await runDB(`
            UPDATE empresas SET
                ruc_rut = COALESCE(?, ruc_rut),
                razon_social = COALESCE(?, razon_social),
                nombre_comercial = COALESCE(?, nombre_comercial),
                logo_icon = COALESCE(?, logo_icon),
                color_accent = COALESCE(?, color_accent),
                email_contacto = COALESCE(?, email_contacto),
                telefono_contacto = COALESCE(?, telefono_contacto),
                contacto_persona = COALESCE(?, contacto_persona),
                rubro = COALESCE(?, rubro),
                direccion = COALESCE(?, direccion),
                estado = COALESCE(?, estado),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [ruc_rut, razon_social, nombre_comercial, logo_icon, color_accent, email_contacto, telefono_contacto, contacto_persona, rubro, direccion, estado, id]);

        const empActualizada = await getDB('SELECT * FROM empresas WHERE id = ?', [id]);
        res.json({ message: 'Datos de la empresa actualizados en BD.', empresa: empActualizada });
    } catch (err) {
        res.status(500).json({ error: 'Error actualizando empresa: ' + err.message });
    }
}

module.exports = {
    listarEmpresas,
    crearEmpresa,
    actualizarEmpresa
};
