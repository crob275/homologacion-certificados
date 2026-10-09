const zlib = require('zlib');
const { PNG } = require('pngjs');
const Tesseract = require('tesseract.js');
const pdfParseModule = require('pdf-parse');

async function extractTextFromPDF(pdfBuffer) {
    let text = '';
    // 1. Try vector text first
    try {
        if (pdfBuffer && pdfBuffer.length > 0) {
            if (typeof pdfParseModule === 'function') {
                const res = await pdfParseModule(pdfBuffer);
                text = (res && res.text) ? res.text.replace(/-- \d+ of \d+ --/g, '').trim() : '';
            } else if (pdfParseModule.PDFParse && typeof pdfParseModule.PDFParse === 'function') {
                const instance = new pdfParseModule.PDFParse({ data: pdfBuffer });
                const res = await instance.getText();
                text = (res && res.text) ? res.text.replace(/-- \d+ of \d+ --/g, '').trim() : '';
            }
        }
    } catch (e) {
        console.log('PDF text parsing error:', e.message);
    }

    // Limpiar marcas de agua de librerías PDF que contaminan nombres de alumnos (ej. TCPDF, FPDF, iText)
    if (text) {
        text = text.replace(/Powered\s+by\s+TCPDF\s*(?:\([^\)]*\))?/gi, '');
        text = text.replace(/www\.tcpdf\.org/gi, '');
        text = text.replace(/TCPDF/gi, '');
    }

    // 2. If vector text is missing or scarce, perform Real OCR on embedded certificate image
    if (text.length < 25 && pdfBuffer && pdfBuffer.length > 0) {
        try {
            console.log('🔍 Realizando escaneo OCR de imagen incrustada con Tesseract...');
            let pos = 0;
            while ((pos = pdfBuffer.indexOf(Buffer.from('/Subtype /Image'), pos + 1)) !== -1) {
                const chunk = pdfBuffer.subarray(Math.max(0, pos - 300), pos + 200).toString();
                const wM = chunk.match(/\/Width\s+(\d+)/);
                const hM = chunk.match(/\/Height\s+(\d+)/);
                const isRGB = chunk.includes('/DeviceRGB') || chunk.includes('ColorSpace 10 0 R');
                const isRunLength = chunk.includes('RunLengthDecode');
                const isFlate = chunk.includes('FlateDecode');

                if (wM && hM) {
                    const width = parseInt(wM[1]);
                    const height = parseInt(hM[1]);
                    const isDCT = chunk.includes('DCTDecode');
                    const sStart = pdfBuffer.indexOf(Buffer.from('stream'), pos) + 6;
                    let s = sStart;
                    while (pdfBuffer[s] === 10 || pdfBuffer[s] === 13) s++;
                    const sEnd = pdfBuffer.indexOf(Buffer.from('endstream'), s);
                    const streamSlice = pdfBuffer.subarray(s, sEnd);

                    if (isDCT || (streamSlice[0] === 0xFF && streamSlice[1] === 0xD8)) {
                        try {
                            const { data: { text: ocrText } } = await Tesseract.recognize(streamSlice, 'spa');
                            if (ocrText && ocrText.trim().length > 10) {
                                text = ocrText;
                                console.log('✅ OCR con Tesseract reconoció exitosamente texto en imagen JPEG del PDF:', ocrText.substring(0, 100) + '...');
                                break;
                            }
                        } catch (dctErr) {
                            console.warn('Fallo OCR directo sobre JPEG:', dctErr.message);
                        }
                    }

                    let decomp = null;
                    if (isRunLength) {
                        // Decodificador RunLengthDecode estándar PDF
                        const outBuf = Buffer.alloc(width * height * 3);
                        let inIdx = 0;
                        let outIdx = 0;
                        while (inIdx < streamSlice.length && outIdx < outBuf.length) {
                            const b = streamSlice[inIdx++];
                            if (b === 128) break; // EOD
                            if (b <= 127) {
                                const count = b + 1;
                                streamSlice.copy(outBuf, outIdx, inIdx, inIdx + count);
                                inIdx += count;
                                outIdx += count;
                            } else {
                                const count = 257 - b;
                                const val = streamSlice[inIdx++];
                                outBuf.fill(val, outIdx, outIdx + count);
                                outIdx += count;
                            }
                        }
                        decomp = outBuf.subarray(0, outIdx);
                    } else if (isFlate || !isRunLength) {
                        try {
                            decomp = zlib.inflateSync(streamSlice);
                        } catch (zErr) {
                            // Raw stream
                            decomp = streamSlice;
                        }
                    }

                    if (decomp && decomp.length >= width * height) {
                        const png = new PNG({ width, height });
                        const isColor = decomp.length >= width * height * 3;
                        for (let i = 0, j = 0; i < width * height; i++, j += 4) {
                            if (isColor) {
                                png.data[j] = decomp[i * 3];
                                png.data[j + 1] = decomp[i * 3 + 1];
                                png.data[j + 2] = decomp[i * 3 + 2];
                            } else {
                                png.data[j] = decomp[i];
                                png.data[j + 1] = decomp[i];
                                png.data[j + 2] = decomp[i];
                            }
                            png.data[j + 3] = 255;
                        }
                        const pngBuffer = PNG.sync.write(png);
                        const { data: { text: ocrText } } = await Tesseract.recognize(pngBuffer, 'spa');
                        if (ocrText && ocrText.trim().length > 10) {
                            text = ocrText;
                            console.log('✅ OCR con Tesseract reconoció exitosamente texto en imagen del PDF:', ocrText.substring(0, 100) + '...');
                            break;
                        }
                    }
                }
            }
        } catch (ocrErr) {
            console.error('Error durante OCR de imagen en PDF:', ocrErr.message);
        }
    }

    return text;
}

