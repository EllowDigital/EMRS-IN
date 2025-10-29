const postgres = require('postgres');

let sqlClient = null;
function getSqlClient() {
    if (sqlClient) return sqlClient;
    sqlClient = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });
    return sqlClient;
}

// Cache small system config for short TTL to avoid DB hits on frequent admin polling
const configCache = { ts: 0, data: null, ttl: 10 * 1000 };

async function withRetries(fn, attempts = 3, baseDelay = 120) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
        try { return await fn(); } catch (err) {
            lastErr = err;
            const code = err && err.code ? err.code : null;
            if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
                const jitter = Math.floor(Math.random() * 100);
                const delay = baseDelay * Math.pow(2, i) + jitter;
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

exports.handler = async (event, context) => {
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
        } catch (e) {
            return false;
        }
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

    try {
        // Serve from short cache when available
        const now = Date.now();
        if (configCache.data && (now - configCache.ts) < configCache.ttl) {
            return { statusCode: 200, body: JSON.stringify(configCache.data) };
        }

        const sql = getSqlClient();

        const configResult = await withRetries(() => sql`SELECT key, value FROM system_config WHERE key IN ('registration_enabled', 'maintenance_mode')`);

        const systemStatus = {
            db_connected: true,
            registration_enabled: configResult.find(c => c.key === 'registration_enabled')?.value === 'true',
            maintenance_mode: configResult.find(c => c.key === 'maintenance_mode')?.value === 'true',
        };

        configCache.data = systemStatus;
        configCache.ts = Date.now();

        return { statusCode: 200, body: JSON.stringify(systemStatus) };
    } catch (error) {
        console.error('Error getting system status:', error && error.message ? error.message : error);
        // If we have a cached config, return it to avoid failing admin login during short DB outages
        if (configCache.data) {
            console.warn('Returning stale cached system status due to DB error.');
            const stale = Object.assign({}, configCache.data, { stale: true, note: 'stale_cached_value' });
            return { statusCode: 200, body: JSON.stringify(stale) };
        }

        // No cache: return a safe default so token validation and UI can proceed. Mark as stale so UI can surface a banner.
        console.warn('No cached system status available; returning safe fallback due to DB error.');
        return {
            statusCode: 200,
            body: JSON.stringify({ db_connected: false, registration_enabled: false, maintenance_mode: true, stale: true, message: 'Database unreachable, returning fallback system status' })
        };
    }
};
