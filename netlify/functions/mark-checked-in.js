// /netlify/functions/mark-checked-in.js

const { pool } = require("./utils");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const providedKey = event.headers["x-admin-key"];
  const secretKey = process.env.EXPORT_SECRET_KEY;
  if (!providedKey || providedKey !== secretKey) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  let dbClient;
  try {
    const { registrationId } = JSON.parse(event.body);

    if (!registrationId || !registrationId.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Registration ID is required." }),
      };
    }

    const normalizedRegistrationId = registrationId.trim().toUpperCase();

    dbClient = await pool.connect();

    const updateQuery = `
      UPDATE registrations
      SET
        checked_in_at = NOW(),
        updated_at = NOW(),
        needs_sync = true
      WHERE reg_id = $1
      RETURNING reg_id, name, checked_in_at;
    `;
    const { rows } = await dbClient.query(updateQuery, [
      normalizedRegistrationId,
    ]);

    if (rows.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "User not found." }),
      };
    }

    // --- 2. FIX: Map correct column name to response ---
    const responseData = {
      registration_id: rows[0].reg_id,
      name: rows[0].name,
      checked_in_at: rows[0].checked_in_at,
    };

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Successfully checked in ${rows[0].name}.`,
        data: responseData,
      }),
    };
  } catch (error) {
    console.error("Error in mark-checked-in function:", error);
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