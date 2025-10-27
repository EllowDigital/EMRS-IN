// --- Import Dependencies ---
const postgres = require('postgres');
const { v2: cloudinary } = require('cloudinary');

// --- Configure Cloudinary ---
// Netlify will automatically load the CLOUDINARY_URL environment variable
// that you set in the Netlify UI.
cloudinary.config(true);

// --- Configure Neon Database ---
// Get the database connection string from Netlify environment variables
const { DATABASE_URL } = process.env;

// Initialize the SQL client
// We add 'ssl: require' to ensure it connects securely to Neon.
const sql = postgres(DATABASE_URL, {
    ssl: 'require',
});

// --- Helper Function ---
/**
 * Generates a unique, random registration ID in the format UP25-XXXXXXXX
 * (where X is an alphanumeric character).
 */
function generateRegistrationId() {
    const prefix = 'UP25-';
    const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `${prefix}${randomPart}`;
}

// --- Netlify Function Handler ---
/**
 * This is the main serverless function.
 * It handles the POST request from your registration form.
 */
exports.handler = async (event) => {

    // 1. Parse the incoming data
    // The frontend sends JSON data, which Netlify provides in 'event.body'
    let formData;
    try {
        formData = JSON.parse(event.body);
    } catch (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Bad request: Invalid JSON format.' }),
        };
    }

    const { name, phone, email, city, state, imageBase64 } = formData;

    // Basic validation
    if (!name || !phone || !email || !city || !state) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Bad request: Missing required fields.' }),
        };
    }

    let profilePicUrl = null;

    try {
        // 2. --- Upload Image to Cloudinary (if one was provided) ---
        if (imageBase64) {
            console.log('Uploading image to Cloudinary...');
            const uploadResponse = await cloudinary.uploader.upload(imageBase64, {
                folder: 'event-attendees', // Puts all images in a specific folder
                resource_type: 'image',
            });
            profilePicUrl = uploadResponse.secure_url;
            console.log('Image upload successful:', profilePicUrl);
        }

        // 3. --- Generate Unique Registration ID ---
        const registrationId = generateRegistrationId();

        // 4. --- Insert Attendee into Neon Database ---
        console.log('Inserting attendee into database...');

        // We use sql`...` to safely insert data. This prevents SQL injection.
        const newAttendee = await sql`
      INSERT INTO attendees (
        registration_id, full_name, phone_number, email, city, state_province, profile_pic_url
      )
      VALUES (
        ${registrationId}, ${name}, ${phone}, ${email}, ${city}, ${state}, ${profilePicUrl}
      )
      RETURNING registration_id, full_name, email, phone_number, profile_pic_url
    `;

        console.log('Database insert successful:', newAttendee[0]);

        // 5. --- Send Success Response to Frontend ---
        // The frontend will use this data to build the E-Pass
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Registration successful!',
                data: newAttendee[0],
            }),
        };

    } catch (error) {
        // --- Handle Errors ---
        console.error('An error occurred:', error.message);

        // This is an advanced check. If the error code is '23505',
        // it means a 'unique_constraint' failed (e.g., duplicate email or phone).
        if (error.code === '23505') {
            let field = 'email or phone number';
            if (error.constraint_name === 'unique_email') field = 'email';
            if (error.constraint_name === 'unique_phone') field = 'phone number';

            return {
                statusCode: 409, // 409 Conflict
                body: JSON.stringify({ message: `This ${field} is already registered.` }),
            };
        }

        // Handle Cloudinary or other generic errors
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error. Could not process registration.' }),
        };
    }
};
