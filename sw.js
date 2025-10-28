// Service Worker (sw.js)

const CACHE_NAME = 'epass-verify-shell-v1.1'; // <-- Added version
const ASSETS_TO_CACHE = [
    '/', // Cache the root (usually index.html)
    '/index.html', // Explicitly cache index.html
    '/verify.html',
    '/manifest.json', // Cache the manifest file
    // Core CSS/JS Libraries
    'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.8/css/bootstrap.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.8/js/bootstrap.bundle.min.js',
    'https://unpkg.com/html5-qrcode', // QR Scanner
    'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.5.2/qrcode.min.js', // QR Generator (for index.html)
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', // E-Pass Download (for index.html)
    // Font
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    // Core Icons/Favicons (add all essential ones)
    '/assets/favicon/favicon.ico',
    '/assets/favicon/favicon-16x16.png',
    '/assets/favicon/favicon-32x32.png',
    '/assets/favicon/apple-touch-icon.png',
    '/assets/favicon/android-chrome-192x192.png',
    '/assets/favicon/android-chrome-512x512.png'
];

// --- INSTALL: Cache the app shell ---
self.addEventListener('install', event => {
    console.log('[SW] Install');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching app shell');
                // Use addAll for atomic caching (all succeed or all fail)
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .catch(err => {
                console.error('[SW] Caching failed during install:', err);
            })
            .then(() => {
                // Force the waiting service worker to become the active service worker.
                // Helps ensure updates take effect sooner.
                return self.skipWaiting();
            })
    );
});

// --- ACTIVATE: Clean up old caches ---
self.addEventListener('activate', event => {
    console.log('[SW] Activate');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    // Delete any caches that aren't the current CACHE_NAME
                    if (cache !== CACHE_NAME) {
                        console.log('[SW] Clearing old cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => {
            // Tell the active service worker to take control of the page immediately.
            return self.clients.claim();
        })
    );
});

// --- FETCH: Serve from cache, but always fetch API calls ---
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // 1. API Calls: Network-first strategy (Always try network)
    // This ensures data like check-in status is always fresh.
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .catch(err => {
                    // Network failed, return a standard error response
                    console.error('[SW] API Fetch Failed:', event.request.url, err);
                    return new Response(JSON.stringify({ message: 'Network error: Could not connect to API.' }), {
                        status: 503, // Service Unavailable
                        headers: { 'Content-Type': 'application/json' }
                    });
                })
        );
        return; // Don't process further for API calls
    }

    // 2. App Shell / Assets: Cache-first, falling back to network ("Cache, falling back to Network" strategy)
    // Serve from cache if available, otherwise fetch from network and cache it.
    // Good for static assets that don't change often.
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // Return cached response if found
                if (cachedResponse) {
                    // console.log('[SW] Serving from cache:', event.request.url);
                    return cachedResponse;
                }

                // Not in cache, fetch from network
                // console.log('[SW] Fetching from network:', event.request.url);
                return fetch(event.request).then(
                    networkResponse => {
                        // Check if we received a valid response
                        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && networkResponse.type !== 'cors') {
                            return networkResponse; // Don't cache invalid responses
                        }

                        // IMPORTANT: Clone the response. A response is a stream
                        // and because we want the browser to consume the response
                        // as well as the cache consuming the response, we need
                        // to clone it so we have two streams.
                        const responseToCache = networkResponse.clone();

                        caches.open(CACHE_NAME)
                            .then(cache => {
                                // Cache the new response
                                cache.put(event.request, responseToCache);
                            });

                        return networkResponse; // Return the original network response
                    }
                ).catch(err => {
                    // Network fetch failed (e.g., offline)
                    console.error('[SW] Network fetch failed:', event.request.url, err);
                    // Optionally, you could return a custom offline page here
                    // return caches.match('/offline.html'); 
                });
            })
    );
});