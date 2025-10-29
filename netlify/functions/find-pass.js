import { getSqlClient, ensureSchemaReady } from './_shared/database.js';
import { buildPassData } from './_shared/pass.js';

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

if (!process.env.DATABASE_URL) {
    console.warn('Missing DATABASE_URL environment variable.');
}

const sqlClient = getSqlClient();

function errorResponse(statusCode, message) {
    return {
        statusCode,
        headers,
        body: JSON.stringify({ success: false, message }),
    };
}

function normalizePhone(phone) {
    return String(phone || '')
        .replace(/\D/g, '')
        .slice(0, 10);
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (!['GET', 'POST'].includes(event.httpMethod)) {
        return errorResponse(405, 'Method not allowed.');
    }

    try {
        const query = event.httpMethod === 'GET'
            ? Object.fromEntries(new URLSearchParams(event.rawQuery || event.rawQueryString || ''))
            : {};

        let phone = normalizePhone(query.phone);
        let email = (query.email || '').trim().toLowerCase();

            if (event.httpMethod === 'POST') {
            if (!event.body) {
                return errorResponse(400, 'Request body is empty.');
            }

            const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
                if (!contentType.includes('application/json')) {
                return errorResponse(415, 'Unsupported content type. Use application/json.');
            }

                const rawBody = event.isBase64Encoded
                    ? Buffer.from(event.body, 'base64').toString('utf8')
                    : event.body;
                const payload = JSON.parse(rawBody);
                phone = normalizePhone(payload.phone ?? phone);
                const emailCandidate = payload.email ?? email ?? '';
                email = String(emailCandidate).trim().toLowerCase();
        }

        if (!phone && !email) {
            return errorResponse(400, 'Provide a 10-digit phone number or an email address.');
        }

        if (phone && phone.length !== 10) {
            return errorResponse(400, 'Phone number must be exactly 10 digits.');
        }

        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return errorResponse(400, 'Email address is invalid.');
        }

        await ensureSchemaReady();

        let attendee;

        if (phone) {
            const rows = await sqlClient`
        select id, registration_id, full_name, phone, email, city, state, profile_url
        from attendees
        where phone = ${phone}
        limit 1
      `;
            if (rows.length) {
                attendee = rows[0];
            }
        } else if (email) {
            const rows = await sqlClient`
        select id, registration_id, full_name, phone, email, city, state, profile_url
        from attendees
        where lower(email) = ${email}
        order by created_at desc
      `;
            if (rows.length > 1) {
                return errorResponse(409, 'Multiple passes found for this email. Please search using the phone number.');
            }
            attendee = rows[0];
        }

        if (!attendee) {
            return errorResponse(404, 'No e-pass found for the provided details.');
        }

        await sqlClient`
      update attendees
      set last_qr_requested_at = now(), updated_at = now()
      where id = ${attendee.id}
    `;

        const epass = buildPassData({
            name: attendee.full_name,
            registrationId: attendee.registration_id,
            profileUrl: attendee.profile_url,
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                attendee: {
                    registrationId: attendee.registration_id,
                    fullName: attendee.full_name,
                    phone: attendee.phone,
                    email: attendee.email,
                    city: attendee.city,
                    state: attendee.state,
                    profileUrl: attendee.profile_url,
                },
                epass,
            }),
        };
    } catch (error) {
        console.error('Unexpected error', error);
        return errorResponse(500, 'Unexpected server error.');
    }
};
