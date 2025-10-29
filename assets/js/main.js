document.addEventListener("DOMContentLoaded", () => {
    // --- System Status Elements ---
    const statusBanner = document.getElementById('status-banner');
    const statusMessage = document.getElementById('status-message');
    const registrationFormContainer = document.getElementById('registration-form-container');
    const statusCenter = document.getElementById('status-center');
    const statusCenterTitle = document.getElementById('status-center-title');
    const statusCenterText = document.getElementById('status-center-text');
    const statusReloadBtn = document.getElementById('status-reload-btn');
    const statusCountdownEl = document.getElementById('status-countdown');
    const adminOpenBtn = document.getElementById('admin-open-btn');
    const adminModalEl = document.getElementById('adminModal');
    const adminLoginForm = document.getElementById('admin-login-form');
    const adminPasswordInput = document.getElementById('admin-password');
    const adminErrorEl = document.getElementById('admin-error');

    // Auto-retry configuration
    const AUTO_RETRY_SECONDS = 15; // seconds until auto-retry
    let autoRetryTimer = null;
    let autoRetryRemaining = 0;

    // --- DOM Element Selectors ---
    const registrationForm = document.getElementById("registration-form");
    const submitButton = document.getElementById("submit-btn");
    const submitButtonText = document.getElementById("submit-btn-text");
    const spinner = document.getElementById("spinner");
    const messageBoxContainer = document.getElementById(
        "message-box-container"
    );
    const registrationSection = document.getElementById(
        "registration-section"
    );
    const findPassSection = document.getElementById("find-pass-section");
    const epassSection = document.getElementById("epass-section");
    const siteFooter = document.getElementById('site-footer');
    const backToHomeButton = document.getElementById("back-to-home-btn");
    const profilePicInput = document.getElementById("profile-pic");
    const avatarPreview = document.getElementById("avatar-preview");
    const avatarPickerLabel = document.getElementById(
        "avatar-picker-label"
    );
    const phoneInput = document.getElementById("phone");
    const avatarFeedback = document.getElementById("avatar-feedback");
    const defaultAvatarSrc =
        "https://placehold.co/150x150/6c757d/white?text=No+Photo";
    const epassCardElement = document.getElementById("epass-card");
    const epassAvatar = document.getElementById("epass-avatar");
    const epassName = document.getElementById("epass-name");
    const epassRegId = document.getElementById("epass-reg-id");
    const qrCodeContainer = document.getElementById("qrcode-container");
    const downloadButton = document.getElementById("download-btn");
    const findPassForm = document.getElementById("find-pass-form");
    const findPassButton = document.getElementById("find-pass-btn");
    const findPassButtonText =
        document.getElementById("find-pass-btn-text");
    const findPassSpinner = document.getElementById("find-pass-spinner");
    const findPassInput = document.getElementById("find-pass-input");
    const findPassLabel = document.getElementById("find-pass-label");
    const findPassIcon = document.getElementById("find-pass-icon");
    const findPassToggles = document.querySelectorAll(
        'input[name="search-type"]'
    );

    const REQUEST_TIMEOUT = 15000; // Increased to 15 seconds
    let currentMessageTimeout = null;

    // --- System Status Check ---
    async function checkSystemStatus() {
        try {
            const response = await fetch('/api/get-public-status');
            if (!response.ok) throw new Error('Could not fetch system status');
            const status = await response.json();

            // Hide any previous status-center/banner
            statusBanner.classList.add('d-none');
            statusBanner.classList.remove('alert-danger', 'alert-warning');
            if (statusCenter) statusCenter.classList.add('d-none');

            // Priority: maintenance_mode (most severe)
            if (status.maintenance_mode) {
                // Show centered maintenance message and hide all interactive sections
                registrationSection.classList.add('d-none');
                findPassSection.classList.add('d-none');
                epassSection.classList.add('d-none');
                if (siteFooter) siteFooter.classList.add('d-none');
                // also add a body-level helper so CSS can hide extra chrome
                document.body.classList.add('status-active');

                if (statusCenter) {
                    statusCenterTitle.textContent = 'Maintenance Mode';
                    statusCenterText.textContent = 'The system is currently down for maintenance. Please check back later.';
                    statusCenter.classList.remove('d-none');
                    // start auto retry countdown so the site attempts to come back automatically
                    startAutoRetryCountdown();
                } else {
                    statusMessage.textContent = 'The system is currently down for maintenance. Please check back later.';
                    statusBanner.classList.remove('d-none');
                    statusBanner.classList.add('alert-danger');
                }
            } else if (!status.registration_enabled) {
                // Registrations are closed: show centered notice (no forms available)
                registrationSection.classList.add('d-none');
                findPassSection.classList.add('d-none');
                epassSection.classList.add('d-none');
                if (siteFooter) siteFooter.classList.add('d-none');
                document.body.classList.add('status-active');

                if (statusCenter) {
                    statusCenterTitle.textContent = 'Registrations Closed';
                    statusCenterText.textContent = 'New registrations are currently closed. Please check back later.';
                    statusCenter.classList.remove('d-none');
                    // start auto retry countdown so the site attempts to come back automatically
                    startAutoRetryCountdown();
                } else {
                    statusMessage.textContent = 'New registrations are currently closed. Please check back later.';
                    statusBanner.classList.remove('d-none');
                    statusBanner.classList.add('alert-warning');
                }
            } else {
                // Normal operation
                statusBanner.classList.add('d-none');
                registrationSection.classList.remove('d-none');
                findPassSection.classList.remove('d-none');
                if (siteFooter) siteFooter.classList.remove('d-none');
                document.body.classList.remove('status-active');
                // stop any auto-retry when system is healthy
                stopAutoRetryCountdown();
            }
        } catch (error) {
            console.error('System Status Check Failed:', error);
            // Fail-safe: show a non-blocking banner and allow form as a fallback
            statusMessage.textContent = 'Could not verify system status. Showing form as fallback — please retry.';
            statusBanner.classList.remove('d-none');
            statusBanner.classList.remove('alert-danger', 'alert-warning');
            statusBanner.classList.add('alert-warning');

            // Add a retry button if not present
            if (!document.getElementById('status-retry-btn')) {
                const retryBtn = document.createElement('button');
                retryBtn.id = 'status-retry-btn';
                retryBtn.type = 'button';
                retryBtn.className = 'btn btn-sm btn-outline-light ms-2';
                retryBtn.textContent = 'Retry';
                retryBtn.addEventListener('click', () => {
                    statusBanner.classList.add('d-none');
                    checkSystemStatus();
                });
                statusBanner.appendChild(retryBtn);
            }

            // Keep registration visible as a degraded fallback so users can still register.
            registrationForm.classList.remove('d-none');
            if (siteFooter) siteFooter.classList.remove('d-none');
            document.body.classList.remove('status-active');
            stopAutoRetryCountdown();
        }
    }

    // Reload / Retry button in centered status card
    if (statusReloadBtn) {
        statusReloadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // If an auto-retry countdown is running, stop it because the user manually reloaded
            stopAutoRetryCountdown();
            if (statusCenter) statusCenter.classList.add('d-none');
            if (statusBanner) statusBanner.classList.add('d-none');
            checkSystemStatus();
        });
    }


    // --- Helper Functions ---
    // Auto-retry helpers: show countdown and trigger a status re-check when elapsed
    function startAutoRetryCountdown(seconds = AUTO_RETRY_SECONDS) {
        stopAutoRetryCountdown();
        if (!statusCountdownEl) return;
        autoRetryRemaining = seconds;
        statusCountdownEl.textContent = `Retry in ${autoRetryRemaining}s`;
        statusCountdownEl.setAttribute('aria-hidden', 'false');
        autoRetryTimer = setInterval(() => {
            autoRetryRemaining -= 1;
            if (autoRetryRemaining <= 0) {
                stopAutoRetryCountdown();
                statusCountdownEl.textContent = '';
                checkSystemStatus();
                return;
            }
            statusCountdownEl.textContent = `Retry in ${autoRetryRemaining}s`;
        }, 1000);
    }

    function stopAutoRetryCountdown() {
        if (autoRetryTimer) clearInterval(autoRetryTimer);
        autoRetryTimer = null;
        if (statusCountdownEl) {
            statusCountdownEl.textContent = '';
            statusCountdownEl.setAttribute('aria-hidden', 'true');
        }
    }

    // --- Admin modal & login handling (stores staff password in sessionStorage for this session) ---
    if (adminModalEl) {
        // Focus the password input when modal shown
        adminModalEl.addEventListener('shown.bs.modal', () => {
            if (adminPasswordInput) {
                adminPasswordInput.value = '';
                adminPasswordInput.focus();
            }
            if (adminErrorEl) adminErrorEl.classList.add('d-none');
        });

        // Return focus to the opener when modal hidden
        adminModalEl.addEventListener('hidden.bs.modal', () => {
            if (adminOpenBtn) adminOpenBtn.focus();
        });
    }

    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pwd = adminPasswordInput ? adminPasswordInput.value.trim() : '';
            if (!pwd) {
                if (adminErrorEl) {
                    adminErrorEl.textContent = 'Please enter the staff password.';
                    adminErrorEl.classList.remove('d-none');
                }
                if (adminPasswordInput) adminPasswordInput.focus();
                return;
            }
            // Exchange password for a short-lived token from the server
            (async () => {
                try {
                    adminErrorEl && adminErrorEl.classList.add('d-none');
                    const resp = await fetchWithTimeout('/api/staff-login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: pwd })
                    }, 10000);
                    const data = await resp.json().catch(() => ({}));
                    if (!resp.ok) {
                        const msg = data && data.message ? data.message : 'Invalid password';
                        if (adminErrorEl) {
                            adminErrorEl.textContent = msg;
                            adminErrorEl.classList.remove('d-none');
                        }
                        return;
                    }
                    if (data && data.token) {
                        // store token (short-lived) in sessionStorage
                        try { sessionStorage.setItem('staff_token', data.token); } catch (e) { /* ignore */ }
                        window.__STAFF_TOKEN = data.token;
                        // Close modal
                        try { const bsModal = bootstrap.Modal.getInstance(adminModalEl) || bootstrap.Modal.getOrCreateInstance(adminModalEl); bsModal.hide(); } catch (e) { }
                        showMessage('Admin unlocked for this session', 'success');
                    } else {
                        if (adminErrorEl) { adminErrorEl.textContent = (data && data.message) || 'Login failed'; adminErrorEl.classList.remove('d-none'); }
                    }
                } catch (err) {
                    console.error('Admin login failed:', err);
                    if (adminErrorEl) { adminErrorEl.textContent = 'Login failed. Please try again.'; adminErrorEl.classList.remove('d-none'); }
                }
            })();
        });
    }

    // Open modal programmatically when admin button clicked (keeps anchor-free unobtrusive behavior)
    if (adminOpenBtn && adminModalEl) {
        adminOpenBtn.addEventListener('click', (e) => {
            e.preventDefault();
            try {
                const bsModal = bootstrap.Modal.getOrCreateInstance(adminModalEl);
                bsModal.show();
            } catch (err) {
                // fallback: navigate to verify page
                window.location.href = '/verify.html';
            }
        });
    }

    function showMessage(message, type = "info", autoHide = true, options = {}) {
        if (currentMessageTimeout) clearTimeout(currentMessageTimeout);
        // If message is an HTML string or an object with title/text
        let title = options.title || '';
        let text = '';
        if (typeof message === 'object') {
            title = message.title || title;
            text = message.text || message.message || '';
        } else {
            text = message;
        }

        // Build hero card markup for nicer UX
        const wrapper = document.createElement('div');
        const cssType = `${type}`; // maps to CSS classes: success, danger, warning
        wrapper.innerHTML = `
            <div class="message-hero ${cssType} p-3">
                <div class="icon" aria-hidden="true">${getIconForType(type)}</div>
                <div class="content">
                    ${title ? `<div class="title">${escapeHtml(title)}</div>` : ''}
                    <div class="text">${escapeHtml(text)}</div>
                </div>
                <div class="cta">
                    <button type="button" class="btn btn-sm btn-outline-primary mh-action">OK</button>
                </div>
            </div>
        `;
        messageBoxContainer.innerHTML = '';
        messageBoxContainer.append(wrapper);
        window.scrollTo({ top: 0, behavior: 'smooth' });

        const actionBtn = wrapper.querySelector('.mh-action');
        if (actionBtn) actionBtn.addEventListener('click', () => clearMessage());

        if (autoHide) {
            currentMessageTimeout = setTimeout(() => {
                clearMessage();
            }, options.duration || 6000);
        }
    }
    function clearMessage() {
        /* ... Clear timeout logic ... */
        if (currentMessageTimeout) clearTimeout(currentMessageTimeout);
        messageBoxContainer.innerHTML = "";
    }

    function getIconForType(type) {
        switch (type) {
            case 'success': return '&#10004;';
            case 'danger': return '&#9888;';
            case 'warning': return '&#9888;';
            default: return '&#8505;';
        }
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return String(unsafe)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    async function fetchWithTimeout(
        url,
        options,
        timeout = REQUEST_TIMEOUT
    ) {
        /* ... no-cache logic ... */
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const updatedOptions = {
            ...options,
            signal: controller.signal,
            cache: "no-store",
        };
        const response = await fetch(url, updatedOptions);
        clearTimeout(id);
        return response;
    }
    function getFriendlyErrorMessage(error, context = "registration") {
        const defaultMessages = {
            registration: "An unknown error occurred during registration.",
            find: "Could not find pass. An unknown error occurred.",
        };

        // Network errors (fetch aborted, offline, DNS issues)
        if (error.name === "AbortError") {
            return "The request took too long and was canceled. Please check your network connection and try again.";
        }
        if (error instanceof TypeError && !navigator.onLine) {
            return "You appear to be offline. Please check your network connection.";
        }
        if (error instanceof TypeError) {
            return "A network error occurred. Could not connect to the server.";
        }

        // Server-side validation or known errors (from JSON response)
        if (error.message) {
            // Add more specific, user-friendly messages here
            switch (error.message) {
                case 'This phone number is already registered.':
                    return 'This phone number has already been used. Please try finding your pass instead.';
                case 'This email address is already registered.':
                    return 'This email address has already been used. Please try finding your pass instead.';
                case 'Failed to process profile picture.':
                    return 'There was a problem uploading your profile picture. Please try a different image or try again later.';
                case 'Payload is too large. Image may be too big.':
                    return 'The image you selected is too large. Please choose a file smaller than 10MB.';
                default:
                    return error.message; // Fallback to the server's message
            }
        }

        return defaultMessages[context];
    }
    function generateQRCode(regId, phone) {
        /* ... unchanged ... */
        const qrData = JSON.stringify({ regId, phone });
        qrCodeContainer.innerHTML = "";
        try {
            const qr = qrcode(0, "M");
            qr.addData(qrData);
            qr.make();
            qrCodeContainer.innerHTML = qr.createImgTag(4, 8);
        } catch (e) {
            console.error("QR fail:", e);
            qrCodeContainer.innerHTML = "<small>QR Error</small>";
        }
    }
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            const MAX_WIDTH = 300;
            const TARGET_QUALITY = 0.7; // Slightly higher quality
            const MAX_SIZE_KB = 90; // Increased max size
            const reader = new FileReader();
            reader.onload = (event) => {
                const image = new Image();
                image.onload = () => {
                    let { width, height } = image;
                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_WIDTH) {
                            width *= MAX_WIDTH / height;
                            height = MAX_WIDTH;
                        }
                    }
                    const canvas = document.createElement("canvas");
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(image, 0, 0, width, height);
                    canvas.toBlob(
                        (blob) => {
                            if (!blob) return reject(new Error("Canvas to Blob conversion failed."));
                            console.log(
                                `%cImage Compress:`,
                                "color:#0d6efd;font-weight:bold;"
                            );
                            console.log(
                                ` - Original: ${(file.size / 1024).toFixed(2)} KB`
                            );
                            console.log(
                                ` - Compressed: ${(blob.size / 1024).toFixed(2)} KB`
                            );
                            if (blob.size / 1024 > MAX_SIZE_KB)
                                console.warn(
                                    `Compressed size (${(blob.size / 1024).toFixed(
                                        2
                                    )}KB) is larger than target max size (${MAX_SIZE_KB}KB)`
                                );
                            const dataUrlReader = new FileReader();
                            dataUrlReader.onloadend = () =>
                                resolve(dataUrlReader.result);
                            dataUrlReader.onerror = (err) => reject(new Error("Could not read blob as Data URL."));
                            dataUrlReader.readAsDataURL(blob);
                        },
                        "image/jpeg",
                        TARGET_QUALITY
                    );
                };
                image.onerror = (err) =>
                    reject(new Error("Image could not be loaded. It may be corrupt or in an unsupported format."));
                image.src = event.target.result;
            };
            reader.onerror = (err) =>
                reject(new Error("File could not be read. Please select the file again."));
            reader.readAsDataURL(file);
        });
    }
    function resetForms() {
        /* ... unchanged ... */
        registrationForm.reset();
        registrationForm.classList.remove("was-validated");
        avatarPreview.src = defaultAvatarSrc;
        avatarPickerLabel.classList.remove("is-invalid");
        avatarFeedback.textContent = "";
        findPassForm.reset();
        findPassForm.classList.remove("was-validated");
        findPassInput.placeholder = "Enter phone number";
        findPassInput.type = "tel";
        findPassLabel.textContent = "Phone Number";
        findPassIcon.className = "fas fa-phone input-icon";
        findPassInput.setAttribute("pattern", "[0-9]{10}");
        findPassInput.setAttribute("maxlength", "10");
        findPassInput.setAttribute("inputmode", "numeric");
        document.getElementById("search-type-phone").checked = true;
        clearMessage();
    }

    // Sanitize digit-only inputs and enforce maxlength
    function sanitizeDigits(el, maxLen = 10) {
        if (!el) return;
        const original = el.value;
        // Remove non-digits
        let sanitized = original.replace(/\D+/g, "");
        if (sanitized.length > maxLen) sanitized = sanitized.slice(0, maxLen);
        if (sanitized !== original) el.value = sanitized;
    }

    // --- UPDATE populateEpass (Phone/Email Display Removed) ---
    function populateEpass(attendee, imageSrc) {
        epassAvatar.src =
            imageSrc ||
            attendee.profile_pic_url ||
            "https://placehold.co/110x110/6c757d/white?text=No+Photo";
        epassName.textContent = attendee.full_name
            ? attendee.full_name.toUpperCase()
            : "N/A";
        epassRegId.textContent = attendee.registration_id || "N/A";

        // Still generate QR with phone number, even if not displayed
        generateQRCode(attendee.registration_id, attendee.phone_number);

        registrationSection.classList.add("d-none");
        findPassSection.classList.add("d-none");
        clearMessage();
        epassSection.classList.remove("d-none");
        window.scrollTo(0, 0); // Scroll to top
    }

    // --- Event Listeners ---
    profilePicInput.addEventListener("change", async (e) => {
        /* ... unchanged ... */
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            showMessage("Invalid image file.", "danger");
            profilePicInput.value = "";
            return;
        }
        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            showMessage("Image too large (Max 10MB).", "danger");
            profilePicInput.value = "";
            return;
        }
        avatarFeedback.textContent = "";
        avatarPickerLabel.classList.remove("is-invalid");
        try {
            avatarPreview.src =
                "https://placehold.co/150x150/f0f0f0/a0a0a0?text=Processing...";
            const compressedDataUrl = await compressImage(file);
            avatarPreview.src = compressedDataUrl;
        } catch (error) {
            console.error("Image processing failed:", error);
            // Provide a more specific, user-friendly error message
            const userMessage = error.message.includes("unsupported format")
                ? "Image format not supported. Please use a standard format like JPG or PNG."
                : "Could not process the selected image. It might be corrupt. Please try another photo.";
            showMessage(userMessage, "danger");
            avatarPreview.src = defaultAvatarSrc;
            profilePicInput.value = "";
        }
    });

    registrationForm.addEventListener("submit", async (e) => {
        /* ... unchanged ... */
        e.preventDefault();
        e.stopPropagation();
        clearMessage();
        let isFormValid = registrationForm.checkValidity();
        let isImageValid =
            avatarPreview.src !== defaultAvatarSrc &&
            !avatarPreview.src.includes("Processing");
        if (!isImageValid) {
            avatarFeedback.textContent = "Upload picture.";
            avatarPickerLabel.classList.add("is-invalid");
        } else {
            avatarFeedback.textContent = "";
            avatarPickerLabel.classList.remove("is-invalid");
        }
        registrationForm.classList.add("was-validated");
        if (!isFormValid || !isImageValid) {
            showMessage("Fix errors & upload picture.", "warning");
            const firstInvalid = registrationForm.querySelector(":invalid");
            if (firstInvalid) firstInvalid.focus();
            return;
        }
        const formData = new FormData(registrationForm);
        const name = formData.get("name"),
            phone = formData.get("phone"),
            email = formData.get("email"),
            city = formData.get("city"),
            state = formData.get("state");
        const imageBase64 = avatarPreview.src;
        const postData = { name, phone, email, city, state, imageBase64 };
        submitButton.disabled = true;
        spinner.classList.remove("d-none");
        submitButtonText.innerText = "Registering...";
        try {
            const response = await fetchWithTimeout("/api/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(postData),
            });
            const result = await response.json();
            if (!response.ok) {
                // Create an error object with the message from the server
                throw new Error(
                    result.message ||
                    `Registration failed (Status: ${response.status})`
                );
            }
            populateEpass(result.data, imageBase64);
        } catch (error) {
            console.error("Registration failed:", error);
            const friendlyMessage = getFriendlyErrorMessage(
                error,
                "registration"
            );
            showMessage(friendlyMessage, "danger", false); // Show error without auto-hiding
        } finally {
            submitButton.disabled = false;
            spinner.classList.add("d-none");
            submitButtonText.innerText = "Register";
        }
    });

    findPassToggles.forEach((toggle) => {
        toggle.addEventListener("change", (e) => {
            const isPhone = e.target.value === "phone";
            const feedbackElement = findPassInput.closest('.form-floating').querySelector('.invalid-feedback');

            if (isPhone) {
                // Set properties for PHONE
                findPassLabel.textContent = "Phone Number";
                findPassIcon.className = "fas fa-phone input-icon";
                findPassInput.placeholder = "Enter your 10-digit phone number";
                findPassInput.type = "tel";
                findPassInput.setAttribute("pattern", "[0-9]{10}");
                findPassInput.setAttribute("maxlength", "10");
                findPassInput.setAttribute("inputmode", "numeric");
                if (feedbackElement) {
                    feedbackElement.textContent =
                        "Please enter a valid 10-digit phone number.";
                }
            } else {
                // Set properties for EMAIL
                findPassLabel.textContent = "Email Address";
                findPassIcon.className = "fas fa-envelope input-icon";
                findPassInput.placeholder = "Enter your email address";
                findPassInput.type = "email";
                findPassInput.removeAttribute("pattern");
                findPassInput.removeAttribute("maxlength");
                findPassInput.removeAttribute("inputmode");
                if (feedbackElement) {
                    feedbackElement.textContent =
                        "Please enter a valid email address.";
                }
            }

            // Reset validation state
            findPassInput.value = "";
            findPassForm.classList.remove("was-validated");
        });
    });

    // sanitize on input/paste for phone fields
    if (phoneInput) {
        phoneInput.addEventListener("input", () => sanitizeDigits(phoneInput, 10));
        phoneInput.addEventListener("paste", (ev) => {
            // Allow paste but sanitize after a tick
            setTimeout(() => sanitizeDigits(phoneInput, 10), 0);
        });
    }
    if (findPassInput) {
        findPassInput.addEventListener("input", () => {
            const isPhoneMode = document.getElementById("search-type-phone").checked;
            if (isPhoneMode) sanitizeDigits(findPassInput, 10);
        });
        findPassInput.addEventListener("paste", (ev) => {
            setTimeout(() => {
                const isPhoneMode = document.getElementById("search-type-phone").checked;
                if (isPhoneMode) sanitizeDigits(findPassInput, 10);
            }, 0);
        });
    }

    findPassForm.addEventListener("submit", async (e) => {
        /* ... unchanged ... */
        e.preventDefault();
        e.stopPropagation();
        clearMessage();
        if (!findPassForm.checkValidity()) {
            findPassForm.classList.add("was-validated");
            return;
        }
        findPassForm.classList.add("was-validated");
        const searchType = document.querySelector(
            'input[name="search-type"]:checked'
        ).value;
        const searchValue = findPassInput.value.trim();
        const postData =
            searchType === "phone"
                ? { phone: searchValue }
                : { email: searchValue };
        findPassButton.disabled = true;
        findPassSpinner.classList.remove("d-none");
        findPassButtonText.innerText = "Searching...";
        try {
            const response = await fetchWithTimeout("/api/find-pass", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(postData),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(
                    result.message ||
                    `Find Pass failed (Status: ${response.status})`
                );
            }
            populateEpass(result.data, null);
        } catch (error) {
            console.error("Find Pass failed:", error);
            const friendlyMessage = getFriendlyErrorMessage(error, "find");
            showMessage(friendlyMessage, "danger", false); // Show error without auto-hiding
        } finally {
            findPassButton.disabled = false;
            findPassSpinner.classList.add("d-none");
            findPassButtonText.innerText = "Find My Pass";
        }
    });

    // Download Button Logic
    downloadButton.addEventListener("click", () => {
        /* ... unchanged ... */
        const passElement = epassCardElement;
        const regIdText = epassRegId.textContent;
        const filename = `E-PASS-${regIdText || "event"}.png`;
        const scale = 2.5;
        const originalStyle = passElement.style.cssText;
        const cardWidth = passElement.offsetWidth;
        passElement.style.width = `${cardWidth}px`;
        passElement.style.maxWidth = `${cardWidth}px`;
        passElement.style.margin = "10px auto";
        downloadButton.disabled = true;
        downloadButton.textContent = "Downloading...";
        html2canvas(passElement, {
            useCORS: true,
            scale: scale,
            backgroundColor: "#f0f2f5",
            logging: false,
            scrollX: 0,
            scrollY: 0,
            windowWidth: document.documentElement.offsetWidth,
        })
            .then((canvas) => {
                const link = document.createElement("a");
                link.href = canvas.toDataURL("image/png");
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                showMessage("E-Pass downloaded successfully!", "success");
            })
            .catch((err) => {
                console.error("Download failed:", err);
                showMessage("Could not download E-Pass.", "danger");
            })
            .finally(() => {
                passElement.style.cssText = originalStyle;
                downloadButton.disabled = false;
                downloadButton.textContent = "Download E-Pass";
            });
    });

    // Back to Home Button
    backToHomeButton.addEventListener("click", () => {
        /* ... unchanged ... */
        epassSection.classList.add("d-none");
        registrationSection.classList.remove("d-none");
        findPassSection.classList.remove("d-none");
        resetForms();
        window.scrollTo(0, 0);
    });

    // Initial status check on page load
    checkSystemStatus();

}); // End DOMContentLoaded
