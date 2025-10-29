const postgres = require('postgres');

// Module-scoped client reused across warm lambda invocations to avoid
// repeated connection churn which commonly causes 503/timeout errors.
let sqlClient = null;
function getSqlClient() {
    if (sqlClient) return sqlClient;
    sqlClient = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });
    return sqlClient;
}

// Small in-memory TTL cache for stats to protect the DB from frequent
// repeated admin polling. TTL is short so admin sees near-real-time data.
const statsCache = { ts: 0, data: null, ttl: 15 * 1000 };

// Simple retry wrapper for transient errors.
async function withRetries(fn, attempts = 3, baseDelay = 150) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const code = err && err.code ? err.code : null;
            // Retry on common transient network/connection errors.
            if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
                const jitter = Math.floor(Math.random() * 100);
                const delay = baseDelay * Math.pow(2, i) + jitter;
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            // Non-transient - rethrow immediately
            throw err;
        }
    }
    throw lastErr;
}

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

    try {
        // Serve from short in-memory cache when possible to reduce DB load.
        const now = Date.now();
        if (statsCache.data && (now - statsCache.ts) < statsCache.ttl) {
            return { statusCode: 200, body: JSON.stringify(statsCache.data) };
        }

        const sql = getSqlClient();

        // Fetch from DB with retries for transient errors
        const result = await withRetries(async () => {
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

            return { total_attendees, checked_in_count };
        }, 3, 120);

        // Update cache
        statsCache.ts = Date.now();
        statsCache.data = result;

        return { statusCode: 200, body: JSON.stringify(result) };
    } catch (error) {
        console.error('Error fetching stats:', error && error.message ? error.message : error);
        // Distinguish timeout/connection errors so frontend/admin can show helpful messages
        // If we have a recently cached value, prefer returning it to avoid showing 503 to admins
        if (statsCache.data) {
            console.warn('Returning stale cached stats due to DB error.');
            // mark as stale so clients can choose how to present it
            const stale = Object.assign({}, statsCache.data, { stale: true, note: 'stale_cached_value' });
            return { statusCode: 200, body: JSON.stringify(stale) };
        }

        if (error && error.code && (error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH' || error.code === 'ECONNRESET')) {
            return { statusCode: 503, body: JSON.stringify({ message: 'Database unreachable (timeout). Please try again later.' }) };
        }
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal Server Error' }) };
    }
};
