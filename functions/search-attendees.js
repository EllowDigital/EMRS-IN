const postgres = require('postgres');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
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
        // Fail fast on DB network issues
        sql = postgres(process.env.DATABASE_URL, {
            ssl: 'require',
            connect_timeout: 5,
            max: 2,
        });

        // Detect which columns exist so this function works across schema variants
        const colRows = await sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'attendees' AND column_name IN ('name','full_name','pass_id','registration_id','phone','phone_number','email','profile_pic_url','created_at','checked_in','checked_in_at')
        `;
        const cols = new Set(colRows.map(r => r.column_name));

        const nameField = cols.has('full_name') ? sql`full_name AS full_name` : (cols.has('name') ? sql`name AS full_name` : sql`NULL::text AS full_name`);
        const regIdField = cols.has('registration_id') ? sql`registration_id AS registration_id` : (cols.has('pass_id') ? sql`pass_id AS registration_id` : sql`NULL::text AS registration_id`);
        const phoneField = cols.has('phone_number') ? sql`phone_number AS phone_number` : (cols.has('phone') ? sql`phone AS phone_number` : sql`NULL::text AS phone_number`);
    const checkedInField = cols.has('checked_in') ? sql`checked_in AS is_checked_in` : sql`FALSE AS is_checked_in`;
    const checkedInAtField = cols.has('checked_in_at') ? sql`to_char(checked_in_at, 'YYYY-MM-DD HH24:MI:SS') as checked_in_at` : sql`NULL::text as checked_in_at`;

    let query = sql`SELECT id, ${nameField}, ${regIdField}, ${phoneField}, email, profile_pic_url, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at, ${checkedInField}, ${checkedInAtField} FROM attendees`;
        let countQuery = sql`SELECT COUNT(*) FROM attendees`;
        
        const conditions = [];
        if (q && q.length > 0) {
            const searchTerm = `%${q}%`;
            const parts = [];
            if (cols.has('full_name')) parts.push(sql`full_name ILIKE ${searchTerm}`);
            if (cols.has('name')) parts.push(sql`name ILIKE ${searchTerm}`);
            if (cols.has('email')) parts.push(sql`email ILIKE ${searchTerm}`);
            if (cols.has('phone_number')) parts.push(sql`phone_number::text ILIKE ${searchTerm}`);
            if (cols.has('phone')) parts.push(sql`phone::text ILIKE ${searchTerm}`);
            if (cols.has('registration_id')) parts.push(sql`registration_id ILIKE ${searchTerm}`);
            if (cols.has('pass_id')) parts.push(sql`pass_id ILIKE ${searchTerm}`);
            if (parts.length > 0) {
                conditions.push(sql`(${sql.join ? sql.join(parts, sql` OR `) : parts.reduce((a,b)=> sql`${a} OR ${b}`)})`);
            }
        }

        if (filter === 'checked_in') {
            if (cols.has('checked_in')) conditions.push(sql`checked_in = true`);
        } else if (filter === 'not_checked_in') {
            if (cols.has('checked_in')) conditions.push(sql`checked_in = false`);
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

    query = sql`${query} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

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
        return { statusCode: 500, body: 'Internal Server Error' };
    } finally {
        if (sql) {
            await sql.end();
        }
    }
};
