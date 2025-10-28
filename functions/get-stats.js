const postgres = require('postgres');

exports.handler = async (event, context) => {
    let sql;
    try {
        sql = postgres(process.env.NEON_DATABASE_URL, { ssl: 'require' });
        
        const [totalResult, checkedInResult] = await Promise.all([
            sql`SELECT COUNT(*) FROM attendees`,
            sql`SELECT COUNT(*) FROM attendees WHERE checked_in = TRUE`
        ]);

        const total_attendees = parseInt(totalResult[0].count, 10);
        const checked_in_count = parseInt(checkedInResult[0].count, 10);
        
        return {
            statusCode: 200,
            body: JSON.stringify({ total_attendees, checked_in_count }),
        };
    } catch (error) {
        console.error('Error fetching stats:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Internal Server Error' }) };
    } finally {
        if (sql) {
            await sql.end();
        }
    }
};
