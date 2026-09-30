const nodemailer = require('nodemailer');
const { allDB, getDB, runDB, recalcularEstadoTrabajadorBD } = require('../config/database');

// Solo activar la redirección de prueba si SMTP_TEST_MODE está explícitamente en 'true'
let correoPruebaRedireccion = (process.env.SMTP_TEST_MODE === 'true' && process.env.SMTP_TEST_EMAIL) ? process.env.SMTP_TEST_EMAIL : null;

// Transporter SMTP centralizado
function crearTransporterSMTP() {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '465');
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER || '';
    const pass = process.env.SMTP_PASS || '';

    if (!user || !pass) {
        return null; // Aún no tiene contraseña configurada, opera en modo virtual/simulación
    }

    return nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
            user,
            pass
        },
        tls: {
            rejectUnauthorized: false
        }
    });
}

// Despachador de correos hacia Internet o Log Seguro
async function despacharCorreoInternet({ to, subject, html, replyTo = null }) {
    const transporter = crearTransporterSMTP();
    const fromName = process.env.SMTP_FROM_NAME || 'HomologaControl HSE Notificaciones';
    const fromUser = process.env.SMTP_USER || 'notificaciones@homologacontrol.com';
    const fromAddress = `"${fromName}" <${fromUser}>`;

    // Si el modo interceptor de pruebas está activo en .env
    const modoTrap = process.env.SMTP_TEST_MODE === 'true';
    const destinatarioEfectivo = modoTrap ? (process.env.SMTP_TEST_EMAIL || to) : to;

    if (!transporter) {
        console.log(`ℹ️ [SMTP VIRTUAL - PENDIENTE CREDENCIAL]: Correo listo para salir a -> ${destinatarioEfectivo} | Asunto: ${subject}`);
        return {
            enviado_real: false,
            motivo: 'SMTP_CREDENCIALES_PENDIENTES',
            destinatario: destinatarioEfectivo
        };
    }

    try {
        const info = await transporter.sendMail({
            from: fromAddress,
            to: destinatarioEfectivo,
            replyTo: replyTo || fromUser,
            subject: modoTrap ? `[PRUEBA TRAP] ${subject}` : subject,
            html
        });
        console.log(`🚀 [SMTP REAL ENVIADO CON ÉXITO]: ID=${info.messageId} | Destino: ${destinatarioEfectivo}`);
        return {
            enviado_real: true,
            messageId: info.messageId,
            destinatario: destinatarioEfectivo
        };
    } catch (smtpErr) {
        console.error(`⚠️ [ERROR SMTP AL ENVIAR]:`, smtpErr.message);
        return {
            enviado_real: false,
            error: smtpErr.message,
            destinatario: destinatarioEfectivo
        };
    }
}

function setCorreoPruebaRedireccion(email) {
    correoPruebaRedireccion = email && email.trim() !== '' ? email.trim() : null;
    return correoPruebaRedireccion;
}

function getCorreoPruebaRedireccion() {
    return correoPruebaRedireccion;
}

