const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const handlerPath = path.resolve(__dirname, "../netlify/functions/search-user.js");
const utilsPath = require.resolve("../netlify/functions/utils.js");
const originalUtilsModule = require.cache[utilsPath];

const clearCaches = () => {
    delete require.cache[handlerPath];
    delete require.cache[utilsPath];
};

test.after(() => {
    clearCaches();
    if (originalUtilsModule) {
        require.cache[utilsPath] = originalUtilsModule;
    }
});

const loadHandler = ({ rows = [], onQuery, onRelease, queryError } = {}) => {
    clearCaches();

    const mockClient = {
        query: async (sql, params) => {
            if (typeof onQuery === "function") {
                onQuery(sql, params);
            }
            if (queryError) {
                throw queryError;
            }
            const resolvedRows = typeof rows === "function" ? rows(sql, params) : rows;
            return { rows: resolvedRows };
        },
        release: () => {
            if (typeof onRelease === "function") {
                onRelease();
            }
        },
    };

    require.cache[utilsPath] = {
        exports: {
            pool: {
                connect: async () => mockClient,
            },
        },
    };

    // eslint-disable-next-line global-require
    return require(handlerPath).handler;
};

test("rejects requests without valid admin key", async () => {
    process.env.EXPORT_SECRET_KEY = "super-secret";
    const handler = loadHandler();

    const response = await handler({
        headers: {},
        httpMethod: "GET",
        queryStringParameters: {},
    });

    assert.equal(response.statusCode, 401);
    assert.equal(
        response.body,
        JSON.stringify({ error: "Unauthorized" }),
        "Should include unauthorized message",
    );
});

test("rejects unsupported HTTP methods", async () => {
    process.env.EXPORT_SECRET_KEY = "super-secret";
    const handler = loadHandler();

    const response = await handler({
        headers: { "x-admin-key": "super-secret" },
        httpMethod: "POST",
        queryStringParameters: { registrationId: "abc" },
    });

    assert.equal(response.statusCode, 405);
    assert.equal(
        response.body,
        JSON.stringify({ error: "Method Not Allowed" }),
    );
});

test("requires at least one query parameter", async () => {
    process.env.EXPORT_SECRET_KEY = "super-secret";
    const handler = loadHandler();

    const response = await handler({
        headers: { "x-admin-key": "super-secret" },
        httpMethod: "GET",
        queryStringParameters: {},
    });

    assert.equal(response.statusCode, 400);
    assert.equal(
        response.body,
        JSON.stringify({ error: "phone or registrationId is required." }),
    );
});

test("returns mapped registration when lookup succeeds", async () => {
    process.env.EXPORT_SECRET_KEY = "super-secret";
    let releaseCalled = false;
    let capturedSql;
    let capturedParams;
    const handler = loadHandler({
        rows: [{ reg_id: "EMRS-42", pay_id: "PAY-9", name: "Taylor" }],
        onRelease: () => {
            releaseCalled = true;
        },
        onQuery: (sql, params) => {
            capturedSql = sql;
            capturedParams = params;
        },
    });

    const response = await handler({
        headers: { "x-admin-key": "super-secret" },
        httpMethod: "GET",
        queryStringParameters: { registrationId: "emrs-42" },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.registration_id, "EMRS-42");
    assert.equal(body.payment_id, "PAY-9");
    assert.equal(body.name, "Taylor");
    assert.ok(releaseCalled, "DB client should be released");
    assert.match(
        capturedSql,
        /SELECT \* FROM registrations WHERE \(.+\) LIMIT 1/,
        "Should query registrations table with OR clause",
    );
    assert.deepEqual(capturedParams, ["EMRS-42"]);
});

test("supports phone number lookup", async () => {
    process.env.EXPORT_SECRET_KEY = "super-secret";
    let capturedParams;
    const handler = loadHandler({
        rows: [{ reg_id: "EMRS-77", pay_id: null, phone: "999" }],
        onQuery: (_, params) => {
            capturedParams = params;
        },
    });

    const response = await handler({
        headers: { "x-admin-key": "super-secret" },
        httpMethod: "GET",
        queryStringParameters: { phone: "999" },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.registration_id, "EMRS-77");
    assert.equal(body.payment_id, null);
    assert.deepEqual(capturedParams, ["999"]);
});

test("returns 404 when no registration matches", async () => {
    process.env.EXPORT_SECRET_KEY = "super-secret";
    const handler = loadHandler({ rows: [] });

    const response = await handler({
        headers: { "x-admin-key": "super-secret" },
        httpMethod: "GET",
        queryStringParameters: { registrationId: "missing" },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(
        response.body,
        JSON.stringify({ error: "Not found" }),
    );
});

test("returns 500 when database query fails", async () => {
    process.env.EXPORT_SECRET_KEY = "super-secret";
    const handler = loadHandler({ queryError: new Error("boom") });

    const response = await handler({
        headers: { "x-admin-key": "super-secret" },
        httpMethod: "GET",
        queryStringParameters: { registrationId: "abc" },
    });

    assert.equal(response.statusCode, 500);
    assert.equal(
        response.body,
        JSON.stringify({ error: "Internal server error" }),
    );
});
