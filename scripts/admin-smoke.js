/*
Simple smoke test script for admin endpoints.
Requires Node 18+ (global fetch) or an environment with fetch available.
Set environment variables: BASE_URL (e.g., http://localhost:8888), STAFF_LOGIN_PASSWORD
Usage: node scripts/admin-smoke.js
*/

const BASE = process.env.BASE_URL || 'http://localhost:8888';
const PASSWORD = process.env.STAFF_LOGIN_PASSWORD || '';
if (!PASSWORD) {
  console.error('Please set STAFF_LOGIN_PASSWORD env var before running smoke tests.');
  process.exit(1);
}

async function ok(res) {
  console.log(res.status, res.statusText);
  try { const j = await res.json(); console.log(JSON.stringify(j, null, 2)); } catch(e) { const t = await res.text(); console.log(t); }
}

(async () => {
  try {
    console.log('Checking get-stats...');
    const stats = await fetch(`${BASE}/.netlify/functions/get-stats`, { headers: { Authorization: `Bearer ${PASSWORD}` } });
    await ok(stats);

    console.log('\nChecking search-attendees (page=1)...');
    const search = await fetch(`${BASE}/.netlify/functions/search-attendees?query=&page=1&limit=5`, { headers: { Authorization: `Bearer ${PASSWORD}` } });
    await ok(search);

    console.log('\nChecking get-system-status...');
    const status = await fetch(`${BASE}/.netlify/functions/get-system-status`, { headers: { Authorization: `Bearer ${PASSWORD}` } });
    await ok(status);

    console.log('\nAttempting to update system status (toggle)');
    const toggle = await fetch(`${BASE}/.netlify/functions/update-system-status`, { method: 'POST', headers: { Authorization: `Bearer ${PASSWORD}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'registration_enabled', value: false }) });
    await ok(toggle);

    console.log('\nSmoke test complete.');
  } catch (err) {
    console.error('Smoke test failed:', err);
    process.exit(2);
  }
})();
