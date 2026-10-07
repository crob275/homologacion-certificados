const { allDB } = require('../config/database');

async function obtenerKPIsDashboard(empresaId = null) {
    let empresas, trabajadores;
    if (empresaId) {
        empresas = await allDB('SELECT * FROM empresas WHERE id = ?', [empresaId]);
        // Solo considerar trabajadores que tengan al menos 1 certificado en la base de datos
        trabajadores = await allDB(`
            SELECT t.* FROM trabajadores t
            JOIN certificados c ON c.trabajador_id = t.id
            WHERE t.empresa_id = ?
            GROUP BY t.id
        `, [empresaId]);
    } else {
        empresas = await allDB('SELECT * FROM empresas');
        trabajadores = await allDB(`
            SELECT t.* FROM trabajadores t
            JOIN certificados c ON c.trabajador_id = t.id
            GROUP BY t.id
        `);
    }
    
    const totalEmpresas = empresas.length;
    const totalTrabajadores = trabajadores.length;
    const habilitados = trabajadores.filter(t => t.estado_habilitacion === 'HABILITADO').length;
    const proximosVencer = trabajadores.filter(t => t.estado_habilitacion === 'PROXIMO_A_VENCER').length;
    const inhabilitados = trabajadores.filter(t => t.estado_habilitacion === 'INHABILITADO').length;
    const tasaCumplimiento = totalTrabajadores > 0 ? Math.round((habilitados / totalTrabajadores) * 100) : 0;

    const resumenEmpresas = await Promise.all(empresas.map(async emp => {
        const trabs = await allDB(`
            SELECT t.* FROM trabajadores t
            JOIN certificados c ON c.trabajador_id = t.id
            WHERE t.empresa_id = ?
            GROUP BY t.id
        `, [emp.id]);
        const hab = trabs.filter(t => t.estado_habilitacion === 'HABILITADO').length;
        const prox = trabs.filter(t => t.estado_habilitacion === 'PROXIMO_A_VENCER').length;
        const inhab = trabs.filter(t => t.estado_habilitacion === 'INHABILITADO').length;
        return {
            empresa: emp.razon_social,
            total: trabs.length,
            habilitados: hab,
            proximos: prox,
            inhabilitados: inhab,
            cumplimiento: trabs.length > 0 ? Math.round((hab / trabs.length) * 100) : 0
        };
    }));

    // Auto-limpieza proactiva: remover trabajadores huérfanos sin ningún certificado
    try {
        await allDB(`
            DELETE FROM trabajadores 
            WHERE id NOT IN (SELECT DISTINCT trabajador_id FROM certificados WHERE trabajador_id IS NOT NULL)
        `);
    } catch(cleanErr) {}

    return {
        totalEmpresas,
        totalTrabajadores,
        habilitados,
        proximosVencer,
        inhabilitados,
        tasaCumplimiento,
        resumenEmpresas
    };
}

async function obtenerReportePowerBI(empresaId = null) {
    if (empresaId) {
        return await allDB(`
            SELECT 
                c.id AS CertificadoID,
                e.ruc_rut AS EmpresaRUC,
                e.razon_social AS EmpresaRazonSocial,
                t.numero_documento AS TrabajadorDocumento,
                CONCAT(t.nombres, ' ', t.apellidos) AS TrabajadorNombres,
                t.email_personal AS TrabajadorEmailPersonal,
                t.telefono_personal AS TrabajadorTelefono,
                t.cargo_puesto AS TrabajadorCargo,
                t.estado_habilitacion AS TrabajadorEstadoHabilitacion,
                c.nombre_curso AS NombreCurso,
                c.entidad_emisora AS EntidadEmisora,
                c.horas_lectivas AS HorasLectivas,
                c.fecha_emision AS FechaEmision,
                c.fecha_vencimiento AS FechaVencimiento,
                c.estado_validacion AS EstadoValidacion,
                c.estado_vigencia AS EstadoVigencia
            FROM certificados c
            JOIN trabajadores t ON c.trabajador_id = t.id
            JOIN empresas e ON c.empresa_id = e.id
            WHERE c.empresa_id = ?
        `, [empresaId]);
    }

    return await allDB(`
        SELECT 
            c.id AS CertificadoID,
            e.ruc_rut AS EmpresaRUC,
            e.razon_social AS EmpresaRazonSocial,
            t.numero_documento AS TrabajadorDocumento,
            CONCAT(t.nombres, ' ', t.apellidos) AS TrabajadorNombres,
            t.email_personal AS TrabajadorEmailPersonal,
            t.telefono_personal AS TrabajadorTelefono,
            t.cargo_puesto AS TrabajadorCargo,
            t.estado_habilitacion AS TrabajadorEstadoHabilitacion,
            c.nombre_curso AS NombreCurso,
            c.entidad_emisora AS EntidadEmisora,
            c.horas_lectivas AS HorasLectivas,
            c.fecha_emision AS FechaEmision,
            c.fecha_vencimiento AS FechaVencimiento,
            c.estado_validacion AS EstadoValidacion,
            c.estado_vigencia AS EstadoVigencia
        FROM certificados c
        JOIN trabajadores t ON c.trabajador_id = t.id
        JOIN empresas e ON c.empresa_id = e.id
    `);
}

module.exports = {
    obtenerKPIsDashboard,
    obtenerReportePowerBI
};
