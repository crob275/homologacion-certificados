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

async function consultarPorDNI(req, res) {
    try {
        const { dni } = req.params;
        const cleanDni = String(dni || '').trim().replace(/[\s\.\-]/g, '');
        if (!cleanDni || cleanDni.length < 6) {
            return res.status(400).json({ error: 'Número de documento o DNI no válido.' });
        }

        let trabajador = await getDB(`
            SELECT t.*, 
                   e.razon_social AS empresa_nombre, 
                   e.ruc_rut AS empresa_ruc,
                   e.email_contacto AS empresa_email, 
                   e.telefono_contacto AS empresa_telefono
            FROM trabajadores t
            JOIN empresas e ON t.empresa_id = e.id
            WHERE t.numero_documento = ?
            LIMIT 1
        `, [cleanDni]);

        if (!trabajador && cleanDni.length > 3) {
            const queryNorm = cleanDni.toLowerCase();
            trabajador = await getDB(`
                SELECT t.*, 
                       e.razon_social AS empresa_nombre, 
                       e.ruc_rut AS empresa_ruc,
                       e.email_contacto AS empresa_email, 
                       e.telefono_contacto AS empresa_telefono
                FROM trabajadores t
                JOIN empresas e ON t.empresa_id = e.id
                WHERE LOWER(t.nombres || ' ' || t.apellidos) LIKE ?
                   OR LOWER(t.apellidos || ' ' || t.nombres) LIKE ?
                LIMIT 1
            `, [`%${queryNorm}%`, `%${queryNorm}%`]);
        }

        if (!trabajador) {
            return res.status(404).json({ 
                error: 'No se encontró ningún trabajador registrado con el documento o nombre: ' + cleanDni,
                sugerencia: 'Verifique que su empresa haya cargado su nómina o certificado en la plataforma.'
            });
        }

        const certificados = await allDB(`
            SELECT c.*
            FROM certificados c
            WHERE c.trabajador_id = ?
            ORDER BY c.fecha_vencimiento DESC
        `, [trabajador.id]);

        const ahora = new Date();
        ahora.setHours(0, 0, 0, 0);

        const certsConVigencia = certificados.map(c => {
            const fVenc = new Date(c.fecha_vencimiento);
            const diffMs = fVenc.getTime() - ahora.getTime();
            const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            let estadoPase = 'HABILITADO';
            if (diasRestantes <= 0) estadoPase = 'VENCIDO';
            else if (diasRestantes <= 90) estadoPase = 'POR_VENCER';

            return {
                ...c,
                dias_restantes: diasRestantes,
                estado_pase: estadoPase
            };
        });

        res.json({
            trabajador,
            certificados: certsConVigencia,
            total_certificados: certsConVigencia.length,
            estado_general: trabajador.estado_habilitacion
        });
    } catch (err) {
        res.status(500).json({ error: 'Error en consulta pública: ' + err.message });
    }
}

