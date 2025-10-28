document.addEventListener('DOMContentLoaded', () => {
    // --- State & Config ---
    const config = {
        api: {
            staffLogin: '/api/staff-login',
            getStats: '/api/get-stats',
            getSystemStatus: '/api/get-system-status',
            updateSystemStatus: '/api/update-system-status',
            searchAttendees: '/api/search-attendees',
            timeout: 20000,
        },
        placeholders: {
            avatar: 'https://placehold.co/150x150/6c757d/white?text=No+Photo'
        }
    };

    const appState = {
        isLoggedIn: false,
        // store staff password in-memory only so a hard refresh requires re-login
        staffPassword: null,
        systemStatus: {
            registration_enabled: false,
            maintenance_mode: false,
        },
        healthStatus: {
            api: 'checking',
            db: 'checking',
            cloudinary: 'checking',
        },
        attendees: [],
        debounceTimer: null,
    };

    // --- DOM Element Cache ---
    const ui = {
        body: document.body,
        loginModal: document.getElementById('staff-login-modal'),
        loginForm: document.getElementById('staff-login-form'),
        passwordInput: document.getElementById('staff-password-input'),
        loginBtn: document.getElementById('staff-login-btn'),
        loginBtnText: document.getElementById('login-btn-text'),
        loginSpinner: document.getElementById('login-spinner'),
        loginMessage: document.getElementById('login-message'),

        // Stats
        totalRegistrations: document.getElementById('total-registrations'),
        totalCheckedIn: document.getElementById('total-checked-in'),
        totalPending: document.getElementById('total-pending'),
        checkInPercentage: document.getElementById('check-in-percentage'),

        // Controls
        registrationSwitch: document.getElementById('registration-switch'),
        registrationLabel: document.getElementById('registration-label'),
        maintenanceSwitch: document.getElementById('maintenance-switch'),
        maintenanceLabel: document.getElementById('maintenance-label'),

        // Health
        healthApi: document.getElementById('health-api'),
        healthDb: document.getElementById('health-db'),
        healthCloudinary: document.getElementById('health-cloudinary'),

        // Attendees
        searchInput: document.getElementById('search-attendee-input'),
    searchBtn: document.getElementById('search-attendee-btn'),
        refreshStatsBtn: document.getElementById('refresh-stats-btn'),
        filterSelect: document.getElementById('filter-attendee-select'),
        attendeeTableBody: document.getElementById('attendee-table-body'),
        attendeeTablePlaceholder: document.getElementById('attendee-table-placeholder'),
        adminLogoutBtn: document.getElementById('admin-logout-btn'),
        adminStatusBanner: document.getElementById('admin-status-banner'),
        adminStatusMessage: document.getElementById('admin-status-message'),
        adminStatusSubtext: document.getElementById('admin-status-subtext'),
        adminStatusRefresh: document.getElementById('admin-status-refresh'),
        adminStatusDismiss: document.getElementById('admin-status-dismiss'),
        // Modals
        editModalEl: document.getElementById('edit-attendee-modal'),
        editForm: document.getElementById('edit-attendee-form'),
        editRegistrationId: document.getElementById('edit-registration-id'),
        editFullName: document.getElementById('edit-full-name'),
        editEmail: document.getElementById('edit-email'),
        editPhone: document.getElementById('edit-phone'),

        deleteModalEl: document.getElementById('confirm-delete-modal'),
        deleteForm: document.getElementById('confirm-delete-form'),
        deleteRegistrationId: document.getElementById('delete-registration-id'),
        deletePasswordInput: document.getElementById('delete-password-input'),
        deleteError: document.getElementById('delete-error'),

        notFoundModalEl: document.getElementById('not-found-modal'),
        notFoundMessage: document.getElementById('not-found-message'),
    };

    // --- UI Helper Functions ---
    // Small toast helper placed near top-right of the page
    function showToast(message, isError = false, duration = 3000) {
        try {
            const toast = document.createElement('div');
            toast.className = `toast-notice position-fixed top-0 end-0 m-3 p-2 rounded shadow ${isError ? 'bg-danger text-white' : 'bg-success text-white'}`;
            toast.style.zIndex = 1060;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.transition = 'opacity 300ms';
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 350);
            }, duration);
        } catch (e) {
            console.warn('Could not show toast:', e);
        }
    }

    function setUIState(state) {
        if (!appState.isLoggedIn && state !== 'login') {
            ui.body.dataset.uiState = 'login';
            return;
        }
        ui.body.dataset.uiState = state;
    }

    function setLoginLoadingState(isLoading) {
        ui.loginSpinner.classList.toggle('d-none', !isLoading);
        ui.loginBtn.disabled = isLoading;
        ui.loginBtnText.textContent = isLoading ? 'Verifying...' : 'Login';
    }

    function showLoginMessage(message, type = 'danger') {
        ui.loginMessage.innerHTML = `<div class="alert alert-${type} py-2">${message}</div>`;
    }

    function updateStats(stats) {
        const { total_attendees = 0, checked_in_count = 0 } = stats;
        const pending = total_attendees - checked_in_count;
        const percentage = total_attendees > 0 ? ((checked_in_count / total_attendees) * 100).toFixed(1) : 0;

        ui.totalRegistrations.textContent = total_attendees;
        ui.totalCheckedIn.textContent = checked_in_count;
        ui.totalPending.textContent = pending;
        ui.checkInPercentage.textContent = `${percentage}%`;
    }

    function updateSystemControlsUI() {
        ui.registrationSwitch.checked = appState.systemStatus.registration_enabled;
        ui.registrationLabel.textContent = appState.systemStatus.registration_enabled ? 'Live' : 'Paused';
        ui.registrationLabel.className = appState.systemStatus.registration_enabled ? 'text-success' : 'text-danger';

        ui.maintenanceSwitch.checked = appState.systemStatus.maintenance_mode;
        ui.maintenanceLabel.textContent = appState.systemStatus.maintenance_mode ? 'Enabled' : 'Disabled';
        ui.maintenanceLabel.className = appState.systemStatus.maintenance_mode ? 'text-danger' : 'text-muted';
    }

    function updateHealthStatusUI() {
        const updateBadge = (element, status) => {
            let badgeClass = 'bg-secondary';
            let text = 'Checking...';
            switch (status) {
                case 'ok':
                    badgeClass = 'bg-success';
                    text = 'Online';
                    break;
                case 'error':
                    badgeClass = 'bg-danger';
                    text = 'Offline';
                    break;
            }
            element.className = `badge ${badgeClass}`;
            element.textContent = text;
        };
        updateBadge(ui.healthApi, appState.healthStatus.api);
        updateBadge(ui.healthDb, appState.healthStatus.db);
        updateBadge(ui.healthCloudinary, appState.healthStatus.cloudinary);
    }

    function renderAttendeeTable() {
        if (appState.attendees.length === 0) {
            ui.attendeeTablePlaceholder.innerHTML = '<p>No attendees found matching your criteria.</p>';
            ui.attendeeTablePlaceholder.style.display = 'block';
            ui.attendeeTableBody.innerHTML = '';
            return;
        }

        ui.attendeeTablePlaceholder.style.display = 'none';
        ui.attendeeTableBody.innerHTML = appState.attendees.map(attendee => `
            <tr data-regid="${attendee.registration_id}">
                <td>
                    <div class="d-flex align-items-center">
                        <img src="${attendee.profile_pic_url || config.placeholders.avatar}" class="attendee-avatar me-3" alt="Avatar">
                        <div>
                            <div class="fw-bold">${attendee.full_name || '—'}</div>
                            <div class="text-muted small">${attendee.email || ''}</div>
                        </div>
                    </div>
                </td>
                <td>${attendee.registration_id || '—'}</td>
                <td>${attendee.phone_number || ''}</td>
                <td>
                    ${(() => {
                        // Normalize checked-in value across schema variants ('checked_in', 'is_checked_in', boolean, text 't')
                        const raw = attendee.is_checked_in ?? attendee.checked_in ?? attendee.checkedIn ?? false;
                        const isChecked = (raw === true) || (raw === 't') || (raw === 'true') || (raw === 1) || (String(raw).toLowerCase() === 'true');
                        return `<span class="badge ${isChecked ? 'bg-success' : 'bg-warning'}">${isChecked ? 'Checked-In' : 'Not Checked-In'}</span>`;
                    })()}
                </td>
                <td>
                    <button class="btn btn-sm btn-outline-primary edit-btn" data-regid="${attendee.registration_id}">Edit</button>
                    <button class="btn btn-sm btn-outline-danger ms-2 delete-btn" data-regid="${attendee.registration_id}">Delete</button>
                </td>
            </tr>
        `).join('');
    }

    // Event delegation for edit/delete buttons in the attendee table
    ui.attendeeTableBody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.edit-btn');
        if (editBtn) {
            const regId = editBtn.dataset.regid;
            const attendee = appState.attendees.find(a => a.registration_id === regId);
            if (attendee) openEditModal(attendee);
            return;
        }
        const deleteBtn = e.target.closest('.delete-btn');
        if (deleteBtn) {
            const regId = deleteBtn.dataset.regid;
            const attendee = appState.attendees.find(a => a.registration_id === regId);
            if (attendee) openDeleteModal(attendee);
            return;
        }
    });

    // Modal helpers (Bootstrap)
    const editModal = ui.editModalEl ? new bootstrap.Modal(ui.editModalEl) : null;
    const deleteModal = ui.deleteModalEl ? new bootstrap.Modal(ui.deleteModalEl) : null;
    const notFoundModal = ui.notFoundModalEl ? new bootstrap.Modal(ui.notFoundModalEl) : null;

    function openEditModal(attendee) {
        ui.editRegistrationId.value = attendee.registration_id || '';
        ui.editFullName.value = attendee.full_name || '';
        ui.editEmail.value = attendee.email || '';
        ui.editPhone.value = attendee.phone_number || '';
        if (editModal) editModal.show();
    }

    function openDeleteModal(attendee) {
        ui.deleteRegistrationId.value = attendee.registration_id || '';
        ui.deletePasswordInput.value = '';
        ui.deleteError.textContent = '';
        if (deleteModal) deleteModal.show();
    }

    // --- API & Data Logic ---
    async function fetchWithTimeout(url, options, timeout = config.api.timeout) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    }

    async function handleLogin(password) {
        setLoginLoadingState(true);
        ui.loginMessage.innerHTML = '';
        try {
            const response = await fetchWithTimeout(config.api.staffLogin, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);

            if (result.success) {
                appState.isLoggedIn = true;
                // Keep password only in-memory so a hard refresh forces re-login
                appState.staffPassword = password;
                setUIState('dashboard');
                initializeAppDashboard();
            }
        } catch (error) {
            showLoginMessage(error.message || 'An unknown error occurred.');
        } finally {
            setLoginLoadingState(false);
        }
    }

    async function fetchDashboardData() {
        try {
            const authHeader = { 'Authorization': `Bearer ${appState.staffPassword || ''}` };
            const [statsRes, statusRes, healthRes] = await Promise.all([
                fetchWithTimeout(config.api.getStats, { headers: authHeader }),
                fetchWithTimeout(config.api.getSystemStatus, { headers: authHeader }),
                fetchWithTimeout(config.api.getSystemStatus, { headers: authHeader }) // This can be a dedicated health check endpoint later
            ]);

            if (statsRes.ok) {
                const stats = await statsRes.json();
                updateStats(stats);
            } else {
                const txt = await statsRes.text().catch(() => statsRes.status);
                console.warn('Failed to load stats:', statsRes.status, txt);
                showToast('Could not load stats: ' + (txt || statsRes.status), true);
                // If server reported 503 (DB timeout/unreachable) show admin status and auto-refresh
                if (statsRes.status === 503) {
                    showAdminStatus(`Database unreachable. Retrying shortly...`);
                }
            }
            if (statusRes.ok) {
                appState.systemStatus = await statusRes.json();
                updateSystemControlsUI();
            } else {
                const txt = await statusRes.text().catch(() => statusRes.status);
                console.warn('Failed to load system status:', statusRes.status, txt);
                showToast('Could not load system status: ' + (txt || statusRes.status), true);
                if (statusRes.status === 503) {
                    showAdminStatus(`System configuration unavailable. Retrying shortly...`);
                }
            }
            if (healthRes.ok) {
                const health = await healthRes.json(); // Mocking health from system status for now
                appState.healthStatus = { api: 'ok', db: health.db_connected ? 'ok' : 'error', cloudinary: 'ok' };
                updateHealthStatusUI();
            }
        } catch (error) {
            console.error("Failed to fetch dashboard data:", error);
            // Show status banner on network/timeout errors and attempt auto-retry
            const msg = error && error.message ? error.message : 'Network or database error.';
            showAdminStatus(`Connection error: ${msg}`);
        }
    }

    // Show a prominent admin status banner with auto-refresh countdown
    let adminStatusTimer = null;
    function showAdminStatus(message, seconds = 10) {
        if (!ui.adminStatusBanner) return;
        ui.adminStatusMessage.textContent = message;
        ui.adminStatusSubtext.textContent = `This page will retry in ${seconds} seconds.`;
        ui.adminStatusBanner.classList.remove('d-none');
        // Clear any existing timer
        if (adminStatusTimer) clearInterval(adminStatusTimer);
        let remaining = seconds;
        adminStatusTimer = setInterval(() => {
            remaining -= 1;
            ui.adminStatusSubtext.textContent = `This page will retry in ${remaining} seconds.`;
            if (remaining <= 0) {
                clearInterval(adminStatusTimer);
                adminStatusTimer = null;
                // Attempt to re-fetch dashboard data
                fetchDashboardData();
            }
        }, 1000);
    }

    function hideAdminStatus() {
        if (!ui.adminStatusBanner) return;
        ui.adminStatusBanner.classList.add('d-none');
        if (adminStatusTimer) {
            clearInterval(adminStatusTimer);
            adminStatusTimer = null;
        }
    }

    async function updateSystemStatus(key, value) {
        try {
            const response = await fetch('/api/update-system-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${appState.staffPassword || ''}`
                },
                body: JSON.stringify({ key, value })
            });
            if (!response.ok) throw new Error('Failed to update system status');
            const data = await response.json();
            // Update local app state and UI controls
            appState.systemStatus = data;
            updateSystemControlsUI();
            showToast('System status updated successfully.');
        } catch (error) {
            console.error('Error updating system status:', error);
            showToast(error.message || 'Failed to update system status', true);
            // On error, re-fetch to sync with the actual server state
            fetchDashboardData();
        }
    }

    async function searchAttendees() {
        const query = ui.searchInput.value;
        const filter = ui.filterSelect.value;

        if (query.length < 3 && query.length > 0) {
            ui.attendeeTablePlaceholder.innerHTML = '<p>Please enter at least 3 characters to search.</p>';
            ui.attendeeTablePlaceholder.style.display = 'block';
            ui.attendeeTableBody.innerHTML = '';
            return;
        }
        
        try {
            const response = await fetchWithTimeout(`${config.api.searchAttendees}?query=${encodeURIComponent(query)}&filter=${filter}`, {
                headers: {
                    'Authorization': `Bearer ${appState.staffPassword || ''}`
                }
            });
            if (!response.ok) {
                    const raw = await response.text().catch(() => `HTTP ${response.status}`);
                    let msg = raw;
                    try {
                        const parsed = JSON.parse(raw);
                        msg = parsed.message || raw;
                    } catch (e) {
                        // not JSON, leave raw
                    }
                    throw new Error(`Failed to fetch attendees: ${response.status} ${msg}`);
            }
            const payload = await response.json();
            // API returns an object { attendees, total, page, limit }
            appState.attendees = Array.isArray(payload.attendees) ? payload.attendees : (Array.isArray(payload) ? payload : []);
            // If we have a query, try to prioritize a close match (reg id or exact name) to the top
            if (query && query.length > 0 && appState.attendees.length > 1) {
                const q = query.toLowerCase();
                const idx = appState.attendees.findIndex(a => (a.registration_id && a.registration_id.toLowerCase() === q) || (a.full_name && a.full_name.toLowerCase().includes(q)) || (a.email && a.email.toLowerCase().includes(q)));
                if (idx > 0) {
                    const [found] = appState.attendees.splice(idx, 1);
                    appState.attendees.unshift(found);
                }
            }
            renderAttendeeTable();
            // show not-found modal for explicit query with zero results
            if ((query && query.length > 0) && appState.attendees.length === 0) {
                ui.notFoundMessage.textContent = `No attendees found for "${query}".`;
                if (notFoundModal) notFoundModal.show();
            }
        } catch (error) {
            console.error("Failed to search attendees:", error);
            const message = error.message || 'Could not load attendee data.';
            ui.attendeeTablePlaceholder.innerHTML = `<p class="text-danger">${message}</p>`;
            ui.attendeeTablePlaceholder.style.display = 'block';
            ui.attendeeTableBody.innerHTML = '';
        }
    }

    // Edit form submit -> update attendee
    if (ui.editForm) {
        ui.editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const regId = ui.editRegistrationId.value;
            const payload = {
                registration_id: regId,
                full_name: ui.editFullName.value,
                email: ui.editEmail.value,
                phone_number: ui.editPhone.value,
            };
            try {
                const res = await fetch('/api/update-attendee', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${appState.staffPassword || ''}`
                    },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    const txt = await res.text().catch(() => `HTTP ${res.status}`);
                    throw new Error(txt || 'Failed to update attendee');
                }
                const updated = await res.json();
                showToast('Attendee updated');
                if (editModal) editModal.hide();
                // refresh list (simple approach: re-run search)
                searchAttendees();
                // refresh stats to reflect any change
                fetchDashboardData();
            } catch (err) {
                console.error('Update attendee error', err);
                showToast(err.message || 'Could not update attendee', true);
            }
        });
    }

    // Delete form submit -> delete attendee after verifying password
    if (ui.deleteForm) {
        ui.deleteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const regId = ui.deleteRegistrationId.value;
            const password = ui.deletePasswordInput.value;
            ui.deleteError.textContent = '';
            try {
                const res = await fetch('/api/delete-attendee', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ registration_id: regId, password })
                });
                if (!res.ok) {
                    const txt = await res.text().catch(() => `HTTP ${res.status}`);
                    throw new Error(txt || 'Failed to delete attendee');
                }
                showToast('Attendee deleted');
                if (deleteModal) deleteModal.hide();
                searchAttendees();
                // refresh stats after deletion
                fetchDashboardData();
            } catch (err) {
                console.error('Delete error', err);
                ui.deleteError.textContent = err.message || 'Could not delete attendee';
            }
        });
    }

    // --- Event Listeners ---
    ui.loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (ui.loginForm.checkValidity()) {
            handleLogin(ui.passwordInput.value);
        }
    });

    ui.registrationSwitch.addEventListener('change', (e) => {
        updateSystemStatus('registration_enabled', e.target.checked);
    });

    ui.maintenanceSwitch.addEventListener('change', (e) => {
        updateSystemStatus('maintenance_mode', e.target.checked);
    });

    ui.searchInput.addEventListener('input', () => {
        clearTimeout(appState.debounceTimer);
        appState.debounceTimer = setTimeout(searchAttendees, 500);
    });

    ui.filterSelect.addEventListener('change', searchAttendees);

    // Search button: trigger immediate search when clicked
    if (ui.searchBtn) {
        ui.searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // cancel any debounce and search immediately
            clearTimeout(appState.debounceTimer);
            searchAttendees();
        });
    }

    // Refresh stats button (always visible) - fetch stats without full page reload
    if (ui.refreshStatsBtn) {
        ui.refreshStatsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showToast('Refreshing stats...');
            fetchDashboardData();
        });
    }

    // Logout handler: clear in-memory credentials and return to login
    if (ui.adminLogoutBtn) {
        ui.adminLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Clear all in-memory credentials and redirect to public index
            appState.staffPassword = null;
            appState.isLoggedIn = false;
            // Try to clear any state and navigate away so session is clearly terminated
            try { sessionStorage.clear(); localStorage.clear(); } catch (err) { /* ignore */ }
            showToast('Logged out. Redirecting to home...');
            // Small delay to show toast, then redirect
            setTimeout(() => { window.location.href = '/index.html'; }, 600);
        });
    }

    if (ui.adminStatusRefresh) {
        ui.adminStatusRefresh.addEventListener('click', (e) => {
            e.preventDefault();
            hideAdminStatus();
            fetchDashboardData();
        });
    }
    if (ui.adminStatusDismiss) {
        ui.adminStatusDismiss.addEventListener('click', (e) => {
            e.preventDefault();
            hideAdminStatus();
        });
    }

    // --- Initializer ---
    function initializeAppDashboard() {
        fetchDashboardData();
        searchAttendees(); // Initial load
        setInterval(fetchDashboardData, 30000); // Refresh data every 30 seconds
    }

    function init() {
        // Always require login on page load (hard refresh will require re-entering password)
        setUIState('login');
    }

    init();
});
