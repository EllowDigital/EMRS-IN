// --- Import Dependencies ---
const postgres = require('postgres');
const cloudinary = require('cloudinary').v2;

// --- Configure Neon Database ---
// Get the database connection string from Netlify environment variables
const { DATABASE_URL } = process.env;

// Initialize the SQL client
// We add 'ssl: require' to ensure it connects securely to Neon.
const sql = postgres(DATABASE_URL, {
    ssl: 'require',
});

// --- Configure Cloudinary ---
// This is the **CORRECT** way to configure Cloudinary in Netlify.
// We are INTENTIONALLY using these three separate environment variables
// to AVOID the "CLOUDINARY_URL" error you were seeing.
//
// **MAKE SURE YOU HAVE THESE 3 VARIABLES IN NETLIFY:**
// 1. CLOUDINARY_CLOUD_NAME
// 2. CLOUDINARY_API_KEY
// 3. CLOUDINARY_API_SECRET
//
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true, // Use HTTPS
});

// --- Netlify Function Handler ---
exports.handler = async (event) => {

    // 1. Parse the incoming form data
    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Bad request: Invalid JSON format.' }),
        };
    }

    const { name, phone, email, city, state, imageBase64 } = payload;

    // 2. Check for missing required fields
    if (!name || !phone || !email || !city || !state) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Bad request: All fields are required.' }),
        };
    }

    let imageUrl = null;
    let uploadError = null;

    // 3. --- Upload Image to Cloudinary (if one was provided) ---
    if (imageBase64) {
        try {
            console.log('Image provided. Uploading to Cloudinary...');
            // Upload the compressed base64 image data
            const uploadResult = await cloudinary.uploader.upload(imageBase64, {
                folder: 'event-attendees', // Puts all uploads in this folder
                resource_type: 'image',
            });
            imageUrl = uploadResult.secure_url;
            console.log('Upload successful. Image URL:', imageUrl);
        } catch (error) {
            // Don't fail the whole registration, just log the image error
            console.error('Cloudinary upload failed:', error.message);
            uploadError = 'Image upload failed. Please try again later.';
            // Note: We continue without an image, as the profile pic is optional.
        }
    }

    // 4. --- Generate Unique Registration ID ---
    // Format: UP25-XXXXXXXX
    const regId = `UP25-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    let newAttendee;
    try {
        // 5. --- Insert Attendee into Neon Database ---
        console.log('Inserting attendee into database...');

        const result = await sql`
      INSERT INTO attendees 
        (registration_id, full_name, phone_number, email, city, state_province, profile_pic_url)
      VALUES
        (${regId}, ${name}, ${phone}, ${email}, ${city}, ${state}, ${imageUrl})
      RETURNING 
        registration_id, full_name, phone_number, email
    `;

        newAttendee = result[0];
        console.log('Attendee created successfully:', newAttendee);

    } catch (error) {
        // 6. --- NEW: Advanced Error Handling ---
        console.error('Database insertion error:', error.message);

        // PostgreSQL error code '23505' means "unique_violation"
        if (error.code === '23505') {
            let friendlyMessage = 'This user is already registered.';

            // Check which constraint was violated
            if (error.constraint_name === 'unique_email') {
                friendlyMessage = 'This email address is already registered.';
            } else if (error.constraint_name === 'unique_phone') {
                friendlyMessage = 'This phone number is already registered.';
            }

            return {
                statusCode: 409, // 409 Conflict
                body: JSON.stringify({ message: friendlyMessage }),
            };
        }

        // Handle other database errors
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error: Could not save registration.' }),
        };
    }

    // 7. --- Send Success Response to Frontend ---
    return {
        statusCode: 201, // 201 Created
        body: JSON.stringify({
            message: 'Registration successful!',
            data: newAttendee,
            uploadError: uploadError, // Send back image error if one occurred
        }),
    };
};

