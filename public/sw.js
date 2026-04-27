// FoxEngine PWA — Service Worker minimal passthrough
// Phase 4 : ajouter OneSignal natif + cache offline

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Passthrough pur — laisse le navigateur gérer
  return;
});
