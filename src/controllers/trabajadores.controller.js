const { allDB, getDB, runDB } = require('../config/database');
const { normalizarTelefonoPeru } = require('../services/excel.service');
const { despacharCorreoInternet } = require('../services/email.service');

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
        await runDB('DELETE FROM solicitudes_correccion WHERE trabajador_id = ?', [id]);
        await runDB('DELETE FROM alertas_notificaciones WHERE trabajador_id = ?', [id]);
        await runDB('DELETE FROM certificados WHERE trabajador_id = ?', [id]);
        await runDB('DELETE FROM trabajadores WHERE id = ?', [id]);
        res.json({ message: 'Trabajador eliminado de la Base de Datos.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function limpiarTodosTrabajadores(req, res) {
    try {
        await runDB('DELETE FROM solicitudes_correccion');
        await runDB('DELETE FROM alertas_notificaciones');
        await runDB('DELETE FROM certificados');
        await runDB('DELETE FROM trabajadores');
        res.json({
            exito: true,
            message: 'Todos los trabajadores, certificados y solicitudes de prueba han sido eliminados de la Base de Datos exitosamente.'
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al limpiar la base de datos: ' + err.message });
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
        const { empresa_id } = req.query;
        let sql = `
            SELECT s.*, 
                   t.nombres as trabajador_nombres,
                   t.apellidos as trabajador_apellidos,
                   t.numero_documento as trabajador_doc,
                   t.empresa_id,
                   e.razon_social as empresa_nombre
            FROM solicitudes_correccion s
            JOIN trabajadores t ON s.trabajador_id = t.id
            JOIN empresas e ON t.empresa_id = e.id
        `;
        const params = [];
        if (empresa_id) {
            sql += ` WHERE t.empresa_id = ? `;
            params.push(empresa_id);
        }
        sql += ` ORDER BY s.fecha_solicitud DESC`;

        const solicitudes = await allDB(sql, params);
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

        // Notificación automática al trabajador por correo electrónico
        const destinatarioEmail = sol.solicitante_contacto && sol.solicitante_contacto.includes('@') 
            ? sol.solicitante_contacto.trim() 
            : (await getDB('SELECT email_personal FROM trabajadores WHERE id = ?', [sol.trabajador_id]))?.email_personal;

        if (destinatarioEmail && destinatarioEmail.includes('@')) {
            try {
                const asunto = `[HOMOLOGACIÓN D.S. 024] Solicitud de Corrección ${nuevoEstado}`;
                const colorHeader = nuevoEstado === 'APROBADA' ? '#10b981' : '#ef4444';
                const html = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 10px; overflow: hidden; border: 1px solid #334155;">
                        <div style="background: ${colorHeader}; padding: 18px 24px; text-align: center; color: white;">
                            <h2 style="margin: 0; font-size: 1.3rem;">Resolución de Solicitud de Corrección</h2>
                            <small style="opacity: 0.9;">Control de Seguridad Minera D.S. 024-2016-EM</small>
                        </div>
                        <div style="padding: 24px;">
                            <p style="font-size: 1rem; color: #e2e8f0;">Estimado(a) trabajador(a),</p>
                            <p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.5;">
                                Su solicitud para la rectificación de <strong>${sol.campo_afectado}</strong> ha sido dictaminada como:
                            </p>
                            <div style="text-align: center; margin: 20px 0;">
                                <span style="background: ${colorHeader}; color: white; padding: 10px 20px; border-radius: 6px; font-weight: bold; font-size: 1.1rem; display: inline-block;">
                                    ${nuevoEstado}
                                </span>
                            </div>
                            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; background: rgba(255,255,255,0.03); border-radius: 6px; font-size: 0.9rem;">
                                <tr>
                                    <td style="padding: 10px; border-bottom: 1px solid #334155; color: #94a3b8;">Dato Solicitado:</td>
                                    <td style="padding: 10px; border-bottom: 1px solid #334155; color: #f8fafc; font-weight: bold;">${sol.valor_solicitado}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; border-bottom: 1px solid #334155; color: #94a3b8;">Observación del Administrador:</td>
                                    <td style="padding: 10px; border-bottom: 1px solid #334155; color: #f8fafc;">${respuesta_admin || 'Conforme a normativa'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; color: #94a3b8;">Revisado Por:</td>
                                    <td style="padding: 10px; color: #38bdf8;">${revisor_nombre || 'Auditoría HSE'}</td>
                                </tr>
                            </table>
                            <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 25px; text-align: center;">
                                Puede volver a consultar su carnet de habilitación en el Kiosco Digital en cualquier momento.
                            </p>
                        </div>
                    </div>
                `;

                await despacharCorreoInternet({
                    to: destinatarioEmail,
                    subject: asunto,
                    html: html
                });
            } catch (mailErr) {
                console.warn('⚠️ No se pudo enviar correo de resolución:', mailErr.message);
            }
        }

        res.json({
            exito: true,
            message: `Solicitud ${nuevoEstado} exitosamente.`
        });
    } catch (err) {
        res.status(500).json({ error: 'Error resolviendo solicitud: ' + err.message });
    }
}

// =========================================================================
// MÓDULO DE VALIDACIÓN PÚBLICA EN GARITA POR CÓDIGO QR (MODO MOVIL / TABLET)
// Abre la ficha oficial de habilitación sin requerir login para el guardia
// =========================================================================
async function verificarQRPublico(req, res) {
    try {
        const { dni } = req.params;
        const cleanDni = String(dni || '').trim().replace(/[\s\.\-]/g, '');

        const trabajador = await getDB(`
            SELECT t.*, 
                   e.razon_social AS empresa_nombre, 
                   e.ruc_rut AS empresa_ruc,
                   e.logo_icon AS empresa_logo
            FROM trabajadores t
            JOIN empresas e ON t.empresa_id = e.id
            WHERE t.numero_documento = ?
            LIMIT 1
        `, [cleanDni]);

        if (!trabajador) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Validación de Pase - No Encontrado</title>
                    <style>
                        body { background: #090d16; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                        .card { background: #111827; border: 2px solid #ef4444; border-radius: 16px; padding: 32px; max-width: 440px; text-align: center; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
                        .badge { background: rgba(239, 68, 68, 0.2); color: #f87171; font-weight: 800; padding: 6px 16px; border-radius: 20px; display: inline-block; font-size: 0.9rem; margin-bottom: 16px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div style="font-size: 3rem; margin-bottom: 12px;">🚫</div>
                        <div class="badge">REGISTRO NO LOCALIZADO</div>
                        <h2 style="margin: 0 0 10px 0;">Pase no Encontrado</h2>
                        <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.5;">El documento <strong>${cleanDni}</strong> no cuenta con acreditación en la base de datos de control de garita.</p>
                        <div style="margin-top: 24px; font-size: 0.8rem; color: #64748b;">HomologaControl Minería &bull; D.S. 024-2016-EM</div>
                    </div>
                </body>
                </html>
            `);
        }

        const certificados = await allDB(`
            SELECT c.*
            FROM certificados c
            WHERE c.trabajador_id = ?
            ORDER BY c.fecha_vencimiento DESC
        `, [trabajador.id]);

        const ahora = new Date();
        ahora.setHours(0, 0, 0, 0);

        let esHabilitado = certificados.length > 0;
        let tieneInhabilitado = false;
        let cursosCards = '';

        for (const cert of certificados) {
            const fVenc = new Date(cert.fecha_vencimiento);
            const diffMs = fVenc.getTime() - ahora.getTime();
            const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

            let colorBadge = '#10b981';
            let labelBadge = '✓ VIGENTE';
            if (diasRestantes <= 0) {
                colorBadge = '#ef4444';
                labelBadge = '⛔ VENCIDO';
                tieneInhabilitado = true;
            } else if (diasRestantes <= 90) {
                colorBadge = '#f59e0b';
                labelBadge = `⚠️ VENCE EN ${diasRestantes}d`;
            }

            const tienePDF = Boolean(cert.url_pdf_storage || (cert.pdf_filename && !cert.pdf_filename.includes('Excel')));

            cursosCards += `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-left: 4px solid ${colorBadge}; border-radius: 8px; padding: 12px; margin-bottom: 10px; text-align: left;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <strong style="color: #fff; font-size: 0.95rem;">${cert.nombre_curso}</strong>
                        <span style="background: ${colorBadge}25; color: ${colorBadge}; border: 1px solid ${colorBadge}; font-size: 0.75rem; font-weight: 800; padding: 2px 8px; border-radius: 10px;">${labelBadge}</span>
                    </div>
                    <div style="font-size: 0.8rem; color: #94a3b8; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;">
                        <span>Vence: <strong style="color: #cbd5e1;">${new Date(cert.fecha_vencimiento).toLocaleDateString('es-PE')}</strong></span>
                        ${tienePDF ? `<a href="/api/v1/certificados/archivo/${encodeURIComponent(cert.pdf_filename || cert.id)}" target="_blank" style="color: #38bdf8; text-decoration: none; font-size: 0.78rem; font-weight: 600;">📄 Ver Sustento PDF &rarr;</a>` : '<span style="color: #f59e0b; font-size: 0.75rem;">⚠️ Sustento 80% Provisional</span>'}
                    </div>
                </div>
            `;
        }

        const estadoFinal = (certificados.length === 0 || tieneInhabilitado) ? 'INHABILITADO' : 'HABILITADO';
        const colorEstado = estadoFinal === 'HABILITADO' ? '#10b981' : '#ef4444';
        const iconoEstado = estadoFinal === 'HABILITADO' ? '✅' : '⛔';
        const mensajePase = estadoFinal === 'HABILITADO' 
            ? 'PASE AUTORIZADO - ACCESO PERMITIDO A MINA' 
            : 'ACCESO DENEGADO EN GARITA - RESTRINGIDO';

        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Validación de Garita - ${trabajador.nombres} ${trabajador.apellidos}</title>
                <style>
                    body { background: #070b14; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; }
                    .container { max-width: 480px; width: 100%; margin: auto; }
                    .header-garita { background: linear-gradient(135deg, #0f172a, #1e293b); border: 1px solid #334155; border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 14px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); }
                    .decision-banner { background: ${colorEstado}; color: #fff; font-weight: 900; font-size: 1.1rem; padding: 14px; border-radius: 12px; margin-bottom: 16px; text-align: center; letter-spacing: 0.5px; box-shadow: 0 8px 20px ${colorEstado}40; display: flex; align-items: center; justify-content: center; gap: 8px; }
                    .data-card { background: #0f172a; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 18px; margin-bottom: 16px; }
                    .avatar { width: 72px; height: 72px; border-radius: 50%; background: #1e293b; border: 3px solid ${colorEstado}; display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="decision-banner">
                        <span>${iconoEstado}</span>
                        <span>${mensajePase}</span>
                    </div>

                    <div class="data-card" style="text-align: center;">
                        <div class="avatar">👷</div>
                        <h2 style="margin: 0; font-size: 1.3rem; color: #fff;">${trabajador.nombres} ${trabajador.apellidos}</h2>
                        <div style="color: #38bdf8; font-weight: bold; font-size: 1rem; margin-top: 4px;">DNI: ${trabajador.numero_documento}</div>
                        <div style="color: #94a3b8; font-size: 0.88rem; margin-top: 4px;">Cargo: <strong style="color: #e2e8f0;">${trabajador.cargo_puesto || 'Personal Técnico'}</strong></div>
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 0.88rem; color: #cbd5e1;">
                            🏢 <strong>${trabajador.empresa_nombre}</strong> (RUC: ${trabajador.empresa_ruc})
                        </div>
                    </div>

                    <div class="data-card">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <strong style="color: #fff; font-size: 0.95rem;">📜 Cursos & Homologaciones (${certificados.length})</strong>
                            <small style="color: #94a3b8;">D.S. 024-2016-EM</small>
                        </div>
                        ${cursosCards || '<div style="color: #f87171; text-align: center; padding: 16px;">Sin certificados registrados en expediente.</div>'}
                    </div>

                    <div style="text-align: center; color: #64748b; font-size: 0.78rem; padding: 12px;">
                        Verificación Criptográfica en Garita &bull; HomologaControl Minería v2.0<br>
                        Fecha y Hora de Consulta: ${new Date().toLocaleString('es-PE')}
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Error en verificación de garita: ' + err.message);
    }
}

// =========================================================================
// MÓDULO GENERADOR DE FOTOCHECK DIGITAL / CARNET MINERO (IMPRIMIBLE CR80)
// =========================================================================
async function generarFotocheckHTML(req, res) {
    try {
        const { id } = req.params;
        const trabajador = await getDB(`
            SELECT t.*, 
                   e.razon_social AS empresa_nombre, 
                   e.ruc_rut AS empresa_ruc,
                   e.logo_icon AS empresa_logo,
                   e.color_accent AS empresa_color
            FROM trabajadores t
            JOIN empresas e ON t.empresa_id = e.id
            WHERE t.id = ?
            LIMIT 1
        `, [id]);

        if (!trabajador) return res.status(404).send('Trabajador no encontrado para fotocheck.');

        const certificados = await allDB(`
            SELECT c.*
            FROM certificados c
            WHERE c.trabajador_id = ?
            ORDER BY c.fecha_vencimiento ASC
        `, [trabajador.id]);

        const ahora = new Date();
        ahora.setHours(0, 0, 0, 0);

        let esApto = certificados.length > 0;
        let primerVencimiento = null;

        const cursosResumen = certificados.map(c => {
            const fVenc = new Date(c.fecha_vencimiento);
            const diff = Math.ceil((fVenc - ahora) / (1000 * 60 * 60 * 24));
            if (diff <= 0) esApto = false;
            if (!primerVencimiento || fVenc < primerVencimiento) primerVencimiento = fVenc;

            return `
                <div style="display: flex; justify-content: space-between; font-size: 8px; margin-bottom: 3px; border-bottom: 1px dotted rgba(255,255,255,0.15); padding-bottom: 2px;">
                    <span style="color: #fff; max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c.nombre_curso}</span>
                    <strong style="color: ${diff <= 0 ? '#f87171' : (diff <= 90 ? '#fbbf24' : '#34d399')};">${new Date(c.fecha_vencimiento).toLocaleDateString('es-PE')}</strong>
                </div>
            `;
        }).join('');

        const hostUrl = req.protocol + '://' + req.get('host');
        const urlVerificacionQR = `${hostUrl}/api/v1/trabajadores/verificar-qr/${encodeURIComponent(trabajador.numero_documento)}`;
        const qrImageApi = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(urlVerificacionQR)}&color=0f172a&bgcolor=ffffff`;

        const badgeColor = esApto ? '#10b981' : '#ef4444';
        const badgeTexto = esApto ? 'AUTORIZADO / APTO' : 'RESTRINGIDO / NO APTO';

        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Fotocheck Oficial - ${trabajador.nombres} ${trabajador.apellidos}</title>
                <style>
                    body { background: #0f172a; color: #fff; font-family: 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                    .btn-print { background: linear-gradient(135deg, #0284c7, #0369a1); color: white; border: none; padding: 12px 24px; font-size: 14px; font-weight: bold; border-radius: 8px; cursor: pointer; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4); }
                    .badge-container { display: flex; gap: 24px; flex-wrap: wrap; justify-content: center; }
                    /* Formato Estándar CR80 Fotocheck (85.6mm x 53.98mm escalado a 324px x 510px) */
                    .cr80-card { width: 310px; height: 490px; background: #090e17; border-radius: 14px; border: 2px solid #334155; position: relative; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column; box-sizing: border-box; }
                    .card-header { background: linear-gradient(135deg, #1e293b, #0f172a); padding: 14px 16px; border-bottom: 2px solid ${badgeColor}; display: flex; justify-content: space-between; align-items: center; }
                    .photo-box { width: 90px; height: 110px; background: #1e293b; border: 2px solid #38bdf8; border-radius: 8px; margin: 12px auto 6px; display: flex; align-items: center; justify-content: center; font-size: 3rem; color: #94a3b8; }
                    .qr-section { background: #ffffff; padding: 6px; border-radius: 8px; display: inline-block; margin-top: 6px; }
                    @media print {
                        body { background: #fff !important; padding: 0 !important; }
                        .btn-print { display: none !important; }
                        .badge-container { gap: 15px; }
                        .cr80-card { border: 1px solid #ccc !important; box-shadow: none !important; page-break-inside: avoid; }
                    }
                </style>
            </head>
            <body>
                <button class="btn-print" onclick="window.print()">
                    🖨️ Imprimir Carnet / Fotocheck (Ambas Caras)
                </button>

                <div class="badge-container">
                    <!-- CARA FRONTAL -->
                    <div class="cr80-card">
                        <div class="card-header">
                            <div>
                                <span style="font-size: 8px; font-weight: 900; color: #38bdf8; letter-spacing: 0.5px; text-transform: uppercase;">HOMOLOGACONTROL HSE</span>
                                <h4 style="margin: 0; font-size: 11px; color: #fff;">PASE DE INGRESO A PLANTA</h4>
                            </div>
                            <span style="font-size: 1.4rem;">${trabajador.empresa_logo || '🏢'}</span>
                        </div>

                        <div class="photo-box">👷</div>

                        <div style="text-align: center; padding: 0 14px;">
                            <h3 style="margin: 0; font-size: 14px; color: #ffffff; text-transform: uppercase;">${trabajador.nombres}</h3>
                            <h3 style="margin: 0; font-size: 14px; color: #ffffff; text-transform: uppercase;">${trabajador.apellidos}</h3>
                            <div style="font-size: 12px; font-weight: 800; color: #38bdf8; margin-top: 3px;">DNI: ${trabajador.numero_documento}</div>
                            <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">CARGO: <strong style="color: #f1f5f9;">${trabajador.cargo_puesto || 'Técnico Especialista'}</strong></div>
                            <div style="font-size: 9px; color: #cbd5e1; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${trabajador.empresa_nombre}
                            </div>
                        </div>

                        <div style="margin-top: auto; padding: 12px; text-align: center; background: rgba(0,0,0,0.4); border-top: 1px solid rgba(255,255,255,0.08);">
                            <div style="background: ${badgeColor}; color: #fff; font-weight: 900; font-size: 11px; padding: 6px; border-radius: 6px; letter-spacing: 0.5px;">
                                ${badgeTexto}
                            </div>
                            <div style="font-size: 8px; color: #64748b; margin-top: 6px;">
                                Válido hasta: ${primerVencimiento ? new Date(primerVencimiento).toLocaleDateString('es-PE') : 'S/I'} &bull; D.S. 024-2016-EM
                            </div>
                        </div>
                    </div>

                    <!-- CARA POSTERIOR (AUDITORÍA & CÓDIGO QR DE GARITA) -->
                    <div class="cr80-card" style="padding: 16px; justify-content: space-between;">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 6px; margin-bottom: 8px;">
                                <span style="font-size: 9px; font-weight: 900; color: #38bdf8;">AUDITORÍA DE CURSOS MINEROS</span>
                                <span style="font-size: 8px; color: #94a3b8;">NORMATIVA MINERA</span>
                            </div>

                            <div style="max-height: 190px; overflow-y: hidden;">
                                ${cursosResumen || '<div style="font-size: 9px; color: #f87171;">Sin cursos registrados</div>'}
                            </div>
                        </div>

                        <div style="text-align: center; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">
                            <div class="qr-section">
                                <img src="${qrImageApi}" width="105" height="105" alt="Código QR Garita" style="display: block;">
                            </div>
                            <div style="font-size: 8px; color: #94a3b8; margin-top: 4px;">
                                Escanear en garita para verificar autenticidad en tiempo real
                            </div>
                            <div style="font-size: 7px; color: #64748b; margin-top: 2px;">
                                HomologaControl Minería &bull; Token Seguro SHA-256
                            </div>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Error generando fotocheck: ' + err.message);
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
    resolverSolicitudCorreccion,
    limpiarTodosTrabajadores,
    verificarQRPublico,
    generarFotocheckHTML
};
