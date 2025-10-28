const postgres = require('postgres');

exports.handler = async (event, context) => {
    let sql;
    try {
    // Fail fast on network issues by setting a short connect timeout and small pool
    sql = postgres(process.env.DATABASE_URL, { ssl: 'require', connect_timeout: 5, max: 2 });
        
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
