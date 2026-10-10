let chartInstance = null;
let empresaActivaId = 'emp-1';
let empresasCache = [];
let usuarioSesionActivo = null; // Session User Object
let superAdminScopeCompanyId = null; // Global Scope Filter for Super Admin

document.addEventListener('DOMContentLoaded', () => {
    // Check if session exists in localStorage
    const savedUser = localStorage.getItem('homologa_user_session');
    if (savedUser) {
        try {
            usuarioSesionActivo = JSON.parse(savedUser);
            iniciarSesionUsuario(usuarioSesionActivo);
        } catch (e) {
            localStorage.removeItem('homologa_user_session');
        }
    }

    setupDragAndDrop();
});

function superAdminChangeGlobalScope(empId) {
    superAdminScopeCompanyId = empId && empId.trim() !== '' ? empId : null;
    if (superAdminScopeCompanyId) {
        empresaActivaId = superAdminScopeCompanyId;
    }
    loadDashboardKPIs();
    loadCompanyProfiles();
    loadCertificados();
    loadAuditoriaList();
    if (usuarioSesionActivo && usuarioSesionActivo.rol !== 'OPERADOR') {
        loadUsuariosList();
    }
}

function setupDragAndDrop() {
    setupZone('pdf-dropzone', 'input-file-pdf', 'pdf');
    setupZone('excel-dropzone', 'input-file-excel', 'excel');
}

function setupZone(dropzoneId, inputId, type) {
    const dropzone = document.getElementById(dropzoneId);
    const input = document.getElementById(inputId);
    if (!dropzone || !input) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dropzone-active');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dropzone-active');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            input.files = files;
            handleFileSelected(type);
        }
    });
}

