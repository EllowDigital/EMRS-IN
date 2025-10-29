const postgres = require('postgres');

// Module-scoped client to reuse connections across warm invocations
let sqlClient = null;
function getSqlClient() {
    if (sqlClient) return sqlClient;
    sqlClient = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });
    return sqlClient;
}

// Cache discovered table columns for short TTL to avoid querying information_schema on every call
const tableColsCache = { ts: 0, cols: null, ttl: 60 * 1000 };

async function listAttendeeColumns(sql) {
    const now = Date.now();
    if (tableColsCache.cols && (now - tableColsCache.ts) < tableColsCache.ttl) return tableColsCache.cols;
    const colRows = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'attendees'`;
    const cols = new Set(colRows.map(r => r.column_name));
    tableColsCache.ts = Date.now();
    tableColsCache.cols = cols;
    return cols;
}

// Simple retry wrapper
async function withRetries(fn, attempts = 3, baseDelay = 150) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
        try { return await fn(); } catch (err) {
            lastErr = err;
            const code = err && err.code ? err.code : null;
            if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
                const jitter = Math.floor(Math.random() * 100);
                const delay = baseDelay * Math.pow(2, i) + jitter;
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Require admin Authorization header for attendee searches
    const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const expected = process.env.STAFF_LOGIN_PASSWORD || '';

    // Helper to verify HMAC-signed token (compact base64url header.payload.signature)
    function verifyToken(token) {
        try {
            const tokenSecret = process.env.STAFF_TOKEN_SECRET || '';
            if (!tokenSecret) return false;
            const crypto = require('crypto');
            const parts = token.split('.');
            if (parts.length !== 3) return false;
            const [h64, p64, sig] = parts;
            const signingInput = `${h64}.${p64}`;
            const expectedSig = crypto.createHmac('sha256', tokenSecret).update(signingInput).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
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

    // Determine authorization: accept legacy raw password (in bearer) or a valid token
    let isAuthorized = false;
    if (auth && auth.startsWith('Bearer ')) {
        const value = auth.split(' ')[1];
        if (value) {
            if (value === expected) {
                isAuthorized = true;
            } else if (verifyToken(value)) {
                isAuthorized = true;
            }
        }
    }
    if (!isAuthorized) {
        return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    // Support both 'q' and 'query' (admin sends 'query') and coerce numeric params
    const params = event.queryStringParameters || {};
    const q = params.q || params.query || '';
    const filter = params.filter || params.filterType || 'all';
    const page = parseInt(params.page, 10) || 1;
    const limit = parseInt(params.limit, 10) || 15;
    const offset = (page - 1) * limit;

    try {
        const sql = getSqlClient();

        const cols = await listAttendeeColumns(sql);

        const nameField = cols.has('full_name') ? sql`a.full_name AS full_name` : (cols.has('name') ? sql`a.name AS full_name` : sql`NULL::text AS full_name`);
        const regIdField = cols.has('registration_id') ? sql`a.registration_id AS registration_id` : (cols.has('pass_id') ? sql`a.pass_id AS registration_id` : sql`NULL::text AS registration_id`);
        const phoneField = cols.has('phone_number') ? sql`a.phone_number AS phone_number` : (cols.has('phone') ? sql`a.phone AS phone_number` : sql`NULL::text AS phone_number`);
        const createdAtField = cols.has('created_at') ? sql`to_char(a.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at` : sql`NULL::text as created_at`;

        // Detect if there is a separate check_ins table; cache the check as a quick query
        const checkInsRows = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'check_ins' AND table_schema = 'public'`;
        const hasCheckIns = Array.isArray(checkInsRows) && checkInsRows.length > 0;
        const checkedInField = hasCheckIns ? sql`(EXISTS (SELECT 1 FROM check_ins c WHERE c.attendee_id = a.id)) AS is_checked_in` : (cols.has('checked_in') ? sql`a.checked_in AS is_checked_in` : sql`FALSE AS is_checked_in`);
        const checkedInAtField = cols.has('checked_in_at') ? sql`to_char(a.checked_in_at, 'YYYY-MM-DD HH24:MI:SS') as checked_in_at` : sql`NULL::text as checked_in_at`;

        // Build base queries
        let baseSelect = sql`SELECT a.id, ${nameField}, ${regIdField}, ${phoneField}, a.email, a.profile_pic_url, ${createdAtField}, ${checkedInField}, ${checkedInAtField} FROM attendees a`;
        let baseCount = sql`SELECT COUNT(*) FROM attendees a`;

        const conditions = [];
        if (q && q.length > 0) {
            const searchTerm = `%${q}%`;
            const parts = [];
            if (cols.has('full_name')) parts.push(sql`a.full_name ILIKE ${searchTerm}`);
            if (cols.has('name')) parts.push(sql`a.name ILIKE ${searchTerm}`);
            if (cols.has('email')) parts.push(sql`a.email ILIKE ${searchTerm}`);
            if (cols.has('phone_number')) parts.push(sql`a.phone_number::text ILIKE ${searchTerm}`);
            if (cols.has('phone')) parts.push(sql`a.phone::text ILIKE ${searchTerm}`);
            if (cols.has('registration_id')) parts.push(sql`a.registration_id ILIKE ${searchTerm}`);
            if (cols.has('pass_id')) parts.push(sql`a.pass_id ILIKE ${searchTerm}`);
            if (parts.length > 0) {
                // Join parts safely
                const orClause = parts.reduce((a, b) => sql`${a} OR ${b}`);
                conditions.push(sql`(${orClause})`);
            }
        }

        if (filter === 'checked_in') {
            if (hasCheckIns) conditions.push(sql`EXISTS (SELECT 1 FROM check_ins c WHERE c.attendee_id = a.id)`);
            else if (cols.has('checked_in')) conditions.push(sql`a.checked_in = true`);
        } else if (filter === 'not_checked_in') {
            if (hasCheckIns) conditions.push(sql`NOT EXISTS (SELECT 1 FROM check_ins c WHERE c.attendee_id = a.id)`);
            else if (cols.has('checked_in')) conditions.push(sql`a.checked_in = false`);
        }

        if (conditions.length > 0) {
            let whereClause = conditions[0];
            for (let i = 1; i < conditions.length; i++) whereClause = sql`${whereClause} AND ${conditions[i]}`;
            baseSelect = sql`${baseSelect} WHERE ${whereClause}`;
            baseCount = sql`${baseCount} WHERE ${whereClause}`;
        }

        // Order and pagination
        if (cols.has('created_at')) baseSelect = sql`${baseSelect} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        else baseSelect = sql`${baseSelect} ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`;

        // Execute both with retries in parallel. `baseSelect` and `baseCount` are already
        // prepared query fragments (tagged templates); awaiting them executes the query.
        const [attendees, totalResult] = await Promise.all([
            withRetries(() => baseSelect),
            withRetries(() => baseCount),
        ]);

        const total = parseInt(totalResult[0].count, 10) || 0;

        return {
            statusCode: 200,
            body: JSON.stringify({ attendees, total, page: parseInt(page, 10), limit: parseInt(limit, 10), totalPages: Math.ceil(total / limit) }),
        };
    } catch (error) {
        console.error('Error searching attendees:', error && error.message ? error.message : error);
        if (error && error.code && (error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH' || error.code === 'ECONNRESET')) {
            return { statusCode: 503, body: JSON.stringify({ message: 'Database unreachable' }) };
        }
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal Server Error' }) };
    }
};
