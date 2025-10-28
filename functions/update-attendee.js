const postgres = require('postgres');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // Simple server-side auth: verify Authorization Bearer <password>
    const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const expected = process.env.STAFF_LOGIN_PASSWORD || '';
    if (!auth.startsWith('Bearer ') || auth.split(' ')[1] !== expected) {
        return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    let sql;
    try {
        const body = JSON.parse(event.body || '{}');
        const { registration_id } = body;
    if (!registration_id) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'registration_id required' }) };

    // For admin update operations prefer default connect behavior to avoid aggressive timeouts while an admin session is active
    sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });

        // detect column names we can update (include reg id variants)
        const colRows = await sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'attendees'
        `;
        const cols = new Set(colRows.map(r => r.column_name));

        const updates = [];
        const values = [];
        if (body.full_name && cols.has('full_name')) { updates.push(sql`full_name = ${body.full_name}`); }
        if (body.full_name && cols.has('name') && !cols.has('full_name')) { updates.push(sql`name = ${body.full_name}`); }
        if (body.email && cols.has('email')) updates.push(sql`email = ${body.email}`);
        if (body.phone_number && cols.has('phone_number')) updates.push(sql`phone_number = ${body.phone_number}`);
        if (body.phone_number && cols.has('phone') && !cols.has('phone_number')) updates.push(sql`phone = ${body.phone_number}`);

        if (updates.length === 0) {
            return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'No updatable fields found or provided' }) };
        }

        // Determine reg id column
        // Try to find the best fit registration id column (support many variants)
        let regCol = null;
        if (cols.has('registration_id')) regCol = 'registration_id';
        else if (cols.has('pass_id')) regCol = 'pass_id';
        else {
            // Try to find a candidate column name that contains 'pass' or 'reg'
            for (const c of cols) {
                const lc = c.toLowerCase();
                if (lc.includes('pass') || lc.includes('reg')) { regCol = c; break; }
            }
        }
    if (!regCol) return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'No registration id column available in DB' }) };

        // Build update SET fragment
        const setFragment = sql.join ? sql.join(updates, sql`, `) : updates.reduce((a, b) => sql`${a}, ${b}`);

        // Parameterize identifier on the correct column name
        let result;
        if (regCol === 'registration_id') {
            result = await sql`
                UPDATE attendees SET ${setFragment}
                WHERE registration_id = ${registration_id}
                RETURNING *
            `;
        } else if (regCol === 'pass_id') {
            result = await sql`
                UPDATE attendees SET ${setFragment}
                WHERE pass_id = ${registration_id}
                RETURNING *
            `;
        } else {
            // We only support the well-known identifier columns here; if an unusual column exists, return an error.
            return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Unsupported registration id column: ' + regCol }) };
        }
        if (!result || result.length === 0) return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Attendee not found' }) };

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, attendee: result[0] }),
        };
    } catch (error) {
        console.error('update-attendee error:', error);
        // If DB network-level error, respond 503
        if (error && (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH')) {
            return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Database unreachable' }) };
        }
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Internal Server Error' }) };
    } finally {
        if (sql) await sql.end();
    }
};
