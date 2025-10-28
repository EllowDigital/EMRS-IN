// Final, Optimized Registration Function (functions/register.js)
// ---
// This version includes:
// 1. Duplicate phone check *before* Cloudinary upload.
// 2. Only Phone Number is checked for uniqueness.
// 3. Email is no longer a unique field.
// 4. Database connection re-use for speed.
// 5. Confirmation email sent via FormSubmit.co on success.
// ---

const postgres = require('postgres');
const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');

// --- OPTIMIZATION: Connection Re-use ---
let sql;
try {
    // Attempt to establish the database connection pool
    sql = postgres(process.env.DATABASE_URL, {
        ssl: 'require',        // Enforce SSL connection (required by Neon)
        connect_timeout: 5,    // Set a connection timeout (5 seconds)
        idle_timeout: 10,      // Close idle connections after 10 seconds to save resources
        max: 5                 // Limit the number of concurrent connections
    });
    console.log("Database connection pool initialized successfully.");
} catch (error) {
    // Log the error if connection fails during initialization
    console.error("CRITICAL: Failed to initialize database connection:", error.message);
    // Setting sql to null allows the handler to return a specific error
    sql = null;
}

// Configure Cloudinary using separate environment variables
try {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        throw new Error("Missing Cloudinary configuration environment variables.");
    }
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true, // Use HTTPS URLs
    });
    console.log("Cloudinary configuration successful.");
} catch (error) {
    console.error("CRITICAL: Failed to configure Cloudinary:", error.message);
    // We'll check cloudinary.config().api_key in the handler to return an error
}

/**
 * Sends a confirmation email using FormSubmit.co (fire-and-forget).
 * @param {object} attendee - Attendee data { full_name, email, registration_id }
 * @param {string} formSubmitEmail - Your FormSubmit.co email address
 */