function formatFechaLimpia(fechaStr) {
    if (!fechaStr) return 'N/A';
    if (fechaStr instanceof Date) {
        const y = fechaStr.getFullYear();
        const m = String(fechaStr.getMonth() + 1).padStart(2, '0');
        const d = String(fechaStr.getDate()).padStart(2, '0');
        return `${d}/${m}/${y}`;
    }
    const str = String(fechaStr).split('T')[0].trim();
    if (str.includes('-')) {
        const p = str.split('-');
        if (p.length === 3) {
            const y = p[0].length === 4 ? p[0] : p[2];
            const m = p[1];
            const d = p[0].length === 4 ? p[2] : p[0];
            return `${d}/${m}/${y}`;
        }
    }
    const parsed = new Date(fechaStr);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${d}/${m}/${y}`;
    }
    return str;
}

function generarHTMLAlertaMinera({ trabajador, certificado, empresa, diasRestantes, emailRealTrab, emailRealEmp, esModoPrueba, emailPrueba, etapaAlerta }) {
    const fechaFormateada = formatFechaLimpia(certificado.fecha_vencimiento);
    
    // Configuración según la etapa (90d, 30d, 10d o vencido)
    let colorHeader = '#10b981';
    let estadoTexto = '✓ APTO';
    let urgenciaBadge = 'INFORMATIVO';
    let recomendacionTexto = 'Favor gestionar la recertificación antes de la fecha límite para evitar contratiempos.';

    if (diasRestantes <= 0) {
        colorHeader = '#f43f5e';
        estadoTexto = '⛔ CERTIFICADO CADUCADO - INHABILITADO EN GARITA';
        urgenciaBadge = 'CRÍTICO / ACCESO DENEGADO';
        recomendacionTexto = 'El certificado ha cumplido su ciclo anual de vigencia. El pase de ingreso a mina queda BLOQUEADO hasta presentar nuevo certificado aprobado.';
    } else if (diasRestantes <= 10) {
        colorHeader = '#dc2626';
        estadoTexto = `🚨 ALERTA CRÍTICA: VENCE EN ${diasRestantes} DÍAS (MENOS DE 10 DÍAS)`;
        urgenciaBadge = 'URGENCIA MÁXIMA - 10 DÍAS';
        recomendacionTexto = 'ACCIÓN INMEDIATA REQUERIDA: Quedan menos de 10 días calendario. Si no se ingresa la renovación de inmediato, el pase será inhabilitado automáticamente en garita.';
    } else if (diasRestantes <= 30) {
        colorHeader = '#ea580c';
        estadoTexto = `⚠️ ALERTA DE VENCIMIENTO: QUEDAN ${diasRestantes} DÍAS (PLAZO 30 DÍAS)`;
        urgenciaBadge = 'SEGUNDO AVISO - 30 DÍAS';
        recomendacionTexto = 'ÚLTIMO MES DE VIGENCIA: Se requiere programar la recertificación urgente con su proveedor de capacitación para evitar cortes de acceso.';
    } else if (diasRestantes <= 90) {
        colorHeader = '#d97706';
        estadoTexto = `📅 AVISO PREVENTIVO: QUEDAN ${diasRestantes} DÍAS (PLAZO 90 DÍAS)`;
        urgenciaBadge = 'PRIMER AVISO - 90 DÍAS';
        recomendacionTexto = 'PLANIFICACIÓN ANUAL: El certificado entrará en su último trimestre de vigencia. Favor iniciar la coordinación de cursos o exámenes correspondientes.';
    }

    const bannerPrueba = esModoPrueba ? `
        <div style="background: #fef3c7; color: #92400e; padding: 10px 15px; border-radius: 6px; font-size: 13px; font-weight: bold; margin-bottom: 15px; border: 1px solid #f59e0b;">
            🧪 MODO PRUEBA DE ARQUITECTURA ACTIVO<br>
            <span style="font-weight: normal; font-size: 12px;">Este correo fue redirigido a <strong>${emailPrueba}</strong> para verificación de pruebas. (Destinatarios originales en BD: <code>${emailRealTrab}</code> | <code>${emailRealEmp}</code>)</span>
        </div>
    ` : '';

    return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 640px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #334155;">
            <div style="background: ${colorHeader}; padding: 20px 25px; color: #ffffff;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <span style="background: rgba(0,0,0,0.3); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 800; letter-spacing: 1px;">${urgenciaBadge}</span>
                    <span style="font-size: 12px; font-weight: 600;">D.S. 024-2016-EM Minería</span>
                </div>
                <h2 style="margin: 0; font-size: 20px; font-weight: 800;">⛰️ CONTROL DE HOMOLOGACIONES MINERAS & HSE</h2>
                <p style="margin: 5px 0 0 0; font-size: 13px; font-weight: 600; opacity: 0.95;">Sistema Automatizado de Alertas de Vigencia (90d, 30d, 10d)</p>
            </div>
            <div style="padding: 25px;">
                ${bannerPrueba}
                <div style="background: #1e293b; padding: 15px; border-radius: 8px; border-left: 4px solid ${colorHeader}; margin-bottom: 20px;">
                    <span style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">Estado del Certificado en Base de Datos</span>
                    <h3 style="margin: 5px 0 0 0; color: #ffffff; font-size: 17px;">${estadoTexto}</h3>
                </div>

                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
                    <tr>
                        <td style="padding: 8px 0; color: #94a3b8; width: 40%;">👤 Trabajador Registrado:</td>
                        <td style="padding: 8px 0; font-weight: bold; color: #ffffff;">${trabajador.nombres} ${trabajador.apellidos} (DNI: ${trabajador.numero_documento})</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #94a3b8;">🏢 Empresa Contratista:</td>
                        <td style="padding: 8px 0; font-weight: bold; color: #38bdf8;">${empresa.razon_social}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #94a3b8;">📜 Certificación / Curso:</td>
                        <td style="padding: 8px 0; font-weight: bold; color: #ffffff;">${certificado.nombre_curso}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #94a3b8;">📅 Fecha Límite de Vencimiento:</td>
                        <td style="padding: 8px 0; font-weight: bold; color: ${colorHeader};">${fechaFormateada} (${diasRestantes > 0 ? diasRestantes + ' días restantes' : 'CADUCADO'})</td>
                    </tr>
                </table>

                <div style="background: #0f172a; padding: 15px; border-radius: 8px; border: 1px dashed #475569; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
                    💡 <strong>Directiva Oficial HSE:</strong><br>
                    ${recomendacionTexto}
                </div>
            </div>
            <div style="background: #020617; padding: 15px 25px; font-size: 11px; color: #64748b; text-align: center;">
                HomologaControl v2.0 &bull; Notificación Oficial de Gerencia de Seguridad y Salud en el Trabajo
            </div>
        </div>
    `;
}

