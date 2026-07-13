// FoxEngine PWA — Manifest dynamique par boutique (Cloudflare Pages Function)
//
// Route : GET /manifest.webmanifest?code=BT-503721
//
// Ce endpoint génère un manifest JSON personnalisé en récupérant le branding
// boutique (nom, couleurs, icône d'app) via la RPC publique Supabase
// rpc_pwa_branding (non sensible, sans signature).
//
// En cas d'erreur (code absent, Supabase injoignable, etc.) on retourne un
// manifest fallback FoxEngine générique pour ne jamais casser la PWA.

const SUPA_URL = 'https://cxbyblnzlivnadyhdwtz.supabase.co';
const SUPA_KEY = 'sb_publishable_XjTXt9N9A-zBhu6lZfrxXw_Hxwfi3wp';
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

function manifestHeaders() {
  return {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': 'public, max-age=' + CACHE_TTL_SECONDS +
                     ', s-maxage=' + CACHE_TTL_SECONDS,
    'Access-Control-Allow-Origin': '*'
  };
}

// Manifest fallback FoxEngine (servi si pas de code ou erreur Supabase)
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

// Manifest enrichi avec le branding boutique (Supabase)
function buildBoutiqueManifest(code, boutique) {
  const m = buildFallbackManifest(code);
  if (!boutique || typeof boutique !== 'object') return m;

  // Nom boutique
  const enseigne = String(boutique.enseigne || boutique.nom || '').trim();
  if (enseigne) {
    m.name = enseigne;
    m.short_name = enseigne.length > 12 ? enseigne.substring(0, 12) : enseigne;
  }

  // Couleurs
  if (boutique.couleurPrimaire) {
    m.theme_color = boutique.couleurPrimaire;
  }
  if (boutique.couleurSecondaire) {
    m.background_color = boutique.couleurSecondaire;
  } else if (boutique.couleurPrimaire) {
    m.background_color = boutique.couleurPrimaire;
  }

  // Icône d'app carrée par boutique (champ dédié appIcon192/512 servi par la RPC
  // branding). C'est une VRAIE image carrée (générée à partir du logo), hébergée
  // côté PWA — Android Chrome exige des icônes carrées, sinon il retombe sur
  // l'icône générique. On ne dépend plus du redimensionnement Wix (disparu).
  const icon192 = (typeof boutique.appIcon192 === 'string') ? boutique.appIcon192.trim() : '';
  const icon512 = (typeof boutique.appIcon512 === 'string') ? boutique.appIcon512.trim() : '';

  if (icon512 || icon192) {
    const s192 = icon192 || icon512;
    const s512 = icon512 || icon192;
    const boutiqueIcons = [
      { src: s192, sizes: '192x192', type: detectMimeFromUrl(s192), purpose: 'any' },
      { src: s512, sizes: '512x512', type: detectMimeFromUrl(s512), purpose: 'any' },
      { src: s512, sizes: '512x512', type: detectMimeFromUrl(s512), purpose: 'maskable' }
    ];
    m.icons = boutiqueIcons.concat(m.icons);
  }
  // Sinon : icônes FoxEngine génériques du fallback (autres enseignes sans icône)

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
    // Branding boutique via RPC publique Supabase (logo, couleurs, icône, enseigne).
    const res = await fetch(SUPA_URL + '/rest/v1/rpc/rpc_pwa_branding', {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_code: code })
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify(buildFallbackManifest(code)),
        { headers: manifestHeaders() }
      );
    }

    // rpc_pwa_branding renvoie directement { found, boutique:{...} }
    const data = await res.json();
    const boutique = (data && data.found === true) ? data.boutique : null;
    const manifest = buildBoutiqueManifest(code, boutique);

    return new Response(
      JSON.stringify(manifest),
      { headers: manifestHeaders() }
    );
  } catch (e) {
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
