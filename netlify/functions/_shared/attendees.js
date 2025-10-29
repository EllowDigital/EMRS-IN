import { ensureSchemaReady, getSqlClient } from './database.js';

const REG_ID_PATTERN = /^[A-Z0-9-_]+$/i;

export function normalizeRegistrationId(registrationId) {
    if (!registrationId) return null;
    return String(registrationId).trim();
}

export function validateRegistrationId(registrationId) {
    const normalized = normalizeRegistrationId(registrationId);
    if (!normalized) {
        return { ok: false, message: 'registrationId required' };
    }
    if (normalized.length > 64) {
        return { ok: false, message: 'registrationId too long' };
    }
    if (!REG_ID_PATTERN.test(normalized)) {
        return { ok: false, message: 'registrationId must be alphanumeric (with optional dash/underscore)' };
    }
    return { ok: true, value: normalized.toUpperCase() };
}

function mapAttendeeRow(row) {
    if (!row) return null;
    const attendee = {
        id: row.attendee_id || row.id,
        registrationId: row.registration_id,
        fullName: row.full_name,
        phone: row.phone,
        email: row.email,
        city: row.city,
        state: row.state,
        profileUrl: row.profile_url,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastQrRequestedAt: row.last_qr_requested_at,
    };

    if (row.latest_checkin_at) {
        attendee.latestCheckin = {
            id: row.latest_checkin_id,
            method: row.latest_checkin_method,
            location: row.latest_checkin_location,
            notes: row.latest_checkin_notes,
            createdAt: row.latest_checkin_at,
        };
    } else {
        attendee.latestCheckin = null;
    }

    attendee.totalCheckins = Number(row.checkins_count || 0);
    attendee.isCheckedIn = String(row.status || '').toLowerCase() === 'checked_in';
    return attendee;
}

export async function fetchAttendeeByRegistration(registrationId) {
    await ensureSchemaReady();
    const sql = getSqlClient();
    const valid = validateRegistrationId(registrationId);
    if (!valid.ok) {
        const error = new Error(valid.message || 'Invalid registrationId');
        error.statusCode = 400;
        throw error;
    }
    const rid = valid.value;
    const rows = await sql`
        select
            a.id as attendee_id,
            a.registration_id,
            a.full_name,
            a.phone,
            a.email,
            a.city,
            a.state,
            a.profile_url,
            a.status,
            a.created_at,
            a.updated_at,
            a.last_qr_requested_at,
            lc.id as latest_checkin_id,
            lc.method as latest_checkin_method,
            lc.location as latest_checkin_location,
            lc.notes as latest_checkin_notes,
            lc.created_at as latest_checkin_at,
            coalesce((select count(*) from checkins where attendee_id = a.id), 0) as checkins_count
        from attendees a
        left join lateral (
            select c.*
            from checkins c
            where c.attendee_id = a.id
            order by c.created_at desc
            limit 1
        ) lc on true
        where upper(a.registration_id) = ${rid}
        limit 1
    `;
    if (!rows || rows.length === 0) {
        return null;
    }
    return mapAttendeeRow(rows[0]);
}

export async function recordCheckin(attendeeId, options = {}) {
    await ensureSchemaReady();
    const sql = getSqlClient();
    const method = options.method === 'manual_lookup' ? 'manual_lookup' : 'qr_scan';
    const location = options.location || null;
    let notes = options.notes || null;
    if (notes && typeof notes !== 'string') {
        notes = JSON.stringify(notes);
    }

    await sql`
        insert into checkins (attendee_id, method, location, notes)
        select ${attendeeId}, ${method}, ${location}, ${notes}
        where not exists (
            select 1 from checkins where attendee_id = ${attendeeId} and method = ${method}
        )
    `;
}

export async function updateAttendeeStatus(attendeeId, status = 'checked_in') {
    await ensureSchemaReady();
    const sql = getSqlClient();
    await sql`
        update attendees
        set status = ${status}, updated_at = now()
        where id = ${attendeeId}
    `;
}
*** End Patch