async function enviarAlertaVencimiento({ trabajador, certificado, empresa, diasRestantes, testEmailOverride = null, etapaAlerta = '90_DIAS' }) {
    const emailTrabajador = trabajador.email_personal || `${trabajador.numero_documento}@gmail.com`;
    const emailEmpresa = empresa.email_contacto || 'contacto@empresa.com';

    const testTarget = testEmailOverride || correoPruebaRedireccion;
    const esModoPrueba = Boolean(testTarget);

    const emailDestinoFinal = esModoPrueba 
        ? `${testTarget} (Prueba Redirigida de: ${emailTrabajador}, ${emailEmpresa})`
        : `${emailTrabajador}, ${emailEmpresa}`;

    const fechaFormateada = formatFechaLimpia(certificado.fecha_vencimiento);
    
    let prefijoAsunto = '📅 [AVISO 90 DÍAS]';
    if (etapaAlerta === '10_DIAS' || diasRestantes <= 10) {
        prefijoAsunto = '🚨 [URGENCIA CRÍTICA 10 DÍAS]';
    } else if (etapaAlerta === '30_DIAS' || diasRestantes <= 30) {
        prefijoAsunto = '⚠️ [SEGUNDO AVISO 30 DÍAS]';
    } else if (diasRestantes <= 0) {
        prefijoAsunto = '⛔ [ACCESO BLOQUEADO - VENCIDO]';
    }

    const asunto = `${prefijoAsunto} Certificado '${certificado.nombre_curso}' vence en ${diasRestantes} días - ${trabajador.nombres} ${trabajador.apellidos}`;

    const cuerpoHTML = generarHTMLAlertaMinera({
        trabajador,
        certificado,
        empresa,
        diasRestantes,
        emailRealTrab: emailTrabajador,
        emailRealEmp: emailEmpresa,
        esModoPrueba,
        emailPrueba: testTarget,
        etapaAlerta
    });

    const resumenMensaje = esModoPrueba
        ? `[PRUEBA TRAP -> ${testTarget}] Alerta preventiva escalonada (${etapaAlerta}): Certificado '${certificado.nombre_curso}' vence el ${fechaFormateada} (${diasRestantes}d). Original: ${emailTrabajador} & ${emailEmpresa}.`
        : `Alerta enviada a ${emailTrabajador} y ${emailEmpresa}: Certificado '${certificado.nombre_curso}' vence el ${fechaFormateada} (${diasRestantes} días restantes). Etapa: ${etapaAlerta}.`;

    // Despacho a servidor SMTP real (o log si no hay credenciales)
    const despachoRes = await despacharCorreoInternet({
        to: emailDestinoFinal,
        subject: asunto,
        html: cuerpoHTML,
        replyTo: emailEmpresa
    });

    const estadoFinal = despachoRes.enviado_real ? 'ENVIADO_SMTP' : 'REGISTRADO_BD';

    // Guardar registro de la alerta en la Base de Datos
    const alertaId = 'alt-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    await runDB(`
        INSERT INTO alertas_notificaciones (id, certificado_id, trabajador_id, empresa_id, email_destinatario, destinatario_email, asunto, tipo_alerta, dias_restantes, mensaje_resumen, cuerpo_html, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [alertaId, certificado.id, trabajador.id, empresa.id, emailDestinoFinal, emailDestinoFinal, asunto, `ALERTA_${etapaAlerta}`, diasRestantes, resumenMensaje, cuerpoHTML, estadoFinal]);

    console.log(`📧 [ALERTA ESCALONADA ${etapaAlerta}]: ${asunto} | Target: ${emailDestinoFinal} (SMTP: ${estadoFinal})`);

    return {
        id: alertaId,
        etapa: etapaAlerta,
        trabajador: `${trabajador.nombres} ${trabajador.apellidos}`,
        email_trabajador: emailTrabajador,
        empresa: empresa.razon_social,
        email_empresa: emailEmpresa,
        email_destino_final: emailDestinoFinal,
        es_modo_prueba: esModoPrueba,
        curso: certificado.nombre_curso,
        fecha_vencimiento: fechaFormateada,
        dias_restantes: diasRestantes,
        asunto,
        resumen: resumenMensaje,
        cuerpo_html: cuerpoHTML,
        despacho_smtp: despachoRes
    };
}

async function enviarAlertaIndividual(certificadoId, testEmailOverride = null) {
    const cert = await getDB(`
        SELECT c.*, 
               t.id AS trab_id, t.nombres AS trab_nombres, t.apellidos AS trab_apellidos, 
               t.numero_documento AS trab_doc, t.email_personal AS trab_email, t.telefono_personal AS trab_telefono,
               e.id AS emp_id, e.razon_social AS emp_nombre, e.email_contacto AS emp_email
        FROM certificados c
        JOIN trabajadores t ON c.trabajador_id = t.id
        JOIN empresas e ON c.empresa_id = e.id
        WHERE c.id = ?
    `, [certificadoId]);

    if (!cert) throw new Error('Certificado no encontrado.');

    const ahora = new Date();
    const fechaVenc = new Date(cert.fecha_vencimiento);
    const diffMs = fechaVenc.getTime() - ahora.getTime();
    const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    let etapa = '90_DIAS';
    if (diasRestantes <= 10) etapa = '10_DIAS';
    else if (diasRestantes <= 30) etapa = '30_DIAS';

    return await enviarAlertaVencimiento({
        trabajador: { id: cert.trab_id, nombres: cert.trab_nombres, apellidos: cert.trab_apellidos, numero_documento: cert.trab_doc, email_personal: cert.trab_email },
        certificado: { id: cert.id, nombre_curso: cert.nombre_curso, fecha_vencimiento: cert.fecha_vencimiento },
        empresa: { id: cert.emp_id, razon_social: cert.emp_nombre, email_contacto: cert.emp_email },
        diasRestantes,
        testEmailOverride,
        etapaAlerta: etapa
    });
}

