const postgres = require('postgres');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // Require admin Authorization header
    const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const expected = process.env.STAFF_LOGIN_PASSWORD || '';
    if (!auth.startsWith('Bearer ') || auth.split(' ')[1] !== expected) {
        return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) };
    }

    let sql;
    try {
        const { key, value } = JSON.parse(event.body);

        if (!['registration_enabled', 'maintenance_mode'].includes(key) || typeof value !== 'boolean') {
            return { statusCode: 400, body: 'Bad Request: Invalid key or value.' };
        }

    sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

        await sql`
            INSERT INTO system_config (key, value, updated_at) 
            VALUES (${key}, ${value.toString()}, CURRENT_TIMESTAMP)
            ON CONFLICT (key) 
            DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
        `;

        const updatedConfig = await sql`SELECT key, value FROM system_config WHERE key IN ('registration_enabled', 'maintenance_mode')`;
        const systemStatus = {
            registration_enabled: updatedConfig.find(c => c.key === 'registration_enabled')?.value === 'true',
            maintenance_mode: updatedConfig.find(c => c.key === 'maintenance_mode')?.value === 'true',
        };

        return {
            statusCode: 200,
            body: JSON.stringify(systemStatus),
        };
    } catch (error) {
        console.error('Error updating system status:', error);
        return { statusCode: 500, body: 'Internal Server Error' };
    } finally {
        if (sql) {
            await sql.end();
        }
    }
};
