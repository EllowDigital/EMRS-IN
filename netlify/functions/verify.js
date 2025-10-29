import { getSqlClient, ensureSchemaReady } from './_shared/database.js';

export const handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
    }

    try {
        if (!event.body) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Missing request body' }) };
        }

        const payload = JSON.parse(event.body || '{}');
        const { action, registrationId } = payload || {};
        if (!action || !registrationId) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'action and registrationId required' }) };
        }

        // Ensure DB schema is available (will create table if missing)
        await ensureSchemaReady();
        const sql = getSqlClient();

        const normalizedId = String(registrationId).trim();

        if (action === 'lookup') {
            const rows = await sql`
                select registration_id, full_name, phone, email, profile_url, status
                from attendees
                where registration_id = ${normalizedId}
                limit 1
            `;
            if (!rows || rows.length === 0) {
                return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: 'E-pass not found for provided Registration ID' }) };
            }
            const r = rows[0];
            const attendee = {
                registrationId: r.registration_id,
                fullName: r.full_name,
                phone: r.phone,
                email: r.email,
                profileUrl: r.profile_url,
                status: r.status,
            };
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, attendee }) };
        }
        // check-in is handled by a separate Netlify function (/netlify/functions/checkin)

        return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Unknown action' }) };
    } catch (err) {
        console.error('verify function error', err);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Server error' }) };
    }
};
