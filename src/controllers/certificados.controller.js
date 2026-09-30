const fs = require('fs');
const XLSX = require('xlsx');
const { allDB, getDB, runDB, recalcularEstadoTrabajadorBD } = require('../config/database');
const { extraerMetadatosRealPDF } = require('../services/ocr.service');
const { formatFechaISO, calcularFechaVencimiento, generarPlantillaCSV, normalizarTelefonoPeru } = require('../services/excel.service');
const { enviarNotificacionIndividualTrabajador, enviarReporteCargaEmpresa } = require('../services/email.service');

async function listarCertificados(req, res) {
    try {
        const empresaId = req.query.empresa_id || null;
        let query = `
            SELECT c.*, 
                   CONCAT(t.nombres, ' ', t.apellidos) AS trabajador_nombre,
                   t.numero_documento AS trabajador_doc,
                   t.email_personal AS trabajador_email,
                   t.telefono_personal AS trabajador_telefono,
                   e.razon_social AS empresa_nombre,
                   e.email_contacto AS empresa_email,
                   e.telefono_contacto AS empresa_telefono
            FROM certificados c
            JOIN trabajadores t ON c.trabajador_id = t.id
            JOIN empresas e ON c.empresa_id = e.id
        `;
        let params = [];

        if (empresaId) {
            query += ` WHERE c.empresa_id = ? `;
            params.push(empresaId);
        }

        query += ` ORDER BY c.created_at DESC `;

        const certs = await allDB(query, params);
        res.json(certs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

async function uploadPDFOCR(req, res) {
    try {
        const filename = req.file ? req.file.filename : 'certificado_sergio.pdf';
        const pdfBuffer = req.file ? fs.readFileSync(req.file.path) : Buffer.from('');

        const extracted = await extraerMetadatosRealPDF(pdfBuffer, req.file ? req.file.originalname : filename);
        const empresaSeleccionadaId = req.body.empresa_id || 'emp-1';

        // Buscar trabajador en BD por coincidencia precisa de nombres/apellidos
        const nombrePDFLimpio = extracted.nombreTrabajador.trim().toLowerCase();
        let trabajador = null;
        if (nombrePDFLimpio.length > 3 && !nombrePDFLimpio.includes('no identificado')) {
            trabajador = await getDB(
                `SELECT * FROM trabajadores 
                 WHERE LOWER(CONCAT(nombres, ' ', apellidos)) = ? 
                    OR LOWER(CONCAT(apellidos, ' ', nombres)) = ?
                    OR (LENGTH(?) > 8 AND LOWER(CONCAT(nombres, ' ', apellidos)) LIKE ?)
                 LIMIT 1`, 
                [nombrePDFLimpio, nombrePDFLimpio, nombrePDFLimpio, `%${nombrePDFLimpio}%`]
            );
        }

        let esNuevoTrabajador = false;
        let discrepanciaDetectada = false;
        let mensajeDiscrepancia = null;

        if (!trabajador) {
            const nuevoId = 'tr-' + Date.now();
            const nuevoDoc = String(Math.floor(Math.random() * 89999999 + 10000000));
            const nombreLimpio = extracted.nombreTrabajador.trim();
            const partes = nombreLimpio.split(/\s+/);
            let nombres = '';
            let apellidos = '';
            if (partes.length <= 2) {
                nombres = partes[0];
                apellidos = partes[1] || '';
            } else {
                nombres = partes.slice(0, 2).join(' ');
                apellidos = partes.slice(2).join(' ');
            }

            await runDB(`
                INSERT INTO trabajadores (id, empresa_id, tipo_documento, numero_documento, nombres, apellidos, email_personal, telefono_personal, cargo_puesto, estado_habilitacion)
                VALUES (?, ?, 'DNI', ?, ?, ?, ?, ?, 'Técnico Especialista en Mantenimiento', 'INHABILITADO')
            `, [nuevoId, empresaSeleccionadaId, nuevoDoc, nombres, apellidos, `${nombres.toLowerCase().replace(/\s+/g, '.')}@gmail.com`, '+51 987654321']);

            trabajador = await getDB('SELECT * FROM trabajadores WHERE id = ?', [nuevoId]);
            esNuevoTrabajador = true;
        } else {
            // Verificar si el nombre del PDF coincide plenamente con la BD
            const nombreBD = `${trabajador.nombres} ${trabajador.apellidos}`.toLowerCase();
            if (!nombreBD.includes(nombrePDFLimpio) && !nombrePDFLimpio.includes(nombreBD)) {
                discrepanciaDetectada = true;
                mensajeDiscrepancia = `⚠️ ADVERTENCIA DE DISCREPANCIA: El nombre extraído del PDF ("${extracted.nombreTrabajador}") difiere de la ficha en BD ("${trabajador.nombres} ${trabajador.apellidos}" - DNI: ${trabajador.numero_documento}). Se requiere auditoría por Supervisor HSE.`;
            }
        }

        const empresa = await getDB('SELECT * FROM empresas WHERE id = ?', [empresaSeleccionadaId]) || await getDB('SELECT * FROM empresas WHERE id = ?', [trabajador.empresa_id]) || await getDB('SELECT * FROM empresas ORDER BY created_at ASC LIMIT 1');
        const fechaVencimiento = calcularFechaVencimiento(extracted.fechaEmision);

        // Prevenir duplicidad de certificados: verificar si ya existe para este trabajador el mismo curso o emisión
        let certExistente = await getDB(
            'SELECT * FROM certificados WHERE trabajador_id = ? AND (LOWER(nombre_curso) = LOWER(?) OR pdf_filename = ?)',
            [trabajador.id, extracted.nombreCurso, filename]
        );

        let newCertId;
        if (certExistente) {
            newCertId = certExistente.id;
            await runDB(`
                UPDATE certificados SET
                    empresa_id = ?,
                    nombre_curso = ?,
                    entidad_emisora = ?,
                    horas_lectivas = ?,
                    fecha_emision = ?,
                    fecha_vencimiento = ?,
                    pdf_filename = ?,
                    estado_validacion = 'EN_VALIDACION',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [empresa.id, extracted.nombreCurso, extracted.entidad, extracted.horas, extracted.fechaEmision, fechaVencimiento, filename, newCertId]);
        } else {
            newCertId = 'cert-' + Date.now();
            await runDB(`
                INSERT INTO certificados (id, trabajador_id, empresa_id, nombre_curso, entidad_emisora, horas_lectivas, fecha_emision, fecha_vencimiento, codigo_qr_hash, pdf_filename, estado_validacion, estado_vigencia)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EN_VALIDACION', 'HABILITADO')
            `, [newCertId, trabajador.id, empresa.id, extracted.nombreCurso, extracted.entidad, extracted.horas, extracted.fechaEmision, fechaVencimiento, 'QR_OCR_PDF_' + Math.floor(Math.random() * 899999 + 100000), filename]);
        }

        await recalcularEstadoTrabajadorBD(trabajador.id);
        const certificadoCreado = await getDB('SELECT * FROM certificados WHERE id = ?', [newCertId]);

        res.status(201).json({
            exito: true,
            es_nuevo_trabajador: esNuevoTrabajador,
            es_actualizacion: Boolean(certExistente),
            discrepancia_detectada: discrepanciaDetectada,
            mensaje_discrepancia: mensajeDiscrepancia,
            message: esNuevoTrabajador 
                ? `¡NUEVO TRABAJADOR REGISTRADO EN BD! Se creó la ficha para "${trabajador.nombres} ${trabajador.apellidos}".`
                : (certExistente 
                    ? `Certificado de "${trabajador.nombres} ${trabajador.apellidos}" actualizado con nueva vigencia.` 
                    : (discrepanciaDetectada ? mensajeDiscrepancia : `Certificado para "${trabajador.nombres} ${trabajador.apellidos}" registrado correctamente.`)),
            datos_vinculados_bd: {
                trabajador_id: trabajador.id,
                trabajador_nombres: `${trabajador.nombres} ${trabajador.apellidos}`,
                trabajador_documento: trabajador.numero_documento,
                trabajador_cargo: trabajador.cargo_puesto,
                trabajador_email_personal: trabajador.email_personal,
                empresa_razon_social: empresa.razon_social,
                empresa_ruc: empresa.ruc_rut,
                empresa_email_contacto: empresa.email_contacto
            },
            metadatos_extraidos_pdf: {
                curso: certificadoCreado.nombre_curso,
                entidad: certificadoCreado.entidad_emisora,
                horas: certificadoCreado.horas_lectivas,
                fecha_emision: certificadoCreado.fecha_emision,
                fecha_vencimiento_calculada: certificadoCreado.fecha_vencimiento,
                codigo_qr_validado: certificadoCreado.codigo_qr_hash
            },
            certificado: certificadoCreado
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error en procesamiento inteligente de PDF: ' + err.message });
    }
}

let cargaExcelEnProceso = false;

async function cargarMasivaExcel(req, res) {
    if (cargaExcelEnProceso) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(429).json({ error: 'Ya existe una carga masiva en proceso. Por favor espere unos instantes a que finalice para evitar registros duplicados.' });
    }

    cargaExcelEnProceso = true;

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Por favor seleccione un archivo Excel (.xlsx o .csv)' });
        }

        const filePath = req.file.path;
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (!rows || rows.length === 0) {
            return res.status(400).json({ error: 'El archivo Excel no contiene filas de datos.' });
        }

        // Determinar quién realiza la carga (remitente: Operador o Admin de Empresa)
        let remitente = null;
        if (req.body && req.body.usuario_id) {
            remitente = await getDB('SELECT * FROM usuarios WHERE id = ?', [req.body.usuario_id]);
        }
        if (!remitente && req.body && req.body.usuario_nombre) {
            remitente = {
                nombre_completo: req.body.usuario_nombre,
                rol: req.body.usuario_rol || 'OPERADOR',
                email: req.body.usuario_email || null
            };
        }

        let procesados = 0;
        let errores = [];
        let creadosCertificados = 0;
        let actualizadosCertificados = 0;
        let creadosTrabajadores = 0;
        let actualizadosTrabajadores = 0;
        let duplicadosOmitidos = 0;
        const seenInThisFile = new Set();
        const itemsProcesados = [];

        for (let idx = 0; idx < rows.length; idx++) {
            const row = rows[idx];
            const getVal = (keyNames) => {
                for (let k of keyNames) {
                    const match = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
                    if (match && row[match] !== '') return String(row[match]).trim();
                }
                return '';
            };

            const ruc = getVal(['RUC_Empresa', 'RUC', 'RUC Empresa']);
            const tipoDoc = getVal(['Tipo_Documento', 'Tipo Documento', 'TipoDoc']) || 'DNI';
            const numDocRaw = getVal(['Numero_Documento', 'Numero Documento', 'DNI', 'Documento', 'Numero_Doc']);
            const nombresRaw = getVal(['Nombres', 'Nombre']);
            const apellidosRaw = getVal(['Apellidos', 'Apellido']) || '';
            const emailPersonal = getVal(['Email_Personal', 'Email Personal', 'Email', 'Correo']);
            const telefonoPersonal = getVal(['Telefono_Personal', 'Telefono Personal', 'Telefono', 'Celular']);
            const cargo = getVal(['Cargo_Puesto', 'Cargo', 'Puesto']) || 'Técnico Operativo';
            const area = getVal(['Area_Trabajo', 'Area']) || 'Planta';
            const codCurso = getVal(['Codigo_Curso_Homologado', 'Codigo Curso']);
            const nombreCursoRaw = getVal(['Nombre_Curso', 'Curso', 'Nombre Curso']);
            const entidad = getVal(['Entidad_Emisora', 'Entidad']) || 'Instituto Certificador';
            const horas = getVal(['Horas_Lectivas', 'Horas']) || '16';
            const fechaEmision = getVal(['Fecha_Emision_YYYY_MM_DD', 'Fecha Emision', 'Fecha_Emision']);

            // Limpieza y normalización estricta para evitar duplicados por espacios o formato
            const cleanDoc = String(numDocRaw || '').trim().replace(/[\s\.\-]/g, '');
            const cleanNombres = String(nombresRaw || '').trim().replace(/\s+/g, ' ');
            const cleanApellidos = String(apellidosRaw || '').trim().replace(/\s+/g, ' ');
            const cleanCurso = String(nombreCursoRaw || codCurso || 'Capacitación Técnica Normativa').trim().replace(/\s+/g, ' ');

            if (!cleanDoc && !cleanNombres) continue;

            if (!cleanDoc || !cleanNombres) {
                errores.push(`Fila ${idx + 2}: Omitida por faltar DNI o Nombres válidos.`);
                continue;
            }

            // Prevención de duplicados dentro del mismo archivo subido
            const batchRowKey = `${cleanDoc}__${cleanCurso.toLowerCase()}`;
            if (seenInThisFile.has(batchRowKey)) {
                duplicadosOmitidos++;
                continue; // Saltar fila repetida en el mismo Excel
            }
            seenInThisFile.add(batchRowKey);

            // 1. Determinar Empresa Contratista con PRIORIDAD ABSOLUTA a la empresa del usuario en sesión
            let emp = null;

            // REGLA DE ORO DE SEGURIDAD Y CONVENIENCIA:
            // Si el usuario en sesión pertenece a una empresa específica (CONTRATISTA u OPERADOR),
            // TODO lo que suba le pertenece a SU empresa, evitando que se desvíe a otra contrata por error de RUC en el Excel.
            if (remitente && remitente.empresa_id) {
                emp = await getDB('SELECT * FROM empresas WHERE id = ?', [remitente.empresa_id]);
            }
            if (!emp && req.body && req.body.empresa_id) {
                emp = await getDB('SELECT * FROM empresas WHERE id = ?', [req.body.empresa_id]);
            }
            // Si es un Administrador Global sin empresa_id fija, se respeta el RUC del Excel
            if (!emp && ruc) {
                emp = await getDB('SELECT * FROM empresas WHERE ruc_rut = ?', [ruc]);
            }
            if (!emp) {
                emp = await getDB('SELECT * FROM empresas ORDER BY created_at ASC LIMIT 1');
            }

            // 2. Buscar o Crear/Actualizar Trabajador en BD (Búsqueda estricta anti-duplicados)
            let trab = await getDB('SELECT * FROM trabajadores WHERE numero_documento = ? OR REPLACE(REPLACE(REPLACE(numero_documento, " ", ""), "-", ""), ".", "") = ?', [cleanDoc, cleanDoc]);
            const telNorm = normalizarTelefonoPeru(telefonoPersonal);

            if (!trab) {
                const newTrabId = 'tr-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
                try {
                    await runDB(`
                        INSERT INTO trabajadores (id, empresa_id, tipo_documento, numero_documento, nombres, apellidos, email_personal, telefono_personal, cargo_puesto, area_trabajo, estado_habilitacion)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INHABILITADO')
                    `, [newTrabId, emp.id, tipoDoc, cleanDoc, cleanNombres, cleanApellidos, emailPersonal || `${cleanDoc}@gmail.com`, telNorm, cargo, area]);
                    
                    trab = await getDB('SELECT * FROM trabajadores WHERE id = ?', [newTrabId]);
                    creadosTrabajadores++;
                } catch (insertErr) {
                    // En caso de condición de carrera, recuperar el registro existente
                    trab = await getDB('SELECT * FROM trabajadores WHERE numero_documento = ?', [cleanDoc]);
                }
            } else {
                // Actualizar datos del trabajador existente SIN crear uno nuevo jamás
                await runDB(`
                    UPDATE trabajadores SET
                        nombres = ?,
                        apellidos = ?,
                        email_personal = COALESCE(NULLIF(?, ''), email_personal),
                        telefono_personal = COALESCE(?, telefono_personal),
                        cargo_puesto = COALESCE(NULLIF(?, ''), cargo_puesto),
                        area_trabajo = COALESCE(NULLIF(?, ''), area_trabajo),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [cleanNombres, cleanApellidos, emailPersonal, telNorm, cargo, area, trab.id]);
                trab = await getDB('SELECT * FROM trabajadores WHERE id = ?', [trab.id]);
                actualizadosTrabajadores++;
            }

            // 3. Crear o Actualizar Certificado en BD (Control estricto anti-duplicados por curso)
            const fEmisionFormatted = formatFechaISO(fechaEmision || '2026-08-20');
            const fVencimientoFormatted = calcularFechaVencimiento(fEmisionFormatted);

            // Cálculo preciso de días restantes y vigencia
            const fechaVencDate = new Date(fVencimientoFormatted);
            const ahora = new Date();
            ahora.setHours(0, 0, 0, 0);
            const diasRestantes = Math.ceil((fechaVencDate.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24));

            let nuevoEstadoVigencia = 'HABILITADO';
            if (diasRestantes <= 0) {
                nuevoEstadoVigencia = 'INHABILITADO';
            } else if (diasRestantes <= 90) {
                nuevoEstadoVigencia = 'PROXIMO_A_VENCER';
            }

            // Buscar si este trabajador YA tiene este curso registrado
            let certExistente = await getDB(`
                SELECT * FROM certificados 
                WHERE trabajador_id = ? 
                  AND (
                      LOWER(TRIM(nombre_curso)) = LOWER(?)
                      OR LOWER(TRIM(nombre_curso)) LIKE LOWER(?)
                      OR LOWER(?) LIKE LOWER(CONCAT('%', TRIM(nombre_curso), '%'))
                  )
                ORDER BY created_at DESC LIMIT 1
            `, [trab.id, cleanCurso, `%${cleanCurso}%`, cleanCurso]);

            let certIdFinal;
            if (certExistente) {
                // Actualizar vigencia y datos del certificado existente (NO duplicar)
                certIdFinal = certExistente.id;
                await runDB(`
                    UPDATE certificados SET
                        empresa_id = ?,
                        nombre_curso = ?,
                        entidad_emisora = ?,
                        horas_lectivas = ?,
                        fecha_emision = ?,
                        fecha_vencimiento = ?,
                        estado_vigencia = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [emp.id, cleanCurso, entidad, parseInt(horas) || 16, fEmisionFormatted, fVencimientoFormatted, nuevoEstadoVigencia, certExistente.id]);
                actualizadosCertificados++;
            } else {
                // Registrar nuevo certificado solo si no existía antes
                certIdFinal = 'cert-excel-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
                await runDB(`
                    INSERT INTO certificados (id, trabajador_id, empresa_id, nombre_curso, entidad_emisora, horas_lectivas, fecha_emision, fecha_vencimiento, codigo_qr_hash, pdf_filename, estado_validacion, estado_vigencia)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Carga_Masiva_Excel.xlsx', 'EN_VALIDACION', ?)
                `, [certIdFinal, trab.id, emp.id, cleanCurso, entidad, parseInt(horas) || 16, fEmisionFormatted, fVencimientoFormatted, 'QR_EXCEL_BATCH_' + Math.floor(Math.random() * 899999 + 100000), nuevoEstadoVigencia]);
                creadosCertificados++;
            }

            await recalcularEstadoTrabajadorBD(trab.id);

            const certFinal = await getDB('SELECT * FROM certificados WHERE id = ?', [certIdFinal]);

            itemsProcesados.push({
                trabajador: trab,
                certificado: certFinal || {
                    id: certIdFinal,
                    nombre_curso: cleanCurso,
                    entidad_emisora: entidad,
                    horas_lectivas: parseInt(horas) || 16,
                    fecha_emision: fEmisionFormatted,
                    fecha_vencimiento: fVencimientoFormatted,
                    codigo_qr_hash: 'QR_EXCEL_BATCH'
                },
                empresa: emp,
                dias_restantes: diasRestantes
            });

            procesados++;
        }

        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // =========================================================================
        // ENVÍO AUTOMÁTICO DE CORREOS POST-CARGA EXCEL
        // 1. Reporte oficial consolidado a la Empresa Contratista con CC al remitente de carga
        // 2. Notificaciones personalizadas e individuales a cada trabajador según su estado (APTO, POR VENCER, NO APTO)
        // =========================================================================
        const enviosRealizados = [];
        const reportesEmpresaEnviados = [];

        // Agrupar items por empresa
        const mapaEmpresas = {};
        for (let item of itemsProcesados) {
            const eId = item.empresa.id;
            if (!mapaEmpresas[eId]) {
                mapaEmpresas[eId] = { empresa: item.empresa, items: [] };
            }
            mapaEmpresas[eId].items.push(item);
        }

        // 1. Enviar Reporte a cada Empresa Contratista
        for (let eId of Object.keys(mapaEmpresas)) {
            const { empresa, items } = mapaEmpresas[eId];
            try {
                const repResult = await enviarReporteCargaEmpresa({
                    empresa,
                    remitente,
                    itemsProcesados: items
                });
                reportesEmpresaEnviados.push(repResult);
            } catch (errReporte) {
                console.error(`Error enviando reporte a empresa ${empresa.razon_social}:`, errReporte);
            }
        }

        // 2. Enviar correo individual a cada trabajador
        for (let item of itemsProcesados) {
            try {
                const notif = await enviarNotificacionIndividualTrabajador({
                    trabajador: item.trabajador,
                    certificado: item.certificado,
                    empresa: item.empresa,
                    remitente,
                    diasRestantes: item.dias_restantes
                });
                enviosRealizados.push(notif);
            } catch (errTrab) {
                console.error(`Error enviando correo individual a trabajador ${item.trabajador.numero_documento}:`, errTrab);
            }
        }

        const totalAptos = itemsProcesados.filter(i => i.dias_restantes > 90).length;
        const totalPorVencer = itemsProcesados.filter(i => i.dias_restantes > 0 && i.dias_restantes <= 90).length;
        const totalVencidos = itemsProcesados.filter(i => i.dias_restantes <= 0).length;

        res.json({
            exito: true,
            total_filas_procesadas: procesados,
            trabajadores_nuevos: creadosTrabajadores,
            trabajadores_actualizados: actualizadosTrabajadores,
            certificados_creados: creadosCertificados,
            certificados_actualizados: actualizadosCertificados,
            duplicados_omitidos: duplicadosOmitidos,
            correos_trabajadores_enviados: enviosRealizados.length,
            reportes_empresa_enviados: reportesEmpresaEnviados.length,
            remitente_usado: remitente ? {
                nombre: remitente.nombre_completo,
                rol: remitente.rol,
                email: remitente.email
            } : {
                nombre: 'Operador de Homologaciones',
                rol: 'OPERADOR HSE',
                email: 'contacto@empresa.com'
            },
            resumen_estados: {
                aptos: totalAptos,
                por_vencer: totalPorVencer,
                vencidos: totalVencidos
            },
            detalles_envios: enviosRealizados,
            reporte_empresa: reportesEmpresaEnviados[0] || null,
            errores: errores
        });

    } catch (err) {
        console.error('Error procesando Excel:', err);
        res.status(500).json({ error: 'Error procesando archivo Excel: ' + err.message });
    } finally {
        cargaExcelEnProceso = false;
    }
}

async function evaluarHomologacion(req, res) {
    try {
        const { certificado_id, estado, observacion, supervisor_nombre } = req.body;

        const cert = await getDB('SELECT * FROM certificados WHERE id = ?', [certificado_id]);
        if (!cert) return res.status(404).json({ error: 'Certificado no encontrado.' });

        await runDB('UPDATE certificados SET estado_validacion = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [estado, certificado_id]);

        const newHomId = 'hom-' + Date.now();
        await runDB(`
            INSERT INTO homologaciones (id, certificado_id, supervisor_nombre, estado_evaluacion, observaciones)
            VALUES (?, ?, ?, ?, ?)
        `, [newHomId, certificado_id, supervisor_nombre || 'Ing. Sofia Ramírez (Supervisor HSE)', estado, observacion || 'Auditoría conforme.']);

        const nuevoEstadoTrab = await recalcularEstadoTrabajadorBD(cert.trabajador_id);

        res.json({
            message: `Certificado ${estado} exitosamente en BD.`,
            trabajador_nuevo_estado: nuevoEstadoTrab
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

function descargarPlantillaExcel(req, res) {
    const csvContent = generarPlantillaCSV();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_Carga_Masiva_Homologaciones.csv"');
    res.send(csvContent);
}

module.exports = {
    listarCertificados,
    uploadPDFOCR,
    cargarMasivaExcel,
    evaluarHomologacion,
    descargarPlantillaExcel
};
