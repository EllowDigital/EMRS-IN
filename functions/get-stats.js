const postgres = require('postgres');

exports.handler = async (event, context) => {
    let sql;
    try {
    // For admin stats prefer the default connection behavior (avoid overly aggressive timeouts while an admin session is active)
    sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });
        
        // Run total first, then attempt checked-in count with a graceful fallback if the column is missing
        const totalResult = await sql`SELECT COUNT(*) FROM attendees`;
        let checkedInCount = 0;
        try {
            const checkedInResult = await sql`SELECT COUNT(*) FROM attendees WHERE checked_in = TRUE`;
            checkedInCount = parseInt(checkedInResult[0].count, 10);
        } catch (innerErr) {
            // If column does not exist (e.g., different schema), log and fallback to 0
            console.warn('Checked-in column missing or query failed; returning 0 for checked-in count.', innerErr.message || innerErr);
            checkedInCount = 0;
        }

        const total_attendees = parseInt(totalResult[0].count, 10);
        const checked_in_count = checkedInCount;
        
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