async function sendConfirmationEmail(attendee, formSubmitEmail) {
    // Check if the target email variable is set
    if (!formSubmitEmail) {
        console.warn('FORMSUBMIT_EMAIL environment variable not set. Skipping email confirmation.');
        return; // Exit if email isn't configured
    }
    // Validate attendee data needed for email
    if (!attendee || !attendee.full_name || !attendee.email || !attendee.registration_id) {
        console.error('sendConfirmationEmail: Invalid attendee data provided. Cannot send email.');
        return;
    }

    const { full_name, email, registration_id } = attendee;
    const emailSubject = `Registration Confirmed: Your E-Pass for the Event!`;
    // Simple HTML structure for the email body
    const emailHtml = `
        <html><head><style> body { font-family: sans-serif; line-height: 1.6; } .details { padding: 10px; background-color: #f0f0f0; border-radius: 4px; } .reg-id { font-weight: bold; color: #8B4513; } </style></head>
        <body> <h2>Hi ${full_name},</h2>
        <p>Thank you for registering! Your E-Pass details:</p>
        <div class="details"> Name: ${full_name}<br> Email: ${email}<br> Registration ID: <span class="reg-id">${registration_id}</span> </div>
        <p>We look forward to seeing you!</p> </body></html>`;

    try {
        console.log(`Sending confirmation email to ${email} via FormSubmit...`);
        // Use fetch API (available in Node.js 18+) to send request to FormSubmit
        fetch(`https://formsubmit.co/${formSubmitEmail}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                _to: email,             // Recipient email address
                _subject: emailSubject, // Email subject line
                name: full_name,        // Sender name (required by FormSubmit)
                message: emailHtml,     // HTML content of the email
                _template: "table"      // Use FormSubmit's basic table template
            })
        })
            .then(response => {
                // Check if the submission was accepted (FormSubmit redirects on success)
                if (response.ok || response.status === 302) {
                    console.log('FormSubmit email initiated successfully.');
                } else {
                    // Try to parse error details if available
                    response.text().then(text => { // Use text() as JSON might fail
                        console.error(`FormSubmit send failed with status ${response.status}: ${text}`);
                    }).catch(() => {
                        console.error(`FormSubmit send failed with status ${response.status}. Could not read response body.`);
                    });
                }
            })
            .catch(err => console.error('FormSubmit fetch network error:', err.message)); // Catch network/fetch errors

    } catch (error) {
        // Log errors during the fetch setup phase
        console.error('Error initiating FormSubmit.co request:', error.message);
    }
}


// --- Netlify Function Handler ---
exports.handler = async (event) => {
    // Immediately check for critical configuration issues
    if (!sql) {
        console.error("Handler Error: Database connection is not available.");
        return { statusCode: 500, body: JSON.stringify({ message: 'Database service unavailable.' }) };
    }
    if (!cloudinary.config()?.api_key) { // Check if config object or api_key is missing
        console.error("Handler Error: Cloudinary configuration is incomplete or missing.");
        return { statusCode: 500, body: JSON.stringify({ message: 'Image service unavailable.' }) };
    }

    // Ensure the request method is POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // Parse incoming JSON body
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (error) {
        console.warn("Handler Warn: Could not parse request body.", error.message);
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request format.' }) };
    }

    // Validate required fields from the parsed body
    const { name, phone, email, city, state, imageBase64 } = body;
    if (!name || !phone || !email || !city || !state) {
        console.warn("Handler Warn: Missing required fields in request body.");
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing required registration details.' }) };
    }

    // Normalize email for consistent storage and lookup
    const normalizedEmail = email.toLowerCase();

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
                // Upload the base64 string directly to Cloudinary
                const uploadResult = await cloudinary.uploader.upload(imageBase64, {
                    folder: 'event-attendees', // Organize uploads into a folder
                    resource_type: 'image',    // Specify the type of resource
                    // Example transformation: Limit size, auto format/quality
                    // transformation: [{ width: 500, height: 500, crop: "limit" }, { fetch_format: "auto", quality: "auto" }]
                });
                imageUrl = uploadResult.secure_url; // Get the HTTPS URL
                console.log(`Cloudinary upload successful. Image URL: ${imageUrl}`);
            } catch (uploadError) {
                console.error('Cloudinary upload error:', uploadError.message);
                // Return a server error if upload fails
                return { statusCode: 500, body: JSON.stringify({ message: 'Failed to process profile picture.' }) };
            }
        } else {
            console.log('No valid image data provided. Skipping Cloudinary upload.');
        }

        // --- Generate Unique Registration ID ---
        const regId = `UP25-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        console.log(`Generated Registration ID: ${regId}`);

        // --- Insert Attendee into Database ---
        console.log(`Inserting attendee (${name}, ${phone}) into database...`);
        // Use sql template literal for safe parameterization
        const [attendee] = await sql`
            INSERT INTO attendees (
                registration_id, full_name, phone_number, email, city, state_province, profile_pic_url
            ) VALUES (
                ${regId}, ${name}, ${phone}, ${normalizedEmail}, ${city}, ${state}, ${imageUrl}
            )
            RETURNING registration_id, full_name, phone_number, email, profile_pic_url -- Return necessary fields
        `;
        console.log('Attendee database insertion successful:', { registration_id: attendee.registration_id, phone: attendee.phone_number });

        // --- Send Confirmation Email (Fire-and-forget) ---
        // Call this after successful insertion
        sendConfirmationEmail(attendee, process.env.FORMSUBMIT_EMAIL);

        // --- Send Success Response to Frontend ---
        return {
            statusCode: 200, // OK
            body: JSON.stringify({
                message: 'Registration successful!',
                data: attendee, // Send back the created attendee data
            }),
        };

    } catch (error) {
        console.error('Handler Error:', error.message);
        // Specifically handle potential database unique constraint errors (though the pre-check should prevent this)
        if (error.code === '23505') { // PostgreSQL unique violation code
            console.warn(`Database race condition? Duplicate phone ${phone} detected during INSERT.`);
            return {
                statusCode: 409, // Conflict
                body: JSON.stringify({ message: 'This phone number was registered just now by someone else. Please try again or check your details.' }),
            };
        }
        // Generic internal server error for other issues
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal server error occurred during registration.' }),
        };
    }
};

