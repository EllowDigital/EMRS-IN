// Final, Optimized Find Pass Function (functions/find-pass.js)
// ---
// This version includes:
// 1. Connection re-use for speed.
// 2. Search by EITHER email (case-insensitive) OR phone number.
// 3. A confirmation email is sent via FormSubmit.co on success.
// ---

const postgres = require('postgres');

// --- OPTIMIZATION 1: Connection Re-use ---
let sql;
try {
    sql = postgres(process.env.DATABASE_URL, {
        ssl: 'require',
        connect_timeout: 5, // 5-second connection timeout
        idle_timeout: 10,   // Close idle connections after 10 seconds
    });
} catch (error) {
    console.error("Failed to initialize database connection:", error.message);
}

/**
 * Sends a confirmation email using FormSubmit.co.
 * @param {object} attendee - The attendee data object
 * @param {string} formSubmitEmail - Your FormSubmit.co email address
 */
async function sendConfirmationEmail(attendee, formSubmitEmail) {
    if (!formSubmitEmail) {
        console.warn('FORMSUBMIT_EMAIL environment variable is not set. Skipping email confirmation.');
        return;
    }

    const { full_name, email, registration_id } = attendee;
    const emailSubject = `Your E-Pass for the Event`; // Slightly different subject for find pass
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

    try {
        console.log(`Sending found pass email to ${email} via FormSubmit...`);
        // Fire-and-forget
        fetch(`https://formsubmit.co/${formSubmitEmail}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                _to: email,
                _subject: emailSubject,
                name: full_name,
                message: emailHtml,
                _template: "table",
            })
        })
            .then(response => {
                if (response.ok || response.status === 302) {
                    console.log('FormSubmit email initiated successfully for found pass.');
                } else {
                    response.json().then(data => {
                        console.error('FormSubmit send error (find pass):', data);
                    }).catch(() => {
                        console.error('FormSubmit send failed with status (find pass):', response.status);
                    });
                }
            })
            .catch(err => console.error('FormSubmit fetch error (find pass):', err));

    } catch (error) {
        console.error('Error initiating FormSubmit.co request (find pass):', error.message);
    }
}


// --- Netlify Function Handler ---

exports.handler = async (event) => {
    // 1. Check for database configuration errors
    if (!sql) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Database connection is not configured.' }),
        };
    }

    // 2. Parse incoming data
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body.' }) };
    }

    const { email, phone } = body;

    if (!email && !phone) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Email or phone number is required.' }) };
    }

    try {
        let attendee;

        if (email) {
            // Search by email (case-insensitive)
            const normalizedEmail = email.toLowerCase();
            console.log(`Searching for pass with email: ${normalizedEmail}`);
            [attendee] = await sql`
        SELECT 
          registration_id, full_name, phone_number, email, profile_pic_url 
        FROM attendees 
        WHERE LOWER(email) = ${normalizedEmail}
        LIMIT 1 -- Important: only return one if multiple emails exist
      `;
        } else if (phone) {
            // Search by phone number (already unique)
            console.log(`Searching for pass with phone: ${phone}`);
            [attendee] = await sql`
        SELECT 
          registration_id, full_name, phone_number, email, profile_pic_url 
        FROM attendees 
        WHERE phone_number = ${phone}
      `;
        }

        if (attendee) {
            // Found the attendee
            console.log('Attendee found:', attendee);

            // --- Send Confirmation Email ---
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
            console.log('No attendee found with those details.');
            return {
                statusCode: 404, // 404 Not Found
                body: JSON.stringify({ message: 'No registration found for these details.' }),
            };
        }

    } catch (error) {
        console.error('Database search error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal error occurred.', error: error.message }),
        };
    }
};