async function extraerMetadatosRealPDF(pdfBuffer, filename) {
    const text = await extractTextFromPDF(pdfBuffer);
    console.log('📄 [OCR INTELIGENTE]: Texto extraído (Longitud: ' + text.length + ') para archivo:', filename);

    // 1. Extraer DNI / Documento de Identidad (8 dígitos exactos)
    let dniTrabajador = null;
    const matchDNI = text.match(/(?:D\.?N\.?I\.?|DOC(?:UMENTO)?(?:\s+DE)?\s+IDENTIDAD|C\.?C\.?|N(?:úm|ro)?\.?\s*DOC(?:UMENTO)?)\s*[:#\.\-]?\s*([0-9]{8})\b/i);
    if (matchDNI && matchDNI[1]) {
        dniTrabajador = matchDNI[1];
    } else {
        // Buscar cualquier secuencia de 8 dígitos aislados que calce como DNI
        const candidatosDNI = text.match(/\b([1-9][0-9]{7})\b/g);
        if (candidatosDNI && candidatosDNI.length > 0) {
            dniTrabajador = candidatosDNI[0];
        }
    }

    // 2. Extraer Nombre del Trabajador (Con filtro estricto anti-firmantes y reconocimiento tras "Otorgado a", "Otorga el presente diploma a")
    let nombreTrabajador = null;
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // Lista negra estricta de palabras clave de firmas, cargos y autoridades que NUNCA deben tomarse como alumno
    const esPalabraDeFirma = (str) => {
        const u = str.toUpperCase();
        return u.includes('COORDINADOR') || u.includes('DIRECTOR') || u.includes('DIRECTORA') || 
               u.includes('GERENTE') || u.includes('INSTRUCTOR') || u.includes('DOCENTE') || 
               u.includes('FACILITADOR') || u.includes('FELIPE SÁENZ') || u.includes('FELIPE SAENZ') || 
               u.includes('JULIANA SILVA') || u.includes('INGENIERO') || u.includes('SUPERVISOR') ||
               u.includes('EMILIO BENAVENTE') || u.includes('BENAVENTE NAJAR') ||
               u.includes('TRAIN THE TRAINER') || u.includes('OSHA') || u.includes('COD.') ||
               u.includes('EBN CONSULTORES') || u.includes('INDIGO') || u.includes('INSTITUTE') ||
               u.includes('ESGOB') || u.includes('ESCUELA') ||
               u.includes('TCPDF') || u.includes('POWERED BY') || u.includes('WWW.') || u.includes('.ORG') ||
               u.includes('.COM') || u.includes('.PE') || u.includes('HTTP');
    };

    // Estrategia 2.1: Buscar la línea inmediatamente posterior a "Certifica a", "Otorgado a", "Otorga el presente diploma a"
    const idxOtorgado = lines.findIndex(l => /(?:certifica\s+a\:?|otorgado\s+a|conferido\s+a|certifica\s+que|otorgado\s+al?\s*sr\.?|otorga\s+(?:el\s+)?(?:presente\s+)?(?:diploma|certificado|constancia)\s+a|a\s*:)/i.test(l));
    if (idxOtorgado !== -1) {
        for (let i = idxOtorgado + 1; i < Math.min(idxOtorgado + 5, lines.length); i++) {
            const rawCand = lines[i].replace(/["'”]/g, '').trim();
            // Ignorar textos que inician la descripción del curso o relación laboral
            if (/^(?:por|haber|completado|concluido|aprobado|satisfactoriamente|en|el|la|diplomado|curso|programa|participado|empleado\s+de)/i.test(rawCand)) break;
            // Limpiar ruido numérico o símbolos
            const lettersOnly = rawCand.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '').trim();
            const words = lettersOnly.split(/\s+/).filter(w => w.length >= 2);
            if (words.length >= 2 && lettersOnly.length >= 6 && !esPalabraDeFirma(rawCand)) {
                let clean = lettersOnly;
                clean = clean.replace(/\bChuistian\b/gi, 'Christian');
                clean = clean.replace(/\bOdega\b/gi, 'Ortega');
                nombreTrabajador = clean;
                break;
            }
        }
    }

    // Estrategia 2.2: Regex directo en bloque
    if (!nombreTrabajador) {
        const matchNombreOtorgado = text.match(/(?:Certifica\s+a\:?|Otorgado\s+a|otorgado\s+a|OTORGADO\s+A|Otorga\s+(?:el\s+)?(?:presente\s+)?(?:diploma|certificado|constancia)\s+a\:?|A:\s*|Al\s+Sr\.?\(?a?\)?\:?\s*|Conferido\s+a\:?\s*|Certifica\s+que\:?\s*)([A-ZÁÉÍÓÚÑa-zácéíóúñ\s]{5,60})/i);
        if (matchNombreOtorgado && matchNombreOtorgado[1]) {
            const cand = matchNombreOtorgado[1].split(/\r?\n/)[0].replace(/["'”]/g, '').trim();
            if (!esPalabraDeFirma(cand) && cand.split(/\s+/).length >= 2) {
                nombreTrabajador = cand;
            }
        }
    }

    // Estrategia 2.3: Buscar líneas nominativas descartando firmas y empresas
    if (!nombreTrabajador) {
        for (const line of lines) {
            if (/^[A-ZÁÉÍÓÚÑa-z]{3,}(?:\s+[A-ZÁÉÍÓÚÑa-z]{3,}){1,3}$/.test(line) && 
                !line.toUpperCase().includes('CERTIFICADO') && 
                !line.toUpperCase().includes('RECONOCIMIENTO') &&
                !line.toUpperCase().includes('DIPLOMA') &&
                !line.toUpperCase().includes('GESTION') &&
                !line.toUpperCase().includes('PUBLICA') &&
                !line.toUpperCase().includes('TECSUP') && 
                !line.toUpperCase().includes('SENATI') && 
                !line.toUpperCase().includes('SEGURIDAD') && 
                !line.toUpperCase().includes('EMPLEADO') &&
                !line.toUpperCase().includes('NETAXION') &&
                !esPalabraDeFirma(line)) {
                nombreTrabajador = line;
                break;
            }
        }
    }

    // Estrategia 2.4: Si el PDF es un scan cerrado o imagen pura no indexable, extraer el nombre del archivo filtrando códigos y hashes
    if (!nombreTrabajador || nombreTrabajador === 'Trabajador Acreditado') {
        if (filename && typeof filename === 'string') {
            const raw = filename.replace(/\(Autosaved\)/ig, '').replace(/\.pdf$/i, '').replace(/\(\d+\)/g, '');
            const parts = raw.split(/[-_\s]+/);
            // Descartar tokens como JSDSQJDX, GP3, COD123, palabras técnicas
            const words = parts.filter(p => {
                const lp = p.toLowerCase();
                const esRuido = ['certificado','constancia','diploma','reconocimiento','pdf','curso','ia'].includes(lp);
                const tieneConsonantesRaras = !/[aeiouáéíóú]/i.test(p); // Ej: JSDSQJDX, GP3
                const tieneDigitos = /\d/.test(p);
                return p.length >= 3 && /^[a-zA-ZáéíóúÁÉÍÓÚñÑ]+$/.test(p) && !esRuido && !tieneConsonantesRaras && !tieneDigitos;
            });
            if (words.length >= 2) {
                nombreTrabajador = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            }
        }
    }

    if (!nombreTrabajador) {
        nombreTrabajador = 'Trabajador Acreditado';
    } else {
        // Limpieza de letras o ruidos de 1 carácter al inicio o final provocados por firmas u OCR marginal
        nombreTrabajador = nombreTrabajador.replace(/^\s*[a-zA-ZáéíóúÁÉÍÓÚñÑ]\s+/g, '').replace(/\s+[a-zA-ZáéíóúÁÉÍÓÚñÑ]\s*$/g, '').trim();
    }

    // 3. Extraer Nombre del Curso Normativo Minero / Especialización
    let nombreCurso = null;
    const upperText = text.toUpperCase();

    // Detección directa de programas de especialización (fórmula oficial: "programa de especialización en ...")
    const matchEspecializacion = text.match(/(?:programa\s+de\s+especializaci[oó]n\s+en|diplomado\s+en|curso\s+de\s+especializaci[oó]n\s+en)[\s\:\-]+([^\n\r\.;”"]{5,100})/i);

    if (upperText.includes('SIAF') || upperText.includes('ADMINISTRACION FINANCIERA') || upperText.includes('ADMINISTRACIÓN FINANCIERA')) {
        nombreCurso = 'Programa de Especialización en SIAF - Sistema Integrado de Administración Financiera';
    } else if (upperText.includes('GESTIÓN PÚBLICA') || upperText.includes('GESTION PUBLICA')) {
        nombreCurso = 'Programa de Especialización en Gestión Pública';
    } else if (matchEspecializacion && matchEspecializacion[1] && matchEspecializacion[1].trim().length > 4) {
        const espClean = matchEspecializacion[1].trim().replace(/\s+/g, ' ');
        nombreCurso = `Programa de Especialización en ${espClean}`;
    } else if (upperText.includes('TRABAJOS EN ALTURA') || upperText.includes('ALTURA FÍSICA') || upperText.includes('ALTURA FISICA')) {
        nombreCurso = 'Seguridad en Trabajos en Altura Física';
    } else if (upperText.includes('ESPACIOS CONFINADOS') || upperText.includes('ESPACIO CONFINADO')) {
        nombreCurso = 'Seguridad en Ingreso a Espacios Confinados';
    } else if (upperText.includes('BLOQUEO Y ETIQUETADO') || upperText.includes('LOTO') || upperText.includes('ENERGÍA PELIGROSA') || upperText.includes('ENERGIA CERO')) {
        nombreCurso = 'Aislamiento de Energía y Bloqueo (LOTO)';
    } else if (upperText.includes('TRABAJOS EN CALIENTE') || upperText.includes('CORTE Y SOLDADURA')) {
        nombreCurso = 'Seguridad en Trabajos en Caliente (PETAR)';
    } else if (upperText.includes('MATERIALES PELIGROSOS') || upperText.includes('MATPEL')) {
        nombreCurso = 'Manejo de Materiales Peligrosos (MATPEL)';
    } else if (upperText.includes('HERRAMIENTAS MANUALES') || upperText.includes('HERRAMIENTAS MANUALES Y DE PODER')) {
        nombreCurso = 'Seguridad en Herramientas Manuales y de Poder';
    } else if (upperText.includes('IPERC') || upperText.includes('IDENTIFICACION DE PELIGROS') || upperText.includes('IDENTIFICACIÓN DE PELIGROS')) {
        nombreCurso = 'IPERC Continuo y Gestión de Riesgos Mineros';
    } else if (upperText.includes('IZAJE') || upperText.includes('RIGGER') || upperText.includes('GRÚA') || upperText.includes('GRUA')) {
        nombreCurso = 'Seguridad en Operaciones de Izaje y Maniobras con Grúa';
    } else if (upperText.includes('SOLDADURA') || upperText.includes('6G') || upperText.includes('ASME IX')) {
        nombreCurso = 'Soldadura Avanzada ASME IX y Posición 6G';
    } else if (upperText.includes('EXCAVACIONES') || upperText.includes('ZANJAS')) {
        nombreCurso = 'Seguridad en Excavaciones y Zanjas';
    } else if (upperText.includes('MANEJO DEFENSIVO')) {
        nombreCurso = 'Manejo Defensivo y Operación en Unidad Minera';
    } else if (upperText.includes('INDUCCIÓN GENERAL') || upperText.includes('INDUCCION GENERAL') || upperText.includes('ANEXO 6') || upperText.includes('ANEXO 4') || upperText.includes('ANEXO 5')) {
        nombreCurso = 'Inducción y Capacitación General de Seguridad Minera (Anexo 6)';
    } else if (upperText.includes('DESARROLLO CON IA') || upperText.includes('INICIACIÓN AL DESARROLLO CON IA') || upperText.includes('INICIACION AL DESARROLLO CON IA')) {
        nombreCurso = 'Curso de Iniciación al Desarrollo con IA';
    } else if (upperText.includes('INTELIGENCIA ARTIFICIAL') || upperText.includes('DIPLOMADO DE INTELIGENCIA')) {
        nombreCurso = 'Diplomado en Inteligencia Artificial y Tecnologías Digitales';
    } else {
        const matchCursoGenerico = text.match(/(?:Programa\s+(?:de\s+)?(?:Especializaci[oó]n|Integral)|CURSO\s+ESPECIALIDAD|CURSO|Curso|Capacitaci[oó]n|Taller|Especializaci[oó]n|Diplomado(?:\s+en|\s+de)?)[\:\s]+([^\n\r;”"]{10,120})/i);
        if (matchCursoGenerico) {
            nombreCurso = matchCursoGenerico[0].replace(/\r?\n/g, ' ').replace(/["'”]/g, '').trim();
        } else if (filename && /GESTION|PUBLICA/i.test(filename)) {
            nombreCurso = 'Programa de Especialización en Gestión Pública';
        } else if (filename && /SIAF/i.test(filename)) {
            nombreCurso = 'Programa de Especialización en SIAF - Sistema Integrado de Administración Financiera';
        } else if (filename && /IA|INTELIGENCIA|PROGRAMACION|PYTHON|REACT|DESARROLLO/i.test(filename)) {
            nombreCurso = 'Curso de Iniciación al Desarrollo con IA';
        } else {
            nombreCurso = 'Capacitación en Seguridad Ocupacional y Minera';
        }
    }

    // 4. Extraer Entidad Emisora
    let entidad = 'Centro de Capacitación y Homologación Especializado';
    if (upperText.includes('ESGOB') || (filename && /esgob/i.test(filename))) {
        entidad = 'ESGOB - Escuela de Gobierno y Gestión Pública';
    } else if (upperText.includes('MOUREDEV') || upperText.includes('BIG SCHOOL') || (filename && /mouredev|bigschool/i.test(filename))) {
        entidad = 'MoureDev & BIG School';
    } else if (upperText.includes('ELECTROTECH')) {
        entidad = 'ELECTROTECH - Instituto de Capacitaciones Profesionales';
    } else if (upperText.includes('TECSUP')) {
        entidad = 'TECSUP del Perú';
    } else if (upperText.includes('SENATI')) {
        entidad = 'SENATI';
    } else if (upperText.includes('EBN CONSULTORES')) {
        entidad = 'EBN CONSULTORES E.I.R.L.';
    } else if (upperText.includes('SGS')) {
        entidad = 'SGS del Perú';
    } else if (upperText.includes('BUREAU VERITAS')) {
        entidad = 'Bureau Veritas Perú';
    } else if (upperText.includes('CAMIPER')) {
        entidad = 'Camiper - Cámara Minera del Perú';
    } else if (upperText.includes('SAFETY ACADEMY')) {
        entidad = 'Safety Academy International';
    }

    // 5. Extraer Horas Lectivas
    let horas = 16;
    if (upperText.includes('DOSCIENTOS CUARENTA') || upperText.includes('240 HORAS')) {
        horas = 240;
    } else if (upperText.includes('CIENTO VEINTE') || upperText.includes('120 HORAS')) {
        horas = 120;
    } else if (upperText.includes('CIENTO OCHENTA') || upperText.includes('180 HORAS')) {
        horas = 180;
    } else if (upperText.includes('NOVENTA') || upperText.includes('90 HORAS')) {
        horas = 90;
    } else if (upperText.includes('SESENTA') || upperText.includes('60 HORAS')) {
        horas = 60;
    } else if (upperText.includes('CUARENTA Y OCHO') || upperText.includes('48 HORAS')) {
        horas = 48;
    } else if (upperText.includes('TREINTA Y DOS') || upperText.includes('32 HORAS')) {
        horas = 32;
    } else if (upperText.includes('VEINTICUATRO') || upperText.includes('24 HORAS')) {
        horas = 24;
    } else {
        const matchHoras = text.match(/(?:DURACI[OÓ]N\s*:?\s*)?(\d+)\s*(?:horas|hrs|Horas|académicas|horas cronológicas)/i) || text.match(/DURACI[OÓ]N\s*:?\s*(\d+)/i);
        if (matchHoras && matchHoras[1]) {
            horas = parseInt(matchHoras[1]);
        }
    }

    // 6. Extraer Fecha de Emisión
    let fechaEmision = new Date().toISOString().split('T')[0];
    const regexFechaStr = /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:del?|de)\s+(\d{4})/gi;
    const matchesFecha = [...text.matchAll(regexFechaStr)];
    if (matchesFecha.length > 0) {
        const lastMatch = matchesFecha[matchesFecha.length - 1];
        const dia = lastMatch[1].padStart(2, '0');
        const mesNombre = lastMatch[2].toLowerCase();
        const anio = lastMatch[3];
        const meses = { enero:'01', febrero:'02', marzo:'03', abril:'04', mayo:'05', junio:'06', julio:'07', agosto:'08', septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12' };
        if (meses[mesNombre]) {
            fechaEmision = `${anio}-${meses[mesNombre]}-${dia}`;
        }
    } else {
        const matchFechaSlash = text.match(/(?:FECHA\s*:?\s*)?(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i);
        if (matchFechaSlash) {
            fechaEmision = `${matchFechaSlash[3]}-${matchFechaSlash[2].padStart(2, '0')}-${matchFechaSlash[1].padStart(2, '0')}`;
        }
    }

    // 7. Extraer Teléfono / Celular si figura en el documento (ej. 9 dígitos empezando en 9)
    let telefonoTrabajador = null;
    const matchTel = text.match(/(?:TEL[EÉ]FONO|CELULAR|M[OÓ]VIL|WHATSAPP|CONTACTO)?\s*[:#\.\-]?\s*(?:\+?51\s*)?(9\d{8})\b/i);
    if (matchTel && matchTel[1]) {
        telefonoTrabajador = `+51 ${matchTel[1]}`;
    }

    // 8. Extraer Correo Electrónico PERSONAL del trabajador (descartando correos de la entidad certificadora o empresa)
    let emailTrabajador = null;
    const matchEmail = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
    if (matchEmail && matchEmail[1]) {
        const em = matchEmail[1].toLowerCase();
        // Descartar correos institucionales de los centros de capacitación o software
        const esCorreoInstitucional = em.includes('administracion@') || em.includes('contacto@') || 
                                     em.includes('info@') || em.includes('informes@') || 
                                     em.includes('soporte@') || em.includes('ebn.pe') || 
                                     em.includes('tecsup') || em.includes('senati') || 
                                     em.includes('tcpdf') || em.includes('example');
        if (!esCorreoInstitucional) {
            emailTrabajador = em;
        }
    }

    return { 
        dniTrabajador, 
        nombreTrabajador, 
        telefonoTrabajador,
        emailTrabajador,
        nombreCurso, 
        entidad, 
        horas, 
        fechaEmision 
    };
}

module.exports = {
    extraerMetadatosRealPDF
};

