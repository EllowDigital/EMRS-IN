// Final, Optimized Find Pass Function (functions/find-pass.js)
// ---
// This version includes:
// 1. Connection re-use for speed.
// 2. HTTP Method and Payload Size checks for security.
// 3. Robust input trimming and validation.
// 4. Search by EITHER email (case-insensitive) OR phone number.
// 5. A robust "fire-and-forget" email is sent on success.
// 6. Database statement_timeout (8s) to prevent hanging queries.
// 7. Added 'Cache-Control: no-store' headers to all responses.
// ---

const postgres = require('postgres');

// --- CONSTANTS ---
const MAX_PAYLOAD_SIZE_BYTES = 2 * 1024; // 2KB
const PHONE_REGEX = /^[0-9]{10}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- OPTIMIZATION: Connection Re-use ---
let sql;
try {
    sql = postgres(process.env.DATABASE_URL, {
        ssl: 'require',
        connect_timeout: 5,
        idle_timeout: 20,
        max: 5,
        set_local: { statement_timeout: '8s' }
    });
    console.log("Database connection pool initialized successfully (find-pass.js).");
} catch (error) {
    console.error("CRITICAL: Failed to initialize database connection (find-pass.js):", error.message);
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
    })();
}


// --- Netlify Function Handler ---

exports.handler = async (event) => {
    const cacheHeaders = {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    };

    if (!sql) {
        console.error("Handler Error: Database connection is not available.");
        return {
            statusCode: 500,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'Database service unavailable.' })
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'Method Not Allowed' })
        };
    }

    const contentLength = event.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE_BYTES) {
        console.warn(`Handler Warn: Payload size (${contentLength} bytes) exceeds limit.`);
        return {
            statusCode: 413,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'Payload is too large.' })
        };
    }

    let body;
    let email, phone, normalizedEmail;
    try {
        body = JSON.parse(event.body);

        email = body.email ? String(body.email).trim() : "";
        phone = body.phone ? String(body.phone).trim() : "";

        if (!email && !phone) {
            return {
                statusCode: 400,
                headers: cacheHeaders,
                body: JSON.stringify({ message: 'Email or phone number is required.' })
            };
        }

        if (email && !EMAIL_REGEX.test(email)) {
            return { statusCode: 400, headers: cacheHeaders, body: JSON.stringify({ message: 'Invalid email address format.' }) };
        }
        if (phone && !PHONE_REGEX.test(phone)) {
            return { statusCode: 400, headers: cacheHeaders, body: JSON.stringify({ message: 'Invalid phone number format. Please use 10 digits.' }) };
        }

        if (email) {
            normalizedEmail = email.toLowerCase();
        }

    } catch (error) {
        console.warn("Handler Warn: Could not parse request body.", error.message);
        return {
            statusCode: 400,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'Invalid request format.' })
        };
    }

    try {
        let attendee;

        if (email) {
            console.log(`Searching for pass with email: ${normalizedEmail}`);
            [attendee] = await sql`
                SELECT 
                    registration_id, full_name, phone_number, email, profile_pic_url 
                FROM attendees 
                WHERE email = ${normalizedEmail}
                LIMIT 1 
            `;
        } else if (phone) {
            console.log(`Searching for pass with phone: ${phone}`);
            [attendee] = await sql`
                SELECT 
                    registration_id, full_name, phone_number, email, profile_pic_url 
                FROM attendees 
                WHERE phone_number = ${phone}
                LIMIT 1 
            `;
        }

        if (attendee) {
            console.log(`Attendee found: ${attendee.registration_id}`);
            sendConfirmationEmail(attendee, process.env.FORMSUBMIT_EMAIL);

            return {
                statusCode: 200,
                headers: cacheHeaders,
                body: JSON.stringify({
                    message: 'Attendee found.',
                    data: attendee,
                }),
            };
        } else {
            console.log(`No attendee found with details: ${email || phone}`);
            return {
                statusCode: 404,
                headers: cacheHeaders,
                body: JSON.stringify({ message: 'No registration found for these details.' }),
            };
        }

    } catch (error) {
        console.error('Database search error:', error.message);

        if (error.code === '57014') {
            console.error('Database query timed out (8s).');
            return {
                statusCode: 504,
                headers: cacheHeaders,
                body: JSON.stringify({ message: 'The request timed out. Please try again.' }),
            };
        }

        return {
            statusCode: 500,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'An internal server error occurred.' }),
        };
    }
};