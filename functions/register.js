// Final, Optimized Registration Function (functions/register.js)
// ---
// This version includes:
// 1. Payload size limits (10MB) to prevent abuse.
// 2. Robust validation (trimming all text inputs).
// 3. Duplicate phone check *before* Cloudinary upload for efficiency.
// 4. Server-side Cloudinary transformation as a safety net.
// 5. Hardened DB error handling (checks constraint_name).
// 6. Safer "fire-and-forget" email sending using an async IIFE.
// 7. Database statement_timeout (8s) to prevent hanging queries.
// 8. Specific error handling for database timeouts.
// ---

const postgres = require('postgres');
const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');

// --- CONSTANTS ---
const MAX_PAYLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const PHONE_REGEX = /^[0-9]{10}$/; // Exactly 10 digits
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // Simple email format check
const BASE64_IMAGE_REGEX = /^data:image\/(png|jpeg|jpg|gif);base64,/;

// --- OPTIMIZATION: Connection Re-use ---
let sql;
try {
    sql = postgres(process.env.DATABASE_URL, {
        ssl: 'require',
        connect_timeout: 5,
        idle_timeout: 30,
        max: 5,
        set_local: { statement_timeout: '8s' }
    });
    console.log("Database connection pool initialized successfully.");
} catch (error) {
    console.error("CRITICAL: Failed to initialize database connection:", error.message);
    sql = null;
}

// Configure Cloudinary
try {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        throw new Error("Missing Cloudinary configuration environment variables.");
    }
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
    });
    console.log("Cloudinary configuration successful.");
} catch (error) {
    console.error("CRITICAL: Failed to configure Cloudinary:", error.message);
}

/**
 * Sends a confirmation email using FormSubmit.co (fire-and-forget).
 * @param {object} attendee - Attendee data { full_name, email, registration_id }
 * @param {string} formSubmitEmail - Your FormSubmit.co email address
 */
