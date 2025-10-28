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

// --- OPTIMIZATION: Connection Re-use ---
let sql;
try {
    sql = postgres(process.env.DATABASE_URL, {
        ssl: 'require',
        connect_timeout: 5,
        idle_timeout: 30,
        max: 5,
        // Set an 8-second timeout for all DB queries
        // This is safely below the 9.5s client timeout and 10s function timeout.
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

    // Use an IIFE (Immediately Invoked Function Expression) async wrapper
    // This is still "fire-and-forget" but allows for cleaner async/await
    // and more robust error handling within the promise chain.
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
    })(); // Execute the async function immediately
}


// --- Netlify Function Handler ---
exports.handler = async (event) => {
    // --- Check critical configurations ---
    if (!sql) {
        console.error("Handler Error: Database connection is not available.");
        return { statusCode: 500, body: JSON.stringify({ message: 'Database service unavailable.' }) };
    }
    if (!cloudinary.config()?.api_key) {
        console.error("Handler Error: Cloudinary configuration is incomplete or missing.");
        return { statusCode: 500, body: JSON.stringify({ message: 'Image service unavailable.' }) };
    }

    // --- Check method ---
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // --- Payload Size Check ---
    const contentLength = event.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE_BYTES) {
        console.warn(`Handler Warn: Payload size (${contentLength} bytes) exceeds limit.`);
        return { statusCode: 413, body: JSON.stringify({ message: 'Payload is too large. Image may be too big.' }) };
    }

    // --- Parse and Validate Body ---
    let body;
    let name, phone, email, city, state, imageBase64, normalizedEmail;
    try {
        body = JSON.parse(event.body);

        // Trim all inputs and validate for empty strings
        name = body.name ? body.name.trim() : "";
        phone = body.phone ? body.phone.trim() : "";
        email = body.email ? body.email.trim() : "";
        city = body.city ? body.city.trim() : "";
        state = body.state ? body.state.trim() : "";
        imageBase64 = body.imageBase64; // No trim needed

        if (!name || !phone || !email || !city || !state) {
            console.warn("Handler Warn: Missing required fields after parsing/trimming.");
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing required registration details.' }) };
        }

        normalizedEmail = email.toLowerCase();

    } catch (error) {
        console.warn("Handler Warn: Could not parse request body.", error.message);
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request format.' }) };
    }

    try {
        // --- OPTIMIZATION: Check for duplicate phone *before* image upload ---
        console.log(`Checking for duplicate phone: ${phone}`);
        const existingPhone = await sql`
            SELECT registration_id FROM attendees WHERE phone_number = ${phone} LIMIT 1
        `;

        if (existingPhone.count > 0) {
            console.log(`Duplicate phone found (Reg ID: ${existingPhone[0].registration_id}). Aborting.`);
            return {
                statusCode: 409, // Conflict
                body: JSON.stringify({ message: 'This phone number is already registered.' }),
            };
        }
        console.log(`Phone number ${phone} is unique. Proceeding...`);

        // --- Image Upload (only if imageBase64 is provided) ---
        let imageUrl = null;
        if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image')) {
            console.log('Image data provided. Uploading to Cloudinary...');
            try {
                const uploadResult = await cloudinary.uploader.upload(imageBase64, {
                    folder: 'event-attendees',
                    resource_type: 'image',

                    // Enforce server-side transformation as a safety net
                    transformation: [
                        { width: 300, height: 300, crop: "fill", gravity: "face" },
                        { fetch_format: "auto", quality: "auto" }
                    ]
                });
                imageUrl = uploadResult.secure_url;
                console.log(`Cloudinary upload successful. Image URL: ${imageUrl}`);
            } catch (uploadError) {
                console.error('Cloudinary upload error:', uploadError.message);
                return { statusCode: 500, body: JSON.stringify({ message: 'Failed to process profile picture.' }) };
            }
        } else {
            console.log('No valid image data provided. Skipping Cloudinary upload.');
        }

        // --- Generate (slightly) stronger Unique Registration ID ---
        const regId = `UP25-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; // 5 bytes = 10 hex chars
        console.log(`Generated Registration ID: ${regId}`);

        // --- Insert Attendee into Database ---
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

        // --- Send Confirmation Email (Fire-and-forget) ---
        sendConfirmationEmail(attendee, process.env.FORMSUBMIT_EMAIL);

        // --- Send Success Response to Frontend ---
        return {
            statusCode: 200, // OK
            body: JSON.stringify({
                message: 'Registration successful!',
                data: attendee,
            }),
        };

    } catch (error) {
        console.error('Handler Error:', error.message);

        // Check constraint name for specific 409 error
        if (error.code === '23505') { // PostgreSQL unique violation code
            if (error.constraint_name === 'attendees_phone_number_key') {
                console.warn(`Database race condition: Duplicate phone ${phone} detected during INSERT.`);
                return {
                    statusCode: 409, // Conflict
                    body: JSON.stringify({ message: 'This phone number is already registered.' }),
                };
            }
            console.error(`Database unique constraint violation: ${error.constraint_name}`);
            return {
                statusCode: 500,
                body: JSON.stringify({ message: 'A server error occurred. Please try again.' }),
            };
        }

        // Handle statement timeout error from database
        if (error.code === '57014') { // PostgreSQL query_canceled code
            console.error('Database query timed out (8s).');
            return {
                statusCode: 504, // Gateway Timeout
                body: JSON.stringify({ message: 'The request timed out while processing. Please try again.' }),
            };
        }

        // Generic internal server error
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal server error occurred during registration.' }),
        };
    }
};