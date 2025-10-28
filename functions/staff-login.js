// functions/staff-login.js

/**
 * This function handles the staff login verification.
 * It securely checks a submitted password against a server-side environment variable.
 */
exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    try {
        const { password } = JSON.parse(event.body);
        const staffPassword = process.env.STAFF_LOGIN_PASSWORD;

        // Check if the environment variable is set on the server
        if (!staffPassword) {
            console.error('CRITICAL: STAFF_LOGIN_PASSWORD environment variable is not set in Netlify.');
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Server configuration error. Please contact an administrator.' }),
            };
        }

        // Validate the submitted password
        if (password && password === staffPassword) {
            // Passwords match: issue a short-lived token (HMAC signed)
            const crypto = require('crypto');
            const secret = process.env.STAFF_TOKEN_SECRET;
            if (!secret) {
                console.error('CRITICAL: STAFF_TOKEN_SECRET environment variable is not set. Token issuance disabled.');
                return {
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: 'Server configuration error. Token service unavailable.' }),
                };
            }

            const header = { alg: 'HS256', typ: 'JWT' };
            const now = Math.floor(Date.now() / 1000);
            const expiresIn = 15 * 60; // 15 minutes
            const payload = { sub: 'staff', iat: now, exp: now + expiresIn };

            function base64url(input) {
                return Buffer.from(JSON.stringify(input)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            }

            const encodedHeader = base64url(header);
            const encodedPayload = base64url(payload);
            const signingInput = `${encodedHeader}.${encodedPayload}`;
            const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            const token = `${signingInput}.${signature}`;

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, token, expires_in: expiresIn }),
            };
        } else {
            // Passwords do not match
            return {
                statusCode: 401,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: false, message: 'Invalid password. Please try again.' }),
            };
        }
    } catch (error) {
        console.error('Staff login error:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'An internal server error occurred during login.' }),
        };
    }
};
