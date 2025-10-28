const postgres = require('postgres');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { registration_id, password } = body;
        if (!registration_id || !password) return { statusCode: 400, body: 'registration_id and password required' };

    const expected = process.env.STAFF_LOGIN_PASSWORD || '';
    // Accept either a password in body (confirmation) or Authorization: Bearer <password>
    const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (password !== expected && bearer !== expected) return { statusCode: 403, body: 'Invalid admin password' };

    // Use default connect behavior for admin-initiated delete operations to avoid aggressive timeouts
    const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });

        // detect available registration id column
        const colRows = await sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'attendees'
        `;
        const cols = new Set(colRows.map(r => r.column_name));

        let regCol = null;
        if (cols.has('registration_id')) regCol = 'registration_id';
        else if (cols.has('pass_id')) regCol = 'pass_id';
        else {
            for (const c of cols) {
                const lc = c.toLowerCase();
                if (lc.includes('pass') || lc.includes('reg')) { regCol = c; break; }
            }
        }
        if (!regCol) return { statusCode: 500, body: 'No registration id column found' };

        let del;
        if (regCol === 'registration_id') {
            del = await sql`DELETE FROM attendees WHERE registration_id = ${registration_id} RETURNING 1`;
        } else if (regCol === 'pass_id') {
            del = await sql`DELETE FROM attendees WHERE pass_id = ${registration_id} RETURNING 1`;
        } else {
            // Only support the common identifier columns for safety
            return { statusCode: 500, body: 'Unsupported registration id column: ' + regCol };
        }
        if (!del || del.length === 0) {
            return { statusCode: 404, body: 'Attendee not found' };
        }

        return { statusCode: 200, body: JSON.stringify({ success: true }) };
    } catch (error) {
        console.error('delete-attendee error:', error);
        if (error && (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH')) {
            return { statusCode: 503, body: 'Database unreachable' };
        }
        return { statusCode: 500, body: 'Internal Server Error' };
    }
};
