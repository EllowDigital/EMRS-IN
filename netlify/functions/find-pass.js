// /netlify/functions/find-pass.js

const { pool } = require("./utils");

// --- Caching Configuration ---
const userCache = new Map();
const CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutes

// --- Rate Limiting Configuration ---
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // Max 10 requests

exports.handler = async (event) => {
  // --- 1. Rate Limiting Logic ---
  try {
    const clientIp = event.headers["x-nf-client-connection-ip"] || "unknown";
    const now = Date.now();
    const requests = (rateLimitStore.get(clientIp) || []).filter(
      (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
    );
    if (requests.length >= RATE_LIMIT_MAX_REQUESTS) {
      console.warn(`[RATE LIMIT] IP ${clientIp} has been rate-limited.`);
      return {
        statusCode: 429,
        body: JSON.stringify({
          error:
            "You have made too many requests. Please try again in a minute.",
        }),
      };
    }
    requests.push(now);
    rateLimitStore.set(clientIp, requests);
  } catch (error) {
    console.error("Error during rate limiting:", error);
  }
  // --- End Rate Limiting Logic ---

  // 2. Basic Request Validation
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const { phone } = event.queryStringParameters;
  const trimmedPhone = phone ? phone.trim() : null;

  if (!trimmedPhone || !/^[6-9]\d{9}$/.test(trimmedPhone)) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Please provide a valid 10-digit phone number.",
      }),
    };
  }

  // --- 3. Caching Logic ---
  const cachedEntry = userCache.get(trimmedPhone);
  if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_DURATION_MS) {
    console.log(
      `[CACHE HIT] Serving pass for phone ${trimmedPhone} from cache.`,
    );
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cachedEntry.data),
    };
  }
  console.log(
    `[CACHE MISS] Fetching pass for phone ${trimmedPhone} from the database.`,
  );

  // --- 4. Database Query ---
  let dbClient;
  try {
    dbClient = await pool.connect();

    // --- 1. FIX: Use `registration_id_text` in SELECT ---
    const queryText = `
            SELECT registration_id_text, name, phone, email, city, state, image_url
            FROM registrations WHERE phone = $1
        `;
    const { rows } = await dbClient.query(queryText, [trimmedPhone]);

    if (rows.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "No registration was found for this phone number.",
        }),
      };
    }

    const userData = rows[0];
    
    // --- 2. FIX: Map `registration_id_text` to `registrationId` ---
    const registrationData = {
      registrationId: userData.registration_id_text,
      name: userData.name,
      phone: userData.phone,
      email: userData.email,
      city: userData.city,
      state: userData.state,
      profileImageUrl: userData.image_url,
    };

    userCache.set(trimmedPhone, {
      data: registrationData,
      timestamp: Date.now(),
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registrationData),
    };
  } catch (error) {
    console.error("Error in find-pass function:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "An internal server error occurred." }),
    };
  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
};