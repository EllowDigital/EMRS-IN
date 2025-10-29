import { ensureSchemaReady } from './_shared/database.js';
import { fetchAttendeeByRegistration, validateRegistrationId } from './_shared/attendees.js';

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

        if (action !== 'lookup') {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: 'Unknown action' }) };
        }

        const validation = validateRegistrationId(registrationId);
        if (!validation.ok) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: validation.message }) };
        }

        await ensureSchemaReady();
        const attendee = await fetchAttendeeByRegistration(validation.value);
        if (!attendee) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: 'E-pass not found for provided Registration ID' }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, attendee }) };
    } catch (err) {
        console.error('verify function error', err);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Server error' }) };
    }
};
