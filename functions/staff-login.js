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
            // Passwords match
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, message: 'Login successful' }),
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