// =========================================================================
// MOTOR AUTOMÁTICO PROACTIVO: EVALUACIÓN DIARIA A LOS 90, 30 Y 10 DÍAS
// (Con Banderas Anti-Spam para no repetir envíos dentro de la misma etapa)
// =========================================================================
async function ejecutarEscaneoAlertasEscalonadas(empresaIdFiltro = null, testEmailOverride = null, forzarEnvio = false) {
    let query = `
        SELECT c.*, 
               t.id AS trab_id, t.nombres AS trab_nombres, t.apellidos AS trab_apellidos, 
               t.numero_documento AS trab_doc, t.email_personal AS trab_email, t.telefono_personal AS trab_telefono,
               e.id AS emp_id, e.razon_social AS emp_nombre, e.email_contacto AS emp_email
        FROM certificados c
        JOIN trabajadores t ON c.trabajador_id = t.id
        JOIN empresas e ON c.empresa_id = e.id
    `;
    let params = [];

    if (empresaIdFiltro) {
        query += ` WHERE c.empresa_id = ? `;
        params.push(empresaIdFiltro);
    }

    const certs = await allDB(query, params);
    const ahora = new Date();
    const alertasEnviadas = [];

    let totalEscaneados = certs.length;
    let contador90d = 0;
    let contador30d = 0;
    let contador10d = 0;
    let contadorInhabilitados = 0;

    for (let c of certs) {
        const fechaVenc = new Date(c.fecha_vencimiento);
        const diffMs = fechaVenc.getTime() - ahora.getTime();
        const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        let nuevoEstadoVigencia = 'HABILITADO';

        if (diasRestantes <= 0) {
            nuevoEstadoVigencia = 'INHABILITADO';
            contadorInhabilitados++;
        } else if (diasRestantes <= 90) {
            nuevoEstadoVigencia = 'PROXIMO_A_VENCER';
        }

        await runDB('UPDATE certificados SET estado_vigencia = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nuevoEstadoVigencia, c.id]);
        await recalcularEstadoTrabajadorBD(c.trabajador_id);

        // LÓGICA ESCALONADA 90 -> 30 -> 10 DÍAS CON CONTROL ANTI-SPAM
        let etapaADisparar = null;
        let updateColumnaAlerta = null;

        if (diasRestantes <= 10 && diasRestantes > 0) {
            contador10d++;
            if (!c.alerta_10d_enviada || forzarEnvio) {
                etapaADisparar = '10_DIAS';
                updateColumnaAlerta = 'alerta_10d_enviada';
            }
        } else if (diasRestantes <= 30 && diasRestantes > 10) {
            contador30d++;
            if (!c.alerta_30d_enviada || forzarEnvio) {
                etapaADisparar = '30_DIAS';
                updateColumnaAlerta = 'alerta_30d_enviada';
            }
        } else if (diasRestantes <= 90 && diasRestantes > 30) {
            contador90d++;
            if (!c.alerta_90d_enviada || forzarEnvio) {
                etapaADisparar = '90_DIAS';
                updateColumnaAlerta = 'alerta_90d_enviada';
            }
        }

        // Si califica para disparar aviso escalonado
        if (etapaADisparar) {
            const enviada = await enviarAlertaVencimiento({
                trabajador: { id: c.trab_id, nombres: c.trab_nombres, apellidos: c.trab_apellidos, numero_documento: c.trab_doc, email_personal: c.trab_email },
                certificado: { id: c.id, nombre_curso: c.nombre_curso, fecha_vencimiento: c.fecha_vencimiento },
                empresa: { id: c.emp_id, razon_social: c.emp_nombre, email_contacto: c.emp_email },
                diasRestantes,
                testEmailOverride,
                etapaAlerta: etapaADisparar
            });

            // Marcar bandera en BD para que no vuelva a spamear en la misma etapa
            if (updateColumnaAlerta) {
                await runDB(`UPDATE certificados SET ${updateColumnaAlerta} = 1, fecha_ultima_alerta = CURRENT_TIMESTAMP WHERE id = ?`, [c.id]);
            }

            alertasEnviadas.push(enviada);
        }
    }

    console.log(`🤖 [CRON PROACTIVO 90-30-10 EJECUTADO]: ${alertasEnviadas.length} alertas disparadas de ${totalEscaneados} certificados escaneados.`);

    return {
        exito: true,
        total_certificados_escaneados: totalEscaneados,
        en_rango_90_dias: contador90d,
        en_rango_30_dias: contador30d,
        en_rango_10_dias: contador10d,
        certificados_inhabilitados: contadorInhabilitados,
        correos_alertas_enviados: alertasEnviadas.length,
        modo_prueba_activo: Boolean(testEmailOverride || correoPruebaRedireccion),
        correo_prueba_usado: testEmailOverride || correoPruebaRedireccion || null,
        detalle_alertas: alertasEnviadas
    };
}

// Compatibilidad con la firma anterior
async function ejecutarEscaneoAlertas90Dias(empresaIdFiltro = null, testEmailOverride = null) {
    return await ejecutarEscaneoAlertasEscalonadas(empresaIdFiltro, testEmailOverride, false);
}

// =========================================================================
// GENERACIÓN Y ENVÍO DE CORREOS INDIVIDUALES A CADA TRABAJADOR SEGÚN ESTADO
// =========================================================================

function generarHTMLCorreoIndividualTrabajador({ trabajador, certificado, empresa, remitenteNombre, remitenteRol, diasRestantes }) {
    const fechaVencFormatted = formatFechaLimpia(certificado.fecha_vencimiento);
    const fechaEmFormatted = formatFechaLimpia(certificado.fecha_emision);

    let estadoKey = 'APTO';
    let estadoLabel = '✓ APTO (ACCESO AUTORIZADO)';
    let bannerGrad = 'linear-gradient(135deg, #059669, #10b981)';
    let colorTextoBanner = '#022c22';
    let iconoBanner = '🎫';
    let tituloBanner = '¡TIENES PASE AUTORIZADO PARA PLANTA!';
    let explicacionHTML = '';

    if (diasRestantes <= 0) {
        estadoKey = 'VENCIDO';
        estadoLabel = '⛔ NO APTO (VENCIDO)';
        bannerGrad = 'linear-gradient(135deg, #be123c, #e11d48)';
        colorTextoBanner = '#ffffff';
        iconoBanner = '🚫';
        tituloBanner = 'ACCESO RESTRINGIDO EN GARITA DE CONTROL';
        explicacionHTML = `
            <div style="background: rgba(225, 29, 72, 0.15); border-left: 4px solid #f43f5e; padding: 12px 16px; border-radius: 6px; color: #fecdd3; margin-top: 14px; font-size: 13px;">
                <strong style="color: #fda4af; display: block; margin-bottom: 4px;">¿Por qué fuiste observado y cuál es tu estatus en garita?:</strong>
                El D.S. 024-2016-EM exige que las capacitaciones críticas en minería se renueven anualmente. Al haber vencido tu certificado, el sistema ha colocado tu pase en estado <strong>⛔ INHABILITADO</strong>. En la garita de control tu ingreso a planta será <strong>REBOTADO / DENEGADO</strong> hasta que apruebes el reentrenamiento y tu empresa suba el nuevo certificado a la plataforma.<br><br>
                👉 <strong>¿Qué debes hacer?:</strong> Comunícate de inmediato con tu supervisor o con <strong>${remitenteNombre}</strong> (${remitenteRol}) para programar tu curso de actualización y reactivar tu pase.
            </div>
        `;
    } else if (diasRestantes <= 90) {
        estadoKey = 'POR_VENCER';
        estadoLabel = `⚠️ POR VENCER (${diasRestantes} DÍAS RESTANTES)`;
        bannerGrad = 'linear-gradient(135deg, #d97706, #f59e0b)';
        colorTextoBanner = '#451a03';
        iconoBanner = '⏳';
        tituloBanner = `TU CERTIFICADO ESTÁ PRÓXIMO A VENCER (${diasRestantes} DÍAS)`;
        explicacionHTML = `
            <div style="background: rgba(245, 158, 11, 0.15); border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 6px; color: #fef3c7; margin-top: 14px; font-size: 13px;">
                <strong style="color: #fde68a; display: block; margin-bottom: 4px;">¿Cuál es tu condición actual y por qué se te notifica?:</strong>
                Actualmente <strong>tu pase sigue activo</strong> y puedes ingresar a laborar con normalidad. Sin embargo, se te alerta con anticipación preventiva para que coordines con tu supervisor o con <strong>${remitenteNombre}</strong> la fecha de tu curso de actualización antes del <strong>${fechaVencFormatted}</strong>, ya que cumplido ese día, el sistema de garita denegará tu acceso automáticamente.
            </div>
        `;
    } else {
        explicacionHTML = `
            <div style="background: rgba(16, 185, 129, 0.15); border-left: 4px solid #10b981; padding: 12px 16px; border-radius: 6px; color: #d1fae5; margin-top: 14px; font-size: 13px;">
                <strong style="color: #6ee7b7; display: block; margin-bottom: 4px;">¿Cuál es tu condición actual?:</strong>
                Tu certificado cumple con todas las exigencias técnicas y reglamentarias del D.S. 024-2016-EM. Tu pase de ingreso a mina se encuentra <strong>100% ACTIVO</strong>. Puedes presentarte en la <strong>Garita de Control Principal</strong> con tu DNI para ingresar directamente a planta y realizar tus labores con normalidad.
            </div>
        `;
    }

    return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 660px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #334155; box-shadow: 0 15px 40px rgba(0,0,0,0.6);">
            <!-- HEADER CABECERA -->
            <div style="background: #020617; padding: 12px 20px; font-size: 11px; color: #94a3b8; border-bottom: 1px solid #1e293b; line-height: 1.6;">
                <div><strong style="color: #cbd5e1;">De:</strong> <span style="color: #38bdf8;">${remitenteNombre} (${remitenteRol})</span> en nombre de <strong style="color: #f8fafc;">HomologaControl Minería</strong></div>
                <div><strong style="color: #cbd5e1;">Para:</strong> <span style="color: #38bdf8;">${trabajador.nombres} ${trabajador.apellidos} &lt;${trabajador.email_personal}&gt;</span></div>
                <div><strong style="color: #cbd5e1;">Empresa:</strong> <span>${empresa.razon_social}</span></div>
            </div>

            <!-- BANNER SUPERIOR -->
            <div style="background: ${bannerGrad}; padding: 20px 25px; color: ${colorTextoBanner}; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="font-size: 10px; font-weight: 900; text-transform: uppercase; background: rgba(0,0,0,0.25); color: #fff; padding: 2px 8px; border-radius: 4px;">Habilitación Oficial HSE</span>
                    <h2 style="margin: 6px 0 0 0; font-size: 18px; font-weight: 900; line-height: 1.2;">${tituloBanner}</h2>
                    <p style="margin: 4px 0 0 0; font-size: 12px; font-weight: 600;">${empresa.razon_social} &bull; Unidad Minera</p>
                </div>
                <div style="font-size: 36px;">${iconoBanner}</div>
            </div>

            <!-- CUERPO -->
            <div style="padding: 24px; font-size: 13px; line-height: 1.6; color: #cbd5e1;">
                <p style="margin-top: 0;">Estimado <strong>${trabajador.nombres} ${trabajador.apellidos}</strong> (DNI: <strong>${trabajador.numero_documento}</strong>):</p>
                
                <p>Te informamos el resultado oficial del registro y auditoría de tu certificado en la plataforma de control minero:</p>

                <!-- TARJETA CERTIFICADO -->
                <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px 18px; margin-bottom: 14px;">
                    <div style="margin-bottom: 6px;"><span style="color: #94a3b8;">📜 Curso Evaluado:</span> <strong style="color: #ffffff; font-size: 14px;">${certificado.nombre_curso}</strong> (${certificado.horas_lectivas || 16} hrs)</div>
                    <div style="margin-bottom: 6px;"><span style="color: #94a3b8;">🏛️ Entidad Emisora:</span> <span style="color: #f1f5f9;">${certificado.entidad_emisora || 'Instituto Certificador'}</span></div>
                    <div style="margin-bottom: 6px;"><span style="color: #94a3b8;">📅 Emisión / Vencimiento:</span> <span style="color: #f1f5f9;">${fechaEmFormatted} &rarr; </span><strong style="color: ${diasRestantes <= 0 ? '#f43f5e' : (diasRestantes <= 90 ? '#f59e0b' : '#34d399')};">${fechaVencFormatted}</strong></div>
                    <div><span style="color: #94a3b8;">🔒 Registro Digital / QR:</span> <code style="color: #38bdf8; font-size: 12px;">${certificado.codigo_qr_hash || 'QR_BATCH_VERIFIED'}</code></div>
                </div>

                ${explicacionHTML}
            </div>

            <!-- FOOTER -->
            <div style="background: #020617; padding: 12px 20px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #1e293b;">
                Mensaje emitido por el Área de Homologaciones HSE de ${empresa.razon_social} &bull; HomologaControl Minería v2.0
            </div>
        </div>
    `;
}

// Enviar notificación a 1 trabajador individual
async function enviarNotificacionIndividualTrabajador({ trabajador, certificado, empresa, remitente, diasRestantes }) {
    const remitenteNombre = (remitente && remitente.nombre_completo) ? remitente.nombre_completo : 'Operador de Homologaciones';
    const remitenteRol = (remitente && remitente.rol) ? remitente.rol : 'OPERADOR HSE';
    const remitenteEmail = (remitente && remitente.email) ? remitente.email : (empresa.email_contacto || 'contacto@empresa.com');

    let asunto = '';
    if (diasRestantes <= 0) {
        asunto = `⛔ [ACCESO DENEGADO] Certificado Vencido de ${certificado.nombre_curso} - Pase Inhabilitado en Garita`;
    } else if (diasRestantes <= 90) {
        asunto = `⚠️ [AVISO PREVENTIVO] Tu Certificado de ${certificado.nombre_curso} vence en ${diasRestantes} días - Coordina Recertificación`;
    } else {
        asunto = `✅ [PASE AUTORIZADO] Tu Certificado de ${certificado.nombre_curso} está Aprobado y Vigente`;
    }

    const emailTrabajador = trabajador.email_personal || `${trabajador.numero_documento}@gmail.com`;

    const cuerpoHTML = generarHTMLCorreoIndividualTrabajador({
        trabajador,
        certificado,
        empresa,
        remitenteNombre,
        remitenteRol,
        diasRestantes
    });

    const alertaId = 'alt-trab-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const tipoAlerta = diasRestantes <= 0 ? 'NOTIFICACION_INHABILITADO' : (diasRestantes <= 90 ? 'NOTIFICACION_POR_VENCER' : 'NOTIFICACION_HABILITADO');

    // Despacho a servidor SMTP real (o log si no hay credenciales)
    const despachoRes = await despacharCorreoInternet({
        to: emailTrabajador,
        subject: asunto,
        html: cuerpoHTML,
        replyTo: remitenteEmail
    });

    const estadoFinal = despachoRes.enviado_real ? 'ENVIADO_SMTP' : 'REGISTRADO_BD';

    await runDB(`
        INSERT INTO alertas_notificaciones (id, certificado_id, trabajador_id, empresa_id, email_destinatario, destinatario_email, asunto, tipo_alerta, dias_restantes, mensaje_resumen, cuerpo_html, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        alertaId, 
        certificado.id, 
        trabajador.id, 
        empresa.id, 
        emailTrabajador, 
        emailTrabajador, 
        asunto, 
        tipoAlerta, 
        diasRestantes, 
        `Notificación individual enviada por ${remitenteNombre} (${remitenteRol}) a ${trabajador.nombres} ${trabajador.apellidos} (${emailTrabajador}) sobre curso '${certificado.nombre_curso}' (Estado: ${diasRestantes <= 0 ? 'NO APTO' : (diasRestantes <= 90 ? 'POR VENCER' : 'APTO')})`, 
        cuerpoHTML,
        estadoFinal
    ]);

    console.log(`📨 [CORREO A TRABAJADOR]: ${asunto} -> Destino: ${emailTrabajador} (Estado SMTP: ${estadoFinal})`);

    return {
        id: alertaId,
        trabajador_nombre: `${trabajador.nombres} ${trabajador.apellidos}`,
        trabajador_email: emailTrabajador,
        trabajador_doc: trabajador.numero_documento,
        asunto,
        estado: diasRestantes <= 0 ? 'NO_APTO' : (diasRestantes <= 90 ? 'POR_VENCER' : 'APTO'),
        dias_restantes: diasRestantes,
        cuerpo_html: cuerpoHTML,
        despacho_smtp: despachoRes
    };
}

