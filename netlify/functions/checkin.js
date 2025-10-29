import { ensureSchemaReady } from './_shared/database.js';
import { fetchAttendeeByRegistration, recordCheckin, updateAttendeeStatus, validateRegistrationId } from './_shared/attendees.js';

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
        const { registrationId, location, method, notes, deviceInfo } = payload || {};

        const validation = validateRegistrationId(registrationId);
        if (!validation.ok) {
            return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: validation.message }) };
        }

        await ensureSchemaReady();
        const attendee = await fetchAttendeeByRegistration(validation.value);
        if (!attendee) {
            return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: 'E-pass not found for provided Registration ID' }) };
        }

        if (attendee.isCheckedIn) {
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Attendee already checked in', attendee }) };
        }

        const normalizedNotes = notes
            ? (typeof notes === 'string' ? notes : JSON.stringify(notes))
            : (deviceInfo
                ? (typeof deviceInfo === 'string' ? deviceInfo : JSON.stringify(deviceInfo))
                : null);

        await updateAttendeeStatus(attendee.id, 'checked_in');
        await recordCheckin(attendee.id, {
            method,
            location,
            notes: normalizedNotes,
        });

        const refreshed = await fetchAttendeeByRegistration(validation.value);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Checked in',
                attendee: refreshed,
            }),
        };

    } catch (err) {
        console.error('checkin function error', err);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: 'Server error' }) };
    }
};
