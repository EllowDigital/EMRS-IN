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
        const { registrationId } = payload || {};
        if (!registrationId) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'registrationId required' }) };
        }

        await ensureSchemaReady();
        const sql = getSqlClient();
        const normalizedId = String(registrationId).trim();

        const rows = await sql`
            select id, registration_id, full_name, phone, email, profile_url, status
            from attendees
            where registration_id = ${normalizedId}
            limit 1
        `;
        if (!rows || rows.length === 0) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: 'E-pass not found for provided Registration ID' }) };
        }
        const existing = rows[0];
        if ((existing.status || '').toLowerCase().includes('checked')) {
            const attendee = {
                registrationId: existing.registration_id,
                fullName: existing.full_name,
                phone: existing.phone,
                email: existing.email,
                profileUrl: existing.profile_url,
                status: existing.status,
            };
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Attendee already checked in', attendee }) };
        }

        // Use the database enum value 'checked_in' (matches schema)
        await sql`
            update attendees
            set status = 'checked_in', updated_at = now()
            where id = ${existing.id}
        `;

        // Record the check-in in the checkins table. Accept optional location and method from the client.
        const { location, method } = payload || {};
        // Normalize method to allowed enum values: 'qr_scan' or 'manual_lookup'
        const methodVal = (method === 'manual_lookup' || method === 'manual') ? 'manual_lookup' : 'qr_scan';
        try {
            // Insert only if a conflicting checkin of the same method doesn't already exist. Use WHERE NOT EXISTS to respect the partial unique index.
            await sql`
                insert into checkins (attendee_id, method, location)
                select ${existing.id}, ${methodVal}, ${location || null}
                where not exists (
                    select 1 from checkins c where c.attendee_id = ${existing.id} and c.method = ${methodVal}
                )
            `;
        } catch (e) {
            // ignore insert errors (e.g., race/unique violations)
            console.warn('checkins insert warning', e?.message || e);
        }

        const updated = await sql`
            select registration_id, full_name, phone, email, profile_url, status
            from attendees
            where id = ${existing.id}
            limit 1
        `;
        const r = updated[0];
        const attendee = {
            registrationId: r.registration_id,
            fullName: r.full_name,
            phone: r.phone,
            email: r.email,
            profileUrl: r.profile_url,
            status: r.status,
        };
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Checked in', attendee }) };

    } catch (err) {
        console.error('checkin function error', err);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Server error' }) };
    }
};