async function reenviarNotificacionTrabajador(req, res) {
    try {
        const { trabajador_id, email_nuevo } = req.body;
        if (!trabajador_id) {
            return res.status(400).json({ error: 'ID de trabajador requerido.' });
        }

        const trabajador = await getDB('SELECT * FROM trabajadores WHERE id = ?', [trabajador_id]);
        if (!trabajador) return res.status(404).json({ error: 'Trabajador no encontrado.' });

        if (email_nuevo && email_nuevo.includes('@')) {
            await runDB('UPDATE trabajadores SET email_personal = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [email_nuevo.trim(), trabajador_id]);
            trabajador.email_personal = email_nuevo.trim();
        }

        const cert = await getDB('SELECT * FROM certificados WHERE trabajador_id = ? ORDER BY fecha_vencimiento DESC LIMIT 1', [trabajador_id]);
        if (!cert) {
            return res.status(404).json({ error: 'El trabajador no cuenta con certificados registrados para notificar.' });
        }

        const empresa = await getDB('SELECT * FROM empresas WHERE id = ?', [trabajador.empresa_id]);

        const { enviarNotificacionIndividualTrabajador } = require('../services/email.service');
        const envio = await enviarNotificacionIndividualTrabajador({
            certificadoId: cert.id,
            remitenteNombre: 'Centro de Acreditación Digital Minera',
            remitenteRol: 'AUDITORÍA HSE',
            remitenteEmail: empresa ? empresa.email_contacto : 'soporte@homologacontrol.com'
        });

        res.json({
            exito: true,
            mensaje: `Notificación despachada con éxito a ${trabajador.email_personal}`,
            envio
        });
    } catch (err) {
        res.status(500).json({ error: 'Error reenviando correo: ' + err.message });
    }
}

// =========================================================================
// MÓDULO NORMATIVO DE SOLICITUDES DE CORRECCIÓN (TRABAJADOR -> ADMIN)
// =========================================================================

async function crearSolicitudCorreccion(req, res) {
    try {
        const { trabajador_id, certificado_id, campo_afectado, valor_anterior, valor_solicitado, motivo_observacion, solicitante_contacto } = req.body;

        if (!trabajador_id || !campo_afectado || !valor_solicitado) {
            return res.status(400).json({ error: 'Identificador del trabajador, campo a corregir y valor solicitado son obligatorios.' });
        }

        const idSol = 'sol-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

        await runDB(`
            INSERT INTO solicitudes_correccion (id, trabajador_id, certificado_id, campo_afectado, valor_anterior, valor_solicitado, motivo_observacion, solicitante_contacto, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')
        `, [idSol, trabajador_id, certificado_id || null, campo_afectado, valor_anterior || '', valor_solicitado, motivo_observacion || '', solicitante_contacto || '']);

        res.status(201).json({
            exito: true,
            message: 'Solicitud de corrección enviada formalmente. Queda en cola de auditoría para revisión del Administrador.',
            solicitud_id: idSol
        });
    } catch (err) {
        res.status(500).json({ error: 'Error creando solicitud de corrección: ' + err.message });
    }
}

async function listarSolicitudesCorreccion(req, res) {
    try {
        const solicitudes = await allDB(`
            SELECT s.*, 
                   t.nombres as trabajador_nombres,
                   t.apellidos as trabajador_apellidos,
                   t.numero_documento as trabajador_doc,
                   e.razon_social as empresa_nombre
            FROM solicitudes_correccion s
            JOIN trabajadores t ON s.trabajador_id = t.id
            JOIN empresas e ON t.empresa_id = e.id
            ORDER BY s.fecha_solicitud DESC
        `);
        res.json(solicitudes);
    } catch (err) {
        res.status(500).json({ error: 'Error listando solicitudes: ' + err.message });
    }
}

async function resolverSolicitudCorreccion(req, res) {
    try {
        const { id } = req.params;
        const { accion, respuesta_admin, revisor_nombre } = req.body; // accion: 'APROBADA' o 'RECHAZADA'

        const sol = await getDB('SELECT * FROM solicitudes_correccion WHERE id = ?', [id]);
        if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada.' });

        const nuevoEstado = (accion === 'APROBADA') ? 'APROBADA' : 'RECHAZADA';

        // Si se aprueba, aplicar automáticamente el cambio en la tabla correspondiente
        if (nuevoEstado === 'APROBADA') {
            const campo = sol.campo_afectado.toLowerCase();
            const valor = sol.valor_solicitado;

            if (['nombres', 'apellidos', 'numero_documento', 'email_personal', 'telefono_personal', 'cargo_puesto'].includes(campo)) {
                await runDB(`UPDATE trabajadores SET ${campo} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [valor, sol.trabajador_id]);
            } else if (sol.certificado_id && ['nombre_curso', 'entidad_emisora', 'horas_lectivas', 'fecha_emision'].includes(campo)) {
                await runDB(`UPDATE certificados SET ${campo} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [valor, sol.certificado_id]);
            }
        }

        await runDB(`
            UPDATE solicitudes_correccion SET
                estado = ?,
                respuesta_admin = ?,
                revisado_por = ?,
                fecha_resolucion = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [nuevoEstado, respuesta_admin || '', revisor_nombre || 'Administrador HSE', id]);

        res.json({
            exito: true,
            message: `Solicitud ${nuevoEstado} exitosamente.`
        });
    } catch (err) {
        res.status(500).json({ error: 'Error resolviendo solicitud: ' + err.message });
    }
}

module.exports = {
    listarTrabajadores,
    crearTrabajador,
    actualizarTrabajador,
    eliminarTrabajador,
    consultarPorDNI,
    reenviarNotificacionTrabajador,
    crearSolicitudCorreccion,
    listarSolicitudesCorreccion,
    resolverSolicitudCorreccion
};
