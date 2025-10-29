const postgres = require("postgres");

let sqlClient = null;
function getSqlClient() {
    if (sqlClient) return sqlClient;
    sqlClient = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });
    return sqlClient;
}

const colsCache = { ts: 0, cols: null, ttl: 60 * 1000 };
async function getAttendeeCols(sql) {
    const now = Date.now();
    if (colsCache.cols && (now - colsCache.ts) < colsCache.ttl) return colsCache.cols;
    const colRows = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'attendees'`;
    const cols = new Set(colRows.map((r) => r.column_name));
    colsCache.ts = Date.now();
    colsCache.cols = cols;
    return cols;
}

async function withRetries(fn, attempts = 3, baseDelay = 120) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
        try { return await fn(); } catch (err) {
            lastErr = err;
            const code = err && err.code ? err.code : null;
            if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ECONNRESET') {
                const jitter = Math.floor(Math.random() * 100);
                const delay = baseDelay * Math.pow(2, i) + jitter;
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "Method Not Allowed" }),
        };
    }

    try {
        const body = JSON.parse(event.body || "{}");
        const { registration_id } = body;
        if (!registration_id)
            return {
                statusCode: 400,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "registration_id required" }),
            };

        // Require Authorization: Bearer <password> OR a short-lived token
        const authHeader =
            (event.headers &&
                (event.headers.authorization || event.headers.Authorization)) ||
            "";
        const expected = process.env.STAFF_LOGIN_PASSWORD || "";
        const tokenSecret = process.env.STAFF_TOKEN_SECRET || "";
        function verifyToken(token) {
            try {
                if (!tokenSecret) return false;
                const crypto = require("crypto");
                const parts = token.split(".");
                if (parts.length !== 3) return false;
                const [h64, p64, sig] = parts;
                const signingInput = `${h64}.${p64}`;
                const expectedSig = crypto
                    .createHmac("sha256", tokenSecret)
                    .update(signingInput)
                    .digest("base64")
                    .replace(/=/g, "")
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_");
                const a = Buffer.from(expectedSig);
                const b = Buffer.from(sig);
                if (a.length !== b.length) return false;
                if (!crypto.timingSafeEqual(a, b)) return false;
                const payload = JSON.parse(Buffer.from(p64, "base64").toString("utf8"));
                const now = Math.floor(Date.now() / 1000);
                if (!payload.exp || payload.exp < now) return false;
                return true;
            } catch (e) {
                return false;
            }
        }
        const bearer = authHeader.startsWith("Bearer ")
            ? authHeader.split(" ")[1]
            : null;
        if (!bearer || (bearer !== expected && !verifyToken(bearer)))
            return {
                statusCode: 401,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "Unauthorized" }),
            };

        const sql = getSqlClient();
        const cols = await getAttendeeCols(sql);

        let regCol = null;
        if (cols.has("registration_id")) regCol = "registration_id";
        else if (cols.has("pass_id")) regCol = "pass_id";
        else {
            for (const c of cols) { const lc = c.toLowerCase(); if (lc.includes("pass") || lc.includes("reg")) { regCol = c; break; } }
        }
        if (!regCol) return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "No registration id column found" }) };

        let del;
        if (regCol === "registration_id") {
            del = await withRetries(() => sql`DELETE FROM attendees WHERE registration_id = ${registration_id} RETURNING 1`);
        } else if (regCol === "pass_id") {
            del = await withRetries(() => sql`DELETE FROM attendees WHERE pass_id = ${registration_id} RETURNING 1`);
        } else {
            return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Unsupported registration id column: " + regCol }) };
        }
        if (!del || del.length === 0) return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Attendee not found" }) };

        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true }) };
    } catch (error) {
        console.error("delete-attendee error:", error);
        if (
            error &&
            (error.code === "ECONNREFUSED" ||
                error.code === "ETIMEDOUT" ||
                error.code === "EHOSTUNREACH")
        ) {
            return {
                statusCode: 503,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "Database unreachable" }),
            };
        }
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "Internal Server Error" }),
        };
    }
};
