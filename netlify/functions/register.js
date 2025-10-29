import { v2 as cloudinary } from 'cloudinary';
import { getSqlClient, ensureSchemaReady } from './_shared/database.js';
import { buildPassData } from './_shared/pass.js';

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const requiredEnv = [
    'DATABASE_URL',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
];

const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
    console.warn(`Missing environment variables: ${missingEnv.join(', ')}`);
}

const envIsReady = missingEnv.length === 0;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

function generateRegistrationId() {
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `UP25-${random}`;
}

function errorResponse(statusCode, message) {
    return {
        statusCode,
        headers,
        body: JSON.stringify({ success: false, message }),
    };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }

    if (event.httpMethod !== 'POST') {
        return errorResponse(405, 'Method not allowed.');
    }

    try {
        if (!envIsReady) {
            return errorResponse(500, 'Server configuration incomplete.');
        }

        if (!event.body) {
            return errorResponse(400, 'Request body is empty.');
        }

        const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
        let payload;

        if (contentType.includes('application/json')) {
            const rawBody = event.isBase64Encoded
                ? Buffer.from(event.body, 'base64').toString('utf8')
                : event.body;
            payload = JSON.parse(rawBody);
        } else if (event.isBase64Encoded) {
            const decoded = Buffer.from(event.body, 'base64').toString('utf8');
            payload = JSON.parse(decoded);
        } else {
            return errorResponse(415, 'Unsupported content type. Use application/json.');
        }

        const fullName = (payload.fullName || '').trim();
        const email = (payload.email || '').trim().toLowerCase();
        const city = (payload.city || '').trim();
        const state = (payload.state || '').trim();
        const profileImage = payload.profileImage || null;
        const phoneDigits = String(payload.phone || '').replace(/\D/g, '');

        if (!fullName || !email || !city || !state) {
            return errorResponse(400, 'Please provide name, email, city, and state.');
        }

        if (phoneDigits.length !== 10) {
            return errorResponse(400, 'Phone number must be 10 digits.');
        }

        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            return errorResponse(400, 'Email address is invalid.');
        }

        const sqlClient = getSqlClient();
        await ensureSchemaReady();

                const existing = await sqlClient`
                        select registration_id from attendees
                        where phone = ${phoneDigits}
                        limit 1
                `;

        if (existing.length) {
            return errorResponse(409, 'An attendee with this phone number already exists.');
        }

        const registrationId = generateRegistrationId();

        let profileUrl = null;
        let profilePublicId = null;
        if (profileImage) {
            try {
                const uploadResult = await cloudinary.uploader.upload(profileImage, {
                    folder: 'emrs/profiles',
                    public_id: `user-${registrationId}`,
                    overwrite: true,
                    transformation: [{ width: 600, height: 600, crop: 'fill', gravity: 'face' }],
                });
                profileUrl = uploadResult.secure_url;
                profilePublicId = uploadResult.public_id;
            } catch (uploadError) {
                console.error('Cloudinary upload failed', uploadError);
                return errorResponse(502, 'Unable to process profile image.');
            }
        }

        const epass = buildPassData({ name: fullName, registrationId, profileUrl });

                await sqlClient`
                        insert into attendees
                                (registration_id, full_name, phone, email, city, state, profile_public_id, profile_url, status, last_qr_requested_at)
                        values
                                (${registrationId}, ${fullName}, ${phoneDigits}, ${email}, ${city}, ${state}, ${profilePublicId}, ${profileUrl}, 'epass_issued', now())
                `;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                attendee: {
                    registrationId,
                    fullName,
                    phone: phoneDigits,
                    email,
                    city,
                    state,
                    profileUrl,
                    profilePublicId,
                },
                epass,
            }),
        };
    } catch (error) {
        console.error('Unexpected error', error);
        return errorResponse(500, 'Unexpected server error.');
    }
};
