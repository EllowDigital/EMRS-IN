// --- Import Dependencies ---
const postgres = require('postgres');

// --- Configure Neon Database ---
// Get the database connection string from Netlify environment variables
const { DATABASE_URL } = process.env;

// Initialize the SQL client
// We add 'ssl: require' to ensure it connects securely to Neon.
const sql = postgres(DATABASE_URL, {
    ssl: 'require',
});

// --- Netlify Function Handler ---
/**
 * This function handles the POST request from your "Find My Pass" form.
 */
exports.handler = async (event) => {

    // 1. Parse the incoming email
    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Bad request: Invalid JSON format.' }),
        };
    }

    const { email } = payload;

    if (!email) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Bad request: Email is required.' }),
        };
    }

    try {
        // 2. --- Query the Neon Database ---
        console.log(`Searching for pass with email: ${email}`);

        // Select all the details needed to rebuild the E-Pass
        const foundAttendees = await sql`
      SELECT 
        registration_id, 
        full_name, 
        phone_number, 
        email, 
        profile_pic_url 
      FROM attendees 
      WHERE 
        email = ${email}
    `;

        // 3. --- Handle "Not Found" ---
        if (foundAttendees.length === 0) {
            console.log('No attendee found with that email.');
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'No registration was found with that email address.' }),
            };
        }

        // 4. --- Send Success Response to Frontend ---
        const attendee = foundAttendees[0];
        console.log('Attendee found:', attendee);

        // The frontend will use this data to rebuild the E-Pass
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Pass found!',
                data: attendee,
            }),
        };

    } catch (error) {
        // --- Handle Generic Errors ---
        console.error('An error occurred in find-pass:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error. Could not find pass.' }),
        };
    }
};
