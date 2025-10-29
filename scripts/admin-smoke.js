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

async function tryJson(res) {
  console.log(res.status, res.statusText);
  try { const j = await res.json(); console.log(JSON.stringify(j, null, 2)); return j; } catch (e) { const t = await res.text(); console.log(t); return null; }
}

async function fetchWithRetries(url, opts = {}, retries = 3, backoff = 300) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 503 && i < retries) {
        console.warn(`${url} returned 503, retrying (${i + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, backoff * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries) throw err;
      console.warn(`${url} fetch failed, retrying (${i + 1}/${retries})...`, err.message || err);
      await new Promise(r => setTimeout(r, backoff * (i + 1)));
    }
  }
}

(async () => {
  try {
    // First, exchange password for a token (preferred)
    console.log('Requesting staff token...');
    let authValue = PASSWORD; // fallback to legacy
    try {
      const loginRes = await fetch(`${BASE}/.netlify/functions/staff-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD })
      });
      if (loginRes.ok) {
        const body = await loginRes.json();
        if (body && body.token) {
          authValue = body.token;
          console.log('Received token from staff-login; using token for subsequent requests.');
        } else {
          console.log('staff-login returned OK but no token; falling back to raw password.');
        }
      } else {
        const txt = await loginRes.text();
        console.warn('staff-login failed:', loginRes.status, txt);
        console.warn('Falling back to legacy password in Authorization header.');
      }
    } catch (e) {
      console.warn('Error calling staff-login, falling back to legacy password:', e.message || e);
    }

    const headers = { Authorization: `Bearer ${authValue}` };

    console.log('\nChecking get-stats...');
    const stats = await fetchWithRetries(`${BASE}/.netlify/functions/get-stats`, { headers });
    await tryJson(stats);

    console.log('\nChecking search-attendees (page=1)...');
    const search = await fetchWithRetries(`${BASE}/.netlify/functions/search-attendees?query=&page=1&limit=5`, { headers });
    await tryJson(search);

    console.log('\nChecking get-system-status...');
    const status = await fetchWithRetries(`${BASE}/.netlify/functions/get-system-status`, { headers });
    const statusBody = await tryJson(status);

    console.log('\nAttempting to update system status (toggle)');
    const toggle = await fetchWithRetries(`${BASE}/.netlify/functions/update-system-status`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'registration_enabled', value: !!(statusBody && statusBody.registration_enabled) ? false : true }) });
    await tryJson(toggle);

    console.log('\nSmoke test complete.');
  } catch (err) {
    console.error('Smoke test failed:', err);
    process.exit(2);
  }
})();
