const postgres = require('postgres');

exports.handler = async function(event, context) {
  let sql;
  try {
    sql = postgres(process.env.NEON_DATABASE_URL, { ssl: 'require' });
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
    // Return a fail-safe status
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
