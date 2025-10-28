const postgres = require('postgres');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Require admin Authorization header for attendee searches
    const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const expected = process.env.STAFF_LOGIN_PASSWORD || '';
    if (!auth.startsWith('Bearer ') || auth.split(' ')[1] !== expected) {
        return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    // Support both 'q' and 'query' (admin sends 'query') and coerce numeric params
    const params = event.queryStringParameters || {};
    const q = params.q || params.query || '';
    const filter = params.filter || params.filterType || 'all';
    const page = parseInt(params.page, 10) || 1;
    const limit = parseInt(params.limit, 10) || 15;
    const offset = (page - 1) * limit;

    let sql;
    try {
        // Use default connection behavior for admin search to avoid overly-aggressive timeouts while an admin session is active
        sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });

        // Detect which columns exist so this function works across schema variants
        const colRows = await sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'attendees'
        `;
        const cols = new Set(colRows.map(r => r.column_name));

        const nameField = cols.has('full_name') ? sql`a.full_name AS full_name` : (cols.has('name') ? sql`a.name AS full_name` : sql`NULL::text AS full_name`);
        const regIdField = cols.has('registration_id') ? sql`a.registration_id AS registration_id` : (cols.has('pass_id') ? sql`a.pass_id AS registration_id` : sql`NULL::text AS registration_id`);
        const phoneField = cols.has('phone_number') ? sql`a.phone_number AS phone_number` : (cols.has('phone') ? sql`a.phone AS phone_number` : sql`NULL::text AS phone_number`);
        const createdAtField = cols.has('created_at') ? sql`to_char(a.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at` : sql`NULL::text as created_at`;

        // Detect if there is a separate check_ins table; if so prefer using it to determine check-in status
        const checkInsTable = await sql`
            SELECT table_name FROM information_schema.tables WHERE table_name = 'check_ins' AND table_schema = 'public'
        `;
        const hasCheckIns = Array.isArray(checkInsTable) && checkInsTable.length > 0;

    const checkedInField = hasCheckIns ? sql`(EXISTS (SELECT 1 FROM check_ins c WHERE c.attendee_id = a.id)) AS is_checked_in` : (cols.has('checked_in') ? sql`a.checked_in AS is_checked_in` : sql`FALSE AS is_checked_in`);
    const checkedInAtField = cols.has('checked_in_at') ? sql`to_char(a.checked_in_at, 'YYYY-MM-DD HH24:MI:SS') as checked_in_at` : sql`NULL::text as checked_in_at`;

    let query = sql`SELECT a.id, ${nameField}, ${regIdField}, ${phoneField}, a.email, a.profile_pic_url, ${createdAtField}, ${checkedInField}, ${checkedInAtField} FROM attendees a`;
    // count query should use same alias so WHERE clauses referencing 'a' work
    let countQuery = sql`SELECT COUNT(*) FROM attendees a`;
        
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
                conditions.push(sql`(${sql.join ? sql.join(parts, sql` OR `) : parts.reduce((a,b)=> sql`${a} OR ${b}`)})`);
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
            // Build WHERE clause by reducing SQL fragments to avoid dependency on sql.join
            let whereClause = conditions[0];
            for (let i = 1; i < conditions.length; i++) {
                whereClause = sql`${whereClause} AND ${conditions[i]}`;
            }
            query = sql`${query} WHERE ${whereClause}`;
            countQuery = sql`${countQuery} WHERE ${whereClause}`;
        }

    // Order by created_at if available, otherwise fall back to id
    if (cols.has('created_at')) {
        query = sql`${query} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    } else {
        query = sql`${query} ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`;
    }

        const [attendees, totalResult] = await Promise.all([
            query,
            countQuery,
        ]);
        
    const total = parseInt(totalResult[0].count, 10) || 0;

        return {
            statusCode: 200,
            body: JSON.stringify({
                attendees,
                total,
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                totalPages: Math.ceil(total / limit),
            }),
        };
    } catch (error) {
        console.error('Error searching attendees:', error);
        if (error && error.code && (error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH')) {
            return { statusCode: 503, body: JSON.stringify({ message: 'Database unreachable' }) };
        }
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal Server Error' }) };
    } finally {
        if (sql) {
            await sql.end();
        }
    }
};