function handleFileSelected(type) {
    if (type === 'pdf') {
        const input = document.getElementById('input-file-pdf');
        const files = input.files;
        const preview = document.getElementById('pdf-filename-preview');
        if (preview && files && files.length > 0) {
            if (files.length === 1) {
                preview.textContent = `📄 Seleccionado: ${files[0].name} (${(files[0].size / 1024).toFixed(1)} KB)`;
            } else {
                let totalSizeMb = 0;
                for (let i = 0; i < files.length; i++) totalSizeMb += files[i].size;
                totalSizeMb = (totalSizeMb / (1024 * 1024)).toFixed(2);
                preview.textContent = `📚 ${files.length} Certificados PDF seleccionados en lote (${totalSizeMb} MB total)`;
            }
        }
    } else if (type === 'excel') {
        const file = document.getElementById('input-file-excel').files[0];
        const preview = document.getElementById('excel-filename-preview');
        if (preview && file) preview.textContent = `📊 Seleccionado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    }
}

function filterCertificatesTable() {
    const textFilter = (document.getElementById('filter-certificados-input')?.value || '').toLowerCase().trim();
    const completitudFilter = document.getElementById('filter-completitud-select')?.value || 'TODOS';
    const rows = document.querySelectorAll('#tbody-certificados tr');

    let visibleCount = 0;
    rows.forEach(row => {
        // Ignorar fila de "No hay certificados"
        if (row.cells && row.cells.length <= 1) return;

        const rowText = row.textContent.toLowerCase();
        const matchesText = !textFilter || rowText.includes(textFilter);

        const tienePdf = row.getAttribute('data-tiene-pdf') === 'true';
        const tieneDni = row.getAttribute('data-tiene-dni') === 'true';
        const tieneEmail = row.getAttribute('data-tiene-email') === 'true';
        const tieneTel = row.getAttribute('data-tiene-tel') === 'true';
        const esIncompleto = row.getAttribute('data-incompleto') === 'true';

        let matchesCompletitud = true;
        if (completitudFilter === 'INCOMPLETOS') {
            matchesCompletitud = esIncompleto;
        } else if (completitudFilter === 'COMPLETOS') {
            matchesCompletitud = !esIncompleto;
        } else if (completitudFilter === 'SIN_DNI') {
            matchesCompletitud = !tieneDni;
        } else if (completitudFilter === 'SIN_PDF') {
            matchesCompletitud = !tienePdf;
        } else if (completitudFilter === 'SIN_CORREO') {
            matchesCompletitud = !tieneEmail;
        } else if (completitudFilter === 'SIN_TELEFONO') {
            matchesCompletitud = !tieneTel;
        }

        if (matchesText && matchesCompletitud) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
}

// LOGIN AUTHENTICATION HANDLERS CON CAMBIO OBLIGATORIO DE CONTRASEÑA EN BD
let pendingLoginUser = null;

async function handleUserLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const res = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Credenciales inválidas.');

        pendingLoginUser = data.user;

        // Si el usuario debe cambiar su contraseña obligatoriamente (primer ingreso o reset)
        if (data.debe_cambiar_password) {
            document.getElementById('change-pass-user-id').value = data.user.id;
            document.getElementById('modal-cambio-password').style.display = 'flex';
            return;
        }

        localStorage.setItem('homologa_user_session', JSON.stringify(data.user));
        iniciarSesionUsuario(data.user);
    } catch (err) {
        alert('Error de inicio de sesión: ' + err.message);
    }
}

async function handleObligatoryPasswordChange(e) {
    e.preventDefault();
    const userId = document.getElementById('change-pass-user-id').value;
    const pass1 = document.getElementById('modal-pass-nuevo').value;
    const pass2 = document.getElementById('modal-pass-confirm').value;

    if (pass1 !== pass2) {
        return alert('Las contraseñas no coinciden. Por favor verifique.');
    }

    try {
        const res = await fetch('/api/v1/auth/cambiar-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario_id: userId, password_nuevo: pass1 })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Error cambiando contraseña.');

        alert(data.message);
        document.getElementById('modal-cambio-password').style.display = 'none';

        if (pendingLoginUser) {
            pendingLoginUser.debe_cambiar_password = false;
            localStorage.setItem('homologa_user_session', JSON.stringify(pendingLoginUser));
            iniciarSesionUsuario(pendingLoginUser);
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function quickLogin(email, password) {
    document.getElementById('login-email').value = email;
    document.getElementById('login-password').value = password || 'Admin2026!';
    document.getElementById('formLogin').dispatchEvent(new Event('submit'));
}

function selectPresetLogo(logo) {
    document.getElementById('modal-logo').value = logo;
}

function esUsuarioEmpresa() {
    return Boolean(usuarioSesionActivo && usuarioSesionActivo.empresa_id);
}

function iniciarSesionUsuario(user) {
    usuarioSesionActivo = user;
    if (user.empresa_id) {
        empresaActivaId = user.empresa_id;
    }

    // Hide Login Screen, Show Main App
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-main-content').style.display = 'block';

    // Apply Corporate Branding to Header
    const logoIconElem = document.querySelector('.header-container .logo-icon');
    const logoTitleElem = document.querySelector('.header-container .logo-text h1');
    const logoSubElem = document.querySelector('.header-container .logo-text p');

    const isCompanyUser = (user.rol === 'CONTRATISTA' || user.rol === 'OPERADOR') && user.empresa_nombre;
    if (isCompanyUser) {
        if (logoIconElem) logoIconElem.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: #0f172a;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
        if (logoTitleElem) logoTitleElem.textContent = `Portal Contratista: ${user.empresa_nombre}`;
        if (logoSubElem) logoSubElem.textContent = user.rol === 'OPERADOR' 
            ? `Operador de Acreditación de Cuadrillas | ${user.email}` 
            : `Gestión y Homologación de Seguridad HSE | ${user.email}`;
    } else {
        if (logoIconElem) logoIconElem.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: #0f172a;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;
        if (logoTitleElem) logoTitleElem.textContent = 'HomologaControl Minería';
        if (logoSubElem) logoSubElem.textContent = 'Plataforma de Control Normativo D.S. 024-2016-EM & Acreditación de Cuadrillas';
    }

    // Render User Badge in Header
    const badgeBox = document.getElementById('user-session-badge');
    const roleIconSvg = user.rol === 'ADMINISTRADOR' 
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-gold);"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>`
        : (user.rol === 'SUPERVISOR' 
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-cyan);"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--success);"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`);

    const roleLabel = user.rol === 'ADMINISTRADOR' ? 'SUPER ADMIN' : (user.rol === 'SUPERVISOR' ? 'SUPERVISOR HSE' : (user.rol === 'CONTRATISTA' ? 'ADMIN EMPRESA' : 'OPERADOR'));
    const companyLabel = user.empresa_nombre ? user.empresa_nombre : 'Visión General Mina';
    
    badgeBox.innerHTML = `
        <div class="user-info-text">
            <strong style="display: inline-flex; align-items: center; gap: 5px;">${roleIconSvg} ${user.nombre_completo}</strong> 
            <span class="badge badge-info" style="font-size: 0.68rem; padding: 0.2rem 0.6rem;">${roleLabel}</span><br>
            <small style="color: var(--text-secondary); display: inline-flex; align-items: center; gap: 4px; margin-top: 2px;">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M19 21v-4"></path><path d="M19 13V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16"></path></svg>
                ${companyLabel}
            </small>
        </div>
        <button class="btn-logout" onclick="logoutUser()" style="display: inline-flex; align-items: center; gap: 5px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            <span>Cerrar Sesión</span>
        </button>
    `;

    // Apply Privileges according to User Role
    aplicarPrivilegiosRol(user.rol);

    // Initial Data Loads
    loadDashboardKPIs();
    loadCompanyProfiles();
    loadCertificados();
    loadAuditoriaList();
    if (user.rol !== 'OPERADOR') {
        loadUsuariosList();
    }
    if (user.rol === 'ADMINISTRADOR') {
        loadPowerBIPreview();
    }
}

function logoutUser() {
    localStorage.removeItem('homologa_user_session');
    usuarioSesionActivo = null;
    document.getElementById('app-main-content').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
}

// PRIVILEGES & UI ROLES ENFORCEMENT (RBAC)
function aplicarPrivilegiosRol(rol) {
    const btnAddEmp = document.getElementById('btn-open-company-modal');
    const btnEditEmp = document.getElementById('btn-edit-active-company');
    const tabSupervisorBtn = document.getElementById('tab-btn-supervisor');
    const tabUsuariosBtn = document.getElementById('tab-btn-usuarios');
    const tabSolicitudesBtn = document.getElementById('tab-btn-solicitudes');
    const tabPowerBIBtn = document.getElementById('tab-btn-powerbi');
    const scopeBar = document.getElementById('superadmin-scope-bar');

    // Si el usuario tiene una empresa específica asignada, NUNCA debe ver la barra de cambio de alcance global
    const esGlobal = !usuarioSesionActivo || !usuarioSesionActivo.empresa_id;

    if (scopeBar) {
        scopeBar.style.display = (esGlobal && (rol === 'ADMINISTRADOR' || rol === 'SUPERVISOR')) ? 'flex' : 'none';
    }

    if (rol === 'ADMINISTRADOR') {
        if (btnAddEmp) btnAddEmp.style.display = esGlobal ? 'inline-block' : 'none';
        if (btnEditEmp) btnEditEmp.style.display = 'inline-block';
        if (tabSupervisorBtn) tabSupervisorBtn.style.display = 'inline-block';
        if (tabUsuariosBtn) tabUsuariosBtn.style.display = 'inline-block';
        if (tabSolicitudesBtn) tabSolicitudesBtn.style.display = 'inline-block';
        if (tabPowerBIBtn) tabPowerBIBtn.style.display = 'inline-block';
    } else if (rol === 'SUPERVISOR') {
        if (btnAddEmp) btnAddEmp.style.display = 'none';
        if (btnEditEmp) btnEditEmp.style.display = 'none';
        if (tabSupervisorBtn) tabSupervisorBtn.style.display = 'inline-block';
        if (tabUsuariosBtn) tabUsuariosBtn.style.display = 'none';
        if (tabSolicitudesBtn) tabSolicitudesBtn.style.display = 'inline-block';
        if (tabPowerBIBtn) tabPowerBIBtn.style.display = 'none';
    } else if (rol === 'CONTRATISTA') {
        if (btnAddEmp) btnAddEmp.style.display = 'none';
        if (btnEditEmp) btnEditEmp.style.display = 'none';
        if (tabSupervisorBtn) tabSupervisorBtn.style.display = 'none';
        if (tabUsuariosBtn) tabUsuariosBtn.style.display = 'inline-block'; // Admin de empresa administra usuarios de su contratista
        if (tabSolicitudesBtn) tabSolicitudesBtn.style.display = 'inline-block'; // Admin de empresa también gestiona solicitudes de su personal
        if (tabPowerBIBtn) tabPowerBIBtn.style.display = 'none';
    } else if (rol === 'OPERADOR') {
        if (btnAddEmp) btnAddEmp.style.display = 'none';
        if (btnEditEmp) btnEditEmp.style.display = 'none';
        if (tabSupervisorBtn) tabSupervisorBtn.style.display = 'none';
        if (tabUsuariosBtn) tabUsuariosBtn.style.display = 'none'; // OPERADOR DE CARGA NO TIENE ACCESO A USUARIOS & ROLES
        if (tabSolicitudesBtn) tabSolicitudesBtn.style.display = 'none';
        if (tabPowerBIBtn) tabPowerBIBtn.style.display = 'none';
    }
    actualizarBadgeSolicitudesPendientes();
}

// ==============================================================================
// GESTIÓN DE USUARIOS Y ROLES (ADMINISTRACIÓN DE ACCESOS EN BD REAL)
// ==============================================================================

async function loadUsuariosList() {
    try {
        let url = '/api/v1/usuarios';
        if (usuarioSesionActivo && usuarioSesionActivo.rol === 'CONTRATISTA' && usuarioSesionActivo.empresa_id) {
            url += '?empresa_id=' + usuarioSesionActivo.empresa_id;
        }

        const res = await fetch(url);
        const users = await res.json();

        const tbody = document.getElementById('tbody-usuarios');
        if (!tbody) return;

        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 2rem;">No hay usuarios registrados aún para esta empresa.</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(u => {
            const roleBadge = u.rol === 'ADMINISTRADOR' ? 'badge-warning' : (u.rol === 'SUPERVISOR' ? 'badge-info' : 'badge-success');
            const empresaStr = u.empresa_nombre ? `${u.empresa_logo || '🏢'} ${u.empresa_nombre}` : '🏛️ Acceso Global (Todas)';
            const passStatusBadge = u.debe_cambiar_password 
                ? `<span class="badge badge-danger" style="font-size: 0.65rem; margin-left: 0.3rem;">🔐 Cambio Pendiente</span>`
                : `<span class="badge badge-success" style="font-size: 0.65rem; margin-left: 0.3rem;">✓ Clave Privada</span>`;
            return `
                <tr>
                    <td><strong>${u.nombre_completo}</strong> ${passStatusBadge}</td>
                    <td><code>${u.email}</code></td>
                    <td><span class="badge ${roleBadge}">${u.rol}</span></td>
                    <td><small style="color: var(--text-primary); font-weight: 600;">${empresaStr}</small></td>
                    <td>${u.cargo || 'Gestor'}</td>
                    <td><small style="color: var(--text-secondary);">${u.ultimo_login ? new Date(u.ultimo_login).toLocaleString() : 'Pendiente'}</small></td>
                    <td>
                        <div class="table-btn-group">
                            <button class="table-btn-action table-btn-edit" onclick="openEditUserModal('${u.id}')" title="Editar Usuario">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                <span>Editar</span>
                            </button>
                            <button class="table-btn-action table-btn-reset" onclick="resetUserPassword('${u.id}')" title="Restablecer Contraseña">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 14"></polyline></svg>
                                <span>Reset Clave</span>
                            </button>
                            ${u.rol !== 'ADMINISTRADOR' ? `
                            <button class="table-btn-action table-btn-delete" onclick="deleteUser('${u.id}')" title="Eliminar Acceso">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                <span>Eliminar</span>
                            </button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error cargando usuarios:', err);
    }
}

async function resetUserPassword(userId) {
    const tempPass = prompt('Ingrese la nueva contraseña temporal para este usuario:', 'Temp2026!');
    if (!tempPass) return;

    try {
        const res = await fetch(`/api/v1/usuarios/${userId}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password_temporal: tempPass })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Error al reiniciar contraseña.');

        alert(data.message);
        loadUsuariosList();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function openUserModal() {
    document.getElementById('modal-usuario-id').value = '';
    document.getElementById('modal-usuario-title').textContent = (usuarioSesionActivo && usuarioSesionActivo.rol === 'CONTRATISTA')
        ? '➕ Registrar Nuevo Usuario / Responsable de Su Empresa'
        : '➕ Registrar Nuevo Usuario y Asignar Rol';
    document.getElementById('formUsuarioModal').reset();

    const selectEmpresa = document.getElementById('modal-user-empresa');
    const selectRol = document.getElementById('modal-user-rol');

    // Populate Companies dropdown
    const res = await fetch('/api/v1/empresas');
    const empresas = await res.json();

    if (usuarioSesionActivo && usuarioSesionActivo.rol === 'CONTRATISTA' && usuarioSesionActivo.empresa_id) {
        const empPropia = empresas.find(e => e.id === usuarioSesionActivo.empresa_id);
        selectEmpresa.innerHTML = `<option value="${usuarioSesionActivo.empresa_id}" selected>${empPropia ? (empPropia.logo_icon + ' ' + empPropia.razon_social) : 'Su Empresa Contratista'}</option>`;
        selectEmpresa.disabled = true;

        selectRol.innerHTML = `
            <option value="OPERADOR" selected>📄 OPERADOR DE CARGA (Solo Subir Certificados - Sin Acceso a Usuarios)</option>
            <option value="CONTRATISTA">🏗️ GESTOR DE EMPRESA (Admin de Empresa - Con Acceso a Usuarios)</option>
        `;
        selectRol.disabled = false;
    } else {
        selectEmpresa.innerHTML = `<option value="">🏛️ Acceso Global (Sin Restricción por Empresa)</option>` + 
            empresas.map(e => `<option value="${e.id}">${e.logo_icon || '🏢'} ${e.razon_social}</option>`).join('');
        selectEmpresa.disabled = false;

        selectRol.innerHTML = `
            <option value="ADMINISTRADOR">👑 ADMINISTRADOR GENERAL (Acceso Total Global)</option>
            <option value="SUPERVISOR">🔍 SUPERVISOR AUDITOR HSE (Auditoría & Aprobación)</option>
            <option value="CONTRATISTA">🏗️ GESTOR DE EMPRESA (Admin de Empresa - Con Acceso a Usuarios)</option>
            <option value="OPERADOR" selected>📄 OPERADOR DE CARGA (Solo Subir Certificados - Sin Acceso a Usuarios)</option>
        `;
        selectRol.disabled = false;
    }

    document.getElementById('modal-usuario').style.display = 'flex';
}

async function openEditUserModal(userId) {
    const res = await fetch('/api/v1/usuarios');
    const users = await res.json();
    const u = users.find(x => x.id === userId);
    if (!u) return alert('Usuario no encontrado.');

    document.getElementById('modal-usuario-id').value = u.id;
    document.getElementById('modal-usuario-title').textContent = `✏️ Editar Usuario: ${u.nombre_completo}`;
    document.getElementById('modal-user-nombre').value = u.nombre_completo;
    document.getElementById('modal-user-email').value = u.email;
    document.getElementById('modal-user-password').value = '';
    document.getElementById('modal-user-cargo').value = u.cargo || '';

    const resEmp = await fetch('/api/v1/empresas');
    const empresas = await resEmp.json();
    const selectEmpresa = document.getElementById('modal-user-empresa');
    const selectRol = document.getElementById('modal-user-rol');

    if (usuarioSesionActivo && usuarioSesionActivo.rol === 'CONTRATISTA') {
        const empPropia = empresas.find(e => e.id === usuarioSesionActivo.empresa_id);
        selectEmpresa.innerHTML = `<option value="${usuarioSesionActivo.empresa_id}" selected>${empPropia ? (empPropia.logo_icon + ' ' + empPropia.razon_social) : 'Su Empresa Contratista'}</option>`;
        selectEmpresa.disabled = true;

        selectRol.innerHTML = `
            <option value="OPERADOR" ${u.rol === 'OPERADOR' ? 'selected' : ''}>📄 OPERADOR DE CARGA (Solo Subir Certificados - Sin Acceso a Usuarios)</option>
            <option value="CONTRATISTA" ${u.rol === 'CONTRATISTA' ? 'selected' : ''}>🏗️ GESTOR DE EMPRESA (Admin de Empresa - Con Acceso a Usuarios)</option>
        `;
        selectRol.disabled = false;
    } else {
        selectEmpresa.innerHTML = `<option value="">🏛️ Acceso Global (Sin Restricción por Empresa)</option>` + 
            empresas.map(e => `<option value="${e.id}" ${e.id === u.empresa_id ? 'selected' : ''}>${e.logo_icon || '🏢'} ${e.razon_social}</option>`).join('');
        selectEmpresa.disabled = false;

        selectRol.innerHTML = `
            <option value="ADMINISTRADOR" ${u.rol === 'ADMINISTRADOR' ? 'selected' : ''}>👑 ADMINISTRADOR GENERAL (Acceso Total Global)</option>
            <option value="SUPERVISOR" ${u.rol === 'SUPERVISOR' ? 'selected' : ''}>🔍 SUPERVISOR AUDITOR HSE (Auditoría & Aprobación)</option>
            <option value="CONTRATISTA" ${u.rol === 'CONTRATISTA' ? 'selected' : ''}>🏗️ GESTOR DE EMPRESA (Admin de Empresa - Con Acceso a Usuarios)</option>
            <option value="OPERADOR" ${u.rol === 'OPERADOR' ? 'selected' : ''}>📄 OPERADOR DE CARGA (Solo Subir Certificados - Sin Acceso a Usuarios)</option>
        `;
        selectRol.disabled = false;
    }

    document.getElementById('modal-usuario').style.display = 'flex';
}

function closeUserModal() {
    document.getElementById('modal-usuario').style.display = 'none';
}

async function handleSaveUser(e) {
    e.preventDefault();
    const id = document.getElementById('modal-usuario-id').value;
    const selectEmpresa = document.getElementById('modal-user-empresa');
    const selectRol = document.getElementById('modal-user-rol');

    const targetEmpresaId = (usuarioSesionActivo && usuarioSesionActivo.rol === 'CONTRATISTA')
        ? usuarioSesionActivo.empresa_id
        : (selectEmpresa.value || null);

    const targetRol = selectRol.value;

    const bodyData = {
        nombre_completo: document.getElementById('modal-user-nombre').value,
        email: document.getElementById('modal-user-email').value,
        password: document.getElementById('modal-user-password').value || 'demo123',
        rol: targetRol,
        empresa_id: targetEmpresaId,
        cargo: document.getElementById('modal-user-cargo').value
    };

    try {
        const url = id ? `/api/v1/usuarios/${id}` : '/api/v1/usuarios';
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Error guardando usuario');

        alert(data.message || 'Usuario y Rol guardado en BD exitosamente.');
        closeUserModal();
        loadUsuariosList();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function deleteUser(userId) {
    if (!confirm('¿Está seguro de eliminar este usuario de la Base de Datos?')) return;
    try {
        const res = await fetch(`/api/v1/usuarios/${userId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al eliminar usuario.');
        alert('Usuario eliminado correctamente.');
        loadUsuariosList();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// RBAC Role Switcher Handler
function switchUserRole(role) {
    rolUsuarioActivo = role;
    const banner = document.getElementById('active-company-banner');
    loadCompanyProfiles();
    loadCertificados();
    alert(`🔑 Rol cambiado a: ${role}. La interfaz ha actualizado los permisos corporativos.`);
}

// Company Modal Handlers (CRUD BD Real)
function openCompanyModal() {
    document.getElementById('modal-empresa-id').value = '';
    document.getElementById('modal-empresa-title').textContent = '➕ Registrar Nueva Empresa Contratista';
    document.getElementById('formEmpresaModal').reset();
    document.getElementById('modal-empresa').style.display = 'flex';
}

function openEditActiveCompanyModal() {
    const activeEmp = empresasCache.find(e => e.id === empresaActivaId);
    if (!activeEmp) return alert('Seleccione una empresa primero.');

    document.getElementById('modal-empresa-id').value = activeEmp.id;
    document.getElementById('modal-empresa-title').textContent = `✏️ Editar Empresa: ${activeEmp.razon_social}`;
    document.getElementById('modal-ruc').value = activeEmp.ruc_rut || '';
    document.getElementById('modal-razon').value = activeEmp.razon_social || '';
    document.getElementById('modal-comercial').value = activeEmp.nombre_comercial || '';
    document.getElementById('modal-logo').value = activeEmp.logo_icon || '🏢';
    document.getElementById('modal-email').value = activeEmp.email_contacto || activeEmp.email || '';
    document.getElementById('modal-telefono').value = activeEmp.telefono_contacto || '';
    document.getElementById('modal-persona').value = activeEmp.contacto_persona || '';
    document.getElementById('modal-rubro').value = activeEmp.rubro || '';
    document.getElementById('modal-direccion').value = activeEmp.direccion || '';

    document.getElementById('modal-empresa').style.display = 'flex';
}

function closeCompanyModal() {
    document.getElementById('modal-empresa').style.display = 'none';
}

async function handleSaveCompany(e) {
    e.preventDefault();
    const id = document.getElementById('modal-empresa-id').value;
    const bodyData = {
        ruc_rut: document.getElementById('modal-ruc').value,
        razon_social: document.getElementById('modal-razon').value,
        nombre_comercial: document.getElementById('modal-comercial').value,
        logo_icon: document.getElementById('modal-logo').value,
        email_contacto: document.getElementById('modal-email').value,
        telefono_contacto: document.getElementById('modal-telefono').value,
        contacto_persona: document.getElementById('modal-persona').value,
        rubro: document.getElementById('modal-rubro').value,
        direccion: document.getElementById('modal-direccion').value
    };

    try {
        const url = id ? `/api/v1/empresas/${id}` : '/api/v1/empresas';
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });
        const result = await res.json();

        if (!res.ok) throw new Error(result.error || 'Error al guardar empresa');

        alert(result.message || 'Empresa guardada en BD exitosamente.');
        closeCompanyModal();
        loadCompanyProfiles();
        loadDashboardKPIs();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

// Tab Switching Logic
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');

    if (tabId === 'dashboard') loadDashboardKPIs();
    if (tabId === 'kiosko') initTabKiosko();
    if (tabId === 'contratista') {
        loadCertificados();
    }
    if (tabId === 'supervisor') loadAuditoriaList();
    if (tabId === 'solicitudes') loadSolicitudesCorreccion();
    if (tabId === 'cron') loadAlertasLog();
    if (tabId === 'powerbi') loadPowerBIPreview();
}

// 1. Load Dashboard KPIs & Render Chart
async function loadDashboardKPIs() {
    try {
        let url = '/api/v1/dashboard/kpis';
        const empTarget = esUsuarioEmpresa() ? usuarioSesionActivo.empresa_id : superAdminScopeCompanyId;
        if (empTarget) {
            url += '?empresa_id=' + empTarget;
        }

        const res = await fetch(url);
        const data = await res.json();

        const isCompany = Boolean(empTarget);
        document.getElementById('kpi-empresas').textContent = isCompany ? '1' : data.totalEmpresas;
        document.getElementById('kpi-habilitados').textContent = data.habilitados;
        document.getElementById('kpi-proximos').textContent = data.proximosVencer;
        document.getElementById('kpi-inhabilitados').textContent = data.inhabilitados;
        document.getElementById('badge-cumplimiento-global').textContent = isCompany 
            ? `Cumplimiento de Empresa Seleccionada: ${data.tasaCumplimiento}%` 
            : `Cumplimiento Global: ${data.tasaCumplimiento}%`;

        // Render Table per Company with High-End Progress Bar
        const tbody = document.getElementById('tbody-empresas-kpi');
        tbody.innerHTML = data.resumenEmpresas.map(emp => {
            const barClass = emp.cumplimiento >= 80 ? 'green' : (emp.cumplimiento >= 50 ? 'amber' : 'red');
            const textColor = emp.cumplimiento >= 80 ? '#34d399' : (emp.cumplimiento >= 50 ? '#fbbf24' : '#fb7185');
            return `
                <tr>
                    <td><strong>${emp.empresa}</strong></td>
                    <td><strong style="color: var(--text-primary); font-size: 0.95rem;">${emp.total}</strong></td>
                    <td><span class="badge badge-success">✓ ${emp.habilitados}</span></td>
                    <td><span class="badge badge-warning">⚠️ ${emp.proximos}</span></td>
                    <td><span class="badge badge-danger">⛔ ${emp.inhabilitados}</span></td>
                    <td>
                        <div class="progress-bar-container">
                            <div class="progress-track">
                                <div class="progress-fill ${barClass}" style="width: ${emp.cumplimiento}%"></div>
                            </div>
                            <span class="progress-text" style="color: ${textColor}">${emp.cumplimiento}%</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Render Donut Chart
        renderChart(data.habilitados, data.proximosVencer, data.inhabilitados);
    } catch (err) {
        console.error('Error loading KPIs:', err);
    }
}

function renderChart(hab, prox, inhab) {
    const ctx = document.getElementById('chartStatus').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Habilitado (Acceso Autorizado)', 'Próximo a Vencer (≤90d Alerta)', 'Inhabilitado (Restringido)'],
            datasets: [{
                data: [hab, prox, inhab],
                backgroundColor: ['#10b981', '#f59e0b', '#f43f5e'],
                borderColor: '#0f172a',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#f8fafc', font: { family: 'Inter', weight: '700' } } }
            }
        }
    });
}

// 1.5 Load Company Profiles & Handle Switcher
async function loadCompanyProfiles() {
    try {
        let url = '/api/v1/empresas';
        if (esUsuarioEmpresa()) {
            url += '?empresa_id=' + usuarioSesionActivo.empresa_id;
        }

        const res = await fetch(url);
        empresasCache = await res.json();

        // Populate Super Admin Scope & Auditoría dropdowns
        const scopeSelect = document.getElementById('select-global-scope-company');
        const auditEmpSelect = document.getElementById('filter-audit-empresa');

        if (scopeSelect && Array.isArray(empresasCache)) {
            scopeSelect.innerHTML = `<option value="">🏛️ VISIÓN GLOBAL DE LA MINA (Todas las Empresas Proveedoras)</option>` + 
                empresasCache.map(e => `<option value="${e.id}" ${e.id === superAdminScopeCompanyId ? 'selected' : ''}>${e.logo_icon || '🏢'} ${e.razon_social}</option>`).join('');
        }

        if (auditEmpSelect && Array.isArray(empresasCache)) {
            const currentVal = auditEmpSelect.value;
            auditEmpSelect.innerHTML = `<option value="">🏢 Todas las Contratistas</option>` + 
                empresasCache.map(e => `<option value="${e.id}" ${e.id === currentVal ? 'selected' : ''}>${e.logo_icon || '🏢'} ${e.razon_social}</option>`).join('');
        }

        const grid = document.getElementById('company-profiles-grid');
        const secTitle = document.getElementById('company-section-title');
        const secDesc = document.getElementById('company-section-desc');
        const secCard = document.getElementById('company-section-card');

        if (esUsuarioEmpresa()) {
            if (secCard) secCard.style.display = 'none'; // Ocultar bloque redundante de empresa para cualquier rol de contratista
        } else {
            if (secCard) secCard.style.display = 'block';
            if (grid) grid.style.display = 'grid';
            if (secDesc) secDesc.style.display = 'block';
            if (secTitle) secTitle.textContent = '🏢 Perfiles de Empresas Proveedoras / Contratistas Mineras';

            if (grid) {
                grid.innerHTML = empresasCache.map(emp => {
                    const isActive = emp.id === (superAdminScopeCompanyId || empresaActivaId);
                    return `
                        <div class="company-card ${isActive ? 'active' : ''}" onclick="selectCompanyProfile('${emp.id}')">
                            <div class="company-logo">${emp.logo_icon || '🏢'}</div>
                            <div class="company-details">
                                <h3>${emp.nombre_comercial || emp.razon_social}</h3>
                                <p><strong>RUC:</strong> ${emp.ruc_rut} | ${emp.rubro || 'Contratista Minero'}</p>
                                <div class="company-meta-tags">
                                    <span class="badge badge-info">${emp.total_trabajadores} Personal</span>
                                    <span class="badge badge-success">${emp.trabajadores_habilitados} Habilitados</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        updateActiveCompanyBanner();
    } catch (err) {
        console.error('Error loading company profiles:', err);
    }
}

function selectCompanyProfile(empId) {
    empresaActivaId = empId;
    loadCompanyProfiles();
    loadCertificados(); // Filter certificates by active company
}

function updateActiveCompanyBanner() {
    const activeEmp = empresasCache.find(e => e.id === empresaActivaId) || empresasCache[0];
    if (!activeEmp) return;

    const banner = document.getElementById('active-company-banner');
    if (banner) {
        banner.style.display = 'flex';
        document.getElementById('banner-logo').textContent = activeEmp.logo_icon || '🏢';
        document.getElementById('banner-razon-social').textContent = activeEmp.razon_social;
        document.getElementById('banner-details').textContent = `RUC: ${activeEmp.ruc_rut} | Rubro: ${activeEmp.rubro || 'Contratista Minero'} | Contacto: ${activeEmp.contacto_persona || 'Gestor HSE'}`;
        
        const emailOficial = activeEmp.email_contacto || activeEmp.email || 'contacto@empresa.com';
        const telefonoOficial = activeEmp.telefono_contacto || '+51 900000000';
        document.getElementById('banner-contacts').innerHTML = `✉️ Correo Oficial: <code>${emailOficial}</code> | 📞 Teléfono: <strong>${telefonoOficial}</strong>`;
        document.getElementById('banner-worker-count').textContent = `👥 ${activeEmp.total_trabajadores || 0} Trabajadores Registrados`;
    }
}

// 3. Handle PDF Smart OCR Upload (Multi-PDF Batch & Single)
async function handleCertificateUpload(e) {
    e.preventDefault();
    const fileInput = document.getElementById('input-file-pdf');
    const files = fileInput.files;
    if (!files || files.length === 0) {
        return alert('Por favor seleccione al menos un archivo PDF.');
    }

    const submitBtn = document.getElementById('btn-submit-pdf');
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
            <span>Analizando y Extrayendo OCR (${files.length} archivo${files.length > 1 ? 's' : ''})...</span>
        `;
        submitBtn.style.opacity = '0.75';
    }

    const ocrBox = document.getElementById('ocr-console');
    const ocrText = document.getElementById('ocr-output-text');
    const badgeCount = document.getElementById('ocr-batch-count-badge');
    ocrBox.style.display = 'block';
    ocrText.innerHTML = '<span style="color: var(--accent-cyan);">Iniciando reconocimiento óptico minero D.S. 024-2016-EM...</span>';

    try {
        const empTarget = esUsuarioEmpresa() ? usuarioSesionActivo.empresa_id : (empresaActivaId || '');

        if (files.length === 1) {
            // Flujo Individual
            const formData = new FormData();
            formData.append('pdfFile', files[0]);
            if (empTarget) formData.append('empresa_id', empTarget);

            const res = await fetch('/api/v1/certificados/upload', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Error procesando archivo PDF.');

            const bd = result.datos_vinculados_bd;
            const meta = result.metadatos_extraidos_pdf;

            const badgeNuevo = result.discrepancia_detectada
                ? `<div style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; padding: 0.6rem 0.9rem; border-radius: 8px; font-weight: 600; font-size: 0.82rem; margin-bottom: 0.75rem; border: 1px solid rgba(245, 158, 11, 0.3);">
                    Alerta de Verificación HSE: El nombre extraído en el PDF difiere parcialmente de la Ficha Maestra en BD.
                   </div>`
                : (result.es_nuevo_trabajador 
                    ? `<span class="badge badge-success" style="font-size: 0.78rem; margin-bottom: 0.5rem; display: inline-block;">Nuevo Trabajador Registrado en BD</span><br>`
                    : `<span class="badge badge-info" style="font-size: 0.78rem; margin-bottom: 0.5rem; display: inline-block;">Trabajador Existente Vinculado en BD</span><br>`);

            const careceDni = result.requiere_regularizar_dni || !result.dni_extraido_en_pdf;
            const bannerDniAlerta = careceDni ? `
                <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; color: #fbbf24; font-size: 0.85rem;">
                    ⚠️ <strong>Aviso de Identificación:</strong> Este certificado digital no contiene número de DNI impreso (solo el nombre). El sistema asignó un documento temporal (<code>${bd.trabajador_documento}</code>). 
                    Por favor haga clic abajo en <strong>[ ⚠️ Completar DNI Real ]</strong> para colocar su DNI auténtico.
                </div>
            ` : '';

            const careceTel = !bd.trabajador_telefono || bd.trabajador_telefono === '+51 987654321' || bd.trabajador_telefono === '+51 900000000';
            const careceEmail = !bd.trabajador_email_personal || bd.trabajador_email_personal.includes('powered@') || bd.trabajador_email_personal.includes('operario.');
            
            const bannerTelAlerta = careceTel ? `
                <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; color: #fbbf24; font-size: 0.85rem;">
                    📞 <strong>Teléfono de Contacto No Detectado:</strong> Este certificado digital no incluye número de celular. Por favor ingrese el número telefónico del empleado para alertas SMS/WhatsApp de habilitación.
                </div>
            ` : '';

            const bannerEmailAlerta = careceEmail ? `
                <div style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; color: #38bdf8; font-size: 0.85rem;">
                    ✉️ <strong>Correo Electrónico No Detectado:</strong> El diploma no contiene correo del trabajador. Ingréselo para que pueda recibir su constancia digital oficial.
                </div>
            ` : '';

            ocrText.innerHTML = `
                ${badgeNuevo}
                ${bannerDniAlerta}
                ${bannerTelAlerta}
                ${bannerEmailAlerta}
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 5px;">
                    <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                        <small style="color: var(--text-secondary); display: block;">Trabajador / DNI</small>
                        <strong style="color: #fff;">${bd.trabajador_nombres}</strong>
                        <div style="color: ${careceDni ? 'var(--accent-amber)' : 'var(--accent-cyan)'}; font-size: 0.8rem; font-family: monospace;">
                            DNI: ${bd.trabajador_documento} ${careceDni ? '<span style="font-size: 0.72rem; background: #f59e0b; color: #000; padding: 1px 4px; border-radius: 3px; font-weight: bold; margin-left: 4px;">Temporal</span>' : ''}
                        </div>
                    </div>
                    <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                        <small style="color: var(--text-secondary); display: block;">Curso Acreditado</small>
                        <strong style="color: var(--accent-amber);">${meta.curso}</strong>
                        <div style="color: var(--text-secondary); font-size: 0.8rem;">${meta.horas} Horas &bull; ${meta.entidad}</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                        <small style="color: var(--text-secondary); display: block;">Vigencia D.S. 024-2016-EM</small>
                        <strong style="color: var(--success);">${meta.fecha_vencimiento_calculada}</strong>
                        <div style="color: var(--text-secondary); font-size: 0.8rem;">Emisión: ${meta.fecha_emision}</div>
                    </div>
                </div>
                <div style="margin-top: 10px; font-size: 0.8rem; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div>
                        Empresa: <strong>${bd.empresa_razon_social}</strong> &bull; Correo: <strong>${bd.trabajador_email_personal ? `<code>${bd.trabajador_email_personal}</code>` : '<span style="color: #38bdf8;">(No Registrado)</span>'}</strong> &bull; Teléfono: <strong>${bd.trabajador_telefono ? bd.trabajador_telefono : '<span style="color: #fbbf24;">(No Registrado)</span>'}</strong>
                    </div>
                    <button type="button" class="btn-primary" style="font-size: 0.78rem; padding: 4px 12px; ${(careceDni || careceTel || careceEmail) ? 'background: #f59e0b; color: #000; font-weight: bold; border: 1px solid #fbbf24;' : 'background: rgba(56, 189, 248, 0.2); border: 1px solid #38bdf8; color: #38bdf8;'}" onclick="abrirModalEditarTrabajador('${bd.trabajador_id}')">
                        ${careceDni ? '⚠️ Completar DNI' : (careceEmail ? '✉️ Registrar Correo' : (careceTel ? '📞 Registrar Teléfono' : '✏️ Editar Ficha'))}
                    </button>
                </div>
            `;
            if (badgeCount) badgeCount.style.display = 'none';

        } else {
            // Flujo Multi-PDF Batch
            const formData = new FormData();
            for (let i = 0; i < files.length; i++) {
                formData.append('pdfFiles', files[i]);
            }
            if (empTarget) formData.append('empresa_id', empTarget);

            const res = await fetch('/api/v1/certificados/upload-batch', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Error en procesamiento multi-PDF.');

            if (badgeCount) {
                badgeCount.style.display = 'inline-block';
                badgeCount.textContent = `${result.total_procesados} / ${result.total_recibidos} Procesados`;
            }

            let filasResultados = '';
            (result.resultados || []).forEach((item, idx) => {
                if (item.error) {
                    filasResultados += `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <td style="padding: 6px 10px; color: var(--text-secondary); font-size: 0.8rem;">${idx + 1}</td>
                            <td style="padding: 6px 10px; font-size: 0.8rem; color: #fff;">${item.archivo}</td>
                            <td colspan="4" style="padding: 6px 10px; font-size: 0.8rem; color: var(--danger);">No se pudo extraer: ${item.error}</td>
                        </tr>
                    `;
                } else {
                    const trabNombre = item.trabajador_nombre || (item.trabajador ? item.trabajador.nombres : 'Trabajador');
                    const trabDni = item.trabajador_dni || (item.trabajador ? item.trabajador.documento : 'S/D');
                    const trabId = item.trabajador_id || (item.trabajador ? item.trabajador.id : '');
                    const certCurso = item.curso_reconocido || (item.certificado ? item.certificado.curso : 'Curso Normativo');
                    const certHoras = item.horas || (item.certificado ? item.certificado.horas : '16');
                    const certEntidad = item.entidad_emisora || (item.certificado ? item.certificado.entidad : 'Certificadora');
                    const certEmision = item.fecha_emision || (item.certificado ? item.certificado.fecha_emision : '-');
                    const certVenc = item.fecha_vencimiento || (item.certificado ? item.certificado.fecha_vencimiento : '-');
                    const pdfFile = item.pdf_filename || '';

                    const esNuevo = item.estado === 'NUEVO_TRABAJADOR' || item.es_nuevo_trabajador;
                    const tagNuevo = esNuevo
                        ? `<span class="badge badge-success" style="font-size: 0.7rem; padding: 2px 6px;">Nuevo</span>`
                        : `<span class="badge badge-info" style="font-size: 0.7rem; padding: 2px 6px;">Existente</span>`;
                    
                    const careceDni = item.requiere_regularizar_dni || !item.dni_extraido_en_pdf;
                    const tagDni = careceDni
                        ? `<span class="badge badge-warning" style="font-size: 0.68rem; padding: 1px 5px;" title="El certificado PDF no traía DNI impreso. Se asignó ID provisional.">⚠️ DNI Pendiente</span>`
                        : `<span class="badge badge-success" style="font-size: 0.68rem; padding: 1px 5px;">✓ DNI PDF</span>`;
                    
                    const careceTel = !item.trabajador_telefono || item.trabajador_telefono === '+51 987654321' || item.trabajador_telefono === '+51 900000000';
                    const tagTel = careceTel
                        ? `<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 0.68rem; padding: 1px 5px;" title="Sin teléfono">⚠️ Sin Teléfono</span>`
                        : `<small style="color: var(--success); font-size: 0.72rem; display: block;">📞 ${item.trabajador_telefono}</small>`;
                    
                    filasResultados += `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); ${(careceDni || careceTel) ? 'background: rgba(245, 158, 11, 0.04);' : ''}">
                            <td style="padding: 6px 10px; color: var(--text-secondary); font-size: 0.8rem;">${idx + 1}</td>
                            <td style="padding: 6px 10px; font-size: 0.82rem; font-weight: 600; color: #fff;">
                                ${trabNombre}<br>
                                <small style="color: ${careceDni ? 'var(--accent-amber)' : 'var(--accent-cyan)'}; font-family: monospace;">Doc: ${trabDni}</small> ${tagNuevo} ${tagDni} ${careceTel ? tagTel : ''}
                                ${!careceTel ? tagTel : ''}
                            </td>
                            <td style="padding: 6px 10px; font-size: 0.82rem; color: var(--accent-amber);">
                                <strong>${certCurso}</strong><br>
                                <small style="color: var(--text-secondary);">${certHoras}h &bull; ${certEntidad}</small>
                            </td>
                            <td style="padding: 6px 10px; font-size: 0.8rem; color: var(--text-secondary);">
                                Emisión: ${certEmision}<br>
                                <strong style="color: var(--success);">Vence: ${certVenc}</strong>
                            </td>
                            <td style="padding: 6px 10px; font-size: 0.8rem;">
                                <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                                    ${pdfFile ? `
                                        <button type="button" class="table-btn-action" style="padding: 3px 6px; font-size: 0.72rem; background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.4); color: #f87171;" onclick="abrirVisorPDF('${pdfFile}', '${certCurso.replace(/'/g, "\\'")}', '${trabNombre.replace(/'/g, "\\'")}')" title="Ver Certificado PDF">
                                            📄 PDF
                                        </button>
                                    ` : ''}
                                    ${trabId ? `
                                        <button type="button" class="table-btn-action" style="padding: 3px 6px; font-size: 0.72rem; ${(careceDni || careceTel) ? 'background: rgba(245, 158, 11, 0.25); border-color: #f59e0b; color: #fbbf24; font-weight: bold;' : 'background: rgba(56, 189, 248, 0.2); border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;'}" onclick="abrirModalEditarTrabajador('${trabId}')" title="${careceDni ? 'Completar DNI Real de este Trabajador' : (careceTel ? 'Registrar Teléfono' : 'Editar Información')}">
                                            ${careceDni ? '⚠️ Completar DNI' : (careceTel ? '📞 Registrar Tel' : '✏️ Editar')}
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `;
                }
            });

            const totalSinDni = (result.resultados || []).filter(r => r.requiere_regularizar_dni).length;
            const totalSinTel = (result.resultados || []).filter(r => r.requiere_regularizar_telefono).length;
            const totalSinEmail = (result.resultados || []).filter(r => !r.trabajador_email || r.trabajador_email.includes('powered@') || r.trabajador_email.includes('operario.')).length;

            const bannerSinDni = totalSinDni > 0 ? `
                <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <strong style="color: #fbbf24; font-size: 0.88rem;">⚠️ ${totalSinDni} Certificado(s) subido(s) no incluían DNI impreso en el PDF</strong>
                        <div style="color: var(--text-secondary); font-size: 0.78rem;">El sistema registró la ficha por nombre. Haga clic en <strong>[ ⚠️ Completar DNI ]</strong> para registrar el documento oficial de cada trabajador.</div>
                    </div>
                </div>
            ` : '';

            const bannerSinTel = totalSinTel > 0 ? `
                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <strong style="color: #fbbf24; font-size: 0.88rem;">📞 ${totalSinTel} Trabajador(es) sin número de celular registrado</strong>
                        <div style="color: var(--text-secondary); font-size: 0.78rem;">Los certificados PDF no incluían teléfono. Use el botón <strong>[ 📞 Registrar Tel ]</strong> para agregarlo para alertas directas.</div>
                    </div>
                </div>
            ` : '';

            const bannerSinEmail = totalSinEmail > 0 ? `
                <div style="background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <strong style="color: #38bdf8; font-size: 0.88rem;">✉️ ${totalSinEmail} Trabajador(es) sin correo electrónico</strong>
                        <div style="color: var(--text-secondary); font-size: 0.78rem;">Haga clic en <strong>[ ✏️ Editar ]</strong> en la fila para registrar el correo y enviarles la acreditación digital.</div>
                    </div>
                </div>
            ` : '';

            ocrText.innerHTML = `
                ${bannerSinDni}
                ${bannerSinTel}
                ${bannerSinEmail}
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px;">
                    <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 6px; text-align: center;">
                        <small style="color: var(--text-secondary); display: block;">Total PDFs</small>
                        <strong style="color: #fff; font-size: 1.1rem;">${result.total_recibidos}</strong>
                    </div>
                    <div style="background: rgba(16, 185, 129, 0.1); padding: 8px; border-radius: 6px; text-align: center; border: 1px solid rgba(16, 185, 129, 0.2);">
                        <small style="color: #a7f3d0; display: block;">Procesados</small>
                        <strong style="color: #34d399; font-size: 1.1rem;">${result.total_procesados}</strong>
                    </div>
                    <div style="background: rgba(56, 189, 248, 0.1); padding: 8px; border-radius: 6px; text-align: center; border: 1px solid rgba(56, 189, 248, 0.2);">
                        <small style="color: #bae6fd; display: block;">Nuevos Trabajadores</small>
                        <strong style="color: #38bdf8; font-size: 1.1rem;">${result.nuevos_registros}</strong>
                    </div>
                    <div style="background: rgba(245, 158, 11, 0.1); padding: 8px; border-radius: 6px; text-align: center; border: 1px solid rgba(245, 158, 11, 0.2);">
                        <small style="color: #fde68a; display: block;">Actualizados</small>
                        <strong style="color: #fbbf24; font-size: 1.1rem;">${result.actualizados}</strong>
                    </div>
                </div>

                <div style="max-height: 280px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: rgba(255,255,255,0.04); font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">
                                <th style="padding: 8px 10px;">#</th>
                                <th style="padding: 8px 10px;">Trabajador / DNI</th>
                                <th style="padding: 8px 10px;">Curso Minero & Horas</th>
                                <th style="padding: 8px 10px;">Vigencia Oficial</th>
                                <th style="padding: 8px 10px;">Acciones & PDF</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasResultados}
                        </tbody>
                    </table>
                </div>
            `;
        }

        loadCertificados();
        loadDashboardKPIs();
        loadCompanyProfiles();
    } catch (err) {
        alert('Error en carga de PDF: ' + err.message);
        ocrText.innerHTML = `<span style="color: var(--danger);">Error: ${err.message}</span>`;
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
            submitBtn.style.opacity = '1';
        }
    }
}

// 3.5 Handle Excel Batch Upload Method
let ultimosEnviosExcel = null;

function verPreviewReporteEmpresaExcel() {
    if (!ultimosEnviosExcel || !ultimosEnviosExcel.reporte_empresa) return alert('No hay reporte consolidado de empresa disponible.');
    mostrarModalPreviewHTML({
        asunto: ultimosEnviosExcel.reporte_empresa.asunto,
        email_destino_final: `${ultimosEnviosExcel.reporte_empresa.email_empresa} (CC: ${ultimosEnviosExcel.reporte_empresa.email_responsable})`,
        cuerpo_html: ultimosEnviosExcel.reporte_empresa.cuerpo_html
    });
}

function verPreviewTrabajadorExcel(index) {
    if (!ultimosEnviosExcel || !ultimosEnviosExcel.detalles_envios || !ultimosEnviosExcel.detalles_envios[index]) return alert('No hay correo disponible.');
    const envio = ultimosEnviosExcel.detalles_envios[index];
    mostrarModalPreviewHTML({
        asunto: envio.asunto,
        email_destino_final: envio.trabajador_email,
        cuerpo_html: envio.cuerpo_html
    });
}

async function handleExcelUpload(e) {
    e.preventDefault();
    const fileInput = document.getElementById('input-file-excel');
    if (!fileInput.files[0]) {
        return alert('Por favor seleccione un archivo Excel o CSV.');
    }

    const submitBtn = document.getElementById('btn-submit-excel');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '⏳ Procesando carga y protegiendo anti-duplicados...';
        submitBtn.style.opacity = '0.75';
        submitBtn.style.cursor = 'not-allowed';
    }

    const formData = new FormData();
    formData.append('excelFile', fileInput.files[0]);
    const empTarget = (usuarioSesionActivo && usuarioSesionActivo.empresa_id) ? usuarioSesionActivo.empresa_id : empresaActivaId;
    if (empTarget) formData.append('empresa_id', empTarget);

    if (usuarioSesionActivo) {
        formData.append('usuario_id', usuarioSesionActivo.id);
        formData.append('usuario_nombre', usuarioSesionActivo.nombre_completo);
        formData.append('usuario_rol', usuarioSesionActivo.rol);
        formData.append('usuario_email', usuarioSesionActivo.email);
    }

    try {
        const res = await fetch('/api/v1/certificados/carga-masiva-excel', {
            method: 'POST',
            body: formData
        });
        const result = await res.json();

        if (!res.ok) {
            throw new Error(result.error || 'Error procesando archivo Excel.');
        }

        ultimosEnviosExcel = result;

        const excelBox = document.getElementById('excel-console');
        const excelText = document.getElementById('excel-output-text');
        excelBox.style.display = 'block';

        let erroresHTML = '';
        if (result.errores && result.errores.length > 0) {
            erroresHTML = `<div style="color: var(--danger); margin-top: 8px; font-size: 0.85rem;">⚠️ ADVERTENCIAS EN FILAS:<br>${result.errores.join('<br>')}</div>`;
        }

        const aptosCount = result.resumen_estados ? result.resumen_estados.aptos : 0;
        const proxCount = result.resumen_estados ? result.resumen_estados.por_vencer : 0;
        const vencCount = result.resumen_estados ? result.resumen_estados.vencidos : 0;
        const duplOmitidos = result.duplicados_omitidos || 0;
        const trabsActualizados = result.trabajadores_actualizados || 0;

        const bannerAntiDuplicados = (duplOmitidos > 0 || trabsActualizados > 0) ? `
            <div style="background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 0.82rem; color: #bae6fd;">
                🛡️ <strong>Control de Integridad Anti-Duplicados:</strong> Se omitieron <strong>${duplOmitidos}</strong> filas duplicadas del archivo y se actualizaron <strong>${trabsActualizados}</strong> registros existentes sin duplicar personal en la base de datos.
            </div>
        ` : '';

        const reportEmpresaHTML = result.reporte_empresa ? `
            <div style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 8px; padding: 12px; margin: 12px 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <strong style="color: #38bdf8; font-size: 0.95rem;">🏢 Reporte Consolidado Enviado a la Empresa Contratista:</strong><br>
                        <span style="font-size: 0.82rem; color: #cbd5e1;">Destinatario: <code style="color: #38bdf8;">${result.reporte_empresa.email_empresa}</code> &bull; Con Copia (CC - Responsable de Carga): <code style="color: #34d399;">${result.reporte_empresa.email_responsable}</code></span>
                    </div>
                    <button type="button" class="btn-primary" style="font-size: 0.8rem; padding: 0.4rem 0.85rem; background: #0284c7; border: none; cursor: pointer;" onclick="verPreviewReporteEmpresaExcel()">👁️ Previsualizar Correo Empresa</button>
                </div>
            </div>
        ` : '';

        const filasCorreosTrab = (result.detalles_envios || []).map((envio, i) => {
            const badgeColor = envio.estado === 'APTO' ? '#10b981' : (envio.estado === 'POR_VENCER' ? '#f59e0b' : '#f43f5e');
            const estadoLabel = envio.estado === 'APTO' ? '✓ APTO' : (envio.estado === 'POR_VENCER' ? `⚠️ POR VENCER (${envio.dias_restantes}d)` : '⛔ NO APTO (VENCIDO)');

            return `
                <div style="background: #1e293b; border-left: 4px solid ${badgeColor}; padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <div>
                        <strong style="color: #fff; font-size: 0.88rem;">👤 ${envio.trabajador_nombre}</strong> <span style="color: #94a3b8; font-size: 0.8rem;">(Doc: ${envio.trabajador_doc})</span><br>
                        <span style="color: #38bdf8; font-size: 0.8rem;">✉️ ${envio.trabajador_email}</span> &bull; <strong style="color: ${badgeColor}; font-size: 0.8rem;">${estadoLabel}</strong>
                    </div>
                    <button type="button" class="btn-primary" style="font-size: 0.75rem; padding: 0.3rem 0.6rem; background: #334155; border: 1px solid #475569; cursor: pointer;" onclick="verPreviewTrabajadorExcel(${i})">👁️ Ver Correo</button>
                </div>
            `;
        }).join('');

        excelText.innerHTML = `
            <div style="color: #34d399; font-weight: bold; font-size: 1rem; margin-bottom: 10px;">
                ✅ ¡CARGA MASIVA REGISTRADA Y NOTIFICACIONES DE CORREO ENVIADAS!
            </div>

            <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; font-size: 0.85rem; color: #fef3c7; line-height: 1.5;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span style="font-size: 1.2rem;">📎</span>
                    <strong style="color: #fde68a; font-size: 0.92rem;">REGISTRO PROVISIONAL (80% COMPLETADO) - FALTA ADJUNTAR ARCHIVO EN PDF:</strong>
                </div>
                Los trabajadores han sido registrados exitosamente en la plataforma, pero <strong>aún falta adjuntar el archivo PDF original de cada certificado</strong>. Para auditoría en garita según D.S. 024-2016-EM, suba los certificados escaneados en <code>[ Carga de Cuadrillas & OCR ]</code> para que el personal cuente con sustento digital al 100%.
            </div>

            ${bannerAntiDuplicados}

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 12px;">
                <div style="background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); text-align: center;">
                    <small style="color: #94a3b8; display: block;">Filas Procesadas</small>
                    <strong style="font-size: 1.15rem; color: #fff;">${result.total_filas_procesadas}</strong>
                </div>
                <div style="background: rgba(16, 185, 129, 0.15); padding: 8px 12px; border-radius: 6px; border: 1px solid #10b981; text-align: center;">
                    <small style="color: #a7f3d0; display: block;">✓ Aptos</small>
                    <strong style="font-size: 1.15rem; color: #34d399;">${aptosCount}</strong>
                </div>
                <div style="background: rgba(245, 158, 11, 0.15); padding: 8px 12px; border-radius: 6px; border: 1px solid #f59e0b; text-align: center;">
                    <small style="color: #fde68a; display: block;">⚠️ Por Vencer (≤90d)</small>
                    <strong style="font-size: 1.15rem; color: #fbbf24;">${proxCount}</strong>
                </div>
                <div style="background: rgba(244, 63, 94, 0.15); padding: 8px 12px; border-radius: 6px; border: 1px solid #f43f5e; text-align: center;">
                    <small style="color: #fecdd3; display: block;">⛔ No Apto (Vencido)</small>
                    <strong style="font-size: 1.15rem; color: #fb7185;">${vencCount}</strong>
                </div>
            </div>

            ${reportEmpresaHTML}

            <div style="margin-top: 10px;">
                <strong style="color: #f8fafc; font-size: 0.9rem; display: block; margin-bottom: 8px;">
                    📨 Correos Individuales Personalizados Enviados a Cada Trabajador (${result.correos_trabajadores_enviados}):
                </strong>
                <div style="max-height: 250px; overflow-y: auto; padding-right: 4px;">
                    ${filasCorreosTrab}
                </div>
            </div>

            ${erroresHTML}
        `;

        loadCertificados();
        loadDashboardKPIs();
        loadAlertasLog();
    } catch (err) {
        alert('Error en carga masiva Excel: ' + err.message);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '🚀 Procesar Carga Masiva Excel';
            submitBtn.style.opacity = '1';
            submitBtn.style.cursor = 'pointer';
        }
    }
}

function formatFechaUI(fechaInput) {
    if (!fechaInput) return 'N/A';
    const str = String(fechaInput).split('T')[0];
    const p = str.split('-');
    if (p.length === 3) return `${p[0]}-${p[1]}-${p[2]}`;
    return str;
}

function calcularDiasRestantesUI(fechaVencStr) {
    if (!fechaVencStr) return null;
    const cleanStr = String(fechaVencStr).split('T')[0];
    const venc = new Date(cleanStr);
    const ahora = new Date();
    ahora.setHours(0,0,0,0);
    const diffMs = venc.getTime() - ahora.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// 4. Load List of Certificates with Full Contact Info (Filtered by Active Company Profile)
async function loadCertificados() {
    try {
        let targetEmpresaId = empresaActivaId;
        if (esUsuarioEmpresa()) {
            targetEmpresaId = usuarioSesionActivo.empresa_id;
        }

        let url = '/api/v1/certificados';
        if (targetEmpresaId) {
            url += '?empresa_id=' + targetEmpresaId;
        }

        const res = await fetch(url);
        const certs = await res.json();

        const tbody = document.getElementById('tbody-certificados');
        if (!tbody) return;

        if (certs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 2rem;">No hay certificados registrados aún para la empresa seleccionada. Utilize los métodos de carga de arriba para registrar personal.</td></tr>`;
            return;
        }

        tbody.innerHTML = certs.map(c => {
            const fechaEm = formatFechaUI(c.fecha_emision);
            const fechaVenc = formatFechaUI(c.fecha_vencimiento);
            const diasRestantes = calcularDiasRestantesUI(c.fecha_vencimiento);

            let badgeVigencia = '';
            if (diasRestantes === null) {
                badgeVigencia = `<span class="badge badge-secondary">S/I</span>`;
            } else if (diasRestantes <= 0) {
                badgeVigencia = `<span class="badge badge-danger">⛔ NO APTO (Vencido)</span>`;
            } else if (diasRestantes <= 90) {
                badgeVigencia = `<span class="badge badge-warning">⚠️ POR VENCER (${diasRestantes}d - Alerta Enviada)</span>`;
            } else {
                badgeVigencia = `<span class="badge badge-success">✓ APTO (${diasRestantes}d restantes)</span>`;
            }

            const tienePDFReal = Boolean(c.url_pdf_storage || (c.pdf_filename && !c.pdf_filename.includes('Excel')));
            const tieneDNIOficial = Boolean(c.trabajador_doc && !c.trabajador_doc.startsWith('TEMP_') && c.trabajador_doc.length === 8);
            const tieneEmailValido = Boolean(c.trabajador_email && !c.trabajador_email.includes('powered@') && !c.trabajador_email.includes('operario.') && c.trabajador_email.includes('@'));
            const tieneTelValido = Boolean(c.trabajador_telefono && c.trabajador_telefono !== '+51 987654321' && c.trabajador_telefono !== '+51 900000000');
            const estaIncompleto = !tienePDFReal || !tieneDNIOficial || !tieneEmailValido || !tieneTelValido;

            const badgeAudit = tienePDFReal 
                ? `<span class="badge ${c.estado_validacion === 'APROBADO' ? 'badge-success' : (c.estado_validacion === 'RECHAZADO' ? 'badge-danger' : 'badge-warning')}">${c.estado_validacion}</span>`
                : `<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);" title="Expediente con 80% completado. Falta adjuntar archivo PDF escaneado.">⚠️ 80% PROVISIONAL</span>`;

            return `
                <tr data-tiene-pdf="${tienePDFReal}" data-tiene-dni="${tieneDNIOficial}" data-tiene-email="${tieneEmailValido}" data-tiene-tel="${tieneTelValido}" data-incompleto="${estaIncompleto}">
                    <td><strong>${c.nombre_curso || c.curso || 'Curso de Homologación'}</strong></td>
                    <td>
                        <strong>${c.trabajador_nombre}</strong><br>
                        <small style="color: var(--text-secondary)">Doc: ${c.trabajador_doc}</small><br>
                        ${tieneEmailValido 
                            ? `<small style="color: var(--accent-blue)">✉️ ${c.trabajador_email}</small>` 
                            : `<button type="button" onclick="abrirModalEditarTrabajador('${c.trabajador_id}')" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; border-radius: 4px; padding: 1px 6px; font-size: 0.72rem; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; margin-bottom: 2px;" title="Correo no registrado. Clic para ingresar correo personal.">✉️ Registrar Correo</button>`}<br>
                        ${tieneTelValido 
                            ? `<small style="color: var(--success)">📞 ${c.trabajador_telefono}</small>` 
                            : `<button type="button" onclick="abrirModalEditarTrabajador('${c.trabajador_id}')" style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24; border-radius: 4px; padding: 1px 6px; font-size: 0.72rem; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; margin-top: 2px;" title="Teléfono no registrado. Clic para ingresar número real.">⚠️ Registrar Teléfono</button>`}
                    </td>
                    <td>
                        <strong>${c.empresa_nombre}</strong><br>
                        <small style="color: var(--text-secondary)">✉️ ${c.empresa_email}</small><br>
                        <small style="color: var(--text-secondary)">📞 ${c.empresa_telefono}</small>
                    </td>
                    <td><strong style="color: var(--text-primary);">${fechaEm}</strong></td>
                    <td><strong style="color: var(--accent-blue);">${fechaVenc}</strong></td>
                    <td><code>${c.codigo_qr_hash || c.qr_hash || 'QR_BATCH_EXCEL'}</code></td>
                    <td>${badgeAudit}</td>
                    <td>${badgeVigencia}</td>
                    <td>
                        <div class="table-btn-group">
                            ${tienePDFReal ? `
                            <button class="table-btn-action" style="background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.35); color: #f87171;" onclick="abrirVisorPDF('${c.pdf_filename}', '${(c.nombre_curso || c.curso || 'Certificado').replace(/'/g, "\\'")}', '${(c.trabajador_nombre || '').replace(/'/g, "\\'")}')" title="Ver Certificado PDF Original">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                <span>PDF</span>
                            </button>
                            ` : `
                            <button class="table-btn-action" style="background: rgba(245, 158, 11, 0.2); border-color: #f59e0b; color: #fbbf24;" onclick="abrirModalAdjuntarPDF('${c.id}', '${(c.trabajador_nombre || '').replace(/'/g, "\\'")}', '${c.trabajador_doc || ''}', '${(c.nombre_curso || c.curso || '').replace(/'/g, "\\'")}')" title="Completar Expediente: Adjuntar Escaneado PDF Original">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                                <span>📎 Adjuntar PDF</span>
                            </button>
                            `}
                            <button class="table-btn-action table-btn-edit" onclick="abrirModalEditarTrabajador('${c.trabajador_id}')" title="Editar Información del Empleado">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                <span>Editar</span>
                            </button>
                            <a href="/api/v1/trabajadores/fotocheck/${encodeURIComponent(c.trabajador_id)}" target="_blank" class="table-btn-action" style="background: rgba(168, 85, 247, 0.15); border-color: rgba(168, 85, 247, 0.35); color: #c084fc; text-decoration: none;" title="Imprimir Fotocheck / Carnet Minero con QR">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                <span>Fotocheck</span>
                            </a>
                            <button class="table-btn-action" style="background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.35); color: #38bdf8;" onclick="enviarAlertaIndividualJS('${c.id}')" title="Despachar Notificación Oficial">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                                <span>Notificar</span>
                            </button>
                            <button class="table-btn-action table-btn-delete" onclick="eliminarCertificadoJS('${c.id}')" title="Eliminar Registro de Certificado">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                <span>Eliminar</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Actualizar contador de incompletos para el botón de notificación masiva
        const incompletosTotal = certs.filter(c => {
            const tienePDFReal = Boolean(c.url_pdf_storage || (c.pdf_filename && !c.pdf_filename.includes('Excel')));
            const tieneDNIOficial = Boolean(c.trabajador_doc && !c.trabajador_doc.startsWith('TEMP_') && c.trabajador_doc.length === 8);
            const tieneEmailValido = Boolean(c.trabajador_email && !c.trabajador_email.includes('powered@') && !c.trabajador_email.includes('operario.') && c.trabajador_email.includes('@'));
            const tieneTelValido = Boolean(c.trabajador_telefono && c.trabajador_telefono !== '+51 987654321' && c.trabajador_telefono !== '+51 900000000');
            return !tienePDFReal || !tieneDNIOficial || !tieneEmailValido || !tieneTelValido;
        }).length;

        const badgeCount = document.getElementById('badge-count-incompletos');
        if (badgeCount) badgeCount.textContent = incompletosTotal;

        // Re-aplicar filtro visual actual
        filterCertificatesTable();
    } catch (err) {
        console.error('Error loading certificados:', err);
    }
}

async function enviarAlertaIndividualJS(certId) {
    const emailOverrideInput = document.getElementById('input-test-email-override');
    const testEmail = emailOverrideInput ? emailOverrideInput.value.trim() : '';

    try {
        const res = await fetch('/api/v1/alertas/enviar-individual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ certificado_id: certId, email_prueba: testEmail || null })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al enviar alerta individual por correo.');

        mostrarModalPreviewHTML(data);
        loadAlertasLog();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function enviarNotificacionMasivaIncompletosJS() {
    const incompletosCount = parseInt(document.getElementById('badge-count-incompletos')?.textContent || '0', 10);
    if (incompletosCount === 0) {
        return alert('¡Excelente! No hay trabajadores con información incompleta en este momento. Todos los expedientes cuentan con DNI, PDF, Correo y Teléfono.');
    }

    if (!confirm(`⚠️ NOTIFICACIÓN MASIVA DE REGULARIZACIÓN:\n\nSe detectaron ${incompletosCount} certificados con expedientes incompletos u observados (falta DNI, sustento PDF, correo o teléfono).\n\n¿Desea despachar la notificación oficial por correo a los trabajadores y a la empresa para que regularicen su expediente?`)) {
        return;
    }

    const btn = document.getElementById('btn-notificar-masivo-incompletos');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳ Enviando correos masivos...</span>`;
    }

    try {
        const empId = empresaActivaId || (esUsuarioEmpresa() ? usuarioSesionActivo.empresa_id : null);
        const res = await fetch('/api/v1/alertas/enviar-masivo-incompletos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                empresa_id: empId,
                remitente_nombre: usuarioSesionActivo ? usuarioSesionActivo.nombre_completo : 'Auditoría HSE',
                remitente_rol: usuarioSesionActivo ? usuarioSesionActivo.rol : 'SUPERVISOR HSE',
                remitente_email: usuarioSesionActivo ? usuarioSesionActivo.email : null
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al enviar notificaciones masivas.');

        let msg = `✅ RESULTADO DE NOTIFICACIÓN MASIVA:\n\n`;
        msg += `• Total evaluados: ${data.total_evaluados}\n`;
        msg += `• Correos despachados con éxito: ${data.total_enviados}\n`;
        if (data.total_omitidos > 0) {
            msg += `• Omitidos (sin correo registrado): ${data.total_omitidos}\n\n`;
            msg += `Detalle de omitidos:\n`;
            data.omitidos.slice(0, 5).forEach(o => {
                msg += ` - ${o.trabajador}: ${o.motivo}\n`;
            });
            if (data.omitidos.length > 5) msg += ` ... y ${data.omitidos.length - 5} más.\n`;
        }
        alert(msg);

        loadCertificados();
        loadAlertasLog();
    } catch (err) {
        alert('Error en notificación masiva: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

function mostrarModalPreviewHTML(data) {
    document.getElementById('preview-asunto-text').textContent = data.asunto || 'Notificación Preventiva HSE';
    document.getElementById('preview-destinatario-text').textContent = data.email_destino_final || `${data.email_trabajador}, ${data.email_empresa}`;
    document.getElementById('preview-html-container').innerHTML = data.cuerpo_html;
    document.getElementById('modal-preview-correo').style.display = 'flex';
}

function closePreviewCorreoModal() {
    document.getElementById('modal-preview-correo').style.display = 'none';
}

// 5. Supervisor Audit List
async function loadAuditoriaList() {
    try {
        const empFilter = document.getElementById('filter-audit-empresa')?.value || superAdminScopeCompanyId || (esUsuarioEmpresa() ? usuarioSesionActivo.empresa_id : null);
        const estadoFilter = document.getElementById('filter-audit-estado')?.value || null;

        let url = '/api/v1/certificados';
        if (empFilter) {
            url += '?empresa_id=' + empFilter;
        }

        const res = await fetch(url);
        let certs = await res.json();

        if (estadoFilter) {
            certs = certs.filter(c => c.estado_validacion === estadoFilter);
        }

        const tbody = document.getElementById('tbody-auditoria');
        if (!tbody) return;

        if (certs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 2rem;">No hay certificados que coincidan con los filtros seleccionados.</td></tr>`;
            return;
        }

        tbody.innerHTML = certs.map(c => `
            <tr>
                <td><strong>${c.nombre_curso || c.curso || 'Curso de Homologación'}</strong></td>
                <td>
                    <strong>${c.trabajador_nombre}</strong><br>
                    <small style="color: var(--accent-cyan); font-weight: 600;">${c.empresa_nombre}</small>
                </td>
                <td>${c.entidad_emisora || c.entidad || 'Instituto Certificador'}</td>
                <td>${formatFechaUI(c.fecha_emision)} &rarr; <strong>${formatFechaUI(c.fecha_vencimiento)}</strong></td>
                <td><span class="badge ${c.estado_validacion === 'APROBADO' ? 'badge-success' : (c.estado_validacion === 'RECHAZADO' ? 'badge-danger' : 'badge-warning')}">${c.estado_validacion}</span></td>
                <td class="action-cell">
                    ${c.estado_validacion === 'EN_VALIDACION' ? `
                        <button class="btn-action-approve" onclick="evaluarCertificado('${c.id}', 'APROBADO')">✓ Aprobar</button>
                        <button class="btn-action-reject" onclick="evaluarCertificado('${c.id}', 'RECHAZADO')">✕ Rechazar</button>
                    ` : '<span style="color: var(--text-secondary); font-size: 0.85rem;">Auditado</span>'}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Error loading auditoria list:', err);
    }
}

async function aprobarTodosCertificadosPendientes() {
    const empFilter = document.getElementById('filter-audit-empresa')?.value || superAdminScopeCompanyId || (esUsuarioEmpresa() ? usuarioSesionActivo.empresa_id : null);

    let url = '/api/v1/certificados';
    if (empFilter) url += '?empresa_id=' + empFilter;

    const res = await fetch(url);
    const certs = await res.json();
    const pendientes = certs.filter(c => c.estado_validacion === 'EN_VALIDACION');

    if (pendientes.length === 0) {
        return alert('No hay certificados pendientes (EN_VALIDACION) para aprobar en el filtro seleccionado.');
    }

    if (!confirm(`⚡ ¿Desea aprobar en lote los ${pendientes.length} certificados pendientes de la cuadrilla?`)) return;

    let aprobadosCount = 0;
    for (let c of pendientes) {
        try {
            await fetch('/api/v1/homologaciones/evaluar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ certificado_id: c.id, estado: 'APROBADO', observacion: 'Aprobación masiva de cuadrilla por Supervisor HSE Super Admin.' })
            });
            aprobadosCount++;
        } catch (e) {
            console.error('Error aprobando certificado', c.id, e);
        }
    }

    alert(`✅ ${aprobadosCount} certificados fueron APROBADOS exitosamente en lote.`);
    loadAuditoriaList();
    loadCertificados();
    loadDashboardKPIs();
}

async function consultarPaseGaritaDNI() {
    const input = document.getElementById('input-garita-search-dni');
    const query = input ? input.value.trim().toLowerCase() : '';
    const resultBox = document.getElementById('garita-result-box');

    if (!query) {
        return alert('Por favor ingrese un DNI o apellido para consultar el pase de ingreso en garita.');
    }

    try {
        const res = await fetch('/api/v1/certificados');
        const certs = await res.json();

        // Match worker by DNI or name
        const certsMatch = certs.filter(c => 
            (c.trabajador_doc && c.trabajador_doc.toLowerCase().includes(query)) ||
            (c.trabajador_nombre && c.trabajador_nombre.toLowerCase().includes(query))
        );

        resultBox.style.display = 'block';

        if (certsMatch.length === 0) {
            resultBox.innerHTML = `
                <div style="background: rgba(244, 63, 94, 0.15); border: 1px solid var(--danger); padding: 1rem 1.25rem; border-radius: 8px; color: #f8fafc;">
                    <strong style="color: var(--danger); font-size: 1rem;">⛔ TRABAJADOR NO REGISTRADO EN BASE DE DATOS MINERA</strong><br>
                    <span style="font-size: 0.85rem; color: var(--text-secondary);">No existen registros de homologación ni certificados cargados para el documento/nombre: <code>${query}</code>. El acceso en garita queda RESTRINGIDO.</span>
                </div>
            `;
            return;
        }

        const primerCert = certsMatch[0];
        const todosAprobados = certsMatch.every(c => c.estado_validacion === 'APROBADO');
        const algunoVencido = certsMatch.some(c => c.estado_vigencia === 'INHABILITADO' || (calcularDiasRestantesUI(c.fecha_vencimiento) <= 0));

        const esHabilitado = todosAprobados && !algunoVencido;

        const badgeState = esHabilitado
            ? `<div style="background: #10b981; color: #000; padding: 0.75rem 1.25rem; border-radius: 8px; font-weight: 800; font-size: 1.05rem; display: flex; align-items: center; justify-content: space-between;">
                <span>✅ PASE AUTORIZADO - ACCESO PERMITIDO A PLANTA MINERA</span>
                <span style="font-size: 0.8rem; background: rgba(0,0,0,0.2); padding: 0.2rem 0.6rem; border-radius: 4px;">PASE: HABILITADO</span>
               </div>`
            : `<div style="background: #f43f5e; color: #fff; padding: 0.75rem 1.25rem; border-radius: 8px; font-weight: 800; font-size: 1.05rem; display: flex; align-items: center; justify-content: space-between;">
                <span>⛔ ACCESO RESTRINGIDO - INHABILITADO EN GARITA</span>
                <span style="font-size: 0.8rem; background: rgba(0,0,0,0.2); padding: 0.2rem 0.6rem; border-radius: 4px;">PASE: NO APTO</span>
               </div>`;

        const cursosHTML = certsMatch.map(c => {
            const dRest = calcularDiasRestantesUI(c.fecha_vencimiento);
            const badgeC = c.estado_validacion === 'APROBADO' 
                ? (dRest > 0 ? `<span class="badge badge-success">✓ Aprobado (${dRest}d restantes)</span>` : `<span class="badge badge-danger">⛔ Vencido</span>`)
                : `<span class="badge badge-warning">⏳ Auditando (${c.estado_validacion})</span>`;

            return `<div style="background: #1e293b; padding: 0.5rem 0.75rem; border-radius: 6px; margin-top: 0.4rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                    <span>📜</span>
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><strong>${c.nombre_curso}</strong> (${formatFechaUI(c.fecha_vencimiento)})</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                    ${badgeC}
                    ${c.pdf_filename ? `
                    <button class="table-btn-action" style="padding: 3px 7px; font-size: 0.72rem; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171;" onclick="abrirVisorPDF('${c.pdf_filename}', '${(c.nombre_curso || 'Certificado').replace(/'/g, "\\'")}', '${(primerCert.trabajador_nombre || '').replace(/'/g, "\\'")}')" title="Ver Certificado PDF Original">
                        📄 PDF
                    </button>
                    ` : ''}
                </div>
            </div>`;
        }).join('');

        resultBox.innerHTML = `
            <div style="background: #0f172a; border: 1px solid rgba(255,255,255,0.15); padding: 1.25rem; border-radius: 10px;">
                ${badgeState}
                <div style="display: flex; gap: 1.5rem; margin-top: 1rem; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 250px;">
                        <span style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">Datos del Personal Homologado:</span>
                        <h3 style="margin: 0.25rem 0; color: #fff;">👤 ${primerCert.trabajador_nombre}</h3>
                        <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6;">
                            <strong>DNI / Doc:</strong> ${primerCert.trabajador_doc}<br>
                            <strong>Empresa Contratista:</strong> <span style="color: var(--accent-blue); font-weight: 700;">${primerCert.empresa_nombre}</span><br>
                            <strong>Teléfono:</strong> ${primerCert.trabajador_telefono || 'N/A'} | <strong>Email:</strong> ${primerCert.trabajador_email || 'N/A'}
                        </p>
                    </div>
                    <div style="flex: 1; min-width: 280px;">
                        <span style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">Expediente de Certificaciones Mineras (${certsMatch.length}):</span>
                        ${cursosHTML}
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        alert('Error consultando pase de garita: ' + err.message);
    }
}

async function evaluarCertificado(certId, nuevoEstado) {
    const obs = prompt(`Ingrese la observación para ${nuevoEstado}:`, nuevoEstado === 'APROBADO' ? 'Certificado auditado y validado conforme.' : 'Documento ilegible / No cumple requisitos.');
    if (obs === null) return;

    try {
        const res = await fetch('/api/v1/homologaciones/evaluar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ certificado_id: certId, estado: nuevoEstado, observacion: obs })
        });
        const data = await res.json();
        alert(data.message);
        loadAuditoriaList();
        loadCertificados();
        loadDashboardKPIs();
    } catch (err) {
        alert('Error al evaluar certificado: ' + err.message);
    }
}

// 6. Cron Engine & Email Alerts Scanner (Escalado: 90, 30 y 10 Días)
async function triggerAlertScan(forzar = false) {
    try {
        const emailOverrideInput = document.getElementById('input-test-email-override');
        const testEmail = emailOverrideInput ? emailOverrideInput.value.trim() : '';

        let url = '/api/v1/alertas/ejecutar-escaneo';
        const params = new URLSearchParams();
        if (esUsuarioEmpresa()) params.append('empresa_id', usuarioSesionActivo.empresa_id);
        if (testEmail) params.append('email_prueba', testEmail);
        if (forzar) params.append('forzar', 'true');

        if (params.toString()) url += '?' + params.toString();

        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();

        const modoMsg = data.modo_prueba_activo ? `\n(🧪 MODO PRUEBA ACTIVO: Redirigido a ${data.correo_prueba_usado})` : '';

        alert(`🤖 EVALUACIÓN AUTOMÁTICA DE VENCIMIENTOS (90, 30 y 10 DÍAS):\n\n` +
              `• Certificados Escaneados en BD: ${data.total_certificados_escaneados}\n` +
              `• En rango de 90 días (Primer aviso): ${data.en_rango_90_dias}\n` +
              `• En rango de 30 días (Segundo aviso): ${data.en_rango_30_dias}\n` +
              `• En rango crítico de 10 días (Urgencia): ${data.en_rango_10_dias}\n` +
              `• Certificados Inhabilitados: ${data.certificados_inhabilitados}\n` +
              `• Correos de Alertas Emitidos: ${data.correos_alertas_enviados}${modoMsg}\n\n` +
              `El motor aplicó control anti-spam para no duplicar avisos en la misma etapa.`);

        loadCertificados();
        loadDashboardKPIs();
        loadAlertasLog();
    } catch (err) {
        alert('Error ejecutando escaneo de alertas: ' + err.message);
    }
}

let alertasCache = [];

function verAlertaPreview(id) {
    const item = alertasCache.find(x => x.id === id);
    if (!item) return alert('Detalle de alerta no encontrado.');
    mostrarModalPreviewHTML({
        asunto: item.asunto || item.tipo_alerta || 'Notificación Oficial de Homologaciones HSE',
        email_destino_final: item.email_destinatario || item.destinatario_email || 'destinatario@minera.com',
        cuerpo_html: item.cuerpo_html || `<div style="padding: 20px; color: #fff;">${item.mensaje_resumen || 'Sin cuerpo HTML.'}</div>`
    });
}

async function loadAlertasLog() {
    try {
        let url = '/api/v1/alertas/historial';
        if (esUsuarioEmpresa()) {
            url += '?empresa_id=' + usuarioSesionActivo.empresa_id;
        }

        const res = await fetch(url);
        const alertas = await res.json();

        const tbody = document.getElementById('tbody-alertas');
        if (!tbody) return;

        alertasCache = Array.isArray(alertas) ? alertas : [];

        if (alertasCache.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 1.5rem;">No se han emitido alertas por correo aún. Utilice el botón superior para ejecutar el escaneo a 90 días o realice una carga masiva Excel.</td></tr>`;
            return;
        }

        tbody.innerHTML = alertasCache.map(a => {
            let badgeTipo = `<span class="badge badge-warning">⚠️ ALERTA (${a.dias_restantes}d)</span>`;
            if (a.tipo_alerta === 'REPORTE_CARGA_EXCEL') {
                badgeTipo = `<span class="badge" style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid #0284c7;">📋 REPORTE EMPRESA</span>`;
            } else if (a.tipo_alerta === 'NOTIFICACION_HABILITADO') {
                badgeTipo = `<span class="badge badge-success">✓ APTO (AUTORIZADO)</span>`;
            } else if (a.tipo_alerta === 'NOTIFICACION_POR_VENCER') {
                badgeTipo = `<span class="badge badge-warning">⚠️ POR VENCER (${a.dias_restantes}d)</span>`;
            } else if (a.tipo_alerta === 'NOTIFICACION_INHABILITADO') {
                badgeTipo = `<span class="badge badge-danger">⛔ NO APTO (VENCIDO)</span>`;
            }

            const nombreDestino = (a.trab_nombres ? `${a.trab_nombres} ${a.trab_apellidos || ''}` : null) || a.emp_nombre || 'Destinatario';

            return `
                <tr>
                    <td><code>${a.id}</code></td>
                    <td><strong>${a.emp_nombre || 'Empresa Contratista'}</strong></td>
                    <td>
                        <strong>👤 ${nombreDestino}</strong><br>
                        <small style="color: var(--accent-blue)">✉️ ${a.email_destinatario || a.destinatario_email}</small>
                    </td>
                    <td>${badgeTipo}</td>
                    <td>${formatFechaUI(a.fecha_envio)}</td>
                    <td>
                        <button type="button" class="btn-primary" style="padding: 0.3rem 0.65rem; font-size: 0.75rem; background: #0284c7; cursor: pointer;" onclick="verAlertaPreview('${a.id}')">👁️ Ver Correo</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error loading alertas log:', err);
    }
}

async function ejecutarCronAlertas(forzar = false) {
    await triggerAlertScan(forzar);
}

// 7. Load Power BI Endpoint Preview
async function loadPowerBIPreview() {
    try {
        const res = await fetch('/api/v1/bi/reporte-powerbi');
        const data = await res.json();
        document.getElementById('powerbi-json-preview').innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    } catch (err) {
        console.error('Error loading Power BI preview:', err);
    }
}

// 8. SMTP Diagnostic & Real Email Gateway
async function checkSMTPStatus() {
    try {
        const res = await fetch('/api/v1/alertas/smtp-status');
        const data = await res.json();
        const badge = document.getElementById('badge-smtp-status');
        const hostElem = document.getElementById('smtp-info-host');
        const userElem = document.getElementById('smtp-info-user');
        const trapElem = document.getElementById('smtp-info-trap');

        if (hostElem) hostElem.textContent = `${data.smtp_host}:${data.smtp_port}`;
        if (userElem) userElem.textContent = data.smtp_user;
        if (trapElem) {
            trapElem.textContent = data.test_mode_activo ? `🧪 Trap Activo (${data.test_email})` : '🌐 Salida Real por Destinatario';
            trapElem.style.color = data.test_mode_activo ? '#fbbf24' : '#34d399';
        }

        if (badge) {
            if (data.smtp_configurado) {
                badge.className = 'badge badge-success';
                badge.textContent = '🟢 SMTP CONECTADO Y LISTO';
            } else {
                badge.className = 'badge badge-warning';
                badge.textContent = '🟡 SMTP VIRTUAL (Falta Contraseña en .env)';
            }
        }
    } catch (e) {
        console.error('Error checking SMTP status:', e);
    }
}

async function probarEnvioSMTPDirecto() {
    const destino = prompt('Ingrese el correo destinatario donde desea recibir la prueba inmediata:', usuarioSesionActivo?.email || 'cristianre257@gmail.com');
    if (!destino) return;

    try {
        const res = await fetch('/api/v1/alertas/enviar-prueba-smtp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ destino })
        });
        const result = await res.json();
        if (result.enviado_real) {
            alert(`🎉 ¡CORREO ENVIADO CON ÉXITO!\n\nSe despachó a través del servidor SMTP hacia: ${result.destinatario}.\nID del Mensaje: ${result.messageId}\n\nPor favor revise su bandeja de entrada (y spam por ser prueba).`);
        } else {
            alert(`ℹ️ ESTADO DEL ENVÍO:\n\nEl sistema preparó el correo, pero el servidor SMTP respondió:\n${result.error || result.motivo}\n\nSi aún no ha colocado la Contraseña de Aplicación en el archivo .env, los correos quedan simulados y guardados en la BD.`);
        }
        checkSMTPStatus();
    } catch (err) {
        alert('Error conectando con el servidor: ' + err.message);
    }
}

function verInstruccionesSMTP() {
    alert(
        `📌 PASOS PARA ACTIVAR SALIDA REAL DE CORREOS CON GMAIL:\n\n` +
        `1. Abra su cuenta de Google (cristianre257@gmail.com) y vaya a "Seguridad".\n` +
        `2. Active "Verificación en 2 pasos" si no la tiene.\n` +
        `3. En el buscador de ajustes de Google escriba: "Contraseñas de aplicaciones" (o App Passwords).\n` +
        `4. Genere una contraseña y seleccione Nombre: "HomologaControl". Le dará un código de 16 letras.\n` +
        `5. Abra el archivo .env en la raíz del proyecto y en la línea:\n` +
        `   SMTP_PASS=aqui_sus_16_letras\n` +
        `6. ¡Listo! A partir de ese momento, cualquier Excel que suba o cualquier correo enviado llegará a las bandejas reales en segundos.`
    );
}

// =========================================================================
// PORTAL DE CONSULTA DEL TRABAJADOR / KIOSCO DIGITAL DE HABILITACIÓN POR DNI
// =========================================================================
let datosKioscoActivo = null;

async function consultarHabilitacionTrabajadorPublico() {
    const input = document.getElementById('public-search-dni');
    const dni = input ? input.value.trim() : '';

    if (!dni || dni.length < 6) {
        return alert('Por favor ingrese un número de DNI o documento válido (mínimo 6 dígitos).');
    }

    try {
        const res = await fetch(`/api/v1/trabajadores/consulta-dni/${encodeURIComponent(dni)}`);
        const data = await res.json();

        if (!res.ok) {
            return alert(data.error || 'No se encontró información para el documento ingresado.');
        }

        datosKioscoActivo = data;
        abrirModalKiosco(data);
    } catch (err) {
        alert('Error conectando con el servicio de consulta: ' + err.message);
    }
}

function abrirModalKiosco(data) {
    const modal = document.getElementById('modal-kiosco-trabajador');
    const body = document.getElementById('kiosco-content-body');
    if (!modal || !body) return;

    const trab = data.trabajador;
    const certs = data.certificados || [];
    const esApto = (trab.estado_habilitacion === 'HABILITADO');

    const badgeEstado = esApto
        ? `<div style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; color: #34d399; padding: 10px 16px; border-radius: 8px; font-weight: 700; display: flex; align-items: center; justify-content: space-between;">
            <span style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3rem;">🟢</span>
                <span>ESTADO EN GARITA: HABILITADO (PASE A PLANTA AUTORIZADO)</span>
            </span>
            <span style="font-size: 0.8rem; background: #065f46; color: #a7f3d0; padding: 4px 10px; border-radius: 999px;">Conforme D.S. 024-2016-EM</span>
           </div>`
        : `<div style="background: rgba(244, 63, 94, 0.15); border: 1px solid #f43f5e; color: #fb7185; padding: 10px 16px; border-radius: 8px; font-weight: 700; display: flex; align-items: center; justify-content: space-between;">
            <span style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.3rem;">🔴</span>
                <span>ESTADO EN GARITA: INHABILITADO (ACCESO RESTRINGIDO)</span>
            </span>
            <span style="font-size: 0.8rem; background: #881337; color: #fecdd3; padding: 4px 10px; border-radius: 999px;">Requiere Regularización</span>
           </div>`;

    let filasCerts = '';
    if (certs.length === 0) {
        filasCerts = `<tr><td colspan="5" style="text-align: center; padding: 1.5rem; color: var(--text-secondary);">No se registran certificados homologados a la fecha.</td></tr>`;
    } else {
        certs.forEach((c, idx) => {
            let badgeVig = '';
            if (c.dias_restantes <= 0) {
                badgeVig = `<span class="badge badge-danger" style="font-size: 0.75rem;">⛔ VENCIDO</span>`;
            } else if (c.dias_restantes <= 90) {
                badgeVig = `<span class="badge badge-warning" style="font-size: 0.75rem;">⚠️ POR VENCER (${c.dias_restantes}d)</span>`;
            } else {
                badgeVig = `<span class="badge badge-success" style="font-size: 0.75rem;">✓ VIGENTE (${c.dias_restantes}d)</span>`;
            }

            filasCerts += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <td style="padding: 10px; font-size: 0.8rem; color: var(--text-secondary);">${idx + 1}</td>
                    <td style="padding: 10px;">
                        <strong style="color: #fff; font-size: 0.88rem;">${c.nombre_curso}</strong><br>
                        <small style="color: var(--text-secondary);">${c.entidad_emisora} &bull; ${c.horas_lectivas} hrs</small>
                    </td>
                    <td style="padding: 10px; font-size: 0.82rem; color: var(--text-secondary); font-family: monospace;">
                        ${formatFechaUI(c.fecha_emision)}
                    </td>
                    <td style="padding: 10px; font-size: 0.82rem; font-weight: 600; color: #fff; font-family: monospace;">
                        ${formatFechaUI(c.fecha_vencimiento)}
                    </td>
                    <td style="padding: 10px; text-align: center;">
                        ${badgeVig}
                    </td>
                    <td style="padding: 10px; text-align: center;">
                        ${c.pdf_filename ? `
                            <button class="table-btn-action" style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 0.75rem; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171;" onclick="abrirVisorPDF('${c.pdf_filename}', '${(c.nombre_curso || 'Certificado').replace(/'/g, "\\'")}', '${(trab.nombres + ' ' + trab.apellidos).replace(/'/g, "\\'")}')" title="Visualizar Certificado PDF Oficial">
                                📄 <span>Ver PDF</span>
                            </button>
                        ` : `<span style="color: var(--text-secondary); font-size: 0.75rem;">Sin archivo</span>`}
                    </td>
                </tr>
            `;
        });
    }

    body.innerHTML = `
        <div style="margin-bottom: 1.25rem;">
            ${badgeEstado}
        </div>

        <!-- Ficha de Datos del Personal -->
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; margin-bottom: 1.25rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
                <div>
                    <small style="color: var(--text-secondary); display: block; font-size: 0.75rem;">Trabajador Titular</small>
                    <strong style="font-size: 1rem; color: #fff;">${trab.nombres} ${trab.apellidos}</strong>
                    <div style="color: var(--accent-cyan); font-family: monospace; font-size: 0.82rem;">${trab.tipo_documento}: ${trab.numero_documento}</div>
                </div>
                <div>
                    <small style="color: var(--text-secondary); display: block; font-size: 0.75rem;">Empresa Contratista</small>
                    <strong style="color: #fff; font-size: 0.9rem;">${trab.empresa_nombre}</strong>
                    <div style="color: var(--text-secondary); font-size: 0.8rem;">RUC: ${trab.empresa_ruc || 'N/A'}</div>
                </div>
                <div>
                    <small style="color: var(--text-secondary); display: block; font-size: 0.75rem;">Cargo & Ubicación</small>
                    <strong style="color: var(--accent-amber); font-size: 0.9rem;">${trab.cargo_puesto || 'Técnico Especialista'}</strong>
                    <div style="color: var(--text-secondary); font-size: 0.8rem;">Área: ${trab.area_trabajo || 'Planta / Mina'}</div>
                </div>
                <div>
                    <small style="color: var(--text-secondary); display: block; font-size: 0.75rem;">Correo Registrado para Avisos</small>
                    <code style="color: var(--accent-cyan); font-size: 0.82rem;">${trab.email_personal || 'No registrado'}</code>
                    <div style="color: var(--text-secondary); font-size: 0.8rem;">Celular: ${trab.telefono_personal || 'No registrado'}</div>
                </div>
            </div>
        </div>

        <!-- Tabla de Certificados y Vigencias -->
        <div style="margin-bottom: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <strong style="color: #fff; font-size: 0.9rem;">Certificados y Homologaciones Normativas (${certs.length})</strong>
                <small style="color: var(--text-secondary);">Renovación anual exigida por D.S. 024-2016-EM</small>
            </div>
            <div style="overflow-x: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="background: rgba(255,255,255,0.04); font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">
                            <th style="padding: 10px;">#</th>
                            <th style="padding: 10px;">Curso / Entidad</th>
                            <th style="padding: 10px;">Emisión</th>
                            <th style="padding: 10px;">Vencimiento</th>
                            <th style="padding: 10px; text-align: center;">Estado</th>
                            <th style="padding: 10px; text-align: center;">Documento</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filasCerts}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Barra de Acciones de Auto-Servicio para el Empleado -->
        <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 10px; padding: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
                <strong style="color: #fff; font-size: 0.88rem; display: flex; align-items: center; gap: 6px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-cyan);"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    ¿No te llegó el correo de notificación o necesitas reenviarlo?
                </strong>
                <p style="margin: 2px 0 0 0; font-size: 0.78rem; color: var(--text-secondary);">
                    Puedes despachar tu ficha oficial a tu bandeja en este mismo instante.
                </p>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="btn-warning" onclick="abrirModalSolicitudDesdeKiosco()" style="font-size: 0.82rem; padding: 0.5rem 1rem; display: inline-flex; align-items: center; gap: 6px; background: rgba(245, 158, 11, 0.2); border: 1px solid #f59e0b; color: #fbbf24;">
                    <span>⚠️ Solicitar Corrección de Datos</span>
                </button>
                <button type="button" class="btn-primary" onclick="reenviarFichaKioscoCorreo()" style="font-size: 0.82rem; padding: 0.5rem 1rem; display: inline-flex; align-items: center; gap: 6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    <span>Reenviar a mi Correo</span>
                </button>
            </div>
        </div>
    `;

    modal.style.display = 'flex';
}

function closeKioscoModal() {
    const modal = document.getElementById('modal-kiosco-trabajador');
    if (modal) modal.style.display = 'none';
}

async function reenviarFichaKioscoCorreo() {
    if (!datosKioscoActivo || !datosKioscoActivo.trabajador) return;

    const trab = datosKioscoActivo.trabajador;
    const correoActual = trab.email_personal || '';
    const emailDestino = prompt('Confirme o ingrese el correo electrónico donde desea recibir su ficha oficial:', correoActual);

    if (!emailDestino || !emailDestino.includes('@')) {
        return alert('Por favor ingrese un correo válido.');
    }

    try {
        const res = await fetch('/api/v1/trabajadores/reenviar-notificacion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trabajador_id: trab.id,
                email_nuevo: emailDestino.trim()
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error enviando correo.');

        alert(`¡Ficha despachada con éxito!\n\nSe envió a: ${emailDestino}.\nPor favor revise su bandeja de entrada.`);
        trab.email_personal = emailDestino.trim();
        abrirModalKiosco(datosKioscoActivo);
    } catch (err) {
        alert('Error en reenvío de notificación: ' + err.message);
    }
}

// =========================================================================
// EDICIÓN DIRECTA DE DATOS DEL TRABAJADOR (DESDE TABLA Y CERTIFICADOS)
// =========================================================================
let trabajadorEditandoId = null;

async function abrirModalEditarTrabajador(trabajadorId) {
    if (!trabajadorId) return alert('ID de trabajador no válido.');
    trabajadorEditandoId = trabajadorId;

    try {
        let trab = null;
        try {
            const res = await fetch('/api/v1/trabajadores');
            if (res.ok) {
                const trabs = await res.json();
                if (Array.isArray(trabs)) {
                    trab = trabs.find(t => t.id === trabajadorId);
                }
            }
        } catch(e) {
            console.warn('Fallback a cache de certificados para editar trabajador:', e);
        }

        // Si no se encuentra en el endpoint /trabajadores, buscar en la lista de certificados en memoria
        if (!trab) {
            const certRow = Array.from(document.querySelectorAll('#tbody-certificados tr')).find(r => r.innerHTML.includes(trabajadorId));
            if (certRow) {
                const docMatch = certRow.innerText.match(/Doc:\s*(\w+)/);
                const emailMatch = certRow.innerText.match(/✉️\s*([^\s\n]+)/);
                const telMatch = certRow.innerText.match(/📞\s*([^\s\n]+)/);
                trab = {
                    id: trabajadorId,
                    nombres: '',
                    apellidos: '',
                    numero_documento: docMatch ? docMatch[1] : '',
                    email_personal: emailMatch ? emailMatch[1] : '',
                    telefono_personal: telMatch ? telMatch[1] : '',
                    cargo_puesto: 'Técnico Especialista'
                };
            }
        }

        const idInput = document.getElementById('modal-trab-id');
        const nombresInput = document.getElementById('modal-trab-nombres');
        const apellidosInput = document.getElementById('modal-trab-apellidos');
        const docInput = document.getElementById('modal-trab-doc');
        const emailInput = document.getElementById('modal-trab-email');
        const telInput = document.getElementById('modal-trab-telefono');
        const cargoInput = document.getElementById('modal-trab-cargo');

        if (idInput) idInput.value = trabajadorId;
        if (nombresInput) nombresInput.value = trab ? (trab.nombres || '') : '';
        if (apellidosInput) apellidosInput.value = trab ? (trab.apellidos || '') : '';
        if (docInput) docInput.value = trab ? (trab.numero_documento || '') : '';
        if (emailInput) emailInput.value = trab ? (trab.email_personal || '') : '';
        if (telInput) telInput.value = trab ? (trab.telefono_personal || '') : '';
        if (cargoInput) cargoInput.value = trab ? (trab.cargo_puesto || '') : '';

        // Manejo de Foto de Perfil
        const fotoBase64Input = document.getElementById('modal-trab-foto-base64');
        const fotoImg = document.getElementById('modal-trab-foto-img');
        const fotoPlaceholder = document.getElementById('modal-trab-foto-placeholder');
        const btnEliminarFoto = document.getElementById('btn-eliminar-foto-perfil');
        const fileInput = document.getElementById('modal-trab-foto-input');
        if (fileInput) fileInput.value = '';

        if (trab && trab.foto_perfil) {
            if (fotoBase64Input) fotoBase64Input.value = trab.foto_perfil;
            if (fotoImg) {
                fotoImg.src = trab.foto_perfil;
                fotoImg.style.display = 'block';
            }
            if (fotoPlaceholder) fotoPlaceholder.style.display = 'none';
            if (btnEliminarFoto) btnEliminarFoto.style.display = 'inline-block';
        } else {
            if (fotoBase64Input) fotoBase64Input.value = '';
            if (fotoImg) {
                fotoImg.src = '';
                fotoImg.style.display = 'none';
            }
            if (fotoPlaceholder) fotoPlaceholder.style.display = 'block';
            if (btnEliminarFoto) btnEliminarFoto.style.display = 'none';
        }

        const modal = document.getElementById('modal-editar-trabajador');
        if (modal) {
            modal.style.display = 'flex';
            modal.style.zIndex = '99999';
        }
    } catch (err) {
        console.error('Error abriendo modal de edición:', err);
        alert('Error cargando datos del empleado: ' + err.message);
    }
}

function handleFotoSeleccionada(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        return alert('Por favor seleccione un archivo de imagen válido (JPG, PNG).');
    }

    // Comprimir / redimensionar imagen en el cliente para máxima velocidad (máx 400x500px)
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 400;
            const MAX_HEIGHT = 500;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);

            const fotoBase64Input = document.getElementById('modal-trab-foto-base64');
            const fotoImg = document.getElementById('modal-trab-foto-img');
            const fotoPlaceholder = document.getElementById('modal-trab-foto-placeholder');
            const btnEliminarFoto = document.getElementById('btn-eliminar-foto-perfil');

            if (fotoBase64Input) fotoBase64Input.value = compressedBase64;
            if (fotoImg) {
                fotoImg.src = compressedBase64;
                fotoImg.style.display = 'block';
            }
            if (fotoPlaceholder) fotoPlaceholder.style.display = 'none';
            if (btnEliminarFoto) btnEliminarFoto.style.display = 'inline-block';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function removerFotoPerfil() {
    const fotoBase64Input = document.getElementById('modal-trab-foto-base64');
    const fotoImg = document.getElementById('modal-trab-foto-img');
    const fotoPlaceholder = document.getElementById('modal-trab-foto-placeholder');
    const btnEliminarFoto = document.getElementById('btn-eliminar-foto-perfil');
    const fileInput = document.getElementById('modal-trab-foto-input');

    if (fotoBase64Input) fotoBase64Input.value = '';
    if (fileInput) fileInput.value = '';
    if (fotoImg) {
        fotoImg.src = '';
        fotoImg.style.display = 'none';
    }
    if (fotoPlaceholder) fotoPlaceholder.style.display = 'block';
    if (btnEliminarFoto) btnEliminarFoto.style.display = 'none';
}

function closeEditTrabajadorModal() {
    const modal = document.getElementById('modal-editar-trabajador');
    if (modal) modal.style.display = 'none';
}

async function handleSaveTrabajadorEdit(e) {
    e.preventDefault();
    const id = document.getElementById('modal-trab-id').value;
    if (!id) return;

    const payload = {
        nombres: document.getElementById('modal-trab-nombres').value.trim(),
        apellidos: document.getElementById('modal-trab-apellidos').value.trim(),
        numero_documento: document.getElementById('modal-trab-doc').value.trim(),
        email_personal: document.getElementById('modal-trab-email').value.trim(),
        telefono_personal: document.getElementById('modal-trab-telefono').value.trim(),
        cargo_puesto: document.getElementById('modal-trab-cargo').value.trim(),
        foto_perfil: document.getElementById('modal-trab-foto-base64') ? document.getElementById('modal-trab-foto-base64').value : null
    };

    try {
        const res = await fetch(`/api/v1/trabajadores/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al actualizar empleado.');

        closeEditTrabajadorModal();
        loadCertificados();
        loadDashboardKPIs();

        if (payload.email_personal && payload.email_personal.includes('@')) {
            const deseaReenviar = confirm(`¿Desea reenviar de inmediato la Notificación Oficial de Habilitación al nuevo correo registrado (${payload.email_personal})?`);
            if (deseaReenviar) {
                try {
                    const notifyRes = await fetch('/api/v1/trabajadores/reenviar-notificacion', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ trabajador_id: id, email_nuevo: payload.email_personal })
                    });
                    const notifyData = await notifyRes.json();
                    if (notifyRes.ok) {
                        alert(`¡Notificación oficial enviada exitosamente a ${payload.email_personal}!`);
                        if (notifyData && notifyData.cuerpo_html) {
                            mostrarModalPreviewHTML(notifyData);
                        }
                    } else {
                        alert('No se pudo enviar el correo: ' + (notifyData.error || 'Error desconocido'));
                    }
                } catch (errNotif) {
                    console.error('Error al reenviar notificación:', errNotif);
                    alert('Error de conexión al despachar el correo: ' + errNotif.message);
                }
            }
        }
    } catch (err) {
        alert('Error guardando cambios: ' + err.message);
    }
}

async function eliminarCertificadoJS(certId) {
    if (!certId) return alert('ID de certificado no válido.');
    if (!confirm('¿Está seguro de eliminar este certificado de la Base de Datos? Esta acción recalculará la habilitación del trabajador y no se puede deshacer.')) return;
    
    try {
        const res = await fetch(`/api/v1/certificados/${encodeURIComponent(certId)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al eliminar certificado');
        
        alert('Certificado eliminado exitosamente.');
        loadCertificados();
        loadDashboardKPIs();
    } catch(err) {
        alert('Error al eliminar certificado: ' + err.message);
    }
}

// Hook into initial loads
const oldIniciarSesionUsuario = iniciarSesionUsuario;
iniciarSesionUsuario = function(user) {
    oldIniciarSesionUsuario(user);
    checkSMTPStatus();
};

// Funciones de Visualización de Certificado PDF
function abrirVisorPDF(nombreArchivo, tituloCurso, trabajadorNombre) {
    if (!nombreArchivo) {
        alert('Este certificado no tiene un archivo adjunto en el sistema.');
        return;
    }
    const modal = document.getElementById('modal-visor-pdf');
    const iframe = document.getElementById('pdf-viewer-frame');
    const titleEl = document.getElementById('pdf-viewer-title');
    const subTitleEl = document.getElementById('pdf-viewer-subtitle');
    const btnExt = document.getElementById('btn-pdf-external');

    const fileUrl = `/api/v1/certificados/archivo/${encodeURIComponent(nombreArchivo)}`;

    if (titleEl) titleEl.textContent = tituloCurso ? `📄 ${tituloCurso}` : '📄 Certificado Oficial';
    if (subTitleEl) subTitleEl.textContent = trabajadorNombre ? `Titular: ${trabajadorNombre}` : `Archivo: ${nombreArchivo}`;
    if (btnExt) btnExt.href = fileUrl;
    if (iframe) iframe.src = fileUrl;

    if (modal) modal.style.display = 'flex';
}

function cerrarVisorPDF() {
    const modal = document.getElementById('modal-visor-pdf');
    const iframe = document.getElementById('pdf-viewer-frame');
    if (iframe) iframe.src = '';
    if (modal) modal.style.display = 'none';
}

window.abrirVisorPDF = abrirVisorPDF;
window.cerrarVisorPDF = cerrarVisorPDF;
window.abrirModalEditarTrabajador = abrirModalEditarTrabajador;
window.closeEditTrabajadorModal = closeEditTrabajadorModal;
window.handleSaveTrabajadorEdit = handleSaveTrabajadorEdit;
window.handleFotoSeleccionada = handleFotoSeleccionada;
window.removerFotoPerfil = removerFotoPerfil;
window.eliminarCertificadoJS = eliminarCertificadoJS;
window.enviarNotificacionMasivaIncompletosJS = enviarNotificacionMasivaIncompletosJS;
window.filterCertificatesTable = filterCertificatesTable;

// =========================================================================
// MÓDULO FRONTEND: SOLICITUDES DE CORRECCIÓN (TRABAJADOR <-> ADMIN)
// =========================================================================

function abrirModalSolicitudDesdeKiosco() {
    if (!datosKioscoActivo || !datosKioscoActivo.trabajador) return;
    const trab = datosKioscoActivo.trabajador;

    document.getElementById('sol-trabajador-id').value = trab.id;
    document.getElementById('sol-certificado-id').value = '';
    document.getElementById('sol-trabajador-nombre').value = `${trab.nombres} ${trab.apellidos} (DNI: ${trab.numero_documento})`;
    document.getElementById('sol-campo-afectado').value = 'numero_documento';
    document.getElementById('sol-valor-anterior').value = trab.numero_documento || 'Sin DNI';
    document.getElementById('sol-valor-solicitado').value = '';
    document.getElementById('sol-motivo').value = '';
    document.getElementById('sol-contacto').value = trab.email_personal || trab.telefono_personal || '';

    const modal = document.getElementById('modal-solicitar-correccion');
    if (modal) modal.style.display = 'flex';
}

function actualizarPlaceholderSolicitud() {
    if (!datosKioscoActivo || !datosKioscoActivo.trabajador) return;
    const trab = datosKioscoActivo.trabajador;
    const campo = document.getElementById('sol-campo-afectado').value;

    let anterior = '';
    if (campo === 'numero_documento') anterior = trab.numero_documento;
    else if (campo === 'nombres') anterior = trab.nombres;
    else if (campo === 'apellidos') anterior = trab.apellidos;
    else if (campo === 'email_personal') anterior = trab.email_personal;
    else if (campo === 'telefono_personal') anterior = trab.telefono_personal;
    else if (campo === 'cargo_puesto') anterior = trab.cargo_puesto;

    document.getElementById('sol-valor-anterior').value = anterior || 'No registrado';
}

function cerrarModalSolicitudCorreccion() {
    const modal = document.getElementById('modal-solicitar-correccion');
    if (modal) modal.style.display = 'none';
}

async function enviarSolicitudCorreccion(e) {
    e.preventDefault();
    const trabId = document.getElementById('sol-trabajador-id').value;
    const certId = document.getElementById('sol-certificado-id').value;
    const campo = document.getElementById('sol-campo-afectado').value;
    const anterior = document.getElementById('sol-valor-anterior').value;
    const solicitado = document.getElementById('sol-valor-solicitado').value.trim();
    const motivo = document.getElementById('sol-motivo').value.trim();
    const contacto = document.getElementById('sol-contacto').value.trim();

    if (!solicitado) return alert('Por favor ingrese el nuevo valor requerido.');

    try {
        const res = await fetch('/api/v1/trabajadores/solicitudes-correccion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trabajador_id: trabId,
                certificado_id: certId || null,
                campo_afectado: campo,
                valor_anterior: anterior,
                valor_solicitado: solicitado,
                motivo_observacion: motivo,
                solicitante_contacto: contacto
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al enviar solicitud.');

        alert('¡Solicitud registrada exitosamente!\nHa sido puesta en la bandeja del Administrador HSE para validación legal.');
        cerrarModalSolicitudCorreccion();
        actualizarBadgeSolicitudesPendientes();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function loadSolicitudesCorreccion() {
    const tbody = document.getElementById('tbody-solicitudes');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:var(--text-secondary);">Cargando solicitudes de auditoría...</td></tr>';

    try {
        let url = '/api/v1/trabajadores/solicitudes-correccion';
        if (usuarioSesionActivo && usuarioSesionActivo.rol === 'CONTRATISTA' && usuarioSesionActivo.empresa_id) {
            url += '?empresa_id=' + encodeURIComponent(usuarioSesionActivo.empresa_id);
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error('Error al obtener solicitudes.');

        const lista = await res.json();
        if (!lista || lista.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem; color:var(--text-secondary);">✓ No hay solicitudes de corrección pendientes en este momento.</td></tr>';
            actualizarBadgeSolicitudesPendientes(0);
            return;
        }

        const pendientes = lista.filter(s => s.estado === 'PENDIENTE').length;
        actualizarBadgeSolicitudesPendientes(pendientes);

        tbody.innerHTML = lista.map(s => {
            const esPendiente = s.estado === 'PENDIENTE';
            let badgeEst = '';
            if (s.estado === 'PENDIENTE') badgeEst = '<span class="badge badge-warning">⏳ Pendiente</span>';
            else if (s.estado === 'APROBADA') badgeEst = '<span class="badge badge-success">✓ Aprobada</span>';
            else badgeEst = '<span class="badge badge-danger">✕ Rechazada</span>';

            const nombreCompleto = s.trabajador_nombres ? `${s.trabajador_nombres} ${s.trabajador_apellidos || ''}` : (s.trabajador_nombre || 'Trabajador');

            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <td style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap;">
                        ${s.fecha_solicitud ? s.fecha_solicitud.substring(0, 16).replace('T', ' ') : '-'}
                    </td>
                    <td>
                        <strong style="color: #fff; font-size: 0.88rem;">${nombreCompleto}</strong><br>
                        <small style="color: var(--accent-cyan); font-family: monospace;">Doc: ${s.trabajador_doc || 'S/D'}</small>
                    </td>
                    <td style="font-size: 0.82rem; color: var(--text-secondary);">
                        ${s.empresa_nombre || 'Empresa Contratista'}
                    </td>
                    <td>
                        <code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: var(--accent-amber);">
                            ${s.campo_afectado}
                        </code>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 3px;">
                            Antes: ${s.valor_anterior || '<em>Vacío</em>'}
                        </div>
                    </td>
                    <td>
                        <strong style="color: var(--success); font-size: 0.88rem;">
                            ${s.valor_solicitado}
                        </strong>
                    </td>
                    <td style="font-size: 0.82rem; color: var(--text-secondary); max-width: 200px;">
                        ${s.motivo_observacion || '-'}<br>
                        ${s.solicitante_contacto ? `<small style="color: var(--accent-cyan);">Contacto: ${s.solicitante_contacto}</small>` : ''}
                    </td>
                    <td>
                        ${badgeEst}
                        ${s.revisado_por ? `<div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 3px;">Por: ${s.revisado_por}</div>` : ''}
                    </td>
                    <td>
                        ${esPendiente ? `
                            <div style="display: flex; gap: 6px;">
                                <button type="button" class="btn-primary" style="padding: 4px 8px; font-size: 0.75rem; background: linear-gradient(135deg, #10b981, #059669); color: white;" onclick="resolverSolicitudJS('${s.id}', 'APROBADA')" title="Aprobar corrección y aplicar cambio">
                                    ✓ Aprobar
                                </button>
                                <button type="button" class="btn-primary" style="padding: 4px 8px; font-size: 0.75rem; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #f87171;" onclick="resolverSolicitudJS('${s.id}', 'RECHAZADA')" title="Rechazar observación">
                                    ✕ Rechazar
                                </button>
                            </div>
                        ` : `
                            <span style="font-size: 0.75rem; color: var(--text-secondary);">Resuelta</span>
                        `}
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:var(--danger); text-align:center;">Error: ${err.message}</td></tr>`;
    }
}

async function resolverSolicitudJS(solicitudId, accion) {
    const motivo = prompt(`Ingrese sustento u observación administrativa para ${accion}:`, accion === 'APROBADA' ? 'Conforme con cotejo documental oficial' : 'Datos no coinciden con documento legal');
    if (motivo === null) return;

    try {
        const revisor = (usuarioSesionActivo && usuarioSesionActivo.nombre_completo) ? usuarioSesionActivo.nombre_completo : 'Administrador HSE';

        const res = await fetch(`/api/v1/trabajadores/solicitudes-correccion/${encodeURIComponent(solicitudId)}/resolver`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accion: accion,
                respuesta_admin: motivo,
                revisor_nombre: revisor
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al procesar resolución.');

        alert(`¡Solicitud ${accion} correctamente! El cambio fue procesado en la base de datos.`);
        loadSolicitudesCorreccion();
        loadCertificados();
        loadDashboardKPIs();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function actualizarBadgeSolicitudesPendientes(conteoDirecto) {
    const badge = document.getElementById('badge-solicitudes-pendientes');
    if (!badge) return;

    if (typeof conteoDirecto === 'number') {
        badge.textContent = conteoDirecto;
        badge.style.display = conteoDirecto > 0 ? 'inline-block' : 'none';
        return;
    }

    try {
        const res = await fetch('/api/v1/trabajadores/solicitudes-correccion');
        if (res.ok) {
            const list = await res.json();
            const pend = Array.isArray(list) ? list.filter(s => s.estado === 'PENDIENTE').length : 0;
            badge.textContent = pend;
            badge.style.display = pend > 0 ? 'inline-block' : 'none';
        }
    } catch(e) {}
}

window.abrirModalSolicitudDesdeKiosco = abrirModalSolicitudDesdeKiosco;
window.actualizarPlaceholderSolicitud = actualizarPlaceholderSolicitud;
window.cerrarModalSolicitudCorreccion = cerrarModalSolicitudCorreccion;
window.enviarSolicitudCorreccion = enviarSolicitudCorreccion;
window.loadSolicitudesCorreccion = loadSolicitudesCorreccion;
window.resolverSolicitudJS = resolverSolicitudJS;
window.actualizarBadgeSolicitudesPendientes = actualizarBadgeSolicitudesPendientes;

// =========================================================================
// MÓDULO TAB KIOSCO INTEGRADO EN PANEL PRINCIPAL
// =========================================================================

function initTabKiosko() {
    const input = document.getElementById('input-kiosko-tab-dni');
    if (input) {
        input.focus();
        if (!input.value && usuarioSesionActivo && usuarioSesionActivo.rol === 'CONTRATISTA') {
            // Sugerir búsqueda
            input.placeholder = "Ingrese DNI o Nombres del trabajador a auditar...";
        }
    }
}

async function consultarKioskoDesdeTab() {
    const input = document.getElementById('input-kiosko-tab-dni');
    const query = input ? input.value.trim() : '';
    const container = document.getElementById('kiosko-tab-result-container');

    if (!query || query.length < 3) {
        return alert('Por favor ingrese al menos 3 caracteres (DNI o nombre del trabajador).');
    }

    try {
        const res = await fetch(`/api/v1/trabajadores/consulta-dni/${encodeURIComponent(query)}`);
        const data = await res.json();

        if (!res.ok) {
            return alert(data.error || 'No se encontró ningún trabajador con el dato ingresado.');
        }

        datosKioscoActivo = data;
        renderizarKioskoEnTab(data);
    } catch (err) {
        alert('Error consultando servidor: ' + err.message);
    }
}

function renderizarKioskoEnTab(data) {
    const container = document.getElementById('kiosko-tab-result-container');
    if (!container) return;

    const trab = data.trabajador;
    const certs = data.certificados || [];

    const esHabilitado = trab.estado_habilitacion === 'HABILITADO';
    const esProximo = trab.estado_habilitacion === 'PROXIMO_A_VENCER';

    let badgeHtml = '';
    if (esHabilitado) {
        badgeHtml = `
            <div style="background: rgba(16, 185, 129, 0.15); border: 1.5px solid #10b981; color: #34d399; padding: 1rem 1.25rem; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                <div>
                    <span style="font-size: 1.05rem; font-weight: 800;">✅ PASE HABILITADO - ACCESO PERMITIDO A PLANTA</span><br>
                    <small style="color: #a7f3d0; font-size: 0.8rem;">Cumplimiento verificado bajo normativa minera D.S. 024-2016-EM</small>
                </div>
                <span class="badge badge-success" style="font-size: 0.82rem; padding: 6px 12px;">APTO</span>
            </div>
        `;
    } else if (esProximo) {
        badgeHtml = `
            <div style="background: rgba(245, 158, 11, 0.15); border: 1.5px solid #f59e0b; color: #fbbf24; padding: 1rem 1.25rem; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                <div>
                    <span style="font-size: 1.05rem; font-weight: 800;">⚠️ ALERTA PREVENTIVA - PASE POR VENCER (&le; 90 DÍAS)</span><br>
                    <small style="color: #fde68a; font-size: 0.8rem;">Coordinar recertificación obligatoria con la contratista</small>
                </div>
                <span class="badge badge-warning" style="font-size: 0.82rem; padding: 6px 12px;">POR VENCER</span>
            </div>
        `;
    } else {
        badgeHtml = `
            <div style="background: rgba(239, 68, 68, 0.15); border: 1.5px solid #ef4444; color: #f87171; padding: 1rem 1.25rem; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
                <div>
                    <span style="font-size: 1.05rem; font-weight: 800;">⛔ ACCESO RESTRINGIDO - INHABILITADO EN GARITA</span><br>
                    <small style="color: #fca5a5; font-size: 0.8rem;">Certificados vencidos, observados o no homologados en el sistema</small>
                </div>
                <span class="badge badge-danger" style="font-size: 0.82rem; padding: 6px 12px;">NO APTO</span>
            </div>
        `;
    }

    let filasCerts = '';
    certs.forEach((c, idx) => {
        let badgeVig = '';
        if (c.dias_restantes <= 0) badgeVig = `<span class="badge badge-danger">⛔ VENCIDO</span>`;
        else if (c.dias_restantes <= 90) badgeVig = `<span class="badge badge-warning">⚠️ ${c.dias_restantes}d</span>`;
        else badgeVig = `<span class="badge badge-success">✓ VIGENTE (${c.dias_restantes}d)</span>`;

        filasCerts += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.15s ease;">
                <td style="padding: 12px 10px; color: var(--text-secondary); font-size: 0.85rem; font-weight: 600; text-align: center;">${idx + 1}</td>
                <td style="padding: 12px 14px;">
                    <div style="font-weight: 700; color: #f8fafc; font-size: 0.92rem; line-height: 1.35; margin-bottom: 4px;">${c.nombre_curso}</div>
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 0.78rem; color: #94a3b8;">
                        <span style="display: inline-flex; align-items: center; gap: 4px;">🏢 ${c.entidad_emisora}</span>
                        <span>•</span>
                        <span style="display: inline-flex; align-items: center; gap: 4px; color: #38bdf8; font-weight: 600;">⏱️ ${c.horas_lectivas} hrs</span>
                    </div>
                </td>
                <td style="padding: 12px 10px; font-size: 0.84rem; color: #cbd5e1; font-family: 'JetBrains Mono', Consolas, monospace; white-space: nowrap;">
                    ${formatFechaUI(c.fecha_emision)}
                </td>
                <td style="padding: 12px 10px; font-size: 0.84rem; font-weight: 700; color: #f8fafc; font-family: 'JetBrains Mono', Consolas, monospace; white-space: nowrap;">
                    ${formatFechaUI(c.fecha_vencimiento)}
                </td>
                <td style="padding: 12px 10px; text-align: center; white-space: nowrap;">
                    ${badgeVig}
                </td>
                <td style="padding: 12px 12px; text-align: center; vertical-align: middle;">
                    <div style="display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 6px; width: 130px; margin: 0 auto;">
                        ${c.pdf_filename ? `
                            <button type="button" class="kiosko-action-btn btn-view-pdf" onclick="abrirVisorPDF('${c.pdf_filename}', '${(c.nombre_curso || 'Certificado').replace(/'/g, "\\'")}', '${(trab.nombres + ' ' + trab.apellidos).replace(/'/g, "\\'")}')" title="Visualizar Certificado Oficial">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                <span>Ver PDF</span>
                            </button>
                            <button type="button" class="kiosko-action-btn btn-change-pdf" onclick="abrirModalAdjuntarPDF('${c.id}', '${(trab.nombres + ' ' + trab.apellidos).replace(/'/g, "\\'")}', '${trab.numero_documento || ''}', '${(c.nombre_curso || '').replace(/'/g, "\\'")}')" title="Actualizar o Reemplazar Documento">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                                <span>Cambiar PDF</span>
                            </button>
                        ` : `
                            <button type="button" class="kiosko-action-btn btn-attach-pdf" onclick="abrirModalAdjuntarPDF('${c.id}', '${(trab.nombres + ' ' + trab.apellidos).replace(/'/g, "\\'")}', '${trab.numero_documento || ''}', '${(c.nombre_curso || '').replace(/'/g, "\\'")}')" title="Adjuntar PDF Original">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                <span>Adjuntar PDF</span>
                            </button>
                        `}
                        <button type="button" class="kiosko-action-btn btn-delete-cert" onclick="eliminarCertificadoDesdeKiosko('${c.id}')" title="Eliminar Certificado">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            <span>Eliminar</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    container.innerHTML = `
        <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1.5rem;">
            ${badgeHtml}

            <!-- Ficha del Trabajador -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; background: rgba(255,255,255,0.02); padding: 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); margin-bottom: 1.25rem;">
                <div>
                    <small style="color: var(--text-secondary); font-size: 0.75rem; display: block;">Trabajador Titular</small>
                    <strong style="color: #fff; font-size: 1rem;">${trab.nombres} ${trab.apellidos}</strong>
                    <div style="color: var(--accent-cyan); font-family: monospace; font-size: 0.82rem;">${trab.tipo_documento}: ${trab.numero_documento}</div>
                </div>
                <div>
                    <small style="color: var(--text-secondary); font-size: 0.75rem; display: block;">Empresa Contratista</small>
                    <strong style="color: #fff; font-size: 0.9rem;">${trab.empresa_nombre}</strong>
                    <div style="color: var(--text-secondary); font-size: 0.8rem;">RUC: ${trab.empresa_ruc || 'N/A'}</div>
                </div>
                <div>
                    <small style="color: var(--text-secondary); font-size: 0.75rem; display: block;">Cargo Asignado</small>
                    <strong style="color: var(--accent-amber); font-size: 0.9rem;">${trab.cargo_puesto || 'Técnico Especialista'}</strong>
                    <div style="color: var(--text-secondary); font-size: 0.8rem;">Área: ${trab.area_trabajo || 'Planta / Mina'}</div>
                </div>
                <div>
                    <small style="color: var(--text-secondary); font-size: 0.75rem; display: block;">Contacto Registrado</small>
                    <code style="color: var(--accent-cyan); font-size: 0.82rem;">${trab.email_personal || 'No registrado'}</code>
                    <div style="color: var(--text-secondary); font-size: 0.8rem;">Celular: ${trab.telefono_personal || 'No registrado'}</div>
                </div>
            </div>

            <!-- Tabla de Certificados -->
            <div style="margin-bottom: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem;">
                    <strong style="color: #fff; font-size: 0.9rem;">Certificaciones y Homologaciones (${certs.length})</strong>
                    <span style="font-size: 0.78rem; color: var(--text-secondary);">Exigidas por D.S. 024-2016-EM</span>
                </div>
                <div style="overflow-x: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                        <thead>
                            <tr style="background: rgba(255,255,255,0.04); font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;">
                                <th style="padding: 10px; width: 40px; text-align: center;">#</th>
                                <th style="padding: 10px; min-width: 250px;">Curso / Capacitación</th>
                                <th style="padding: 10px; width: 110px; white-space: nowrap;">Emisión</th>
                                <th style="padding: 10px; width: 120px; white-space: nowrap;">Vencimiento</th>
                                <th style="padding: 10px; width: 130px; text-align: center; white-space: nowrap;">Estado</th>
                                <th style="padding: 10px; width: 160px; text-align: center; white-space: nowrap;">Documento & Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filasCerts || '<tr><td colspan="6" style="padding: 1.5rem; text-align: center; color: var(--text-secondary);">No se registraron certificados en base de datos.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Botones de Acción -->
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); padding: 12px; border-radius: 8px;">
                <div>
                    <strong style="color: #fff; font-size: 0.88rem;">Credencial Oficial & Solicitudes</strong>
                    <p style="margin: 2px 0 0 0; font-size: 0.78rem; color: var(--text-secondary);">Descargue su fotocheck oficial con código QR o solicite corrección de datos.</p>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <a href="/api/v1/trabajadores/fotocheck/${encodeURIComponent(trab.id)}" target="_blank" class="btn-primary" style="font-size: 0.85rem; padding: 0.5rem 1rem; background: linear-gradient(135deg, #a855f7, #7e22ce); color: #fff; font-weight: 700; border: none; border-radius: 6px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                        🖨️ Imprimir Carnet / Fotocheck
                    </a>
                    <button type="button" class="btn-warning" onclick="abrirModalSolicitudDesdeKiosco()" style="font-size: 0.85rem; padding: 0.5rem 1rem; background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; font-weight: 700; border: none; border-radius: 6px; cursor: pointer;">
                        ⚠️ Solicitar Corrección
                    </button>
                </div>
            </div>
        </div>
    `;

    container.style.display = 'block';
}

async function eliminarCertificadoDesdeKiosko(certId) {
    if (!certId) return alert('ID de certificado no válido.');
    if (!confirm('¿Está seguro de eliminar este certificado? Esta acción recalculará la habilitación del trabajador en garita.')) return;

    try {
        const res = await fetch(`/api/v1/certificados/${encodeURIComponent(certId)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al eliminar certificado');

        alert('Certificado eliminado exitosamente.');
        // Re-consultar la ficha en el Kiosco para reflejar el cambio en tiempo real
        await consultarKioskoDesdeTab();
        loadCertificados();
        loadDashboardKPIs();
    } catch(err) {
        alert('Error al eliminar certificado: ' + err.message);
    }
}

window.initTabKiosko = initTabKiosko;
window.consultarKioskoDesdeTab = consultarKioskoDesdeTab;
window.renderizarKioskoEnTab = renderizarKioskoEnTab;
window.eliminarCertificadoDesdeKiosko = eliminarCertificadoDesdeKiosko;

function descargarPadronFiltrado() {
    let url = '/api/v1/reportes/descargar-padron-excel';
    const empTarget = esUsuarioEmpresa() ? usuarioSesionActivo.empresa_id : superAdminScopeCompanyId;
    if (empTarget) {
        url += '?empresa_id=' + encodeURIComponent(empTarget);
    }
    window.location.href = url;
}

window.descargarPadronFiltrado = descargarPadronFiltrado;

// =========================================================================
// GESTIÓN DEL MODAL PARA ADJUNTAR SUSTENTO DIGITAL PDF (80% -> 100%)
// =========================================================================
function abrirModalAdjuntarPDF(certId, trabNombre, trabDoc, cursoNombre) {
    document.getElementById('adjunto-cert-id').value = certId;
    document.getElementById('adjunto-trab-nombre').textContent = trabNombre || 'Personal Minero';
    document.getElementById('adjunto-trab-doc').textContent = trabDoc ? `(Doc: ${trabDoc})` : '';
    document.getElementById('adjunto-cert-curso').textContent = cursoNombre || 'Certificado de Homologación';

    // Resetear dropzone y archivo
    const fileInput = document.getElementById('input-file-adjunto-pdf');
    if (fileInput) fileInput.value = '';
    const labelPreview = document.getElementById('adjunto-pdf-filename-preview');
    if (labelPreview) labelPreview.textContent = 'Ningún archivo seleccionado';
    const statusBox = document.getElementById('adjunto-status-alert');
    if (statusBox) statusBox.style.display = 'none';

    document.getElementById('modal-adjuntar-pdf').style.display = 'flex';
}

function cerrarModalAdjuntarPDF() {
    document.getElementById('modal-adjuntar-pdf').style.display = 'none';
}

function handleFileSelectedAdjuntoPDF() {
    const fileInput = document.getElementById('input-file-adjunto-pdf');
    const labelPreview = document.getElementById('adjunto-pdf-filename-preview');
    if (fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        labelPreview.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    } else {
        labelPreview.textContent = 'Ningún archivo seleccionado';
    }
}

async function handleGuardarAdjuntoPDF(e) {
    e.preventDefault();
    const certId = document.getElementById('adjunto-cert-id').value;
    const fileInput = document.getElementById('input-file-adjunto-pdf');
    const statusBox = document.getElementById('adjunto-status-alert');
    const btnSubmit = document.getElementById('btn-submit-adjuntar-pdf');

    if (!fileInput.files || fileInput.files.length === 0) {
        alert('Por favor seleccione el archivo PDF del diploma escaneado.');
        return;
    }

    const formData = new FormData();
    formData.append('pdfFile', fileInput.files[0]);

    if (usuarioSesionActivo) {
        formData.append('usuario_id', usuarioSesionActivo.id);
        formData.append('usuario_nombre', usuarioSesionActivo.nombre_completo);
        formData.append('usuario_rol', usuarioSesionActivo.rol);
        formData.append('usuario_email', usuarioSesionActivo.email);
    }

    try {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<span>⏳ Procesando y Validando OCR...</span>';
        statusBox.style.display = 'none';

        const res = await fetch(`/api/v1/certificados/${certId}/adjuntar-pdf`, {
            method: 'POST',
            body: formData
        });

        const result = await res.json();
        if (!res.ok) {
            throw new Error(result.error || 'Error al adjuntar sustento PDF');
        }

        // Mostrar advertencias de OCR si existen o éxito total
        let mensaje = result.message || 'Sustento PDF adjuntado correctamente.';
        if (result.ocr_analisis && result.ocr_analisis.advertencias && result.ocr_analisis.advertencias.length > 0) {
            mensaje += '\n\n⚠️ NOTAS DE AUDITORÍA OCR:\n' + result.ocr_analisis.advertencias.join('\n');
        }

        alert(mensaje);
        cerrarModalAdjuntarPDF();
        loadCertificados();
        loadDashboardKPIs();
        loadAlertasLog();
        const inputKiosko = document.getElementById('input-kiosko-tab-dni');
        if (inputKiosko && inputKiosko.value.trim().length >= 3) {
            consultarKioskoDesdeTab();
        }

    } catch (err) {
        statusBox.style.display = 'block';
        statusBox.style.background = 'rgba(239, 68, 68, 0.2)';
        statusBox.style.color = '#fca5a5';
        statusBox.style.border = '1px solid #ef4444';
        statusBox.textContent = '❌ ' + err.message;
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<span>📎 Cargar y Acreditar al 100%</span>';
    }
}

window.abrirModalAdjuntarPDF = abrirModalAdjuntarPDF;
window.cerrarModalAdjuntarPDF = cerrarModalAdjuntarPDF;
window.handleFileSelectedAdjuntoPDF = handleFileSelectedAdjuntoPDF;
window.handleGuardarAdjuntoPDF = handleGuardarAdjuntoPDF;

async function limpiarTodoHistorialDesdeUI() {
    if (!confirm('⚠️ ¿Está seguro de limpiar todo el historial de pruebas?\n\nEsta acción eliminará todos los trabajadores, certificados y alertas registradas para comenzar desde cero de manera limpia.')) {
        return;
    }

    try {
        const res = await fetch('/api/v1/trabajadores/limpiar-todo', {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al limpiar base de datos.');

        alert('✅ ' + (data.message || 'Base de datos restablecida a 0.'));
        loadCertificados();
        loadDashboardKPIs();
        loadCompanyProfiles();
        loadAlertasLog();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

window.limpiarTodoHistorialDesdeUI = limpiarTodoHistorialDesdeUI;







