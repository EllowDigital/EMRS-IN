const postgres = require('postgres');

exports.handler = async function(event, context) {
  let sql;
  try {
  // Use a short connect timeout so public requests fail fast when DB is down
  sql = postgres(process.env.DATABASE_URL, { ssl: 'require', connect_timeout: 5, max: 1 });
  const configResult = await sql`SELECT key, value FROM system_config WHERE key IN ('registration_enabled', 'maintenance_mode')`;
    
    const status = {
      registration_enabled: configResult.find(c => c.key === 'registration_enabled')?.value === 'true',
      maintenance_mode: configResult.find(c => c.key === 'maintenance_mode')?.value === 'true',
    };

    return {
      statusCode: 200,
      body: JSON.stringify(status)
    };
  } catch (error) {
    console.error("Error fetching public status:", error);
    // If DB is unreachable, return maintenance_mode true as a conservative fail-safe
    if (error && error.code && (error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH')) {
      return {
        statusCode: 503,
        body: JSON.stringify({
          registration_enabled: false,
          maintenance_mode: true,
          error: "Database unreachable. Assuming maintenance mode."
        })
      };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        registration_enabled: false,
        maintenance_mode: true,
        error: "Could not retrieve system status."
      })
    };
  } finally {
    if (sql) {
      await sql.end();
    }
  }
};
