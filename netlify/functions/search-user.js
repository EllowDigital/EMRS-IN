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

  const params = event.queryStringParameters || {};
  const rawPhone =
    typeof params.phone === "string" ? params.phone.trim() : "";
  const rawRegistrationId =
    typeof params.registrationId === "string"
      ? params.registrationId.trim()
      : "";

  const phone = rawPhone ? rawPhone : null;
  const registrationId = rawRegistrationId
    ? rawRegistrationId.toUpperCase()
    : null;

  if (!phone && !registrationId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "phone or registrationId is required." }),
    };
  }

  const whereClauses = [];
  const values = [];
  let index = 1;

  if (phone) {
    whereClauses.push(`phone = $${index}`);
    values.push(phone);
    index += 1;
  }

  if (registrationId) {
    whereClauses.push(`UPPER(reg_id) = $${index}`);
    values.push(registrationId);
    index += 1;
  }

  const whereClause = `WHERE ${whereClauses.join(" OR ")}`;
  const selectQuery = `
    SELECT id,
           "timestamp",
           reg_id,
           name,
           phone,
           email,
           city,
           state,
           pay_id,
           image_url,
           needs_sync,
           checked_in_at,
           updated_at
      FROM registrations
      ${whereClause}
      LIMIT 1;
  `;

  let dbClient;
  try {
    dbClient = await pool.connect();
    const { rows } = await dbClient.query(selectQuery, values);

    if (rows.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Registration not found." }),
      };
    }

    const record = rows[0];
    const mappedRecord = {
      ...record,
      registration_id: record.reg_id,
      payment_id: record.pay_id,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mappedRecord),
    };
  } catch (error) {
    console.error("Error in search-user function:", error);
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