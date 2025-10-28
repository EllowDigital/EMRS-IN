const crypto = require('crypto');
const base64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function signToken(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const h64 = base64url(JSON.stringify(header));
    const p64 = base64url(JSON.stringify(payload));
    const signingInput = `${h64}.${p64}`;
    const sig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${signingInput}.${sig}`;
}

function verifyTokenCompact(token, secret) {
    try {
        if (!secret) return false;
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const [h64, p64, sig] = parts;
        const signingInput = `${h64}.${p64}`;
        const expectedSig = crypto.createHmac('sha256', secret).update(signingInput).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const a = Buffer.from(expectedSig);
        const b = Buffer.from(sig);
        if (a.length !== b.length) return false;
        if (!crypto.timingSafeEqual(a, b)) return false;
        const payload = JSON.parse(Buffer.from(p64, 'base64').toString('utf8'));
        const now = Math.floor(Date.now() / 1000);
        if (!payload.exp || payload.exp < now) return false;
        return payload;
    } catch (e) {
        return false;
    }
}

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const staffPassword = process.env.STAFF_LOGIN_PASSWORD || '';
    const tokenSecret = process.env.STAFF_TOKEN_SECRET;
    if (!tokenSecret) {
        console.error('CRITICAL: STAFF_TOKEN_SECRET environment variable is not set. Token issuance disabled.');
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Token service unavailable' }) };
    }

    // Accept either Authorization: Bearer <password|token> or { password } in JSON body
    const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    let incoming = null;
    if (auth && auth.startsWith('Bearer ')) incoming = auth.split(' ')[1];
    try {
        const body = event.body ? JSON.parse(event.body) : {};
        if (!incoming && body && body.password) incoming = body.password;
    } catch (e) { /* ignore parse errors */ }

    if (!incoming) return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) };

    // If incoming matches legacy password, issue a new token
    if (incoming === staffPassword) {
        const now = Math.floor(Date.now() / 1000);
        const exp = now + 15 * 60; // 15 minutes
        const payload = { sub: 'staff', iat: now, exp };
        const token = signToken(payload, tokenSecret);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, token, expires_in: exp - now }) };
    }

    // Otherwise treat incoming as a token to be refreshed
    const verified = verifyTokenCompact(incoming, tokenSecret);
    if (!verified) {
        return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Invalid token' }) };
    }

    // Issue a new token (rotate expiry)
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 15 * 60;
    const payload = { sub: 'staff', iat: now, exp };
    const token = signToken(payload, tokenSecret);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, token, expires_in: exp - now }) };
};
