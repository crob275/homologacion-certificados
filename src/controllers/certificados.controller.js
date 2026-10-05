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
        const empresaSeleccionadaId = req.body.empresa_id || 'emp-3';

        // 1. Buscar coincidencia por DNI si se extrajo
        let trabajador = null;
        if (extracted.dniTrabajador && extracted.dniTrabajador.length === 8) {
            trabajador = await getDB('SELECT * FROM trabajadores WHERE numero_documento = ? LIMIT 1', [extracted.dniTrabajador]);
        }

        // 2. Buscar por coincidencia de Nombres/Apellidos en tabla trabajadores
        const nombrePDFLimpio = extracted.nombreTrabajador.trim().toLowerCase();
        if (!trabajador && nombrePDFLimpio.length > 4 && !nombrePDFLimpio.includes('trabajador acreditado')) {
            trabajador = await getDB(
                `SELECT * FROM trabajadores 
                 WHERE LOWER(CONCAT(nombres, ' ', apellidos)) = ? 
                    OR LOWER(CONCAT(apellidos, ' ', nombres)) = ?
                    OR (LENGTH(?) > 8 AND LOWER(CONCAT(nombres, ' ', apellidos)) LIKE ?)
                 LIMIT 1`, 
                [nombrePDFLimpio, nombrePDFLimpio, nombrePDFLimpio, `%${nombrePDFLimpio}%`]
            );
        }

        // 3. Si no existe en trabajadores pero es un Usuario del Sistema (ej. Christian Renato Ortega Bernedo)
        let usuarioSistemaMatch = null;
        if (!trabajador) {
            usuarioSistemaMatch = await getDB(
                `SELECT * FROM usuarios 
                 WHERE LOWER(nombre_completo) = ? 
                    OR (LENGTH(?) > 8 AND LOWER(nombre_completo) LIKE ?)
                 LIMIT 1`,
                [nombrePDFLimpio, nombrePDFLimpio, `%${nombrePDFLimpio}%`]
            );
        }

        let esNuevoTrabajador = false;
        let discrepanciaDetectada = false;
        let mensajeDiscrepancia = null;

        if (!trabajador) {
            const nuevoId = 'tr-' + Date.now();
            const nuevoDoc = extracted.dniTrabajador || String(Math.floor(Math.random() * 89999999 + 10000000));
            let nombres = '';
            let apellidos = '';
            let emailPersonal = '';

            if (usuarioSistemaMatch) {
                // Adoptar datos oficiales del usuario
                const partes = usuarioSistemaMatch.nombre_completo.trim().split(/\s+/);
                nombres = partes.slice(0, 2).join(' ');
                apellidos = partes.slice(2).join(' ') || partes[1] || '';
                emailPersonal = usuarioSistemaMatch.email;
            } else {
                const nombreLimpio = extracted.nombreTrabajador.trim();
                const partes = nombreLimpio.split(/\s+/);
                if (partes.length <= 2) {
                    nombres = partes[0] || 'Operario';
                    apellidos = partes[1] || 'General';
                } else {
                    nombres = partes.slice(0, 2).join(' ');
                    apellidos = partes.slice(2).join(' ');
                }
                emailPersonal = `${nombres.toLowerCase().replace(/\s+/g, '.')}@gmail.com`;
            }

            await runDB(`
                INSERT INTO trabajadores (id, empresa_id, tipo_documento, numero_documento, nombres, apellidos, email_personal, telefono_personal, cargo_puesto, estado_habilitacion)
                VALUES (?, ?, 'DNI', ?, ?, ?, ?, ?, 'Técnico Especialista en Mantenimiento', 'INHABILITADO')
            `, [nuevoId, empresaSeleccionadaId, nuevoDoc, nombres, apellidos, emailPersonal, '+51 987654321']);

            trabajador = await getDB('SELECT * FROM trabajadores WHERE id = ?', [nuevoId]);
            esNuevoTrabajador = true;
        } else {
            // Verificar si el nombre del PDF coincide plenamente con la BD
            const nombreBD = `${trabajador.nombres} ${trabajador.apellidos}`.toLowerCase();
            if (!nombreBD.includes(nombrePDFLimpio) && !nombrePDFLimpio.includes(nombreBD)) {
                discrepanciaDetectada = true;
                mensajeDiscrepancia = `Aviso de Verificación: El nombre del PDF ("${extracted.nombreTrabajador}") difiere de la ficha en BD ("${trabajador.nombres} ${trabajador.apellidos}" - DNI: ${trabajador.numero_documento}).`;
            }
        }

        const empresa = await getDB('SELECT * FROM empresas WHERE id = ?', [empresaSeleccionadaId]) || await getDB('SELECT * FROM empresas WHERE id = ?', [trabajador.empresa_id]) || await getDB('SELECT * FROM empresas ORDER BY created_at ASC LIMIT 1');
        const fechaVencimiento = calcularFechaVencimiento(extracted.fechaEmision);

        // Prevenir duplicidad de certificados
        let certExistente = await getDB(
            'SELECT * FROM certificados WHERE trabajador_id = ? AND (LOWER(nombre_curso) = LOWER(?) OR pdf_filename = ?)',
            [trabajador.id, extracted.nombreCurso, filename]
        );

        // Almacenar respaldo en Base64 en la base de datos (url_pdf_storage) para que sobreviva a reinicios en la nube (Railway)
        let pdfBase64 = null;
        if (pdfBuffer && pdfBuffer.length > 0 && pdfBuffer.length < 8 * 1024 * 1024) {
            pdfBase64 = 'data:application/pdf;base64,' + pdfBuffer.toString('base64');
        }

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
                    url_pdf_storage = COALESCE(?, url_pdf_storage),
                    estado_validacion = 'EN_VALIDACION',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [empresa.id, extracted.nombreCurso, extracted.entidad, extracted.horas, extracted.fechaEmision, fechaVencimiento, filename, pdfBase64, newCertId]);
        } else {
            newCertId = 'cert-' + Date.now();
            await runDB(`
                INSERT INTO certificados (id, trabajador_id, empresa_id, nombre_curso, entidad_emisora, horas_lectivas, fecha_emision, fecha_vencimiento, codigo_qr_hash, pdf_filename, url_pdf_storage, estado_validacion, estado_vigencia)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EN_VALIDACION', 'HABILITADO')
            `, [newCertId, trabajador.id, empresa.id, extracted.nombreCurso, extracted.entidad, extracted.horas, extracted.fechaEmision, fechaVencimiento, 'QR_OCR_PDF_' + Math.floor(Math.random() * 899999 + 100000), filename, pdfBase64]);
        }

        await recalcularEstadoTrabajadorBD(trabajador.id);
        const certificadoCreado = await getDB('SELECT * FROM certificados WHERE id = ?', [newCertId]);

        // Disparar de inmediato la notificación oficial al correo del trabajador
        let envioEmailResultado = null;
        try {
            envioEmailResultado = await enviarNotificacionIndividualTrabajador({
                certificadoId: newCertId,
                remitenteNombre: 'Centro de Acreditación Digital Minera',
                remitenteRol: 'AUDITORÍA HSE',
                remitenteEmail: empresa.email_contacto || 'admin@ingemant.pe'
            });
        } catch (mailErr) {
            console.warn('⚠️ No se pudo despachar el correo inmediato de PDF:', mailErr.message);
        }

        res.status(201).json({
            exito: true,
            es_nuevo_trabajador: esNuevoTrabajador,
            es_actualizacion: Boolean(certExistente),
            discrepancia_detectada: discrepanciaDetectada,
            mensaje_discrepancia: mensajeDiscrepancia,
            correo_enviado: Boolean(envioEmailResultado),
            destinatario_correo: trabajador.email_personal,
            message: esNuevoTrabajador 
                ? `¡NUEVO TRABAJADOR REGISTRADO EN BD! Se creó la ficha para "${trabajador.nombres} ${trabajador.apellidos}" y se despachó el correo a ${trabajador.email_personal}.`
                : (certExistente 
                    ? `Certificado de "${trabajador.nombres} ${trabajador.apellidos}" actualizado y notificado a ${trabajador.email_personal}.` 
                    : (discrepanciaDetectada ? mensajeDiscrepancia : `Certificado para "${trabajador.nombres} ${trabajador.apellidos}" registrado y notificado exitosamente.`)),
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

// =========================================================================
// CARGA Y EXTRACCIÓN MASIVA MULTI-PDF (BATCH OCR MINERO)
// Procesa múltiples archivos PDF simultáneamente con extracción inteligente
// de DNI, nombres, curso normativo, horas y vigencias.
// =========================================================================
async function uploadBatchPDFOCR(req, res) {
    try {
        const files = req.files || (req.file ? [req.file] : []);
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No se recibieron archivos PDF para procesar.' });
        }

        const empresaSeleccionadaId = req.body.empresa_id || 'emp-1';
        const empresa = await getDB('SELECT * FROM empresas WHERE id = ?', [empresaSeleccionadaId]) || await getDB('SELECT * FROM empresas ORDER BY created_at ASC LIMIT 1');

        const resultados = [];
        let creados = 0;
        let actualizados = 0;

        for (const file of files) {
            try {
                const pdfBuffer = fs.readFileSync(file.path);
                const extracted = await extraerMetadatosRealPDF(pdfBuffer, file.originalname);

                // 1. Localizar o asociar trabajador por DNI o Nombres
                let trabajador = null;

                if (extracted.dniTrabajador && extracted.dniTrabajador.length === 8) {
                    trabajador = await getDB('SELECT * FROM trabajadores WHERE numero_documento = ? LIMIT 1', [extracted.dniTrabajador]);
                }

                if (!trabajador && extracted.nombreTrabajador && extracted.nombreTrabajador.length > 4 && !extracted.nombreTrabajador.includes('Trabajador Acreditado')) {
                    const nombreLimpio = extracted.nombreTrabajador.trim().toLowerCase();
                    trabajador = await getDB(
                        `SELECT * FROM trabajadores 
                         WHERE LOWER(CONCAT(nombres, ' ', apellidos)) = ? 
                            OR LOWER(CONCAT(apellidos, ' ', nombres)) = ?
                            OR (LENGTH(?) > 8 AND LOWER(CONCAT(nombres, ' ', apellidos)) LIKE ?)
                         LIMIT 1`,
                        [nombreLimpio, nombreLimpio, nombreLimpio, `%${nombreLimpio}%`]
                    );
                }

                // Si no existe como trabajador pero coincide con un usuario del sistema (ej. Christian Renato Ortega Bernedo)
                let usuarioMatch = null;
                if (!trabajador && extracted.nombreTrabajador) {
                    const nLimp = extracted.nombreTrabajador.trim().toLowerCase();
                    usuarioMatch = await getDB(
                        `SELECT * FROM usuarios 
                         WHERE LOWER(nombre_completo) = ? 
                            OR (LENGTH(?) > 8 AND LOWER(nombre_completo) LIKE ?)
                         LIMIT 1`,
                        [nLimp, nLimp, `%${nLimp}%`]
                    );
                }

                let esNuevoTrabajador = false;
                if (!trabajador) {
                    const nuevoId = 'tr-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
                    const docFinal = extracted.dniTrabajador || String(Math.floor(Math.random() * 89999999 + 10000000));
                    let nombres = '';
                    let apellidos = '';
                    let emailPersonal = '';

                    if (usuarioMatch) {
                        const partes = usuarioMatch.nombre_completo.trim().split(/\s+/);
                        nombres = partes.slice(0, 2).join(' ');
                        apellidos = partes.slice(2).join(' ') || partes[1] || '';
                        emailPersonal = usuarioMatch.email;
                    } else {
                        const partes = extracted.nombreTrabajador.trim().split(/\s+/);
                        nombres = partes[0] || 'Operario';
                        apellidos = partes.slice(1).join(' ') || 'General';
                        emailPersonal = `${nombres.toLowerCase().replace(/\s+/g, '.')}@gmail.com`;
                    }

                    await runDB(`
                        INSERT INTO trabajadores (id, empresa_id, tipo_documento, numero_documento, nombres, apellidos, email_personal, telefono_personal, cargo_puesto, estado_habilitacion)
                        VALUES (?, ?, 'DNI', ?, ?, ?, ?, ?, 'Técnico Especialista en Mantenimiento', 'INHABILITADO')
                    `, [nuevoId, empresa.id, docFinal, nombres, apellidos, emailPersonal, '+51 987654321']);

                    trabajador = await getDB('SELECT * FROM trabajadores WHERE id = ?', [nuevoId]);
                    esNuevoTrabajador = true;
                }

                const fechaVencimiento = calcularFechaVencimiento(extracted.fechaEmision);

                // 2. Prevenir duplicidad de certificado por curso
                let certExistente = await getDB(
                    'SELECT * FROM certificados WHERE trabajador_id = ? AND (LOWER(nombre_curso) = LOWER(?) OR pdf_filename = ?)',
                    [trabajador.id, extracted.nombreCurso, file.filename]
                );

                let batchBase64 = null;
                if (pdfBuffer && pdfBuffer.length > 0 && pdfBuffer.length < 8 * 1024 * 1024) {
                    batchBase64 = 'data:application/pdf;base64,' + pdfBuffer.toString('base64');
                }

                let certId;
                if (certExistente) {
                    certId = certExistente.id;
                    await runDB(`
                        UPDATE certificados SET
                            empresa_id = ?,
                            nombre_curso = ?,
                            entidad_emisora = ?,
                            horas_lectivas = ?,
                            fecha_emision = ?,
                            fecha_vencimiento = ?,
                            pdf_filename = ?,
                            url_pdf_storage = COALESCE(?, url_pdf_storage),
                            estado_validacion = 'EN_VALIDACION',
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `, [empresa.id, extracted.nombreCurso, extracted.entidad, extracted.horas, extracted.fechaEmision, fechaVencimiento, file.filename, batchBase64, certId]);
                    actualizados++;
                } else {
                    certId = 'cert-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
                    await runDB(`
                        INSERT INTO certificados (id, trabajador_id, empresa_id, nombre_curso, entidad_emisora, horas_lectivas, fecha_emision, fecha_vencimiento, codigo_qr_hash, pdf_filename, url_pdf_storage, estado_validacion, estado_vigencia)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EN_VALIDACION', 'HABILITADO')
                    `, [certId, trabajador.id, empresa.id, extracted.nombreCurso, extracted.entidad, extracted.horas, extracted.fechaEmision, fechaVencimiento, 'QR_OCR_BATCH_' + Math.floor(Math.random() * 899999 + 100000), file.filename, batchBase64]);
                    creados++;
                }

                await recalcularEstadoTrabajadorBD(trabajador.id);

                // Enviar notificación oficial a cada trabajador procesado en el lote
                let correoEnviado = false;
                try {
                    await enviarNotificacionIndividualTrabajador({
                        certificadoId: certId,
                        remitenteNombre: 'Centro de Acreditación Digital Minera',
                        remitenteRol: 'AUDITORÍA HSE',
                        remitenteEmail: empresa.email_contacto || 'admin@ingemant.pe'
                    });
                    correoEnviado = true;
                } catch (batchMailErr) {
                    console.warn(`⚠️ Error enviando correo a ${trabajador.email_personal}:`, batchMailErr.message);
                }

                resultados.push({
                    archivo_original: file.originalname,
                    trabajador_nombre: `${trabajador.nombres} ${trabajador.apellidos}`,
                    trabajador_dni: trabajador.numero_documento,
                    trabajador_email: trabajador.email_personal,
                    correo_notificado: correoEnviado,
                    curso_reconocido: extracted.nombreCurso,
                    entidad_emisora: extracted.entidad,
                    horas: extracted.horas,
                    fecha_emision: extracted.fechaEmision,
                    fecha_vencimiento: fechaVencimiento,
                    estado: certExistente ? 'ACTUALIZADO' : (esNuevoTrabajador ? 'NUEVO_TRABAJADOR' : 'REGISTRADO')
                });
            } catch (fileErr) {
                console.error(`Error procesando archivo individual ${file.originalname}:`, fileErr.message);
                resultados.push({
                    archivo_original: file.originalname,
                    error: fileErr.message,
                    estado: 'ERROR_LECTURA'
                });
            }
        }

        res.status(201).json({
            exito: true,
            total_recibidos: files.length,
            total_procesados: resultados.length,
            nuevos_registros: creados,
            actualizados: actualizados,
            resultados
        });
    } catch (err) {
        console.error('Error general en uploadBatchPDFOCR:', err);
        res.status(500).json({ error: 'Fallo al procesar lote de certificados PDF: ' + err.message });
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

        // 1. Enviar Reporte a cada Empresa Contratista en paralelo
        const promesasReportes = Object.keys(mapaEmpresas).map(async (eId) => {
            const { empresa, items } = mapaEmpresas[eId];
            try {
                return await enviarReporteCargaEmpresa({
                    empresa,
                    remitente,
                    itemsProcesados: items
                });
            } catch (errReporte) {
                console.error(`Error enviando reporte a empresa ${empresa.razon_social}:`, errReporte);
                return null;
            }
        });

        // 2. Enviar correos individuales a cada trabajador en paralelo
        const promesasTrabajadores = itemsProcesados.map(async (item) => {
            try {
                return await enviarNotificacionIndividualTrabajador({
                    trabajador: item.trabajador,
                    certificado: item.certificado,
                    empresa: item.empresa,
                    remitente,
                    diasRestantes: item.dias_restantes
                });
            } catch (errTrab) {
                console.error(`Error enviando correo individual a trabajador ${item.trabajador.numero_documento}:`, errTrab);
                return null;
            }
        });

        // Ejecución concurrente de alto rendimiento
        const [resultadosReportes, resultadosTrabajadores] = await Promise.all([
            Promise.all(promesasReportes),
            Promise.all(promesasTrabajadores)
        ]);

        for (let r of resultadosReportes) {
            if (r) reportesEmpresaEnviados.push(r);
        }
        for (let t of resultadosTrabajadores) {
            if (t) enviosRealizados.push(t);
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

async function servirArchivoPDF(req, res) {
    try {
        const { filename } = req.params;
        const path = require('path');
        const fs = require('fs');

        const safeFilename = path.basename(filename);
        const filePath = path.join(__dirname, '..', '..', 'uploads', safeFilename);

        if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
            return res.sendFile(filePath);
        }

        // 2. Buscar si el PDF binario real está persistido en la BD (url_pdf_storage)
        const cert = await getDB('SELECT c.*, CONCAT(t.nombres, " ", t.apellidos) as trab_nombre, t.numero_documento as trab_doc, e.razon_social as emp_nombre FROM certificados c JOIN trabajadores t ON c.trabajador_id = t.id JOIN empresas e ON c.empresa_id = e.id WHERE c.pdf_filename = ? OR c.id = ? LIMIT 1', [safeFilename, safeFilename]);

        if (cert && cert.url_pdf_storage && cert.url_pdf_storage.startsWith('data:application/pdf;base64,')) {
            const base64Data = cert.url_pdf_storage.replace('data:application/pdf;base64,', '');
            const fileBuffer = Buffer.from(base64Data, 'base64');
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
            return res.send(fileBuffer);
        }

        const certTitulo = cert ? cert.nombre_curso : 'Certificado de Homologación Minera';
        const titular = cert ? `${cert.trab_nombre} (DNI: ${cert.trab_doc})` : 'Trabajador Acreditado';
        const empresa = cert ? cert.emp_nombre : 'Empresa Contratista Autorizada';
        const emision = cert ? new Date(cert.fecha_emision).toLocaleDateString('es-PE') : '04/10/2026';
        const vencimiento = cert ? new Date(cert.fecha_vencimiento).toLocaleDateString('es-PE') : '04/10/2027';
        const qrHash = cert ? (cert.codigo_qr_hash || 'QR_OFICIAL_MINERIA') : 'QR_VALIDADO';

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>${certTitulo}</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 2rem; display: flex; justify-content: center; align-items: center; min-height: 90vh; }
                    .cert-card { background: #1e293b; border: 2px solid #38bdf8; border-radius: 16px; padding: 2.5rem; max-width: 750px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); text-align: center; }
                    .header-tag { display: inline-block; background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 0.85rem; margin-bottom: 1rem; border: 1px solid #38bdf8; }
                    h1 { color: #fff; font-size: 1.8rem; margin: 0.5rem 0 1rem; }
                    .titular { font-size: 1.4rem; color: #fbbf24; font-weight: 800; margin: 1rem 0; border-bottom: 2px dashed rgba(255,255,255,0.2); padding-bottom: 1rem; }
                    .grid-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.5rem 0; text-align: left; background: rgba(0,0,0,0.25); padding: 1.25rem; border-radius: 10px; font-size: 0.9rem; }
                    .grid-meta strong { color: #38bdf8; }
                    .footer-qr { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #94a3b8; }
                    .badge-valido { background: #065f46; color: #34d399; padding: 6px 12px; border-radius: 6px; font-weight: 700; }
                </style>
            </head>
            <body>
                <div class="cert-card">
                    <span class="header-tag">EXPEDIENTE DIGITAL DE HOMOLOGACIÓN MINERA D.S. 024-2016-EM</span>
                    <h1>${certTitulo}</h1>
                    <div style="color: #94a3b8; font-size: 0.95rem;">El presente documento certifica la acreditación y cumplimiento normativo de:</div>
                    <div class="titular">👤 ${titular}</div>
                    <div class="grid-meta">
                        <div><strong>Empresa Contratista:</strong><br>${empresa}</div>
                        <div><strong>Entidad Certificadora:</strong><br>${cert ? cert.entidad_emisora : 'Centro Especializado'}</div>
                        <div><strong>Fecha de Emisión:</strong><br>${emision}</div>
                        <div><strong>Fecha de Caducidad:</strong><br>${vencimiento}</div>
                    </div>
                    <div class="footer-qr">
                        <span>Código Digital: <code>${qrHash}</code></span>
                        <span class="badge-valido">✓ REGISTRO OFICIAL VERIFICADO EN SISTEMA</span>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch(e) {
        res.status(500).send('Error recuperando documento digital: ' + e.message);
    }
}

function descargarPlantillaExcel(req, res) {
    const csvContent = generarPlantillaCSV();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Plantilla_Carga_Masiva_Homologaciones.csv"');
    res.send(csvContent);
}

async function eliminarCertificado(req, res) {
    try {
        const { id } = req.params;
        const cert = await getDB('SELECT * FROM certificados WHERE id = ?', [id]);
        if (!cert) return res.status(404).json({ error: 'Certificado no encontrado.' });

        const trabajadorId = cert.trabajador_id;

        // Eliminar homologaciones y alertas vinculadas si las hay
        try {
            await runDB('DELETE FROM homologaciones WHERE certificado_id = ?', [id]);
            await runDB('DELETE FROM alertas_notificaciones WHERE certificado_id = ?', [id]);
        } catch(e) {}

        await runDB('DELETE FROM certificados WHERE id = ?', [id]);

        // Recalcular estado del trabajador tras eliminar
        if (trabajadorId) {
            await recalcularEstadoTrabajadorBD(trabajadorId);
        }

        res.json({ exito: true, message: 'Certificado eliminado de la Base de Datos exitosamente.' });
    } catch (err) {
        res.status(500).json({ error: 'Error eliminando certificado: ' + err.message });
    }
}

async function actualizarCertificado(req, res) {
    try {
        const { id } = req.params;
        const { nombre_curso, entidad_emisora, horas_lectivas, fecha_emision, fecha_vencimiento, estado_validacion } = req.body;

        const cert = await getDB('SELECT * FROM certificados WHERE id = ?', [id]);
        if (!cert) return res.status(404).json({ error: 'Certificado no encontrado.' });

        await runDB(`
            UPDATE certificados SET
                nombre_curso = COALESCE(?, nombre_curso),
                entidad_emisora = COALESCE(?, entidad_emisora),
                horas_lectivas = COALESCE(?, horas_lectivas),
                fecha_emision = COALESCE(?, fecha_emision),
                fecha_vencimiento = COALESCE(?, fecha_vencimiento),
                estado_validacion = COALESCE(?, estado_validacion),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [nombre_curso, entidad_emisora, horas_lectivas, fecha_emision, fecha_vencimiento, estado_validacion, id]);

        if (cert.trabajador_id) {
            await recalcularEstadoTrabajadorBD(cert.trabajador_id);
        }

        const certActualizado = await getDB('SELECT * FROM certificados WHERE id = ?', [id]);
        res.json({ exito: true, message: 'Certificado actualizado.', certificado: certActualizado });
    } catch (err) {
        res.status(500).json({ error: 'Error actualizando certificado: ' + err.message });
    }
}

module.exports = {
    listarCertificados,
    servirArchivoPDF,
    uploadPDFOCR,
    uploadBatchPDFOCR,
    cargarMasivaExcel,
    evaluarHomologacion,
    descargarPlantillaExcel,
    eliminarCertificado,
    actualizarCertificado
};
