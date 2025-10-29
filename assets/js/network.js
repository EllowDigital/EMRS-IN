// Shared network utilities: retry, timeout, circuit breaker, and SWR caching for GET
(function () {
    'use strict';

    // Simple circuit breaker state (in-memory). For multi-tab, consider BroadcastChannel.
    const circuit = {
        failures: 0,
        threshold: 5, // after 5 consecutive failures, open circuit
        openUntil: 0, // epoch ms until which circuit is open
        cooldownMs: 30 * 1000 // 30s cooldown
    };

    function isCircuitOpen() {
        return circuit.openUntil && Date.now() < circuit.openUntil;
    }

    function recordFailure() {
        circuit.failures += 1;
        if (circuit.failures >= circuit.threshold) {
            circuit.openUntil = Date.now() + circuit.cooldownMs;
            console.warn('[network] circuit opened until', new Date(circuit.openUntil).toISOString());
        }
    }

    function recordSuccess() {
        circuit.failures = 0;
        circuit.openUntil = 0;
    }

    // timeout helper
    function fetchWithTimeout(input, init = {}, timeout = 15000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const merged = Object.assign({}, init, { signal: controller.signal });
        return fetch(input, merged).finally(() => clearTimeout(id));
    }

    // jitter helper
    function jitter(ms) { return Math.floor(ms * (0.5 + Math.random() * 0.5)); }

    // Stale-while-revalidate: if GET and cached, return cache immediately then refresh in background
    // Accepts an optional `init` param so Authorization headers and other options are forwarded to the network fetch.
    async function swrGet(url, init = {}, cacheName = 'epass-swr-v1') {
        try {
            const cache = await caches.open(cacheName);
            const cached = await cache.match(url);
            // Start network fetch regardless to refresh cache; forward init (headers etc.)
            const networkPromise = fetch(url, init).then(async (res) => {
                if (res && res.ok) {
                    try { await cache.put(url, res.clone()); } catch (e) { /* ignore */ }
                }
                return res;
            }).catch(() => null);

            if (cached) {
                // Return cached response immediately and also kick off background refresh
                networkPromise.catch(() => { });
                return cached.clone();
            }
            // no cache, wait for network
            const net = await networkPromise;
            if (net) return net;
            return new Response(null, { status: 503, statusText: 'Service Unavailable' });
        } catch (e) {
            console.warn('[network] swrGet error', e);
            return fetch(url, init).catch(() => new Response(null, { status: 503 }));
        }
    }

    async function fetchWithRetry(url, options = {}) {
        // options: { retries, timeout, backoff, cache (swr|cache-first|no-cache), acceptCachedOnFail }
        const method = (options.method || (options.headers && options.headers['method']) || 'GET').toUpperCase();
        const retries = typeof options.retries === 'number' ? options.retries : 3;
        const timeout = typeof options.timeout === 'number' ? options.timeout : 15000;
        const backoff = typeof options.backoff === 'number' ? options.backoff : 500;
        const cacheMode = options.cache || 'no-cache';

        // If circuit is open, short-circuit
        if (isCircuitOpen()) {
            console.warn('[network] circuit open; failing fast for', url);
            // for GET, try to return cache if available
            if (method === 'GET' && (options.acceptCachedOnFail !== false)) {
                try { return await swrGet(url); } catch (_) { return new Response(null, { status: 503 }); }
            }
            return Promise.reject(new Error('CircuitOpen'));
        }

        // If requested cache-first SWR: pass the options so swrGet can include headers (Authorization)
        if (method === 'GET' && cacheMode === 'swr') {
            try { return await swrGet(url, options); } catch (e) { /* fallthrough to retry below */ }
        }

        let attempt = 0;
        let lastErr = null;
        while (attempt <= retries) {
            try {
                const resp = await fetchWithTimeout(url, options, timeout);
                if (!resp.ok && (resp.status === 503 || resp.status === 504)) {
                    throw new Error(`HTTP ${resp.status}`);
                }
                recordSuccess();
                return resp;
            } catch (err) {
                lastErr = err;
                attempt += 1;
                recordFailure();
                if (attempt > retries) break;
                const wait = jitter(backoff * Math.pow(2, attempt - 1));
                await new Promise(r => setTimeout(r, wait));
            }
        }

        // final failure: for GET and acceptCachedOnFail, return cached response
        if (method === 'GET' && (options.acceptCachedOnFail !== false)) {
            try {
                const cache = await caches.open('epass-swr-v1');
                const match = await cache.match(url);
                if (match) return match.clone();
            } catch (e) { /* ignore */ }
        }

        return Promise.reject(lastErr || new Error('NetworkError'));
    }

    // Helper to fetch JSON with automatic retries and parsing
    async function fetchJson(url, options = {}) {
        const resp = await fetchWithRetry(url, options);
        // If service worker returned a synthetic Response for offline, ensure JSON
        const text = await resp.text().catch(() => null);
        try { return new Response(text, { status: resp.status, headers: resp.headers }); } catch (e) { /* ignore */ }
        return resp;
    }

    // Expose helpers globally for legacy code
    window.__network = window.__network || {};
    window.__network.fetchWithRetry = fetchWithRetry;
    window.__network.fetchWithTimeout = fetchWithTimeout;
    window.__network.fetchJson = fetchJson;
    // Also expose short names for existing code using retryFetch
    window.retryFetch = fetchWithRetry;
    window.fetchWithRetry = fetchWithRetry;
    window.fetchWithTimeout = fetchWithTimeout;

    console.info('[network] network helpers loaded');
})();
