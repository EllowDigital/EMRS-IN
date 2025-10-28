// Final, Optimized Verification Function (functions/verify.js)
// ---
// This function:
// 1. Receives a Registration ID.
// 2. Looks up the attendee in the 'attendees' table.
// 3. Simultaneously checks if a matching record exists in the 'check_ins' table.
// 4. Returns the attendee's data AND their check-in status (isCheckedIn: true/false).
// 5. Uses a single, efficient JOIN query.
// 6. Adds 'Cache-Control: no-store' header to all responses.
// ---

const postgres = require('postgres');

// --- CONSTANTS ---
const MAX_PAYLOAD_SIZE_BYTES = 1 * 1024; // 1KB (generous for { "registrationId": "..." })

// --- OPTIMIZATION: Connection Re-use ---
let sql;
try {
    sql = postgres(process.env.DATABASE_URL, {
        ssl: 'require',
        connect_timeout: 5,
        idle_timeout: 20,
        max: 5,
        set_local: { statement_timeout: '8s' } // 8-second query timeout
    });
    console.log("Database connection pool initialized successfully (verify.js).");
} catch (error) {
    console.error("CRITICAL: Failed to initialize database connection (verify.js):", error.message);
    sql = null;
}

// --- Netlify Function Handler ---

exports.handler = async (event) => {
    // --- Define Cache Header ---
    const cacheHeaders = {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    };

    // 1. Check for critical DB configuration
    if (!sql) {
        console.error("Handler Error: Database connection is not available.");
        return {
            statusCode: 500,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'Database service unavailable.' })
        };
    }

    // 2. Check HTTP Method
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'Method Not Allowed' })
        };
    }

    // 3. Payload Size Check
    const contentLength = event.headers['content-length'];
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE_BYTES) {
        console.warn(`Handler Warn: Payload size (${contentLength} bytes) exceeds limit.`);
        return {
            statusCode: 413,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'Payload is too large.' })
        };
    }

    // 4. Parse and Validate Body
    let registrationId;
    try {
        const body = JSON.parse(event.body);
        registrationId = body.registrationId ? body.registrationId.trim().toUpperCase() : "";

        if (!registrationId) {
            console.warn("Handler Warn: Missing registrationId in request body.");
            return {
                statusCode: 400,
                headers: cacheHeaders,
                body: JSON.stringify({ message: 'Registration ID is required.' })
            };
        }

    } catch (error) {
        console.warn("Handler Warn: Could not parse request body.", error.message);
        return {
            statusCode: 400,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'Invalid request format.' })
        };
    }

    // 5. Execute Database Query
    try {
        console.log(`Verifying pass with Registration ID: ${registrationId}`);

        // This single query joins attendees with check_ins to get all data at once.
        // a.id = attendee's UUID
        // c.id = check_in_id (will be NULL if not checked in)
        const [result] = await sql`
            SELECT 
                a.registration_id, 
                a.full_name, 
                a.phone_number, 
                a.email, 
                a.profile_pic_url,
                c.id as check_in_id
            FROM attendees a
            LEFT JOIN check_ins c ON a.id = c.attendee_id
            WHERE a.registration_id = ${registrationId}
            LIMIT 1
        `;

        // 6. Handle Results
        if (result) {
            // Found the attendee
            console.log(`Attendee found: ${result.registration_id}`);

            // Separate the attendee data from the check_in status
            const isCheckedIn = !!result.check_in_id; // Convert null/UUID to true/false
            const { check_in_id, ...attendeeData } = result;

            console.log(`Check-in status for ${result.registration_id}: ${isCheckedIn}`);

            return {
                statusCode: 200,
                headers: cacheHeaders,
                body: JSON.stringify({
                    message: 'Attendee verified.',
                    data: {
                        attendee: attendeeData,
                        isCheckedIn: isCheckedIn
                    },
                }),
            };
        } else {
            // Did not find the attendee
            console.log(`No attendee found with Registration ID: ${registrationId}`);
            return {
                statusCode: 404,
                headers: cacheHeaders,
                body: JSON.stringify({ message: 'No registration found for this ID.' }),
            };
        }

    } catch (error) {
        console.error('Database verification error:', error.message);

        // Handle statement timeout error from database
        if (error.code === '57014') { // PostgreSQL query_canceled code
            console.error('Database query timed out (8s).');
            return {
                statusCode: 504, // Gateway Timeout
                headers: cacheHeaders,
                body: JSON.stringify({ message: 'The request timed out. Please try again.' }),
            };
        }

        // Generic internal server error
        return {
            statusCode: 500,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'An internal server error occurred.' }),
        };
    }
};