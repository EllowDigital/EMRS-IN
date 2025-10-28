const postgres = require('postgres');

exports.handler = async (event, context) => {
    // Require admin Authorization header (accept either raw staff password or a short-lived token)
    const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const expected = process.env.STAFF_LOGIN_PASSWORD || '';
    const tokenSecret = process.env.STAFF_TOKEN_SECRET || '';

    function verifyToken(token) {
        try {
            if (!tokenSecret) return false;
            const crypto = require('crypto');
            const parts = token.split('.');
            if (parts.length !== 3) return false;
            const [h64, p64, sig] = parts;
            const signingInput = `${h64}.${p64}`;
            const expectedSig = crypto.createHmac('sha256', tokenSecret).update(signingInput).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            // Use timingSafeEqual
            const a = Buffer.from(expectedSig);
            const b = Buffer.from(sig);
            if (a.length !== b.length) return false;
            if (!crypto.timingSafeEqual(a, b)) return false;
            const payload = JSON.parse(Buffer.from(p64, 'base64').toString('utf8'));
            const now = Math.floor(Date.now() / 1000);
            if (!payload.exp || payload.exp < now) return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    const isAuthorized = (auth && auth.startsWith('Bearer ') && (() => {
        const value = auth.split(' ')[1];
        if (!value) return false;
        if (value === expected) return true; // legacy: staff password as bearer
        if (verifyToken(value)) return true;
        return false;
    })());

    if (!isAuthorized) {
        return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    let sql;
    try {
    // For admin stats prefer the default connection behavior (avoid overly aggressive timeouts while an admin session is active)
    sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });

        // Run total first
        const totalResult = await sql`SELECT COUNT(*) FROM attendees`;
        const total_attendees = parseInt(totalResult[0].count, 10);

        // Determine checked-in count:
        // Prefer counting distinct attendee_id from check_ins table if present.
        let checked_in_count = 0;
        try {
            const checkInsTable = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'check_ins' AND table_schema = 'public'`;
            const hasCheckIns = Array.isArray(checkInsTable) && checkInsTable.length > 0;
            if (hasCheckIns) {
                const checkedRes = await sql`SELECT COUNT(DISTINCT attendee_id) FROM check_ins`;
                checked_in_count = parseInt(checkedRes[0].count, 10);
            } else {
                // Fallback to attendees.checked_in column if available
                try {
                    const checkedRes = await sql`SELECT COUNT(*) FROM attendees WHERE checked_in = TRUE`;
                    checked_in_count = parseInt(checkedRes[0].count, 10);
                } catch (innerErr) {
                    console.warn('Checked-in column missing; returning 0 for checked-in count.', innerErr && innerErr.message ? innerErr.message : innerErr);
                    checked_in_count = 0;
                }
            }
        } catch (err) {
            console.warn('Failed to determine check-in counts, falling back to 0.', err && err.message ? err.message : err);
            checked_in_count = 0;
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({ total_attendees, checked_in_count }),
        };
    } catch (error) {
        console.error('Error fetching stats:', error);
        // Distinguish timeout/connection errors so frontend/admin can show helpful messages
        if (error && error.code && (error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH')) {
            return { statusCode: 503, body: JSON.stringify({ message: 'Database unreachable (timeout). Please try again later.' }) };
        }
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal Server Error' }) };
    } finally {
        if (sql) {
            await sql.end();
        }
    }
};
