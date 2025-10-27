// Final, Optimized Registration Function (functions/register.js)
// ---
// This version is updated so that:
// 1. Only the Phone Number is checked for uniqueness.
// 2. Email is no longer a unique field.
// 3. Database connection re-use is implemented for speed.
// 4. A confirmation email is sent via FormSubmit.co on success.
// ---

const postgres = require('postgres');
const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');

// --- OPTIMIZATION 1: Connection Re-use ---
// Define the 'sql' object outside the handler to be re-used
// across "warm" function invocations.
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

// Configure Cloudinary using your three separate environment variables
// This is more secure and avoids the CLOUDINARY_URL error.
try {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
    });
} catch (error) {
    console.error("Failed to configure Cloudinary:", error.message);
}

/**
 * Sends a confirmation email using FormSubmit.co.
 * This is a "fire-and-forget" function; we don't block the user's
 * response even if the email fails to send.
 * @param {object} attendee - The attendee data object
 * @param {string} formSubmitEmail - Your FormSubmit.co email address
 */
async function sendConfirmationEmail(attendee, formSubmitEmail) {
    if (!formSubmitEmail) {
        console.warn('FORMSUBMIT_EMAIL environment variable is not set. Skipping email confirmation.');
        return;
    }

    const { full_name, email, registration_id } = attendee;
    const emailSubject = `Registration Confirmed: Your E-Pass for the Event!`;
    const emailHtml = `
        <html>
        <head>
            <style> body { font-family: Arial, sans-serif; line-height: 1.6; } h1 { color: #333; } p { margin-bottom: 20px; } .pass-details { padding: 15px; background-color: #f4f4f4; border-radius: 5px; } .reg-id { font-size: 20px; font-weight: bold; color: #8D6E63; } </style>
        </head>
        <body>
            <h1>Hi ${full_name},</h1>
            <p>Thank you for registering — <strong>you are most welcome!</strong></p>
            <p>Your registration is confirmed. Please keep this email safe. Your E-Pass details are below:</p>
            <div class="pass-details">
                <strong>Name:</strong> ${full_name}<br>
                <strong>Email:</strong> ${email}<br>
                <strong>Registration ID:</strong> <span class="reg-id">${registration_id}</span>
            </div>
            <p style="margin-top: 20px;">We look forward to seeing you at the event!</p>
        </body>
        </html>
    `;

    try {
        console.log(`Sending confirmation email to ${email} via FormSubmit...`);
        // We do not await this, it runs in the background.
        fetch(`https://formsubmit.co/${formSubmitEmail}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                _to: email, // The attendee's email
                _subject: emailSubject,
                name: full_name, // FormSubmit requires a 'name' field
                message: emailHtml, // Put the HTML content in 'message'
                _template: "table", // Use a clean template from FormSubmit
            })
        })
            .then(response => {
                // Check if the response was successful (FormSubmit usually redirects)
                if (response.ok || response.status === 302) { // 302 is the redirect status
                    console.log('FormSubmit email initiated successfully.');
                } else {
                    // If not ok, try to read the error message
                    response.json().then(data => {
                        console.error('FormSubmit send error:', data);
                    }).catch(() => {
                        // If reading JSON fails, log the status
                        console.error('FormSubmit send failed with status:', response.status);
                    });
                }
            })
            .catch(err => console.error('FormSubmit fetch error:', err)); // Catch network errors

    } catch (error) {
        // Log the error but don't fail the registration
        console.error('Error initiating FormSubmit.co request:', error.message);
    }
}


// --- Netlify Function Handler ---

exports.handler = async (event) => {
    // 1. Check for database or Cloudinary configuration errors
    if (!sql) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Database connection is not configured.' }),
        };
    }
    if (!cloudinary.config().api_key) {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Cloudinary is not configured.' }),
        };
    }

    // 2. Parse incoming data
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Invalid request body.' }) };
    }

    const { name, phone, email, city, state, imageBase64 } = body;

    if (!name || !phone || !email || !city || !state) {
        return { statusCode: 400, body: JSON.stringify({ message: 'Missing required fields.' }) };
    }

    // Normalize email to lowercase
    const normalizedEmail = email.toLowerCase();

    try {
        // --- UPDATED Duplicate Check ---
        // Only check for duplicate phone number.
        console.log(`Checking for duplicate phone: ${phone}`);
        const existingPhone = await sql`
      SELECT 1 FROM attendees WHERE phone_number = ${phone}
    `;

        if (existingPhone.count > 0) {
            console.log('Duplicate phone found. Aborting registration.');
            return {
                statusCode: 409, // 409 Conflict
                body: JSON.stringify({ message: 'This phone number is already registered.' }),
            };
        }

        // 3. Upload image
        let imageUrl = null;
        if (imageBase64) {
            console.log('Image provided. Uploading to Cloudinary...');
            try {
                const uploadResult = await cloudinary.uploader.upload(imageBase64, {
                    folder: 'event-attendees',
                    resource_type: 'image',
                    // Add transformations for consistency if desired
                    // transformation: [{ width: 300, height: 300, crop: "limit" }]
                });
                imageUrl = uploadResult.secure_url;
                console.log(`Upload successful. Image URL: ${imageUrl}`);
            } catch (uploadError) {
                console.error('Cloudinary upload error:', uploadError.message);
                return { statusCode: 500, body: JSON.stringify({ message: 'Failed to upload image.', error: uploadError.message }) };
            }
        } else {
            console.log('No image provided. Skipping Cloudinary upload.');
        }

        // 4. Generate Registration ID
        const regId = `UP25-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        // 5. Insert into Database
        console.log('Inserting attendee into database...');
        const [attendee] = await sql`
      INSERT INTO attendees (
        registration_id, full_name, phone_number, email, city, state_province, profile_pic_url
      ) VALUES (
        ${regId}, ${name}, ${phone}, ${normalizedEmail}, ${city}, ${state}, ${imageUrl}
      )
      RETURNING registration_id, full_name, phone_number, email, profile_pic_url
    `;

        console.log('Attendee created successfully:', attendee);

        // --- 6. Send Confirmation Email ---
        // We do this *after* success, but we don't wait for it.
        sendConfirmationEmail(attendee, process.env.FORMSUBMIT_EMAIL);

        // --- 7. Send Success Response ---
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Registration successful!',
                data: attendee,
            }),
        };

    } catch (error) {
        console.error('Database or logic error:', error.message);
        if (error.code === '23505') { // PostgreSQL unique violation for phone_number
            return {
                statusCode: 409,
                body: JSON.stringify({ message: 'This phone number is already registered.' }),
            };
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'An internal error occurred.', error: error.message }),
        };
    }
};

