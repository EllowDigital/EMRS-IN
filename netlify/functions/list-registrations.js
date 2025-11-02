// /netlify/functions/list-registrations.js

const { pool } = require("./utils");

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

exports.handler = async (event) => {
  const providedKey = event.headers["x-admin-key"];
  const secretKey = process.env.EXPORT_SECRET_KEY;

  if (!providedKey || providedKey !== secretKey) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const params = event.queryStringParameters || {};
  const parsedPage = parseInt(params.page, 10);
  const parsedLimit = parseInt(params.limit, 10);
  const rawSearch =
    typeof params.search === "string" ? params.search.trim() : "";
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const requestedLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? parsedLimit
      : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(requestedLimit, MAX_PAGE_SIZE);
  let dbClient;
  try {
    dbClient = await pool.connect();

    const searchTerm = rawSearch ? `%${rawSearch}%` : null;

    // --- 1. FIX: Use `registration_id_text` in WHERE clause ---
    const whereClause = searchTerm
      ? "WHERE registration_id_text ILIKE $1 OR name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1 OR city ILIKE $1 OR state ILIKE $1"
      : "";

    const countQuery = `SELECT COUNT(*) AS total FROM registrations ${whereClause}`;
    const countParams = searchTerm ? [searchTerm] : [];
    const { rows: countRows } = await dbClient.query(countQuery, countParams);

    const total = parseInt(countRows[0].total, 10) || 0;
    const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const offset = (safePage - 1) * pageSize;

    const selectParams = searchTerm
      ? [searchTerm, pageSize, offset]
      : [pageSize, offset];
    const limitIndex = searchTerm ? 2 : 1;
    const offsetIndex = searchTerm ? 3 : 2;

    // --- 2. FIX: Use `registration_id_text` and `payment_id_text` in SELECT ---
    const selectQuery = `SELECT id, registration_id_text, name, phone, email, city, state, payment_id_text, timestamp, checked_in_at
         FROM registrations
         ${whereClause}
         ORDER BY timestamp DESC
         LIMIT $${limitIndex} OFFSET $${offsetIndex}`;

    const { rows: registrationRows } = await dbClient.query(
      selectQuery,
      selectParams,
    );

    // --- 3. FIX: Map correct column names to response ---
    // (This maps to the frontend `admin.html` which expects `registration_id`)
    const finalResults = registrationRows.map(row => ({
      ...row,
      registration_id: row.registration_id_text, // Map to what frontend expects
      payment_id: row.payment_id_text, // Map to what frontend expects
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results: finalResults, // Send the mapped results
        total,
        page: safePage,
        pageSize,
        totalPages,
        search: rawSearch,
      }),
    };
  } catch (error) {
    console.error("Error in list-registrations function:", error);
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