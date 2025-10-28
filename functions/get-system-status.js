const postgres = require('postgres');

exports.handler = async (event, context) => {
    let sql;
    try {
    // Use a short connect timeout so admin page doesn't hang when DB is unreachable
    sql = postgres(process.env.DATABASE_URL, { ssl: 'require', connect_timeout: 5, max: 2 });

        const configResult = await sql`SELECT key, value FROM system_config WHERE key IN ('registration_enabled', 'maintenance_mode')`;
        
        const systemStatus = {
            db_connected: true,
            registration_enabled: configResult.find(c => c.key === 'registration_enabled')?.value === 'true',
            maintenance_mode: configResult.find(c => c.key === 'maintenance_mode')?.value === 'true',
        };

        return {
            statusCode: 200,
            body: JSON.stringify(systemStatus),
        };
    } catch (error) {
        console.error('Error getting system status:', error);
        // If DB is unreachable, return a controlled fail-safe indicating maintenance_mode true
        if (error && error.code && (error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH')) {
            return {
                statusCode: 503,
                body: JSON.stringify({
                    db_connected: false,
                    registration_enabled: false,
                    maintenance_mode: true,
                    error: 'Database unreachable. Assuming maintenance mode.'
                }),
            };
        }
        return {
            statusCode: 500,
            body: JSON.stringify({
                db_connected: false,
                registration_enabled: false,
                maintenance_mode: true, // Fail-safe
                error: 'Could not connect to the database or read configuration.'
            }),
        };
    } finally {
        if (sql) {
            await sql.end();
        }
    }
};
