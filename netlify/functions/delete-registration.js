// /netlify/functions/delete-registration.js

const { pool } = require("./utils");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const CLOUDINARY_ENABLED = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET,
);

const deriveCloudinaryPublicId = (url) => {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const uploadIdx = segments.indexOf("upload");
    if (uploadIdx === -1) {
      return null;
    }
    const publicIdSegments = segments.slice(uploadIdx + 1);
    if (publicIdSegments.length === 0) {
      return null;
    }
    if (publicIdSegments[0].startsWith("v") && !Number.isNaN(Number(publicIdSegments[0].slice(1)))) {
      publicIdSegments.shift();
    }
    const lastSegment = publicIdSegments.pop();
    if (!lastSegment) {
      return null;
    }
    const basename = lastSegment.split(".")[0];
    publicIdSegments.push(basename);
    return publicIdSegments.join("/");
  } catch (error) {
    console.warn("[DELETE_REG] Failed to derive Cloudinary public ID", error);
    return null;
  }
};

exports.handler = async (event) => {
  const providedKey = event.headers["x-admin-key"];
  const secretKey = process.env.EXPORT_SECRET_KEY;

  if (!providedKey || providedKey !== secretKey) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  if (event.httpMethod !== "DELETE") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON payload." }),
    };
  }

  const { registrationId } = payload;
  if (!registrationId || typeof registrationId !== "string") {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "registrationId is required." }),
    };
  }

  const normalizedRegistrationId = registrationId.trim().toUpperCase();

  let dbClient;
  let transactionStarted = false;
  try {
    dbClient = await pool.connect();
    await dbClient.query("BEGIN");
    transactionStarted = true;

    const { rows: existingRows } = await dbClient.query(
      `SELECT reg_id, name, image_url FROM registrations WHERE reg_id = $1 FOR UPDATE;`,
      [normalizedRegistrationId],
    );

    if (existingRows.length === 0) {
      await dbClient.query("ROLLBACK");
      transactionStarted = false;
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Registration not found." }),
      };
    }

    const targetRecord = existingRows[0];
    const cloudinaryOutcome = {
      status: "no_image",
      publicId: null,
      message: "No profile image stored for this registration.",
    };

    if (targetRecord.image_url) {
      const publicId = deriveCloudinaryPublicId(targetRecord.image_url);
      cloudinaryOutcome.publicId = publicId;
      if (!publicId) {
        cloudinaryOutcome.status = "unrecognized";
        cloudinaryOutcome.message =
          "Stored image URL is not a Cloudinary asset. Delete manually if needed.";
      } else if (!CLOUDINARY_ENABLED) {
        cloudinaryOutcome.status = "disabled";
        cloudinaryOutcome.message =
          "Cloudinary credentials missing; image removal skipped.";
      } else {
        try {
          const destroyResult = await cloudinary.uploader.destroy(publicId, {
            invalidate: true,
          });
          const destroyOutcome = destroyResult?.result;
          if (destroyOutcome === "ok") {
            cloudinaryOutcome.status = "deleted";
            cloudinaryOutcome.message = "Profile image removed from Cloudinary.";
          } else if (destroyOutcome === "not found") {
            cloudinaryOutcome.status = "not_found";
            cloudinaryOutcome.message =
              "Cloudinary image already removed or missing.";
          } else {
            throw new Error(
              `Unexpected Cloudinary response: ${destroyOutcome || "unknown"}`,
            );
          }
        } catch (cloudError) {
          await dbClient.query("ROLLBACK");
          transactionStarted = false;
          console.error("[DELETE_REG] Cloudinary deletion failed", cloudError);
          return {
            statusCode: 502,
            body: JSON.stringify({
              error: "Failed to delete Cloudinary profile image.",
              details: cloudError.message,
            }),
          };
        }
      }
    }

    const { rows: deletedRows } = await dbClient.query(
      `DELETE FROM registrations WHERE reg_id = $1 RETURNING reg_id, name;`,
      [normalizedRegistrationId],
    );

    await dbClient.query("COMMIT");
    transactionStarted = false;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Registration deleted successfully.",
        registrationId: deletedRows[0]?.reg_id || normalizedRegistrationId,
        cloudinary: cloudinaryOutcome,
      }),
    };
  } catch (error) {
    console.error("Error in delete-registration function:", error);
    if (transactionStarted && dbClient) {
      try {
        await dbClient.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[DELETE_REG] Failed to rollback transaction", rollbackError);
      }
    }
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