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
        // store short-lived staff token in-memory only so a hard refresh requires re-login
        staffToken: null,
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
        // pagination
        currentPage: 1,
        pageSize: 15,
        totalPages: 1,
        totalResults: 0,
        isLoadingAttendees: false,
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
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');
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

    // Global loader helpers
    function showLoader() {
        const el = document.getElementById('global-loader');
        if (!el) return;
        el.classList.remove('d-none');
    }
    function hideLoader() {
        const el = document.getElementById('global-loader');
        if (!el) return;
        el.classList.add('d-none');
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

    // Browser-friendly JWT parsing (base64url) for token payload
    function parseJwtPayload(token) {
        try {
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            const p64 = parts[1];
            // base64url -> base64
            const b64 = p64.replace(/-/g, '+').replace(/_/g, '/');
            // pad
            const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
            const json = decodeURIComponent(Array.prototype.map.call(atob(b64 + pad), function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(json);
        } catch (e) { return null; }
    }

    // Restore staff token from sessionStorage if available and not expired; schedule refresh
    function restoreTokenFromSession() {
        try {
            const token = sessionStorage.getItem('staff_token');
            if (!token) return false;
            const payload = parseJwtPayload(token);
            const now = Math.floor(Date.now() / 1000);
            if (payload && payload.exp && payload.exp < now) {
                sessionStorage.removeItem('staff_token');
                return false;
            }
            appState.staffToken = token;
            window.__STAFF_TOKEN = token;
            appState.isLoggedIn = true;
            // schedule refresh if token has expiry
            if (payload && payload.exp) scheduleTokenRefresh(token, payload.exp);
            return true;
        } catch (e) {
            try { sessionStorage.removeItem('staff_token'); } catch (_) {}
            return false;
        }
    }

    // Schedule a token refresh ahead of expiry (refresh 90s before exp)
    let _tokenRefreshTimer = null;
    function scheduleTokenRefresh(token, exp) {
        try {
            if (_tokenRefreshTimer) clearTimeout(_tokenRefreshTimer);
            const now = Math.floor(Date.now() / 1000);
            const refreshAt = Math.max(now + 5, exp - 90); // at least 5s in future, or 90s before exp
            const ms = (refreshAt - now) * 1000;
            _tokenRefreshTimer = setTimeout(async () => {
                try {
                    const res = await fetch('/.netlify/functions/staff-refresh', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                    if (res.ok) {
                        const body = await res.json();
                        if (body && body.token) {
                            appState.staffToken = body.token;
                            window.__STAFF_TOKEN = body.token;
                            try { sessionStorage.setItem('staff_token', body.token); } catch (e) {}
                            const p = parseJwtPayload(body.token);
                            if (p && p.exp) scheduleTokenRefresh(body.token, p.exp);
                            showToast('Session refreshed');
                        }
                    } else {
                        console.warn('Token refresh failed:', res.status);
                    }
                } catch (e) { console.warn('Token refresh error', e); }
            }, ms);
        } catch (e) { /* ignore */ }
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
    if (ui.attendeeTableBody) {
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
    }

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

    // Generic fetch with retries (exponential backoff)
    async function retryFetch(url, options = {}, tries = 3, backoff = 500) {
        let attempt = 0;
        let lastError = null;
        while (attempt < tries) {
            try {
                // use fetchWithTimeout so individual attempts also timeout
                const res = await fetchWithTimeout(url, options);
                if (!res.ok && (res.status === 503 || res.status === 504)) {
                    // treat as transient and retry
                    lastError = new Error(`HTTP ${res.status}`);
                    throw lastError;
                }
                return res;
            } catch (err) {
                lastError = err;
                attempt += 1;
                // If last attempt, break and rethrow afterwards
                if (attempt >= tries) break;
                // Wait exponential backoff
                const wait = backoff * Math.pow(2, attempt - 1);
                await new Promise(r => setTimeout(r, wait));
            }
        }
        throw lastError;
    }

    async function handleLogin(password) {
        setLoginLoadingState(true);
        ui.loginMessage.innerHTML = '';
        try {
            // Exchange password for short-lived token
            const response = await fetchWithTimeout(config.api.staffLogin, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Login failed');

            if (result && result.token) {
                appState.isLoggedIn = true;
                // Keep token only in-memory; optionally persist to sessionStorage for seamless tabs
                appState.staffToken = result.token;
                try { sessionStorage.setItem('staff_token', result.token); window.__STAFF_TOKEN = result.token; } catch (e) { /* ignore */ }
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
            const authHeader = { 'Authorization': `Bearer ${appState.staffToken || ''}` };
            // Use retryFetch for transient DB/network issues
            const [statsRes, statusRes, healthRes] = await Promise.all([
                retryFetch(config.api.getStats, { headers: authHeader }, 3, 500).catch(e => { throw { stage: 'stats', err: e }; }),
                retryFetch(config.api.getSystemStatus, { headers: authHeader }, 3, 500).catch(e => { throw { stage: 'status', err: e }; }),
                retryFetch(config.api.getSystemStatus, { headers: authHeader }, 3, 500).catch(e => { throw { stage: 'health', err: e }; }) // reuse system-status as health for now
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
            // If thrown from our retryFetch wrapper, it may be an object with stage
            const rawErr = error && error.err ? error.err : error;
            const msg = rawErr && rawErr.message ? rawErr.message : 'Network or database error.';
            showAdminStatus(`Connection error: ${msg}`, 15);
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
                        hideLoader();
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
                    'Authorization': `Bearer ${appState.staffToken || ''}`
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
        // show loading placeholder in the table area (skeletons)
        appState.isLoadingAttendees = true;
        const skeletons = Array.from({ length: Math.min(6, appState.pageSize) }).map(() => `
            <div class="skeleton-row">
                <div class="skeleton-avatar"></div>
                <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
                    <div class="skeleton-line" style="width:60%"></div>
                    <div class="skeleton-line" style="width:40%"></div>
                </div>
            </div>
        `).join('');
        ui.attendeeTablePlaceholder.innerHTML = skeletons;
        ui.attendeeTablePlaceholder.style.display = 'block';
        ui.attendeeTableBody.innerHTML = '';

        try {
            const page = appState.currentPage || 1;
            const limit = appState.pageSize || 15;
            const response = await retryFetch(`${config.api.searchAttendees}?query=${encodeURIComponent(query)}&filter=${filter}&page=${page}&limit=${limit}`, {
                headers: {
                    'Authorization': `Bearer ${appState.staffToken || ''}`
                }
            }, 3, 300);
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
            appState.isLoadingAttendees = false;
            appState.totalResults = payload.total || 0;
            appState.currentPage = payload.page || appState.currentPage || 1;
            appState.pageSize = payload.limit || appState.pageSize || 15;
            appState.totalPages = payload.totalPages || Math.max(1, Math.ceil(appState.totalResults / appState.pageSize));
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
            // update pagination UI
            const pageInfo = document.getElementById('attendee-page-info');
            if (pageInfo) pageInfo.textContent = `Page ${appState.currentPage} of ${appState.totalPages} (${appState.totalResults} results)`;
            // enable/disable prev/next
            const prevBtn = document.getElementById('attendee-prev-btn');
            const nextBtn = document.getElementById('attendee-next-btn');
            if (prevBtn) prevBtn.disabled = appState.currentPage <= 1;
            if (nextBtn) nextBtn.disabled = appState.currentPage >= appState.totalPages;
            // show not-found modal for explicit query with zero results
            if ((query && query.length > 0) && appState.attendees.length === 0) {
                ui.notFoundMessage.textContent = `No attendees found for "${query}".`;
                if (notFoundModal) notFoundModal.show();
            }
        } catch (error) {
            console.error("Failed to search attendees:", error);
            const message = error.message || 'Could not load attendee data.';
            appState.isLoadingAttendees = false;
            ui.attendeeTablePlaceholder.innerHTML = `<p class="text-danger">${message}</p>`;
            ui.attendeeTablePlaceholder.style.display = 'block';
            ui.attendeeTableBody.innerHTML = '';
            // hide header spinner if present
            const headerSpinner = document.getElementById('attendee-table-spinner');
            if (headerSpinner) headerSpinner.classList.add('d-none');
            // If this looks like a DB/network unreachable error, show the admin banner with retry
            try {
                const raw = error && (error.err || error) ;
                const txt = raw && raw.message ? raw.message : String(raw);
                if (txt.includes('503') || txt.toLowerCase().includes('database unreachable') || txt.toLowerCase().includes('timed out') || txt.toLowerCase().includes('timeout')) {
                    showAdminStatus(`Database unreachable: ${txt}`, 15);
                }
            } catch (e) { /* ignore */ }
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
                showLoader();
                const res = await fetch('/api/update-attendee', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${appState.staffToken || ''}`
                    },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    let errTxt = `HTTP ${res.status}`;
                    try { const parsed = await res.json(); if (parsed && parsed.message) errTxt = parsed.message; }
                    catch (e) { errTxt = await res.text().catch(() => errTxt); }
                    throw new Error(errTxt || 'Failed to update attendee');
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
            } finally {
                hideLoader();
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
                showLoader();
                const res = await fetch('/api/delete-attendee', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${appState.staffToken || ''}` },
                    body: JSON.stringify({ registration_id: regId })
                });
                if (!res.ok) {
                    let errTxt = `HTTP ${res.status}`;
                    try { const parsed = await res.json(); if (parsed && parsed.message) errTxt = parsed.message; }
                    catch (e) { errTxt = await res.text().catch(() => errTxt); }
                    throw new Error(errTxt || 'Failed to delete attendee');
                }
                showToast('Attendee deleted');
                if (deleteModal) deleteModal.hide();
                searchAttendees();
                // refresh stats after deletion
                fetchDashboardData();
            } catch (err) {
                console.error('Delete error', err);
                ui.deleteError.textContent = err.message || 'Could not delete attendee';
            } finally {
                hideLoader();
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

    // Show header spinner when starting a search (debounced input will call searchAttendees)
    ui.searchInput.addEventListener('keydown', () => {
        const headerSpinner = document.getElementById('attendee-table-spinner');
        if (headerSpinner) headerSpinner.classList.remove('d-none');
    });

    ui.filterSelect.addEventListener('change', searchAttendees);

    // Search button: trigger immediate search when clicked
    if (ui.searchBtn) {
        ui.searchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // cancel any debounce and search immediately
            clearTimeout(appState.debounceTimer);
            const headerSpinner = document.getElementById('attendee-table-spinner');
            if (headerSpinner) headerSpinner.classList.remove('d-none');
            searchAttendees();
        });
    }

    // Refresh stats button (always visible) - fetch stats without full page reload
    if (ui.refreshStatsBtn) {
        ui.refreshStatsBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            // Disable while refreshing to avoid duplicate clicks
            ui.refreshStatsBtn.disabled = true;
            const originalText = ui.refreshStatsBtn.innerHTML;
            ui.refreshStatsBtn.innerHTML = '<i class="bi bi-arrow-clockwise me-1 spinning"></i>Refreshing...';
            showToast('Refreshing stats and attendee list...');
            try {
                // Show global loader and run stats and current attendee search in parallel
                showLoader();
                // show header spinner so the attendee table reflects activity
                const headerSpinner = document.getElementById('attendee-table-spinner');
                if (headerSpinner) headerSpinner.classList.remove('d-none');
                await Promise.allSettled([
                    fetchDashboardData(),
                    (async () => {
                        clearTimeout(appState.debounceTimer);
                        await searchAttendees();
                    })()
                ]);
                showToast('Refresh complete');
            } catch (err) {
                console.error('Refresh error', err);
                showToast('Refresh encountered errors', true);
            } finally {
                hideLoader();
                const headerSpinner2 = document.getElementById('attendee-table-spinner');
                if (headerSpinner2) headerSpinner2.classList.add('d-none');
                ui.refreshStatsBtn.disabled = false;
                ui.refreshStatsBtn.innerHTML = originalText;
            }
        });
    }

    // Logout handler: clear in-memory credentials and return to login
    if (ui.adminLogoutBtn) {
        ui.adminLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Clear all in-memory credentials and redirect to public index
            appState.staffToken = null;
            appState.isLoggedIn = false;
            // Try to clear any state and navigate away so session is clearly terminated
            try { sessionStorage.removeItem('staff_token'); /* preserve other items */ } catch (err) { /* ignore */ }
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

    // --- Mobile nav & accessibility ---
    function openMobileNav() {
        const nav = document.getElementById('mobile-nav');
        const backdrop = document.getElementById('mobile-nav-backdrop');
        if (!nav || !backdrop) return;
        nav.classList.add('open');
        backdrop.classList.remove('d-none');
        nav.setAttribute('aria-hidden', 'false');
        // set aria-expanded on all toggles
        document.querySelectorAll('#menu-toggle').forEach(btn => btn.setAttribute('aria-expanded', 'true'));
        // trap focus inside nav
        trapFocus(nav);
        // prevent body scroll
        document.body.style.overflow = 'hidden';
    }

    function closeMobileNav() {
        const nav = document.getElementById('mobile-nav');
        const backdrop = document.getElementById('mobile-nav-backdrop');
        if (!nav || !backdrop) return;
        nav.classList.remove('open');
        backdrop.classList.add('d-none');
        nav.setAttribute('aria-hidden', 'true');
        document.querySelectorAll('#menu-toggle').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
        releaseFocusTrap();
        document.body.style.overflow = '';
    }

    let _focusTrap = null;
    function trapFocus(container) {
        const focusable = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
        const nodes = Array.from(container.querySelectorAll(focusable)).filter(n => n.offsetParent !== null);
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        _focusTrap = function (e) {
            if (e.key === 'Tab') {
                if (e.shiftKey) { // shift+tab
                    if (document.activeElement === first) {
                        e.preventDefault(); last.focus();
                    }
                } else {
                    if (document.activeElement === last) {
                        e.preventDefault(); first.focus();
                    }
                }
            } else if (e.key === 'Escape') {
                closeMobileNav();
            }
        };
        document.addEventListener('keydown', _focusTrap);
        // focus the first element
        setTimeout(() => first.focus(), 50);
    }

    function releaseFocusTrap() {
        if (_focusTrap) {
            document.removeEventListener('keydown', _focusTrap);
            _focusTrap = null;
        }
    }

    // wire menu toggle and backdrop
    const menuToggle = document.getElementById('menu-toggle');
    const mobileBackdrop = document.getElementById('mobile-nav-backdrop');
    const mobileNavClose = document.getElementById('mobile-nav-close');
    const mobileLogout = document.getElementById('mobile-logout');
    if (menuToggle) {
        menuToggle.addEventListener('click', (e) => { e.preventDefault(); openMobileNav(); });
    }
    if (mobileBackdrop) mobileBackdrop.addEventListener('click', closeMobileNav);
    if (mobileNavClose) mobileNavClose.addEventListener('click', (e) => { e.preventDefault(); closeMobileNav(); });
    if (mobileLogout) mobileLogout.addEventListener('click', (e) => { e.preventDefault(); if (ui.adminLogoutBtn) ui.adminLogoutBtn.click(); closeMobileNav(); });

    // delegate mobile nav link clicks to scroll/focus sections
    document.addEventListener('click', (e) => {
        const a = e.target.closest('.mobile-nav-link');
        if (!a) return;
        e.preventDefault();
        const target = a.getAttribute('data-nav-target');
        if (target === 'stats') {
            document.querySelector('.stat-card')?.scrollIntoView({ behavior: 'smooth' });
        } else if (target === 'attendees') {
            document.getElementById('search-attendee-input')?.focus();
            document.getElementById('attendee-table-controls')?.scrollIntoView({ behavior: 'smooth' });
        } else if (target === 'health') {
            document.getElementById('system-health-list')?.scrollIntoView({ behavior: 'smooth' });
        }
        closeMobileNav();
    });

    // mobile tree section toggles (expand/collapse)
    document.addEventListener('click', (e) => {
        const toggle = e.target.closest('.mobile-nav-section-toggle');
        if (!toggle) return;
        e.preventDefault();
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        const sub = toggle.parentElement.querySelector('.mobile-sublist');
        if (sub) {
            if (expanded) {
                sub.classList.remove('open');
            } else {
                sub.classList.add('open');
            }
        }
    });

    // Header ripple micro-interaction: add ripple on pointerdown for header buttons
    function initHeaderRipples() {
        const headerBtns = document.querySelectorAll('.app-header .btn');
        headerBtns.forEach(btn => {
            btn.classList.add('ripple');
            btn.addEventListener('pointerdown', function (ev) {
                const rect = this.getBoundingClientRect();
                const circle = document.createElement('span');
                circle.className = 'ripple-effect';
                const size = Math.max(rect.width, rect.height) * 1.2;
                circle.style.width = circle.style.height = size + 'px';
                circle.style.left = (ev.clientX - rect.left - size / 2) + 'px';
                circle.style.top = (ev.clientY - rect.top - size / 2) + 'px';
                this.appendChild(circle);
                setTimeout(() => circle.remove(), 700);
            });
        });
    }
    initHeaderRipples();

    // Pagination controls
    const prevBtn = document.getElementById('attendee-prev-btn');
    const nextBtn = document.getElementById('attendee-next-btn');
    if (prevBtn) prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (appState.currentPage > 1) {
            appState.currentPage -= 1;
            searchAttendees();
        }
    });
    if (nextBtn) nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (appState.currentPage < appState.totalPages) {
            appState.currentPage += 1;
            searchAttendees();
        }
    });

    // --- Initializer ---
    function initializeAppDashboard() {
        fetchDashboardData();
        searchAttendees(); // Initial load
        setInterval(fetchDashboardData, 30000); // Refresh data every 30 seconds
    }

    function init() {
        // Try to restore an existing token from sessionStorage so refreshes stay logged in
        const restored = restoreTokenFromSession();
        if (restored) {
            setUIState('dashboard');
            initializeAppDashboard();
        } else {
            setUIState('login');
        }

        // Network online/offline handling
        window.addEventListener('online', () => {
            showToast('Network connection restored. Refreshing data...');
            hideAdminStatus();
            fetchDashboardData();
        });
        window.addEventListener('offline', () => {
            showAdminStatus('You are offline. Some features are disabled.', 0);
        });
        // Keyboard shortcuts: / to focus search, r to refresh, l to logout (when not typing)
        window.addEventListener('keydown', (e) => {
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
            if (e.key === '/') {
                e.preventDefault(); ui.searchInput.focus();
            } else if (e.key.toLowerCase() === 'r') {
                e.preventDefault(); if (ui.refreshStatsBtn) ui.refreshStatsBtn.click();
            } else if (e.key.toLowerCase() === 'l') {
                e.preventDefault(); if (ui.adminLogoutBtn) ui.adminLogoutBtn.click();
            }
        });
    }

    init();
});
