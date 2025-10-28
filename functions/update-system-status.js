const postgres = require('postgres');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // Require admin Authorization header (accept raw password or token)
    const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    const expected = process.env.STAFF_LOGIN_PASSWORD || '';
    const tokenSecret = process.env.STAFF_TOKEN_SECRET || '';
    function verifyToken(token) {
        try {
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
        } catch (e) { return false; }
    }
    const isAuthorized = (auth && auth.startsWith('Bearer ') && (() => {
        const value = auth.split(' ')[1];
        if (!value) return false;
        if (value === expected) return true;
        if (verifyToken(value)) return true;
        return false;
    })());
    if (!isAuthorized) {
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
