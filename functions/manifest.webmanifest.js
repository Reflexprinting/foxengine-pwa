// FoxEngine PWA — Manifest dynamique par boutique (Cloudflare Pages Function)
//
// Route : GET /manifest.webmanifest?code=BT-503721
//
// Ce endpoint génère un manifest JSON personnalisé en récupérant les données
// boutique (nom, couleurs, logoUrl) via l'endpoint Wix existant
// getPublicClientData. Aucune modification côté Wix nécessaire.
//
// En cas d'erreur (code absent, Wix injoignable, etc.) on retourne un manifest
// fallback FoxEngine générique pour ne jamais casser la PWA.

const WIX_API_BASE = 'https://www.my-foxengine.com/_functions';
const CACHE_TTL_SECONDS = 300; // 5 minutes — équilibre fraîcheur/perf

// ── HELPERS ───────────────────────────────────────────
function detectMimeFromUrl(url) {
  const lower = String(url || '').toLowerCase().split('?')[0].split('#')[0];
  if (lower.endsWith('.png'))  return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg'))  return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

// Transforme une URL Wix CMS rectangulaire en URL carrée de la taille demandée.
// Indispensable côté Android Chrome qui refuse les icônes d'app non-carrées
// et tombe en fallback sur l'icône FoxEngine générique.
//
// Pattern Wix CMS : .../v1/fill/w_NNN,h_NNN,al_c,q_85,...
// On remplace w_X,h_Y par w_<size>,h_<size> en gardant les autres paramètres.
// Si l'URL n'est pas une URL Wix CMS reconnaissable, on retourne l'original.
function makeWixSquareUrl(originalUrl, size) {
  if (!originalUrl) return originalUrl;
  try {
    if (!/static\.wixstatic\.com/.test(originalUrl)) return originalUrl;
    if (!/\/fill\/w_\d+,h_\d+/.test(originalUrl))    return originalUrl;
    return originalUrl.replace(
      /\/fill\/w_\d+,h_\d+/,
      '/fill/w_' + size + ',h_' + size
    );
  } catch (_) {
    return originalUrl;
  }
}

function manifestHeaders() {
  return {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': 'public, max-age=' + CACHE_TTL_SECONDS +
                     ', s-maxage=' + CACHE_TTL_SECONDS,
    'Access-Control-Allow-Origin': '*'
  };
}

// Manifest fallback FoxEngine (servi si pas de code ou erreur Wix)
function buildFallbackManifest(code) {
  const startUrl = code
    ? '/ma-carte.html?code=' + encodeURIComponent(code) +
      '#code=' + encodeURIComponent(code)
    : '/ma-carte.html';

  return {
    name: 'Ma Carte FoxEngine',
    short_name: 'Ma Carte',
    description: 'Carte de fidélité numérique',
    start_url: startUrl,
    id: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#0B3D91',
    background_color: '#0B3D91',
    lang: 'fr',
    dir: 'ltr',
    prefer_related_applications: false,
    icons: [
      { src: '/assets/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/assets/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}

// Manifest enrichi avec les données boutique CMS
function buildBoutiqueManifest(code, boutique) {
  const m = buildFallbackManifest(code);
  if (!boutique || typeof boutique !== 'object') return m;

  // Nom boutique
  const enseigne = String(boutique.enseigne || boutique.nom || '').trim();
  if (enseigne) {
    m.name = enseigne;
    m.short_name = enseigne.length > 12 ? enseigne.substring(0, 12) : enseigne;
  }

  // Couleurs CMS
  if (boutique.couleurPrimaire) {
    m.theme_color = boutique.couleurPrimaire;
  }
  if (boutique.couleurSecondaire) {
    m.background_color = boutique.couleurSecondaire;
  } else if (boutique.couleurPrimaire) {
    m.background_color = boutique.couleurPrimaire;
  }

  // Logo boutique → icônes carrées Wix (192/512) + fallback FoxEngine après
  // Android Chrome exige des icônes carrées 192x192 ou 512x512 pour l'app
  // installée. On génère 2 URLs carrées via le redimensionnement Wix CMS.
  const logoUrl = (typeof boutique.logoUrl === 'string') ? boutique.logoUrl.trim() : '';
  if (logoUrl) {
    const mime = detectMimeFromUrl(logoUrl);
    const url192 = makeWixSquareUrl(logoUrl, 192);
    const url512 = makeWixSquareUrl(logoUrl, 512);

    const boutiqueIcons = [
      { src: url192, sizes: '192x192', type: mime, purpose: 'any' },
      { src: url512, sizes: '512x512', type: mime, purpose: 'any' },
      { src: url512, sizes: '512x512', type: mime, purpose: 'maskable' }
    ];
    m.icons = boutiqueIcons.concat(m.icons);
  }
  // Sinon : icônes FoxEngine du fallback conservées tel quel

  return m;
}

// ── HANDLER ───────────────────────────────────────────
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = (url.searchParams.get('code') || '').trim();

  // Pas de code → fallback FoxEngine générique
  if (!code) {
    return new Response(
      JSON.stringify(buildFallbackManifest('')),
      { headers: manifestHeaders() }
    );
  }

  try {
    const wixUrl = WIX_API_BASE + '/getPublicClientData?code=' + encodeURIComponent(code);
    const wixRes = await fetch(wixUrl, {
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true }
    });

    if (!wixRes.ok) {
      // Code introuvable ou erreur Wix → fallback avec start_url + code
      return new Response(
        JSON.stringify(buildFallbackManifest(code)),
        { headers: manifestHeaders() }
      );
    }

    const data = await wixRes.json();
    const manifest = buildBoutiqueManifest(code, data && data.boutique);

    return new Response(
      JSON.stringify(manifest),
      { headers: manifestHeaders() }
    );
  } catch (e) {
    // Toute erreur réseau / parsing → fallback
    return new Response(
      JSON.stringify(buildFallbackManifest(code)),
      { headers: manifestHeaders() }
    );
  }
}

// CORS preflight (si jamais appelé en cross-origin)
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