// Enviar reporte consolidado a la Empresa Contratista con copia al Usuario de Carga
async function enviarReporteCargaEmpresa({ empresa, remitente, itemsProcesados }) {
    const remitenteNombre = (remitente && remitente.nombre_completo) ? remitente.nombre_completo : 'Operador de Homologaciones';
    const remitenteRol = (remitente && remitente.rol) ? remitente.rol : 'OPERADOR HSE';
    const remitenteEmail = (remitente && remitente.email) ? remitente.email : (empresa.email_contacto || 'contacto@empresa.com');

    const totalAptos = itemsProcesados.filter(i => i.dias_restantes > 90).length;
    const totalPorVencer = itemsProcesados.filter(i => i.dias_restantes > 0 && i.dias_restantes <= 90).length;
    const totalVencidos = itemsProcesados.filter(i => i.dias_restantes <= 0).length;

    const asunto = `📋 [DICTAMEN HSE] Resultado de Habilitación de Cuadrilla (${totalAptos} Aptos, ${totalPorVencer} Por Vencer, ${totalVencidos} Vencidos) - ${empresa.razon_social}`;

    const filasDetalleHTML = itemsProcesados.map(item => {
        const d = item.dias_restantes;
        const badge = d <= 0
            ? `<span style="background: rgba(244, 63, 94, 0.2); color: #fb7185; border: 1px solid #f43f5e; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 11px;">⛔ NO APTO (VENCIDO)</span>`
            : (d <= 90 
                ? `<span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 11px;">⚠️ POR VENCER (${d}d)</span>`
                : `<span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 11px;">✓ APTO</span>`);

        const motivo = d <= 0
            ? 'Superó el límite anual reglamentario (D.S. 024-2016-EM). Pase bloqueado en garita.'
            : (d <= 90 
                ? 'Alerta preventiva a 90 días. Pase temporal activo, requiere renovar antes de la fecha límite.'
                : 'Cumplimiento normativo vigente. Acceso a planta 100% autorizado.');

        return `
            <div style="background: #1e293b; border-left: 4px solid ${d <= 0 ? '#f43f5e' : (d <= 90 ? '#f59e0b' : '#10b981')}; padding: 12px 15px; border-radius: 6px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap;">
                    <strong style="color: #ffffff; font-size: 14px;">👤 ${item.trabajador.nombres} ${item.trabajador.apellidos} <span style="font-weight: normal; color: #94a3b8; font-size: 12px;">(Doc: ${item.trabajador.numero_documento})</span></strong>
                    ${badge}
                </div>
                <div style="font-size: 12px; color: #cbd5e1; line-height: 1.5;">
                    <strong>Certificado:</strong> ${item.certificado.nombre_curso} | <strong>Vencimiento:</strong> ${formatFechaLimpia(item.certificado.fecha_vencimiento)}<br>
                    <span style="color: ${d <= 0 ? '#fda4af' : (d <= 90 ? '#fde68a' : '#6ee7b7')}; font-size: 11px;"><strong>Motivo:</strong> ${motivo}</span>
                </div>
            </div>
        `;
    }).join('');

    const cuerpoHTML = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #334155;">
            <div style="background: #020617; padding: 14px 20px; font-size: 11px; color: #94a3b8; border-bottom: 1px solid #1e293b; line-height: 1.6;">
                <div><strong style="color: #cbd5e1;">Para (Empresa):</strong> <span style="color: #38bdf8;">${empresa.email_contacto || 'contacto@empresa.com'}</span></div>
                <div><strong style="color: #cbd5e1;">Con Copia (CC - Responsable de Carga):</strong> <span style="color: #34d399;">${remitenteEmail} (${remitenteNombre})</span></div>
            </div>

            <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border-bottom: 1px solid #334155; padding: 20px 24px;">
                <span style="font-size: 10px; font-weight: 900; background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); padding: 2px 8px; border-radius: 4px;">REPORTE DE AUDITORÍA HSE MINERA</span>
                <h2 style="margin: 8px 0 0 0; font-size: 18px; color: #ffffff;">DICTAMEN OFICIAL DE HABILITACIÓN DE CUADRILLA</h2>
                <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">Empresa: <strong>${empresa.razon_social}</strong> &bull; Responsable: <strong>${remitenteNombre}</strong> (${remitenteRol})</p>
            </div>

            <div style="padding: 24px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; text-align: center; margin-bottom: 20px;">
                    <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); padding: 10px; border-radius: 8px;">
                        <span style="font-size: 18px; font-weight: 900; color: #34d399; display: block;">${totalAptos}</span>
                        <span style="font-size: 11px; color: #a7f3d0; font-weight: bold;">APTOS</span>
                    </div>
                    <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 10px; border-radius: 8px;">
                        <span style="font-size: 18px; font-weight: 900; color: #fbbf24; display: block;">${totalPorVencer}</span>
                        <span style="font-size: 11px; color: #fde68a; font-weight: bold;">POR VENCER (≤90d)</span>
                    </div>
                    <div style="background: rgba(244, 63, 94, 0.15); border: 1px solid rgba(244, 63, 94, 0.3); padding: 10px; border-radius: 8px;">
                        <span style="font-size: 18px; font-weight: 900; color: #fb7185; display: block;">${totalVencidos}</span>
                        <span style="font-size: 11px; color: #fecdd3; font-weight: bold;">NO APTO (Vencido)</span>
                    </div>
                </div>

                <p style="font-size: 13px; color: #cbd5e1; margin-bottom: 15px;">
                    Se completó la carga masiva y se enviaron las notificaciones oficiales correspondientes a cada trabajador. A continuación el detalle consolidado:
                </p>

                ${filasDetalleHTML}
            </div>

            <div style="background: #020617; padding: 12px 20px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #1e293b;">
                HomologaControl Minería &bull; Notificación Oficial de Gerencia HSE
            </div>
        </div>
    `;

    const alertaId = 'alt-emp-' + Date.now();
    
    // Despacho a servidor SMTP real para la empresa contratista
    const despachoEmpresaRes = await despacharCorreoInternet({
        to: empresa.email_contacto,
        subject: asunto,
        html: cuerpoHTML,
        replyTo: remitenteEmail
    });

    // Si el usuario que cargó tiene correo diferente, enviarle copia también
    if (remitenteEmail && remitenteEmail !== empresa.email_contacto) {
        await despacharCorreoInternet({
            to: remitenteEmail,
            subject: `[COPIA RESPONSABLE] ${asunto}`,
            html: cuerpoHTML,
            replyTo: empresa.email_contacto
        });
    }

    const estadoEmpresaFinal = despachoEmpresaRes.enviado_real ? 'ENVIADO_SMTP' : 'REGISTRADO_BD';

    await runDB(`
        INSERT INTO alertas_notificaciones (id, certificado_id, trabajador_id, empresa_id, email_destinatario, destinatario_email, asunto, tipo_alerta, dias_restantes, mensaje_resumen, cuerpo_html, estado)
        VALUES (?, NULL, NULL, ?, ?, ?, ?, 'REPORTE_CARGA_EXCEL', 0, ?, ?, ?)
    `, [
        alertaId,
        empresa.id,
        `${empresa.email_contacto}, ${remitenteEmail}`,
        `${empresa.email_contacto}, ${remitenteEmail}`,
        asunto,
        `Reporte consolidado de carga enviado a ${empresa.razon_social} (${empresa.email_contacto}) y ${remitenteNombre} (${remitenteEmail}). Totales: ${totalAptos} Aptos, ${totalPorVencer} Por Vencer, ${totalVencidos} Vencidos.`,
        cuerpoHTML,
        estadoEmpresaFinal
    ]);

    console.log(`🏢 [CORREO A EMPRESA & RESPONSABLE]: ${asunto} -> Destino: ${empresa.email_contacto}, CC: ${remitenteEmail} (Estado SMTP: ${estadoEmpresaFinal})`);

    return {
        id: alertaId,
        empresa: empresa.razon_social,
        email_empresa: empresa.email_contacto,
        email_responsable: remitenteEmail,
        asunto,
        total_aptos: totalAptos,
        total_por_vencer: totalPorVencer,
        total_vencidos: totalVencidos,
        cuerpo_html: cuerpoHTML,
        despacho_smtp: despachoEmpresaRes
    };
}

async function obtenerHistorialAlertas(empresaIdFiltro = null) {
    let query = `
        SELECT a.*, c.nombre_curso, t.nombres AS trab_nombres, t.apellidos AS trab_apellidos, e.razon_social AS emp_nombre
        FROM alertas_notificaciones a
        LEFT JOIN certificados c ON a.certificado_id = c.id
        LEFT JOIN trabajadores t ON a.trabajador_id = t.id
        LEFT JOIN empresas e ON a.empresa_id = e.id
    `;
    let params = [];
    if (empresaIdFiltro) {
        query += ` WHERE a.empresa_id = ? `;
        params.push(empresaIdFiltro);
    }
    query += ` ORDER BY a.fecha_envio DESC, a.id DESC `;
    return await allDB(query, params);
}

module.exports = {
    setCorreoPruebaRedireccion,
    getCorreoPruebaRedireccion,
    enviarAlertaVencimiento,
    enviarAlertaIndividual,
    ejecutarEscaneoAlertas90Dias,
    ejecutarEscaneoAlertasEscalonadas,
    obtenerHistorialAlertas,
    formatFechaLimpia,
    enviarNotificacionIndividualTrabajador,
    enviarReporteCargaEmpresa,
    despacharCorreoInternet,
    crearTransporterSMTP
};
