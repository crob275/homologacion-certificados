const zlib = require('zlib');
const { PNG } = require('pngjs');
const Tesseract = require('tesseract.js');
const pdfParseModule = require('pdf-parse');

async function extractTextFromPDF(pdfBuffer) {
    let text = '';
    // 1. Try vector text first
    try {
        if (pdfBuffer && pdfBuffer.length > 0) {
            const PDFParse = pdfParseModule.PDFParse || pdfParseModule;
            if (typeof PDFParse === 'function') {
                const instance = new PDFParse({ data: pdfBuffer });
                const res = await instance.getText();
                text = (res && res.text) ? res.text.replace(/-- \d+ of \d+ --/g, '').trim() : '';
            }
        }
    } catch (e) {
        console.log('PDF text parsing error:', e.message);
    }

    // 2. If vector text is missing or scarce, perform Real OCR on embedded certificate image
    if (text.length < 25 && pdfBuffer && pdfBuffer.length > 0) {
        try {
            console.log('🔍 Realizando escaneo OCR de imagen incrustada con Tesseract...');
            let pos = 0;
            while ((pos = pdfBuffer.indexOf(Buffer.from('/Subtype /Image'), pos + 1)) !== -1) {
                const chunk = pdfBuffer.subarray(Math.max(0, pos - 200), pos + 100).toString();
                const wM = chunk.match(/\/Width\s+(\d+)/);
                const hM = chunk.match(/\/Height\s+(\d+)/);
                const isRGB = chunk.includes('/DeviceRGB');
                if (wM && hM && isRGB) {
                    const width = parseInt(wM[1]);
                    const height = parseInt(hM[1]);
                    const sStart = pdfBuffer.indexOf(Buffer.from('stream'), pos) + 6;
                    let s = sStart;
                    while (pdfBuffer[s] === 10 || pdfBuffer[s] === 13) s++;
                    const sEnd = pdfBuffer.indexOf(Buffer.from('endstream'), s);
                    const decomp = zlib.inflateSync(pdfBuffer.subarray(s, sEnd));

                    const png = new PNG({ width, height });
                    for (let i = 0, j = 0; i < decomp.length; i += 3, j += 4) {
                        png.data[j] = decomp[i];
                        png.data[j + 1] = decomp[i + 1];
                        png.data[j + 2] = decomp[i + 2];
                        png.data[j + 3] = 255;
                    }
                    const pngBuffer = PNG.sync.write(png);
                    const { data: { text: ocrText } } = await Tesseract.recognize(pngBuffer, 'spa');
                    if (ocrText && ocrText.trim().length > 10) {
                        text = ocrText;
                        break;
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
    console.log('📄 Texto extraído para metadatos (Longitud: ' + text.length + '):\n', text);

    // 1. Extraer Nombre del Trabajador
    let nombreTrabajador = null;
    const matchNombreOtorgado = text.match(/(?:Otorgado\s+a|otorgado\s+a|OTORGADO\s+A|A:\s*|Al\s+Sr\.\:?\s*)([A-ZÁÉÍÓÚÑa-zácéíóúñ\s]{5,60})/i);
    if (matchNombreOtorgado && matchNombreOtorgado[1]) {
        nombreTrabajador = matchNombreOtorgado[1].split(/\r?\n/)[0].replace(/["'”]/g, '').trim();
    }

    if (!nombreTrabajador) {
        // Buscar líneas en mayúsculas sostenidas de 2 a 4 palabras
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (/^[A-ZÁÉÍÓÚÑ]{3,}\s+[A-ZÁÉÍÓÚÑ]{3,}(?:\s+[A-ZÁÉÍÓÚÑ]{3,})?$/.test(line) && 
                !line.includes('CERTIFICADO') && !line.includes('ELECTROTECH') && !line.includes('INGENIERO') && !line.includes('COLEGIO')) {
                nombreTrabajador = line;
                break;
            }
        }
    }

    if (!nombreTrabajador) {
        nombreTrabajador = 'Trabajador No Identificado';
    }

    // 2. Extraer Nombre del Curso
    let nombreCurso = null;
    const matchCurso = text.match(/(?:Programa\s+Integral|CURSO\s+ESPECIALIDAD|CURSO|Curso|Capacitaci[oó]n|Taller|Especializaci[oó]n)[\:\s]+([^\n\r;”"]{10,120})/i);
    if (matchCurso) {
        nombreCurso = matchCurso[0].replace(/\r?\n/g, ' ').replace(/["'”]/g, '').trim();
    }

    if (!nombreCurso) {
        nombreCurso = 'Capacitación y Certificación Técnica Normativa';
    }

    // 3. Extraer Entidad Emisora
    let entidad = 'Instituto Certificador Especializado';
    const upperText = text.toUpperCase();
    if (upperText.includes('ELECTROTECH')) {
        entidad = 'ELECTROTECH - Instituto de Capacitaciones Profesionales';
    } else if (upperText.includes('TECSUP') || upperText.includes('TECSU')) {
        entidad = 'TECSUP - Instituto Superior de Tecnología';
    } else if (upperText.includes('SENATI')) {
        entidad = 'SENATI';
    } else if (upperText.includes('EBN CONSULTORES')) {
        entidad = 'EBN CONSULTORES E.I.R.L.';
    } else if (upperText.includes('SGS')) {
        entidad = 'SGS del Perú';
    }

    // 4. Extraer Horas Lectivas
    let horas = 16;
    const matchHoras = text.match(/(\d+)\s*(?:horas|hrs|Horas|académicas)/i);
    if (matchHoras && matchHoras[1]) {
        horas = parseInt(matchHoras[1]);
    }

    // 5. Extraer Fecha de Emisión (tomar la última fecha encontrada en el documento, que suele ser la de expedición/firma)
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
        const matchFechaSlash = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (matchFechaSlash) {
            fechaEmision = `${matchFechaSlash[3]}-${matchFechaSlash[2].padStart(2, '0')}-${matchFechaSlash[1].padStart(2, '0')}`;
        }
    }

    return { nombreTrabajador, nombreCurso, entidad, horas, fechaEmision };
}

module.exports = {
    extraerMetadatosRealPDF
};

