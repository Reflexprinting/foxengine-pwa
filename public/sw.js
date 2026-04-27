// FoxEngine PWA Service Worker — Phase 2 squelette
// Phase 4 : ajoutera importScripts OneSignal + cache offline

const SW_VERSION = 'fox-pwa-v0.1.0';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

// Passthrough — minimum requis par Chrome pour PWA installable
self.addEventListener('fetch', (event) => {
  // Pas de cache offline en Phase 2 — on laisse passer
  return;
});
