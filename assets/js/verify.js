document.addEventListener("DOMContentLoaded", () => {

    // --- State & Config ---
    const config = {
        api: {
            staffLogin: '/api/staff-login',
            verify: '/api/verify',
            checkIn: '/api/check-in',
            timeout: 15000, // Increased timeout
        },
        placeholders: {
            avatar: 'https://placehold.co/150x150/6c757d/white?text=No+Photo'
        }
    };

    const appState = {
        currentAttendeeRegId: null,
        scanner: null,
        isScannerRunning: false,
        messageTimeout: null,
        cameraTrack: null,
        isLoggedIn: false // Track login state
    };

    // --- DOM Element Cache ---
    const ui = {
        body: document.body,
        messageBox: document.getElementById("message-box-container"),

        // Login Modal
        loginModal: document.getElementById("staff-login-modal"),
        loginForm: document.getElementById("staff-login-form"),
        passwordInput: document.getElementById("staff-password-input"),
        loginBtn: document.getElementById("staff-login-btn"),
        loginBtnText: document.getElementById("login-btn-text"),
        loginSpinner: document.getElementById("login-spinner"),
        loginMessage: document.getElementById("login-message"),

        // Scanner Section
        scannerSection: document.getElementById("scanner-section"),
        startScanBtn: document.getElementById("start-scan-btn"),
        startScanBtnText: document.getElementById("start-scan-btn-text"),
        qrReader: document.getElementById("qr-reader"),
        zoomControls: document.getElementById("zoom-controls"),
        zoomSlider: document.getElementById("zoom-slider"),

        // Lookup Form
        manualForm: document.getElementById("manual-lookup-form"),
        regIdInput: document.getElementById("reg-id-input"),
        lookupBtn: document.getElementById("lookup-btn"),
        lookupBtnText: document.getElementById("lookup-btn-text"),
        lookupSpinner: document.getElementById("lookup-spinner"),

        // Results Section
        resultsSection: document.getElementById("results-section"),
        clearBtnTop: document.getElementById("clear-btn-top"),
        clearBtnBottom: document.getElementById("clear-btn-bottom"),
        resultStatusBadge: document.getElementById("result-status-badge"),
        resultAvatar: document.getElementById("result-avatar"),
        resultName: document.getElementById("result-name"),
        resultRegId: document.getElementById("result-reg-id"),
        resultPhone: document.getElementById("result-phone"),
        resultEmail: document.getElementById("result-email"),
        checkinBtn: document.getElementById("checkin-btn"),
        checkinBtnText: document.getElementById("checkin-btn-text"),
        checkinSpinner: document.getElementById("checkin-spinner"),
    };

    // --- UI Helper Functions ---

    /**
     * Sets the entire application UI state.
     */
    function setUIState(state) {
        // Prevent UI changes if not logged in, except for the login state itself
        if (!appState.isLoggedIn && state !== 'login') {
            console.warn("Attempted to change UI state while not logged in. Forcing login state.");
            setUIState('login');
            return;
        }
        ui.body.dataset.uiState = state;

        if (state === 'scanning') {
            startScanner();
        } else {
            stopScanner();
        }

        if (state === 'result') {
            setTimeout(() => {
                ui.resultsSection.classList.add('animate-in');
            }, 10);
        } else {
            ui.resultsSection.classList.remove('animate-in');
        }

        if (state === 'lookup') {
            appState.currentAttendeeRegId = null;
            ui.manualForm.reset();
            ui.manualForm.classList.remove("was-validated");
        }
    }

    /**
     * Resets the entire UI back to the initial lookup state.
     */
    function resetUI() {
        clearMessage();
        ui.resultAvatar.src = config.placeholders.avatar;
        ui.resultName.textContent = "";
        ui.resultRegId.textContent = "";
        ui.resultPhone.textContent = "";
        ui.resultEmail.textContent = "";
        ui.checkinBtn.disabled = false;
        ui.checkinBtn.classList.replace('btn-secondary', 'btn-success');
        ui.checkinBtnText.textContent = "Confirm Check-In";
        setUIState('lookup');
    }

    /**
     * Shows a toast message.
     * @param {string} message The message to display.
     * @param {string} type The alert type (e.g., 'success', 'danger').
     * @param {boolean} autoHide If false, the message will not auto-dismiss.
     */
    function showMessage(message, type = 'info', autoHide = true) {
        if (appState.messageTimeout) {
            clearTimeout(appState.messageTimeout);
        }
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
        ui.messageBox.innerHTML = '';
        ui.messageBox.append(wrapper);
        window.scrollTo(0, 0);

        if (autoHide) {
            appState.messageTimeout = setTimeout(() => {
                const alert = wrapper.querySelector('.alert');
                if (alert) {
                    new bootstrap.Alert(alert).close();
                }
            }, 5000);
        }
    }

    /**
     * Clears any active message.
     */
    function clearMessage() {
        if (appState.messageTimeout) {
            clearTimeout(appState.messageTimeout);
        }
        ui.messageBox.innerHTML = '';
    }

    /**
     * Controls the loading spinner state for buttons.
     */
    function setLoadingState(isLoading, type) {
        const isCheckin = type === 'checkin';
        const spinner = isCheckin ? ui.checkinSpinner : ui.lookupSpinner;
        const button = isCheckin ? ui.checkinBtn : ui.lookupBtn;
        const btnText = isCheckin ? ui.checkinBtnText : ui.lookupBtnText;
        const loadingText = isCheckin ? "Checking In..." : "Searching...";
        const defaultText = isCheckin ? "Confirm Check-In" : "Find Attendee";

        if (isLoading) {
            spinner.classList.remove("d-none");
            button.disabled = true;
            btnText.textContent = loadingText;
            if (type === 'lookup') setUIState('loading');
        } else {
            spinner.classList.add("d-none");
            button.disabled = false;
            btnText.textContent = defaultText;

            if (type === 'lookup' && ui.body.dataset.uiState !== 'result') {
                setUIState('lookup');
            }
        }
    }

    /**
     * Controls loading state for the login button.
     */
    function setLoginLoadingState(isLoading) {
        if (isLoading) {
            ui.loginSpinner.classList.remove("d-none");
            ui.loginBtn.disabled = true;
            ui.loginBtnText.textContent = "Verifying...";
        } else {
            ui.loginSpinner.classList.add("d-none");
            ui.loginBtn.disabled = false;
            ui.loginBtnText.textContent = "Login";
        }
    }

    /**
     * Shows a message within the login modal.
     */
    function showLoginMessage(message, type = 'danger') {
        ui.loginMessage.innerHTML = `<div class="alert alert-${type} py-2">${message}</div>`;
    }


    /**
     * Populates the results card with attendee data.
     */
    function displayResults(attendee, isCheckedIn) {
        appState.currentAttendeeRegId = attendee.registration_id;

        // --- ENSURE NAME IS SET ---
        ui.resultName.textContent = attendee.full_name;

        ui.resultAvatar.src = attendee.profile_pic_url || config.placeholders.avatar;
        ui.resultRegId.textContent = attendee.registration_id;
        ui.resultPhone.textContent = attendee.phone_number || 'N/A';
        ui.resultEmail.textContent = attendee.email || 'N/A';

        if (isCheckedIn) {
            ui.resultStatusBadge.className = 'd-inline-flex align-items-center bg-warning text-dark animated';
            ui.resultStatusBadge.querySelector('#result-status-badge-text').innerHTML = `<i class="bi bi-person-check-fill me-2"></i>ALREADY CHECKED IN`;
            ui.checkinBtn.disabled = true;
            ui.checkinBtn.classList.replace('btn-success', 'btn-secondary');
            ui.checkinBtnText.textContent = "Already Checked-In";
        } else {
            ui.resultStatusBadge.className = 'd-inline-flex align-items-center bg-success text-white animated';
            ui.resultStatusBadge.querySelector('#result-status-badge-text').innerHTML = `<i class="bi bi-check-circle-fill me-2"></i>VERIFIED - NOT CHECKED IN`;
            ui.checkinBtn.disabled = false;
            ui.checkinBtn.classList.replace('btn-secondary', 'btn-success');
            ui.checkinBtnText.textContent = "Confirm Check-In";
        }
        setUIState('result');
    }

    /**
     * Gets a user-friendly error message from a technical error.
     * Maps specific server messages to clearer text.
     */
    function getFriendlyErrorMessage(error) {
        // Handle AbortError for fetch timeouts
        if (error.name === 'AbortError') {
            return "The request timed out. The server is taking too long to respond. Please check your network and try again.";
        }
        // Handle network failures (e.g., offline)
        if (error instanceof TypeError && !navigator.onLine) {
            return "You are offline. Please check your internet connection.";
        }
        if (error instanceof TypeError) {
            return "A network error occurred. Could not connect to the server.";
        }

        // Handle specific, known server error messages
        const message = error.message || "An unknown error occurred.";
        switch (message) {
            case 'This attendee is already checked in.':
                return "This person has already been marked as checked-in.";
            case 'Check-in failed: Invalid Registration ID.':
                return "This Registration ID was not found in our system. Please double-check it.";
            case 'Invalid Registration ID format.':
                return "The Registration ID has an invalid format. It should look like 'UP25-XXXXXXXXXX'.";
            case 'The request timed out. Please try again.':
                return "The server took too long to process the check-in. Please try again.";
            case 'Database service unavailable.':
            case 'An internal server error occurred.':
                return "A problem occurred on our server. Please wait a moment and try again.";
            default:
                return message; // Fallback to the original message if it's not a known case
        }
    }

    // --- API & Data Logic ---

    /**
     * Handles the staff login process.
     */
    async function handleLogin(password) {
        setLoginLoadingState(true);
        ui.loginMessage.innerHTML = ''; // Clear previous messages
        try {
            const response = await fetchWithTimeout(config.api.staffLogin, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || `HTTP error! Status: ${response.status}`);
            }

            if (result.success) {
                appState.isLoggedIn = true;
                sessionStorage.setItem('emrs-staff-logged-in', 'true'); // Persist login state for the session
                setUIState('lookup'); // Transition to the main app
            } else {
                // This case is technically covered by !response.ok but included for clarity
                showLoginMessage(result.message || "Login failed.");
            }

        } catch (error) {
            console.error("Login failed:", error);
            const friendlyMessage = getFriendlyErrorMessage(error);
            showLoginMessage(friendlyMessage);
        } finally {
            setLoginLoadingState(false);
        }
    }


    /**
     * A fetch wrapper with a timeout and no-cache policy.
     */
    async function fetchWithTimeout(url, options, timeout = config.api.timeout) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            cache: 'no-store'
        });
        clearTimeout(id);
        return response;
    }

    /**
     * Fetches attendee data from the API.
     */
    async function fetchAttendee(registrationId) {
        if (!registrationId) {
            showMessage("Invalid Registration ID.", "danger");
            return;
        }
        clearMessage();
        setLoadingState(true, 'lookup');
        try {
            const response = await fetchWithTimeout(config.api.verify, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ registrationId: registrationId.trim().toUpperCase() })
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || `HTTP error! Status: ${response.status}`);
            }
            if (!result.data || !result.data.attendee) {
                // This case handles a successful response but with unexpected data structure.
                throw new Error("Received an invalid response from the server.");
            }
            displayResults(result.data.attendee, result.data.isCheckedIn);
        } catch (error) {
            console.error("Fetch Attendee failed:", error);
            const friendlyMessage = getFriendlyErrorMessage(error);
            showMessage(friendlyMessage, "danger", false); // Make critical errors persistent
        } finally {
            setLoadingState(false, 'lookup');
        }
    }

    /**
     * Performs the check-in API call.
     */
    async function performCheckIn() {
        if (!appState.currentAttendeeRegId) return;
        setLoadingState(true, 'checkin');
        try {
            const response = await fetchWithTimeout(config.api.checkIn, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ registrationId: appState.currentAttendeeRegId })
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || `HTTP error! Status: ${response.status}`);
            }
            showMessage("Check-In Successful!", "success");
            ui.resultStatusBadge.className = 'bg-success text-white animated';
            ui.resultStatusBadge.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i>CHECK-IN COMPLETE`;
            ui.checkinBtn.disabled = true;
            ui.checkinBtn.classList.replace('btn-success', 'btn-secondary');
            ui.checkinBtnText.textContent = "Checked-In";
        } catch (error) {
            console.error("Check-In failed:", error);
            const friendlyMessage = getFriendlyErrorMessage(error);
            showMessage(friendlyMessage, "danger", false); // Make critical errors persistent
        } finally {
            setLoadingState(false, 'checkin');
        }
    }

    // --- QR Scanner Logic ---

    function onScanSuccess(decodedText, decodedResult) {
        console.log(`Scan result: ${decodedText}`);
        try {
            const data = JSON.parse(decodedText);
            if (data && data.regId) {
                fetchAttendee(data.regId);
            } else {
                throw new Error("Invalid QR code format (JSON).");
            }
        } catch (jsonError) {
            console.warn("QR code is not JSON, treating as plain text ID.");
            if (decodedText && decodedText.trim().length > 0) {
                fetchAttendee(decodedText);
            } else {
                console.error("QR Parse Error:", jsonError);
                showMessage("Invalid E-Pass QR Code. Please try manual lookup.", "danger");
            }
        }
    }

    function onScanFailure(error) {
        // This fires continuously. It's safe to ignore.
    }

    /**
     * Initializes zoom controls using standard browser APIs.
     */
    function initializeZoomControls() {
        try {
            const videoElement = ui.qrReader.querySelector('video');
            if (!videoElement || !videoElement.srcObject) {
                console.warn("Could not find video element to apply zoom.");
                ui.zoomControls.style.display = 'none';
                return;
            }
            const track = videoElement.srcObject.getVideoTracks()[0];
            if (!track) {
                console.warn("Could not find video track.");
                ui.zoomControls.style.display = 'none';
                return;
            }
            const capabilities = track.getCapabilities();
            const settings = track.getSettings();
            if (capabilities && capabilities.zoom) {
                appState.cameraTrack = track;
                const { min, max, step } = capabilities.zoom;
                ui.zoomSlider.min = min;
                ui.zoomSlider.max = max;
                ui.zoomSlider.step = step;
                ui.zoomSlider.value = settings.zoom || min;
                ui.zoomControls.style.display = 'block';
                console.log(`Zoom enabled: min=${min}, max=${max}, current=${settings.zoom}`);
            } else {
                console.warn("Zoom is not supported by this camera.");
                ui.zoomControls.style.display = 'none';
            }
        } catch (err) {
            console.error("Error getting camera capabilities:", err);
            ui.zoomControls.style.display = 'none';
        }
    }

    function startScanner() {
        if (appState.isScannerRunning) return;
        if (!appState.scanner) {
            appState.scanner = new Html5Qrcode("qr-reader");
        }
        const scannerConfig = {
            fps: 10,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                const size = Math.floor(minEdge * 0.75);
                return { width: size, height: size };
            },
            rememberLastUsedCamera: true
        };

        appState.scanner.start({ facingMode: "environment" }, scannerConfig, onScanSuccess, onScanFailure)
            .then(() => {
                console.log("Scanner started with back camera.");
                appState.isScannerRunning = true;
                ui.startScanBtnText.textContent = "Scanning... (Point at QR Code)";
                ui.startScanBtn.disabled = true;
                setUIState('scanning');
                initializeZoomControls();
            })
            .catch((err) => {
                console.warn("Back camera failed, trying any camera:", err);
                appState.scanner.start({}, scannerConfig, onScanSuccess, onScanFailure)
                    .then(() => {
                        console.log("Scanner started with default camera.");
                        appState.isScannerRunning = true;
                        ui.startScanBtnText.textContent = "Scanning... (Point at QR Code)";
                        ui.startScanBtn.disabled = true;
                        setUIState('scanning');
                        initializeZoomControls();
                    })
                    .catch((err2) => {
                        console.error("Failed to start any camera:", err2);
                        showMessage("Could not start camera. Please grant permissions or use manual lookup.", "danger");
                        setUIState('lookup');
                    });
            });
    }

    function stopScanner() {
        ui.zoomControls.style.display = 'none';
        appState.cameraTrack = null;
        if (appState.scanner && appState.isScannerRunning) {
            try {
                appState.scanner.stop().then(() => {
                    console.log("Scanner stopped.");
                }).catch(err => {
                    console.warn("Scanner already stopped or failed to stop:", err);
                }).finally(() => {
                    appState.isScannerRunning = false;
                    ui.startScanBtnText.textContent = "Start Camera Scan";
                    ui.startScanBtn.disabled = false;
                });
            } catch (err) {
                console.warn("Scanner stop error:", err);
                appState.isScannerRunning = false;
                appState.cameraTrack = null;
                ui.startScanBtnText.textContent = "Start Camera Scan";
                ui.startScanBtn.disabled = false;
            }
        }
    }

    // --- Event Listeners (Initialization) ---

    ui.loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!ui.loginForm.checkValidity()) {
            ui.loginForm.classList.add("was-validated");
            return;
        }
        handleLogin(ui.passwordInput.value);
    });

    ui.startScanBtn.addEventListener("click", () => {
        setUIState('scanning');
    });

    ui.zoomSlider.addEventListener('input', () => {
        if (appState.cameraTrack && appState.isScannerRunning) {
            try {
                const zoomValue = parseFloat(ui.zoomSlider.value);
                appState.cameraTrack.applyConstraints({
                    advanced: [{ zoom: zoomValue }]
                });
            } catch (err) {
                console.warn("Could not apply zoom:", err);
            }
        }
    });

    ui.manualForm.addEventListener("submit", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!ui.manualForm.checkValidity()) {
            ui.manualForm.classList.add("was-validated");
            return;
        }
        ui.manualForm.classList.add("was-validated");
        fetchAttendee(ui.regIdInput.value);
    });

    ui.checkinBtn.addEventListener("click", performCheckIn);
    ui.clearBtnTop.addEventListener("click", resetUI);
    ui.clearBtnBottom.addEventListener("click", resetUI);

    // --- Initializer ---
    function initialize() {
        // Check session storage to see if user is already logged in
        if (sessionStorage.getItem('emrs-staff-logged-in') === 'true') {
            appState.isLoggedIn = true;
            setUIState('lookup');
        } else {
            setUIState('login');
        }
    }

    initialize(); // Run the initializer

    // --- Service Worker Registration ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('ServiceWorker registration successful with scope: ', registration.scope);
                })
                .catch(error => {
                    console.log('ServiceWorker registration failed: ', error);
                });
        });
    }
});