function sendConfirmationEmail(attendee, formSubmitEmail) {
    if (!formSubmitEmail) {
        console.warn('FORMSUBMIT_EMAIL environment variable not set. Skipping email confirmation.');
        return;
    }
    if (!attendee || !attendee.full_name || !attendee.email || !attendee.registration_id) {
        console.error('sendConfirmationEmail: Invalid attendee data provided. Cannot send email.');
        return;
    }

    const { full_name, email, registration_id } = attendee;
    const emailSubject = `Registration Confirmed: Your E-Pass for the Event!`;
    const emailHtml = `
        <html><head><style> body { font-family: sans-serif; line-height: 1.6; } .details { padding: 10px; background-color: #f0f0f0; border-radius: 4px; } .reg-id { font-weight: bold; color: #8B4513; } </style></head>
        <body> <h2>Hi ${full_name},</h2>
        <p>Thank you for registering! Your E-Pass details:</p>
        <div class="details"> Name: ${full_name}<br> Email: ${email}<br> Registration ID: <span class="reg-id">${registration_id}</span> </div>
        <p>We look forward to seeing you!</p> </body></html>`;

    (async () => {
        try {
            console.log(`Sending confirmation email to ${email} via FormSubmit...`);
            const response = await fetch(`https://formsubmit.co/${formSubmitEmail}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    _to: email,
                    _subject: emailSubject,
                    name: full_name,
                    message: emailHtml,
                    _template: "table"
                })
            });

            if (response.ok || response.status === 302) {
                console.log('FormSubmit email initiated successfully.');
            } else {
                const errorText = await response.text().catch(() => "Could not read response body");
                console.error(`FormSubmit send failed with status ${response.status}: ${errorText}`);
            }
        } catch (err) {
            console.error('FormSubmit fetch network error:', err.message);
        }
    })();
}


// --- Netlify Function Handler ---
exports.handler = async (event) => {
    const headers = {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    };

    if (!sql) {
        console.error("Handler Error: Database connection is not available.");
        return { statusCode: 500, headers, body: JSON.stringify({ message: 'Database service unavailable.' }) };
    }
    if (!cloudinary.config()?.api_key) {
        console.error("Handler Error: Cloudinary configuration is incomplete or missing.");
        return { statusCode: 500, headers, body: JSON.stringify({ message: 'Image service unavailable.' }) };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    const contentLength = event.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE_BYTES) {
        console.warn(`Handler Warn: Payload size (${contentLength} bytes) exceeds limit.`);
        return { statusCode: 413, headers, body: JSON.stringify({ message: 'Payload is too large. Image may be too big.' }) };
    }

    let body;
    let name, phone, email, city, state, imageBase64, normalizedEmail;
    try {
        body = JSON.parse(event.body);

        name = body.name ? String(body.name).trim() : "";
        phone = body.phone ? String(body.phone).trim() : "";
        email = body.email ? String(body.email).trim() : "";
        city = body.city ? String(body.city).trim() : "";
        state = body.state ? String(body.state).trim() : "";
        imageBase64 = body.imageBase64;

        if (!name || !phone || !email || !city || !state || !imageBase64) {
            return { statusCode: 400, headers, body: JSON.stringify({ message: 'All fields, including a profile picture, are required.' }) };
        }
        if (!PHONE_REGEX.test(phone)) {
            return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid phone number format. Please use 10 digits.' }) };
        }
        if (!EMAIL_REGEX.test(email)) {
            return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid email address format.' }) };
        }
        if (imageBase64 && !BASE64_IMAGE_REGEX.test(imageBase64)) {
            return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid image format. Please upload a valid image.' }) };
        }

        normalizedEmail = email.toLowerCase();

    } catch (error) {
        console.warn("Handler Warn: Could not parse request body.", error.message);
        return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid request format.' }) };
    }

    try {
        // Server-side guard: check system_config for both registration_enabled and maintenance_mode
        try {
            const cfg = await sql`SELECT key, value FROM system_config WHERE key IN ('registration_enabled', 'maintenance_mode')`;
            const registrationCfg = cfg.find(c => c.key === 'registration_enabled');
            const maintenanceCfg = cfg.find(c => c.key === 'maintenance_mode');

            if (maintenanceCfg && maintenanceCfg.value === 'true') {
                console.warn('Registration attempt blocked: system is in maintenance mode.');
                return { statusCode: 503, headers, body: JSON.stringify({ message: 'Service is temporarily down for maintenance. Please try again later.' }) };
            }

            if (registrationCfg && registrationCfg.value !== 'true') {
                console.warn('Registration attempt blocked: registrations are disabled in system_config.');
                return { statusCode: 403, headers, body: JSON.stringify({ message: 'Registrations are currently closed.' }) };
            }
        } catch (cfgErr) {
            console.warn('Could not read system configuration; allowing registration as fallback.', cfgErr.message);
        }

        console.log(`Checking for duplicate phone: ${phone}`);
        const existingPhone = await sql`
            SELECT registration_id FROM attendees WHERE phone_number = ${phone} LIMIT 1
        `;

        if (existingPhone.count > 0) {
            console.log(`Duplicate phone found (Reg ID: ${existingPhone[0].registration_id}). Aborting.`);
            return {
                statusCode: 409, headers,
                body: JSON.stringify({ message: 'This phone number is already registered.' }),
            };
        }
        console.log(`Phone number ${phone} is unique. Proceeding...`);

        let imageUrl = null;
        if (imageBase64) {
            console.log('Image data provided. Uploading to Cloudinary...');
            try {
                const uploadResult = await cloudinary.uploader.upload(imageBase64, {
                    folder: 'event-attendees',
                    resource_type: 'image',
                    transformation: [
                        { width: 300, height: 300, crop: "fill", gravity: "face" },
                        { fetch_format: "auto", quality: "auto" }
                    ]
                });
                imageUrl = uploadResult.secure_url;
                console.log(`Cloudinary upload successful. Image URL: ${imageUrl}`);
            } catch (uploadError) {
                console.error('Cloudinary upload error:', uploadError.message);
                return { statusCode: 500, headers, body: JSON.stringify({ message: 'Failed to process profile picture.' }) };
            }
        }

        const regId = `UP25-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        console.log(`Generated Registration ID: ${regId}`);

        console.log(`Inserting attendee (${name}, ${phone}) into database...`);
        const [attendee] = await sql`
            INSERT INTO attendees (
                registration_id, full_name, phone_number, email, city, state_province, profile_pic_url
            ) VALUES (
                ${regId}, ${name}, ${phone}, ${normalizedEmail}, ${city}, ${state}, ${imageUrl}
            )
            RETURNING registration_id, full_name, phone_number, email, profile_pic_url
        `;
        console.log('Attendee database insertion successful:', { regId: attendee.registration_id, phone: attendee.phone_number });

        sendConfirmationEmail(attendee, process.env.FORMSUBMIT_EMAIL);

        return {
            statusCode: 200, headers,
            body: JSON.stringify({
                message: 'Registration successful!',
                data: attendee,
            }),
        };

    } catch (error) {
        console.error('Handler Error:', error.message);

        if (error.code === '23505') {
            if (error.constraint_name === 'unique_phone') {
                console.warn(`Database: Duplicate phone ${phone} detected during INSERT.`);
                return {
                    statusCode: 409, headers,
                    body: JSON.stringify({ message: 'This phone number is already registered.' }),
                };
            }
            if (error.constraint_name === 'unique_email') {
                console.warn(`Database: Duplicate email ${normalizedEmail} detected during INSERT.`);
                return {
                    statusCode: 409, headers,
                    body: JSON.stringify({ message: 'This email address is already registered.' }),
                };
            }
            console.error(`Database unique constraint violation: ${error.constraint_name}`);
            return {
                statusCode: 500, headers,
                body: JSON.stringify({ message: 'A server error occurred. Please try again.' }),
            };
        }

        if (error.code === '57014') {
            console.error('Database query timed out (8s).');
            return {
                statusCode: 504, headers,
                body: JSON.stringify({ message: 'The request timed out while processing. Please try again.' }),
            };
        }

        return {
            statusCode: 500, headers,
            body: JSON.stringify({ message: 'An internal server error occurred during registration.' }),
        };
    }
};