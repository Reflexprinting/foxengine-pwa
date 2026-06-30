// ════════════════════════════════════════════════════════════════════
// FoxEngine PWA — Wrapper API  (VERSION SUPABASE — sortie de Wix)
// ════════════════════════════════════════════════════════════════════
// Remplace l'ancien api.js qui appelait www.my-foxengine.com/_functions.
// Cette version appelle directement Supabase (RPC rpc_pwa_card) et
// ADAPTE la réponse au format attendu par ma-carte.js (INCHANGÉ).
//
// Interface publique conservée à l'identique :
//   window.FoxApi.getPublicClientData(code) -> Promise<dataAdaptée>
//   window.FoxApi.signalerAide(payload)     -> Promise (best-effort)
//
// PRÉREQUIS HTML : charger le SDK Supabase AVANT ce fichier :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//
// SÉCURITÉ — signature obligatoire :
//   rpc_pwa_card exige p_sig = HMAC(code) calculé EN BASE (secret jamais
//   exposé). Le front NE calcule PAS la signature : il la lit dans l'URL
//   (?code=XXX&sig=YYY). Le lien signé est généré par le backend FE au
//   moment de l'envoi (SMS/push). Sans sig valide -> "LIEN_INVALIDE".
// ════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // --- Config Supabase (clé publishable = sans danger côté front) ---
  var SUPABASE_URL = 'https://cxbyblnzlivnadyhdwtz.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_XjTXt9N9A-zBhu6lZfrxXw_Hxwfi3wp';

  if (typeof supabase === 'undefined' || !supabase.createClient) {
    console.error('[FoxApi] SDK Supabase non chargé. Ajouter le <script> supabase-js avant api.js');
  }
  var sb = (typeof supabase !== 'undefined' && supabase.createClient)
    ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

  // --- Lecture de la signature dans l'URL (?sig= ou ?s=) ---
  function readSigFromUrl() {
    try {
      var p = new URLSearchParams(window.location.search);
      return (p.get('sig') || p.get('s') || '').trim();
    } catch (_) { return ''; }
  }

  // ──────────────────────────────────────────────────────────────────
  // ADAPTATEUR : réponse rpc_pwa_card -> format attendu par ma-carte.js
  // ──────────────────────────────────────────────────────────────────
  // L'app lit (ancien format Wix) :
  //   data.nom, data.prenom, data.code_client, data.boutique,
  //   data.cumul, data.achatsCycle, data.seuilBon, data.montantBon,
  //   data.resteAvantBon, data.progressPct, data.bons, data.passages,
  //   data.infos, data.oneSignalAppId
  // rpc_pwa_card renvoie :
  //   { found, client:{...}, parametres:{...}, onesignal_app_id,
  //     bons_actifs:[...], infos_boutique:{...}, historique:[...],
  //     inbox:[...], boutique_branding:{...} }
  function adapt(r) {
    if (!r || r.found !== true) {
      var code = (r && r.error) || 'CLIENT_NOT_FOUND';
      var err = new Error(
        code === 'LIEN_INVALIDE' ? 'Lien invalide ou expiré'
        : code === 'CLIENT_INCONNU' ? 'Carte introuvable'
        : 'Données indisponibles'
      );
      err.code = (code === 'CLIENT_INCONNU') ? 'CLIENT_NOT_FOUND' : code;
      throw err;
    }

    var c = r.client || {};
    var params = r.parametres || {};
    var brand = r.boutique_branding || {};

    // Cumul du cycle en cours : achats_cycle (compteur fidélité)
    var cumul = Number(c.achats_cycle || 0);
    var seuilBon = Number(params.seuil_achat || params.seuilBon || 0);
    var montantBon = Number(params.montant_bon || params.montantBon || 0);
    var reste = seuilBon > 0 ? Math.max(0, seuilBon - cumul) : 0;
    var progress = seuilBon > 0 ? Math.min(100, Math.round((cumul / seuilBon) * 100)) : 0;

    // boutique : l'app passe data.boutique à FoxTheme.apply() et setAppleTouchIcon().
    // On fournit un objet de branding compatible (logo + couleurs + nom).
    var boutique = {
      boutiqueId: c.boutique || '',
      nom: brand.enseigne || c.boutique || '',
      enseigne: brand.enseigne || '',
      logoUrl: brand.logo_url || '',
      couleurPrimaire: brand.couleur_primaire || '#0B3D91',
      couleurSecondaire: brand.couleur_secondaire || '#F26A21',
      secteur: brand.secteur || ''
    };

    // bons : [{code, montant, date_expiration}] -> conservé tel quel (l'app lit data.bons)
    var bons = Array.isArray(r.bons_actifs) ? r.bons_actifs : [];

    // passages : l'app lit data.passages -> on mappe l'historique ledger
    var passages = Array.isArray(r.historique) ? r.historique.map(function (h) {
      return {
        type: h.type,
        montant: h.montant,
        cumul_apres: h.cumul_apres,
        ref_bon_code: h.ref_bon_code,
        date: h.date
      };
    }) : [];

    return {
      // identité client
      nom: c.nom || '',
      prenom: c.prenom || '',
      code_client: c.code_client || '',
      boutique: boutique,

      // fidélité
      cumul: cumul,
      achatsCycle: cumul,
      seuilBon: seuilBon,
      montantBon: montantBon,
      resteAvantBon: reste,
      progressPct: progress,
      totalAchats: Number(c.total_achats || 0),

      // listes
      bons: bons,
      passages: passages,

      // infos boutique (horaires, promos…) — l'app lit data.infos
      infos: r.infos_boutique || null,

      // inbox push (si l'app l'utilise un jour)
      inbox: Array.isArray(r.inbox) ? r.inbox : [],

      // push
      oneSignalAppId: r.onesignal_app_id || null
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // API publique
  // ──────────────────────────────────────────────────────────────────
  async function getPublicClientData(code) {
    if (!sb) {
      var e0 = new Error('Service indisponible'); e0.code = 'SERVER_ERROR'; throw e0;
    }
    var sig = readSigFromUrl();
    var resp = await sb.rpc('rpc_pwa_card', { p_code: code, p_sig: sig });
    if (resp.error) {
      console.error('[FoxApi] rpc_pwa_card error', resp.error);
      var e = new Error('Impossible de charger votre carte');
      e.code = 'SERVER_ERROR';
      throw e;
    }
    return adapt(resp.data);
  }

  // Best-effort : enregistrement device push via RPC Supabase (ne bloque jamais la PWA)
  async function signalerAide(payload) {
    // Conservé pour compat : log non bloquant. Pas d'équivalent critique.
    try { console.info('[FoxApi] signalerAide (noop Supabase)', payload); } catch (_) {}
    return { success: true };
  }

  // Enregistrement device push -> RPC Supabase rpc_register_device (best-effort).
  async function registerDevice(payload) {
    if (!sb) return { ok: false };
    try {
      var resp = await sb.rpc('rpc_register_device', { p: payload || {} });
      if (resp.error) return { ok: false, error: resp.error.message };
      return { ok: true, data: resp.data };
    } catch (e) { return { ok: false, error: String(e) }; }
  }

  // INTERCEPTEUR : ma-carte.js fait des fetch() vers .../_functions/registerPushDevice (Wix).
  // On les détourne vers Supabase, sans modifier ma-carte.js (anti-régression).
  var _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (url.indexOf('/_functions/registerPushDevice') >= 0) {
        var body = {};
        try { body = (init && init.body) ? JSON.parse(init.body) : {}; } catch (_) {}
        return registerDevice(body).then(function (r) {
          return new Response(JSON.stringify({ success: !!r.ok, data: r.data || null, error: r.error || null }),
            { status: r.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
        });
      }
    } catch (_) {}
    return _origFetch(input, init);
  };

  window.FoxApi = {
    getPublicClientData: getPublicClientData,
    signalerAide: signalerAide,
    registerDevice: registerDevice
  };
})();
