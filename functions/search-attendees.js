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

        /*
         * Return fields shaped for the admin UI (aliases):
         * - full_name (was name)
         * - registration_id (was pass_id)
         * - phone_number (was phone)
         * - is_checked_in (was checked_in)
         */
        let query = sql`SELECT id,
            name AS full_name,
            pass_id AS registration_id,
            phone AS phone_number,
            email,
            profile_pic_url,
            to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
            checked_in AS is_checked_in,
            to_char(checked_in_at, 'YYYY-MM-DD HH24:MI:SS') as checked_in_at
            FROM attendees`;
        let countQuery = sql`SELECT COUNT(*) FROM attendees`;
        
        const conditions = [];
        if (q && q.length > 0) {
            const searchTerm = `%${q}%`;
            conditions.push(sql`(name ILIKE ${searchTerm} OR email ILIKE ${searchTerm} OR phone::text ILIKE ${searchTerm} OR pass_id ILIKE ${searchTerm})`);
        }

        if (filter === 'checked_in') {
            conditions.push(sql`checked_in = true`);
        } else if (filter === 'not_checked_in') {
            conditions.push(sql`checked_in = false`);
        }

        if (conditions.length > 0) {
            // Use the postgres client's sql.join helper correctly by passing a SQL fragment
            const whereClause = sql.join(conditions, sql` AND `);
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
