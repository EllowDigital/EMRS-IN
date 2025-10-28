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
        filterSelect: document.getElementById('filter-attendee-select'),
        attendeeTableBody: document.getElementById('attendee-table-body'),
        attendeeTablePlaceholder: document.getElementById('attendee-table-placeholder'),
    };

    // --- UI Helper Functions ---
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
            <tr>
                <td>
                    <div class="d-flex align-items-center">
                        <img src="${attendee.profile_pic_url || config.placeholders.avatar}" class="attendee-avatar me-3" alt="Avatar">
                        <div>
                            <div class="fw-bold">${attendee.full_name}</div>
                            <div class="text-muted small">${attendee.email}</div>
                        </div>
                    </div>
                </td>
                <td>${attendee.registration_id}</td>
                <td>${attendee.phone_number}</td>
                <td>
                    <span class="badge ${attendee.is_checked_in ? 'bg-success' : 'bg-warning'}">
                        ${attendee.is_checked_in ? 'Checked-In' : 'Not Checked-In'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="alert('Edit action for ${attendee.registration_id}')">Edit</button>
                </td>
            </tr>
        `).join('');
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
                sessionStorage.setItem('emrs-admin-logged-in', 'true');
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
            const [statsRes, statusRes, healthRes] = await Promise.all([
                fetchWithTimeout(config.api.getStats),
                fetchWithTimeout(config.api.getSystemStatus),
                fetchWithTimeout(config.api.getSystemStatus) // This can be a dedicated health check endpoint later
            ]);

            if (statsRes.ok) {
                const stats = await statsRes.json();
                updateStats(stats);
            }
            if (statusRes.ok) {
                appState.systemStatus = await statusRes.json();
                updateSystemControlsUI();
            }
            if (healthRes.ok) {
                const health = await healthRes.json(); // Mocking health from system status for now
                appState.healthStatus = { api: 'ok', db: health.db_connected ? 'ok' : 'error', cloudinary: 'ok' };
                updateHealthStatusUI();
            }
        } catch (error) {
            console.error("Failed to fetch dashboard data:", error);
        }
    }

    async function updateSystemStatus(key, value) {
        try {
            const response = await fetch('/api/update-system-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionStorage.getItem('staff_password')}`
                },
                body: JSON.stringify({ key, value })
            });
            if (!response.ok) throw new Error('Failed to update system status');
            const data = await response.json();
            renderSystemStatus(data);
            showToast('System status updated successfully.');
        } catch (error) {
            console.error('Error updating system status:', error);
            showToast(error.message, true);
            // On error, re-fetch to sync with the actual server state
            fetchSystemStatus();
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
            const response = await fetchWithTimeout(`${config.api.searchAttendees}?query=${encodeURIComponent(query)}&filter=${filter}`);
            if (!response.ok) throw new Error('Failed to fetch attendees.');
            appState.attendees = await response.json();
            renderAttendeeTable();
        } catch (error) {
            console.error("Failed to search attendees:", error);
            ui.attendeeTablePlaceholder.innerHTML = '<p class="text-danger">Could not load attendee data.</p>';
        }
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

    // --- Initializer ---
    function initializeAppDashboard() {
        fetchDashboardData();
        searchAttendees(); // Initial load
        setInterval(fetchDashboardData, 30000); // Refresh data every 30 seconds
    }

    function init() {
        if (sessionStorage.getItem('emrs-admin-logged-in') === 'true') {
            appState.isLoggedIn = true;
            setUIState('dashboard');
            initializeAppDashboard();
        } else {
            setUIState('login');
        }
    }

    init();
});
