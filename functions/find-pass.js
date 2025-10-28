// Final, Optimized Find Pass Function (functions/find-pass.js)
// ---
// This version includes:
// 1. Connection re-use for speed.
// 2. HTTP Method and Payload Size checks for security.
// 3. Robust input trimming and validation.
// 4. Search by EITHER email (case-insensitive) OR phone number.
// 5. A robust "fire-and-forget" email is sent on success.
// 6. Database statement_timeout (8s) to prevent hanging queries.
// ---

const postgres = require('postgres');

// --- CONSTANTS ---
const MAX_PAYLOAD_SIZE_BYTES = 2 * 1024; // 2KB (generous for a small JSON request)

// --- OPTIMIZATION: Connection Re-use ---
let sql;
try {
    // Standardized connection settings
    sql = postgres(process.env.DATABASE_URL, {
        ssl: 'require',
        connect_timeout: 5,   // Fail fast on new connections
        idle_timeout: 20,     // Close idle connections sooner
        max: 5,               // Max 5 concurrent connections
        // Set an 8-second timeout for all DB queries
        set_local: { statement_timeout: '8s' }
    });
    console.log("Database connection pool initialized successfully.");
} catch (error) {
    console.error("CRITICAL: Failed to initialize database connection:", error.message);
    sql = null;
}

/**
 * Sends a confirmation email using FormSubmit.co (fire-and-forget).
 * @param {object} attendee - The attendee data object
 * @param {string} formSubmitEmail - Your FormSubmit.co email address
 */
function sendConfirmationEmail(attendee, formSubmitEmail) {
    if (!formSubmitEmail) {
        console.warn('FORMSUBMIT_EMAIL environment variable is not set. Skipping email confirmation.');
        return;
    }
    if (!attendee || !attendee.full_name || !attendee.email || !attendee.registration_id) {
        console.error('sendConfirmationEmail: Invalid attendee data provided. Cannot send email.');
        return;
    }

    const { full_name, email, registration_id } = attendee;
    const emailSubject = `Your E-Pass for the Event`;
    const emailHtml = `
        <html>
        <head>
            <style> body { font-family: Arial, sans-serif; line-height: 1.6; } h1 { color: #333; } p { margin-bottom: 20px; } .pass-details { padding: 15px; background-color: #f4f4f4; border-radius: 5px; } .reg-id { font-size: 20px; font-weight: bold; color: #8D6E63; } </style>
        </head>
        <body>
            <h1>Hi ${full_name},</h1>
            <p>You requested your E-Pass for the upcoming event. Here are your details:</p>
            <div class="pass-details">
                <strong>Name:</strong> ${full_name}<br>
                <strong>Email:</strong> ${email}<br>
                <strong>Registration ID:</strong> <span class="reg-id">${registration_id}</span>
            </div>
            <p style="margin-top: 20px;">Please keep this email safe. We look forward to seeing you!</p>
        </body>
        </html>
    `;

    // Use an IIFE (Immediately Invoked Function Expression) async wrapper
    (async () => {
        try {
            console.log(`Sending found pass email to ${email} via FormSubmit...`);
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
                console.log('FormSubmit email initiated successfully for found pass.');
            } else {
                const errorText = await response.text().catch(() => "Could not read response body");
                console.error(`FormSubmit send failed with status ${response.status} (find pass): ${errorText}`);
            }
        } catch (err) {
            console.error('FormSubmit fetch network error (find pass):', err.message);
        }
    })(); // Execute the async function immediately
}


// --- Netlify Function Handler ---

exports.handler = async (event) => {
    // 1. Check for critical DB configuration
    if (!sql) {
        console.error("Handler Error: Database connection is not available.");
        return { statusCode: 500, body: JSON.stringify({ message: 'Database service unavailable.' }) };
    }

    // 2. Check HTTP Method
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // 3. Payload Size Check
    const contentLength = event.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE_BYTES) {
        console.warn(`Handler Warn: Payload size (${contentLength} bytes) exceeds limit.`);
        return { statusCode: 413, body: JSON.stringify({ message: 'Payload is too large.' }) };
    }

    // 4. Parse and Validate Body
    let body;
    let email, phone, normalizedEmail;
    try {
        body = JSON.parse(event.body);

        // Trim all inputs and validate for empty strings
        email = body.email ? body.email.trim() : "";
        phone = body.phone ? body.phone.trim() : "";

        if (!email && !phone) {
            console.warn("Handler Warn: Missing email or phone in request body.");
            return { statusCode: 400, body: JSON.stringify({ message: 'Email or phone number is required.' }) };
        }

        if (email) {
            normalizedEmail = email.toLowerCase();
        }

    } catch (error) {
        console.warn("Handler Warn: Could not parse request body.", error.message);
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request format.' }) };
    }

    // 5. Execute Database Query
    try {
        let attendee;

        if (email) {
            // Search by email (case-insensitive)
            console.log(`Searching for pass with email: ${normalizedEmail}`);
            [attendee] = await sql`
                SELECT 
                    registration_id, full_name, phone_number, email, profile_pic_url 
                FROM attendees 
                WHERE email = ${normalizedEmail}
                LIMIT 1
            `;
        } else if (phone) {
            // Search by phone number (which is unique)
            console.log(`Searching for pass with phone: ${phone}`);
            [attendee] = await sql`
                SELECT 
                    registration_id, full_name, phone_number, email, profile_pic_url 
                FROM attendees 
                WHERE phone_number = ${phone}
            `;
        }

        // 6. Handle Results
        if (attendee) {
            // Found the attendee
            console.log(`Attendee found: ${attendee.registration_id}`);

            // Send Confirmation Email (Fire-and-forget)
            sendConfirmationEmail(attendee, process.env.FORMSUBMIT_EMAIL);

            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: 'Attendee found.',
                    data: attendee,
                }),
            };
        } else {
            // Did not find the attendee
            console.log(`No attendee found with details: ${email || phone}`);
            return {
                statusCode: 404, // 404 Not Found
                body: JSON.stringify({ message: 'No registration found for these details.' }),
            };
        }

    } catch (error) {
        // Handle any database or unexpected errors
        console.error('Database search error:', error.message);

        // Handle statement timeout error from database
        if (error.code === '57014') { // PostgreSQL query_canceled code
            console.error('Database query timed out (8s).');
            return {
                statusCode: 504, // Gateway Timeout
                body: JSON.stringify({ message: 'The request timed out. Please try again.' }),
            };
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal server error occurred.' }),
        };
    }
};