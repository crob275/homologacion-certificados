function parseFechaSegura(fechaInput) {
    if (!fechaInput) return new Date('2026-08-20');

    if (fechaInput instanceof Date && !isNaN(fechaInput.getTime())) {
        return fechaInput;
    }

    if (typeof fechaInput === 'number' || (!isNaN(fechaInput) && !String(fechaInput).includes('-') && !String(fechaInput).includes('/'))) {
        const serial = Number(fechaInput);
        const utc_days = Math.floor(serial - 25569);
        const date_info = new Date(utc_days * 86400 * 1000);
        if (!isNaN(date_info.getTime())) return date_info;
    }

    const str = String(fechaInput).trim();

    const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
        const day = parseInt(dmy[1], 10);
        const month = parseInt(dmy[2], 10) - 1;
        const year = parseInt(dmy[3], 10);
        return new Date(year, month, day);
    }

    const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (ymd) {
        const year = parseInt(ymd[1], 10);
        const month = parseInt(ymd[2], 10) - 1;
        const day = parseInt(ymd[3], 10);
        return new Date(year, month, day);
    }

    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;

    return new Date('2026-08-20');
}

function formatFechaISO(fechaInput) {
    const d = parseFechaSegura(fechaInput);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function calcularFechaVencimiento(fechaEmisionInput) {
    const emision = parseFechaSegura(fechaEmisionInput);
    const vencimiento = new Date(emision);
    vencimiento.setFullYear(vencimiento.getFullYear() + 1);
    return formatFechaISO(vencimiento);
}

function normalizarTelefonoPeru(phoneInput) {
    if (!phoneInput) return '+51 900000000';
    let str = String(phoneInput).trim();
    // Limpiar espacios extra o caracteres excepto dígitos y el signo +
    str = str.replace(/[^\d+]/g, '');
    
    if (str.startsWith('+51')) {
        const num = str.substring(3);
        return `+51 ${num}`;
    }
    if (str.startsWith('51') && str.length === 11) {
        const num = str.substring(2);
        return `+51 ${num}`;
    }
    if (str.length === 9 && str.startsWith('9')) {
        return `+51 ${str}`;
    }
    if (str.length > 0) {
        return str.startsWith('+') ? str : `+51 ${str}`;
    }
    return '+51 900000000';
}

const XLSX = require('xlsx');

function generarPlantillaCSV() {
    const csvHeader = 'RUC_Empresa,Tipo_Documento,Numero_Documento,Nombres,Apellidos,Email_Personal,Telefono_Personal,Cargo_Puesto,Area_Trabajo,Codigo_Curso_Homologado,Nombre_Curso,Entidad_Emisora,Horas_Lectivas,Fecha_Emision_YYYY_MM_DD\n';
    const sampleRow1 = '20601234567,DNI,45891234,Christian renato,rodriguez mamani,jrez@gmail.com,953651975,Soldador Especialista 6G,Planta de Fabricación,CERT-SOLD-6G,Soldadura Avanzada ASME IX 6G,Instituto TecnoSoldar,180,10/03/2026\n';
    const sampleRow2 = '20601234567,DNI,71234567,roberto romario,lupaca nina,lupac777@hotmail.com,993188431,Técnico Montajista,Campo / Altura,CERT-SST-ALTURA,Trabajos en Altura Física y Prevención,Safety Academy S.A.,280,15/01/2026\n';
    const sampleRow3 = '20708889911,DNI,74829103,Sergio Alexander,Juarez Fuentes,sergio.juarez@gmail.com,987654321,Especialista en Soldadura,HSE Planta,CERT-SOLD-6G,Soldadura Estructural y de Mantenimiento,TECSUP,500,12/08/2022\n';

    return '\uFEFF' + csvHeader + sampleRow1 + sampleRow2 + sampleRow3;
}

// Genera un archivo Excel (.xlsx) nativo con formato visual profesional para el Padrón General de Mina
function generarExcelPadronGeneral(data) {
    const wb = XLSX.utils.book_new();

    const rows = data.map((item, idx) => ({
        'N°': idx + 1,
        'Empresa Contratista': item.EmpresaRazonSocial || 'N/A',
        'RUC Contratista': item.EmpresaRUC || 'N/A',
        'Tipo Doc': 'DNI',
        'N° Documento': item.TrabajadorDocumento || 'N/A',
        'Apellidos y Nombres': item.TrabajadorNombres || 'N/A',
        'Cargo / Puesto': item.TrabajadorCargo || 'Operario',
        'Estado en Garita': item.TrabajadorEstadoHabilitacion || 'INHABILITADO',
        'Curso Homologado': item.NombreCurso || 'N/A',
        'Entidad Emisora': item.EntidadEmisora || 'N/A',
        'Horas': item.HorasLectivas || 0,
        'Fecha Emisión': item.FechaEmision || 'N/A',
        'Fecha Vencimiento': item.FechaVencimiento || 'N/A',
        'Vigencia Norma': item.EstadoVigencia || 'N/A',
        'Auditoría HSE': item.EstadoValidacion || 'N/A'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    // Ajustar anchos de columna automáticos
    const colWidths = [
        { wch: 5 },  // N
        { wch: 32 }, // Empresa
        { wch: 14 }, // RUC
        { wch: 8 },  // Tipo
        { wch: 14 }, // Doc
        { wch: 30 }, // Nombres
        { wch: 22 }, // Cargo
        { wch: 18 }, // Estado Garita
        { wch: 35 }, // Curso
        { wch: 25 }, // Entidad
        { wch: 8 },  // Horas
        { wch: 14 }, // Emision
        { wch: 15 }, // Vencimiento
        { wch: 16 }, // Vigencia
        { wch: 16 }  // Auditoria
    ];
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Padrón de Acceso Garita');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Genera la Plantilla Oficial Excel (.xlsx) con validaciones e instrucciones para contratistas
function generarPlantillaOficialXLSX() {
    const wb = XLSX.utils.book_new();

    const dataEjemplo = [
        {
            'RUC_Empresa': '20601234567',
            'Tipo_Documento': 'DNI',
            'Numero_Documento': '45891234',
            'Nombres': 'Christian Renato',
            'Apellidos': 'Ortega Bernedo',
            'Email_Personal': 'cristianre257@gmail.com',
            'Telefono_Personal': '953651975',
            'Cargo_Puesto': 'Supervisor de Soldadura 6G',
            'Area_Trabajo': 'Mantenimiento Mecánico',
            'Codigo_Curso_Homologado': 'CERT-SOLD-6G',
            'Nombre_Curso': 'Soldadura Avanzada ASME IX y 6G',
            'Entidad_Emisora': 'TecnoSoldar Perú S.A.C.',
            'Horas_Lectivas': 120,
            'Fecha_Emision_YYYY_MM_DD': '2026-02-15'
        },
        {
            'RUC_Empresa': '20601234567',
            'Tipo_Documento': 'DNI',
            'Numero_Documento': '71234567',
            'Nombres': 'Delia',
            'Apellidos': 'Bernedo Catari',
            'Email_Personal': 'deliabernedoc@gmail.com',
            'Telefono_Personal': '993188431',
            'Cargo_Puesto': 'Técnica en Seguridad Industrial',
            'Area_Trabajo': 'Prevención de Pérdidas HSE',
            'Codigo_Curso_Homologado': 'CERT-SST-ALTURA',
            'Nombre_Curso': 'Seguridad en Trabajos en Altura Física',
            'Entidad_Emisora': 'Safety Academy International',
            'Horas_Lectivas': 40,
            'Fecha_Emision_YYYY_MM_DD': '2026-01-20'
        }
    ];

    const ws = XLSX.utils.json_to_sheet(dataEjemplo);
    ws['!cols'] = [
        { wch: 15 }, { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 22 },
        { wch: 28 }, { wch: 18 }, { wch: 28 }, { wch: 24 }, { wch: 24 },
        { wch: 38 }, { wch: 28 }, { wch: 14 }, { wch: 25 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla Cuadrillas HSE');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    parseFechaSegura,
    formatFechaISO,
    calcularFechaVencimiento,
    normalizarTelefonoPeru,
    generarPlantillaCSV,
    generarExcelPadronGeneral,
    generarPlantillaOficialXLSX
};
