// /netlify/functions/search-user.js

const { pool } = require("./utils");

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

  const qs = event.queryStringParameters || {};
  const phone = qs.phone ? String(qs.phone).trim() : null;
  const registrationId = qs.registrationId
    ? String(qs.registrationId).trim().toUpperCase()
    : null;

  if (!phone && !registrationId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "phone or registrationId is required." }),
    };
  }

  const values = [];
  let whereClauses = [];
  let idx = 1;

  if (phone) {
    whereClauses.push(`phone = $${idx}`);
    values.push(phone);
    idx += 1;
  }
  if (registrationId) {
    whereClauses.push(`reg_id = $${idx}`);
    values.push(registrationId);
    idx += 1;
  }

  const query = `SELECT * FROM registrations WHERE (${whereClauses.join(" OR ")}) LIMIT 1`;

  let dbClient;
  try {
    dbClient = await pool.connect();
    const { rows } = await dbClient.query(query, values);
    if (!rows || rows.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
    }
    const row = rows[0];
    const mapped = {
      ...row,
      registration_id: row.reg_id,
      payment_id: row.pay_id,
    };
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mapped),
    };
  } catch (error) {
    console.error("Error in search-user function:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  } finally {
    if (dbClient) dbClient.release();
  }
};