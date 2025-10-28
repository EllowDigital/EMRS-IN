const postgres = require('postgres');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { q, filter, page = 1, limit = 15 } = event.queryStringParameters;
    const offset = (page - 1) * limit;

    let sql;
    try {
        sql = postgres(process.env.NEON_DATABASE_URL, {
            ssl: 'require',
        });

        let query = sql`SELECT id, name, phone, email, pass_id, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at, checked_in, to_char(checked_in_at, 'YYYY-MM-DD HH24:MI:SS') as checked_in_at FROM attendees`;
        let countQuery = sql`SELECT COUNT(*) FROM attendees`;
        
        const conditions = [];
        if (q) {
            const searchTerm = `%${q}%`;
            conditions.push(sql`(name ILIKE ${searchTerm} OR email ILIKE ${searchTerm} OR phone::text ILIKE ${searchTerm} OR pass_id ILIKE ${searchTerm})`);
        }

        if (filter === 'checked_in') {
            conditions.push(sql`checked_in = true`);
        } else if (filter === 'not_checked_in') {
            conditions.push(sql`checked_in = false`);
        }

        if (conditions.length > 0) {
            const whereClause = sql.join(conditions, ' AND ');
            query = sql`${query} WHERE ${whereClause}`;
            countQuery = sql`${countQuery} WHERE ${whereClause}`;
        }

        query = sql`${query} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

        const [attendees, totalResult] = await Promise.all([
            query,
            countQuery,
        ]);
        
        const total = totalResult[0].count;

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
