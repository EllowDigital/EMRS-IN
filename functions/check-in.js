// Final, Optimized Check-In Function (functions/check-in.js)
// ---
// This function:
// 1. Receives a Registration ID.
// 2. Finds the matching attendee's UUID (a.id).
// 3. Inserts a new row into the 'check_ins' table using that UUID.
// 4. Uses an `INSERT ... SELECT` query to do this in one DB call.
// 5. Handles the 'unique_attendee_check_in' constraint violation.
// 6. Adds 'Cache-Control: no-store' header to all responses.
// ---

const postgres = require('postgres');

// --- CONSTANTS ---
const MAX_PAYLOAD_SIZE_BYTES = 1 * 1024; // 1KB (generous for a small JSON request)

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
    console.log("Database connection pool initialized successfully (check-in.js).");
} catch (error) {
    console.error("CRITICAL: Failed to initialize database connection (check-in.js):", error.message);
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
        console.log(`Attempting check-in for: ${registrationId}`);

        // This query finds the attendee's UUID (id) from their registration_id
        // and inserts that UUID into the check_ins table.
        // The 'verified_by' field is good for auditing.
        const result = await sql`
            INSERT INTO check_ins (attendee_id, verified_by)
            SELECT id, 'Staff Scanner'
            FROM attendees
            WHERE registration_id = ${registrationId}
            RETURNING id, check_in_time
        `;

        // 6. Handle Results
        if (result.count > 0) {
            // Success! The INSERT...SELECT found a user and inserted them.
            console.log(`Check-in successful for ${registrationId}. Check-in ID: ${result[0].id}`);
            return {
                statusCode: 200,
                headers: cacheHeaders,
                body: JSON.stringify({
                    message: 'Check-in successful!',
                    data: {
                        checkInId: result[0].id,
                        checkInTime: result[0].check_in_time
                    },
                }),
            };
        } else {
            // The INSERT...SELECT ran, but the SELECT part found 0 attendees.
            // This means the registrationId was invalid.
            console.warn(`Check-in failed: No attendee found with Registration ID: ${registrationId}`);
            return {
                statusCode: 404,
                headers: cacheHeaders,
                body: JSON.stringify({ message: 'Check-in failed: Invalid Registration ID.' }),
            };
        }

    } catch (error) {
        console.error('Database check-in error:', error.message);

        // Handle unique constraint violation (already checked in)
        if (error.code === '23505' && error.constraint_name === 'unique_attendee_check_in') {
            console.warn(`Check-in failed: Attendee ${registrationId} is already checked in.`);
            return {
                statusCode: 409, // Conflict
                headers: cacheHeaders,
                body: JSON.stringify({ message: 'This attendee is already checked in.' }),
            };
        }

        // Handle statement timeout error
        if (error.code === '57014') {
            console.error('Database query timed out (8s).');
            return {
                statusCode: 504, // Gateway Timeout
                headers: cacheHeaders,
                body: JSON.stringify({ message: 'The request timed out. Please try again.' }),
            };
        }

        // Generic error
        return {
            statusCode: 500,
            headers: cacheHeaders,
            body: JSON.stringify({ message: 'An internal server error occurred.' }),
        };
    }
};