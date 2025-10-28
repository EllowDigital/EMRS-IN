// Service Worker (sw.js)

const CACHE_NAME = 'epass-verify-shell-v1.2'; // Version updated
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/verify.html',
    '/offline.html', // <-- Added offline fallback page
    '/manifest.json',
    // Core CSS/JS Libraries
    'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.8/css/bootstrap.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.8/js/bootstrap.bundle.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css', // <-- Added Font Awesome
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.5.2/qrcode.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    // Fonts
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;700;900&display=swap',
    // Core Icons/Favicons
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

// --- FETCH: Serve from cache, but use network-first for HTML and API ---
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const request = event.request;

    // 1. API Calls: Network-only, with a JSON error response on failure.
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request)
            .catch(err => {
                console.error('[SW] API Fetch Failed:', request.url, err);
                return new Response(JSON.stringify({
                    message: 'You are offline. The operation could not be completed.'
                }), {
                    status: 503, // Service Unavailable
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
            })
        );
        return;
    }

    // 2. HTML Navigation: Network-first, falling back to cache, then to offline page.
    // This ensures users get the latest page version if online.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
            .then(response => {
                // If fetch is successful, cache the new response for next time
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // Network failed, try to serve from cache
                return caches.match(request)
                    .then(cachedResponse => {
                        // Return from cache or show the offline page if not cached
                        return cachedResponse || caches.match('/offline.html');
                    });
            })
        );
        return;
    }

    // 3. Static Assets (CSS, JS, Fonts, Images): Cache-first, falling back to network.
    // This is fast and efficient for assets that don't change often.
    event.respondWith(
        caches.match(request)
        .then(cachedResponse => {
            // Return from cache if found
            if (cachedResponse) {
                return cachedResponse;
            }
            // Not in cache, fetch from network and cache it for next time
            return fetch(request).then(networkResponse => {
                // Don't cache opaque or error responses
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'error') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(request, responseToCache);
                });
                return networkResponse;
            });
        })
    );
});