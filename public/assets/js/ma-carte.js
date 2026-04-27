// FoxEngine PWA — Page Ma Carte
// QR réel (qrcodejs), modal bons d'achat avec code-barres CODE128,
// offres remontées sous la carte avant la fidélité.

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const showState = (name) => {
    document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
    const el = $(name);
    if (el) el.classList.add('active');
  };

  // Clé localStorage pour mémoriser le code client.
  // Indispensable côté iPhone : quand la PWA est installée sur l'écran d'accueil,
  // iOS lance le start_url du manifest (sans la query string ?code=XXX).
  // On sauvegarde donc le code à la 1ʳᵉ visite (lien SMS) pour le retrouver
  // aux lancements suivants depuis l'icône.
  const STORAGE_KEY = 'foxengine_client_code';
  const COOKIE_NAME = 'foxengine_client_code';

  function safeStorageGet() {
    try { return (localStorage.getItem(STORAGE_KEY) || '').trim(); }
    catch (_) { return ''; }
  }
  function safeStorageSet(value) {
    try { localStorage.setItem(STORAGE_KEY, String(value || '')); }
    catch (_) { /* navigation privée, quota, etc. : on ignore silencieusement */ }
  }

  // Cookie : fallback ultime pour iOS PWA installée (le contexte standalone
  // partage parfois les cookies avec Safari, contrairement au localStorage).
  function safeCookieGet() {
    try {
      const all = String(document.cookie || '');
      const re = new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)');
      const m = all.match(re);
      return m ? decodeURIComponent(m[1]).trim() : '';
    } catch (_) { return ''; }
  }
  function safeCookieSet(value) {
    try {
      const v = encodeURIComponent(String(value || ''));
      document.cookie = COOKIE_NAME + '=' + v +
        '; max-age=31536000; path=/; SameSite=Lax; Secure';
    } catch (_) { /* ignore */ }
  }

  function getCodeFromUrl() {
    // Stratégie de résolution du code client (ordre de priorité) :
    //   1. ?code=XXX     → query string standard
    //   2. #code=XXX     → hash (plus persistant que la query string sur iOS PWA installée)
    //   3. localStorage  → fallback PC / Android / contextes non isolés
    //   4. cookie        → fallback ultime iOS standalone
    //
    // Côté SMS : les liens doivent être au format
    //   /ma-carte.html?code=XXX#code=XXX
    // pour maximiser la chance qu'iOS conserve le code après installation.

    let code = '';

    // 1. Query string ?code=XXX
    try {
      const params = new URLSearchParams(window.location.search);
      code = (params.get('code') || '').trim();
    } catch (_) { /* ignore */ }

    // 2. Hash #code=XXX  (résiste mieux aux relances PWA installée iOS)
    if (!code) {
      try {
        const rawHash = (window.location.hash || '').replace(/^#/, '');
        if (rawHash) {
          const hashParams = new URLSearchParams(rawHash);
          code = (hashParams.get('code') || '').trim();
        }
      } catch (_) { /* ignore */ }
    }

    // 3. Fallback localStorage (PC / Android Chrome / contextes non isolés)
    if (!code) {
      code = safeStorageGet();
    }

    // 4. Fallback cookie (iOS standalone : meilleur partage avec Safari)
    if (!code) {
      code = safeCookieGet();
    }

    if (code) {
      // Mémoriser pour les visites futures (utile hors iOS isolé)
      safeStorageSet(code);
      // Mémoriser aussi côté cookie (utile iOS PWA installée)
      safeCookieSet(code);

      // Réinjecter ?code=XXX dans l'URL pour cohérence (sans recharger).
      // On préserve le hash existant pour ne pas perdre #code=XXX si déjà là.
      try {
        const newUrl = window.location.pathname
                     + '?code=' + encodeURIComponent(code)
                     + (window.location.hash || '');
        window.history.replaceState(null, '', newUrl);
      } catch (_) { /* history API peut être restreint */ }
    }

    return code;
  }

  function fmtEuro(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' €';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
    } catch (_) { return '—'; }
  }

  // ── HEADER BOUTIQUE ────────────────────────────────
  // Règle FoxEngine : logoUrl est une donnée OBLIGATOIRE en CMS.
  // Si absent OU invalide (URL cassée) : on masque l'image et on affiche
  // un message discret "Logo boutique non configuré". Aucun fallback visuel
  // qui pourrait laisser croire à une vraie identité boutique.
  function renderShop(data) {
    const b = data.boutique || {};
    const logoEl = $('shop-logo');
    const fallbackEl = $('shop-logo-fallback');
    const boutiqueIdLog = b.boutiqueId || b._id || b.id || '(inconnu)';

    function showFallback(reason) {
      console.warn('[FoxEngine PWA] logoUrl obligatoire ' + reason +
        ' pour boutiqueId=' + boutiqueIdLog);
      if (logoEl) {
        logoEl.removeAttribute('src');
        logoEl.hidden = true;
      }
      if (fallbackEl) fallbackEl.hidden = false;
    }

    if (logoEl && fallbackEl) {
      const url = (typeof b.logoUrl === 'string') ? b.logoUrl.trim() : '';
      if (url) {
        // Hook erreur AVANT d'assigner src (couvre 404, CORS, image corrompue)
        logoEl.onerror = function () {
          logoEl.onerror = null;
          showFallback('invalide (chargement échoué)');
        };
        logoEl.onload = function () { logoEl.hidden = false; };
        logoEl.hidden = false;
        fallbackEl.hidden = true;
        logoEl.src = url;
      } else {
        showFallback('absent');
      }
    }

    $('shop-name').textContent = b.enseigne || b.nom || '';
    $('shop-city').textContent = [b.codePostal, b.ville].filter(Boolean).join(' ');
  }

  // ── CARTE FIDÉLITÉ + CODE-BARRES CODE128 (scan douchette caisse) ──
  // CODE128 = code-barres 1D linéaire, lisible par toutes les douchettes
  // laser de caisse (contrairement au QR qui exige une caméra 2D).
  function renderCard(data) {
    const fullName = ((data.prenom || '') + ' ' + (data.nom || '')).trim() || 'Client';
    $('card-name').textContent = fullName;
    $('card-code').textContent = data.code_client || '';

    const svg = $('card-barcode');
    if (!svg) return;

    // Reset SVG
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const codeText = data.code_client || '';
    if (!codeText || !window.JsBarcode) {
      console.warn('[ma-carte] code client absent ou JsBarcode non chargé');
      return;
    }

    try {
      // Paramètres optimisés scan caisse :
      //  - format CODE128 (universel, supporte ASCII complet incl. tirets)
      //  - width=2.4 (épaisseur barre lisible)
      //  - height=110 (hauteur suffisante pour scan oblique)
      //  - margin=12 (zone de quiet zone obligatoire)
      //  - displayValue=true (code affiché sous le barcode pour saisie manuelle de secours)
      window.JsBarcode(svg, String(codeText), {
        format: 'CODE128',
        width: 2.4,
        height: 110,
        margin: 12,
        displayValue: true,
        fontSize: 16,
        fontOptions: 'bold',
        textMargin: 6,
        background: '#FFFFFF',
        lineColor: '#000000'
      });
    } catch (e) {
      console.error('[ma-carte] JsBarcode card failed', e);
      // Fallback texte monospace gras pour saisie manuelle si lib casse
      svg.innerHTML =
        '<rect width="100%" height="100%" fill="#FFFFFF"/>' +
        '<text x="50%" y="50%" text-anchor="middle" font-family="monospace" ' +
        'font-size="22" font-weight="700" fill="#000">' +
        escapeHtml(codeText) + '</text>';
    }
  }

  // ── OFFRES REMONTÉES (sous la carte, avant fidélité) ─
  function renderOffres(data) {
    const i = data.infos || {};
    const offres = [];
    if (i.promoEnCours)  offres.push({ type: 'promo', icon: '🥩', text: i.promoEnCours });
    if (i.offreSpeciale) offres.push({ type: 'vip',   icon: '⭐', text: i.offreSpeciale });
    if (i.infoMessage)   offres.push({ type: 'info',  icon: 'ℹ️', text: i.infoMessage });

    const block = $('offres-block');
    const section = $('offres-section');
    if (!offres.length) {
      section.style.display = 'none';
      block.innerHTML = '';
      return;
    }
    block.innerHTML = offres.map(o =>
      '<div class="offre offre-' + o.type + '">' +
        '<span class="offre-icon">' + o.icon + '</span>' +
        escapeHtml(o.text) +
      '</div>'
    ).join('');
    section.style.display = 'block';
  }

  // ── FIDÉLITÉ ───────────────────────────────────────
  function renderFidelity(data) {
    const cumul = Number(data.cumul || data.achatsCycle || 0);
    const seuil = Number(data.seuilBon || 0);
    const reste = Number(data.resteAvantBon || 0);
    const pct   = Number(data.progressPct || 0);

    $('fid-amount').textContent = fmtEuro(cumul);
    $('fid-seuil').textContent  = '/ ' + fmtEuro(seuil);
    $('fid-bar').style.width    = Math.max(0, Math.min(100, pct)) + '%';

    if (reste <= 0 && cumul > 0) {
      $('fid-msg').innerHTML = '🎁 Vous avez atteint le seuil ! Un bon va être généré.';
    } else if (reste > 0) {
      $('fid-msg').innerHTML = 'Plus que <strong>' + fmtEuro(reste) +
        '</strong> avant votre prochain bon de ' + fmtEuro(data.montantBon || 0);
    } else {
      $('fid-msg').textContent = 'Bienvenue dans le programme fidélité.';
    }
  }

  // ── BONS D'ACHAT (cliquables → modal) ──────────────
  let _currentBons = [];

  function renderBons(data) {
    _currentBons = Array.isArray(data.bons) ? data.bons : [];
    const box = $('bons-list');
    if (!_currentBons.length) {
      box.innerHTML = '<div class="empty">Aucun bon d\'achat actif.</div>';
      return;
    }
    box.innerHTML = _currentBons.map((b, idx) =>
      '<div class="bon" data-idx="' + idx + '" role="button" tabindex="0">' +
        '<div class="bon-amount">' + fmtEuro(b.montant) + '</div>' +
        '<div class="bon-meta">' +
          '<span>' + escapeHtml(b.code || '—') + '</span>' +
          '<span>' + fmtDate(b.date_creation) + ' · ' + escapeHtml(b.boutique_emission || '—') + '</span>' +
          '<span class="bon-cta">Afficher en caisse</span>' +
        '</div>' +
      '</div>'
    ).join('');

    // Délégation : un seul listener pour tous les bons
    box.querySelectorAll('.bon').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        const bon = _currentBons[idx];
        if (bon) openBonModal(bon);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          el.click();
        }
      });
    });
  }

  // ── MODAL BON D'ACHAT (avec code-barres CODE128) ──
  function openBonModal(bon) {
    $('bon-modal-amount').textContent = fmtEuro(bon.montant);
    $('bon-modal-code').textContent   = bon.code || '—';
    $('bon-modal-date').textContent   = fmtDate(bon.date_creation);
    $('bon-modal-shop').textContent   = bon.boutique_emission || '—';

    const svg = $('bon-modal-barcode');
    // Reset SVG content
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    if (bon.code && window.JsBarcode) {
      try {
        // CODE128 = scan caisse standard, accepte tous caractères ASCII
        // Largeur lisible : 2px par barre, hauteur 80px, marge 10px
        window.JsBarcode(svg, String(bon.code), {
          format: 'CODE128',
          width: 2,
          height: 80,
          margin: 10,
          displayValue: false,   // on affiche le code en dessous séparément
          background: '#FFFFFF',
          lineColor: '#000000'
        });
      } catch (e) {
        console.error('[ma-carte] JsBarcode failed', e);
        svg.innerHTML =
          '<text x="10" y="40" font-family="monospace" font-size="14" fill="#000">' +
          escapeHtml(bon.code || '') +
          '</text>';
      }
    }

    $('bon-modal').classList.add('open');
  }

  function closeBonModal() {
    $('bon-modal').classList.remove('open');
  }

  // ── PASSAGES ───────────────────────────────────────
  function renderPassages(data) {
    const list = Array.isArray(data.passages) ? data.passages : [];
    const box = $('passages-list');
    if (!list.length) {
      box.innerHTML = '<div class="empty">Aucun passage récent.</div>';
      return;
    }
    box.innerHTML = list.slice(0, 10).map(p => {
      const m = Number(p.montant) || 0;
      const cls = m >= 0 ? 'positive' : 'negative';
      const sign = m >= 0 ? '+' : '';
      return (
        '<div class="passage">' +
          '<div>' +
            '<div class="passage-date">' + fmtDate(p.date) + '</div>' +
            '<small style="color:var(--muted);font-size:11px;">' +
              escapeHtml(p.boutique || '') +
              (p.mode_paiement ? ' · ' + escapeHtml(p.mode_paiement) : '') +
            '</small>' +
          '</div>' +
          '<div class="passage-amount ' + cls + '">' +
            sign + fmtEuro(Math.abs(m)) +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  // ── INFOS HORAIRES (sans les promos qui sont déjà remontées) ─
  function renderInfos(data) {
    const i = data.infos || {};
    const rows = [];
    if (i.horairesLunVen) rows.push('<div class="info-row"><strong>Lun–Ven</strong><span>' + escapeHtml(i.horairesLunVen) + '</span></div>');
    if (i.horairesSam)    rows.push('<div class="info-row"><strong>Samedi</strong><span>'  + escapeHtml(i.horairesSam)    + '</span></div>');
    if (i.horairesDim)    rows.push('<div class="info-row"><strong>Dimanche</strong><span>'+ escapeHtml(i.horairesDim)    + '</span></div>');
    if (i.horairesFeries) rows.push('<div class="info-row"><strong>Fériés</strong><span>'  + escapeHtml(i.horairesFeries) + '</span></div>');

    if (rows.length) {
      $('infos-block').innerHTML = rows.join('');
      $('infos-section').style.display = 'block';
    } else {
      $('infos-section').style.display = 'none';
    }
  }

  // ── DATE MAJ ───────────────────────────────────────
  function renderUpdated() {
    const now = new Date();
    $('updated-at').textContent =
      now.toLocaleDateString('fr-FR') + ' · ' +
      now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ── UTILS ──────────────────────────────────────────
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── MODALES (aide + bon) ───────────────────────────
  function bindModals() {
    // Aide
    $('help-btn').addEventListener('click', () => $('help-modal').classList.add('open'));
    $('help-close').addEventListener('click', () => $('help-modal').classList.remove('open'));
    $('help-modal').addEventListener('click', (e) => {
      if (e.target.id === 'help-modal') $('help-modal').classList.remove('open');
    });

    // Bon
    $('bon-modal-close').addEventListener('click', closeBonModal);
    $('bon-modal').addEventListener('click', (e) => {
      if (e.target.id === 'bon-modal') closeBonModal();
    });

    // Welcome (première visite)
    const welcomeModal = $('welcome-modal');
    if (welcomeModal) {
      const close = () => { welcomeModal.classList.remove('open'); markWelcomeSeen(); };
      $('welcome-close').addEventListener('click', close);
      $('welcome-later').addEventListener('click', close);
      $('welcome-install').addEventListener('click', () => {
        markWelcomeSeen();
        welcomeModal.classList.remove('open');
        $('help-modal').classList.add('open');
      });
      welcomeModal.addEventListener('click', (e) => {
        if (e.target.id === 'welcome-modal') close();
      });
    }

    // Esc ferme toute modal ouverte
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        $('help-modal').classList.remove('open');
        if (welcomeModal && welcomeModal.classList.contains('open')) {
          welcomeModal.classList.remove('open');
          markWelcomeSeen();
        }
        closeBonModal();
      }
    });
  }

  // ── MODAL ACCUEIL PREMIÈRE VISITE ─────────────────
  // Affichage automatique uniquement si :
  //   - une carte client a été chargée avec succès (state-ready)
  //   - l'utilisateur n'a pas déjà vu (ni fermé) la modale d'accueil
  // Le choix est mémorisé en localStorage ET cookie pour résister au
  // contexte iOS standalone qui isole le localStorage.
  const WELCOME_KEY = 'foxengine_welcome_seen';

  function isWelcomeSeen() {
    try { if (localStorage.getItem(WELCOME_KEY) === '1') return true; } catch (_) {}
    try {
      const m = String(document.cookie || '').match(/(?:^|;\s*)foxengine_welcome_seen=1/);
      if (m) return true;
    } catch (_) {}
    return false;
  }
  function markWelcomeSeen() {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch (_) {}
    try {
      document.cookie = 'foxengine_welcome_seen=1; max-age=31536000; path=/; SameSite=Lax; Secure';
    } catch (_) {}
  }
  function maybeShowWelcome() {
    if (isWelcomeSeen()) return;
    const m = $('welcome-modal');
    if (m) m.classList.add('open');
  }

  // ── MANIFEST DYNAMIQUE — URL HTTPS RÉELLE (Pages Function) ──
  // Depuis polish-14, le manifest dynamique par boutique est servi par la
  // Cloudflare Pages Function /functions/manifest.webmanifest.js qui répond
  // sur l'URL HTTPS réelle :  /manifest.webmanifest?code=XXX
  //
  // Ici, on se contente de modifier le href du <link rel="manifest"> pour
  // qu'il pointe vers l'URL avec code. Plus AUCUN blob: — c'est ce que
  // Chrome Android exige pour l'icône d'app installée.
  function setManifestHref(code) {
    if (!code) return;
    try {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return;
      link.href = '/manifest.webmanifest?code=' + encodeURIComponent(code);
    } catch (e) {
      console.warn('[ma-carte] setManifestHref failed', e);
    }
  }

  // iOS n'utilise pas l'icône du manifest mais le <link rel="apple-touch-icon">.
  // On le patch dynamiquement avec le logoUrl CMS reçu de l'API.
  function setAppleTouchIcon(boutique) {
    if (!boutique) return;
    const logoUrl = (typeof boutique.logoUrl === 'string') ? boutique.logoUrl.trim() : '';
    if (!logoUrl) return;
    try {
      const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleIcon) appleIcon.href = logoUrl;
    } catch (e) {
      console.warn('[ma-carte] setAppleTouchIcon failed', e);
    }
  }

  // ── INIT ───────────────────────────────────────────
  async function init() {
    bindModals();

    const code = getCodeFromUrl();
    if (!code) {
      showState('state-error');
      $('error-msg').textContent = 'Aucune carte fidélité n\'a pu être chargée. Ouvrez le lien reçu par SMS ou demandez au vendeur de vous le renvoyer.';
      return;
    }

    // Pointer le <link rel="manifest"> vers la Pages Function avec code
    // → /manifest.webmanifest?code=XXX retourne un manifest JSON HTTPS réel
    // (pas blob:) avec name/colors/icons CMS personnalisés.
    setManifestHref(code);

    showState('state-loading');

    try {
      const data = await window.FoxApi.getPublicClientData(code);
      // Patch apple-touch-icon dynamiquement (iOS ne lit pas l'icône depuis le manifest)
      setAppleTouchIcon(data.boutique);
      window.FoxTheme.apply(data.boutique);
      renderShop(data);
      renderCard(data);
      renderOffres(data);     // remontées sous la carte
      renderFidelity(data);
      renderBons(data);
      renderPassages(data);
      renderInfos(data);
      renderUpdated();
      showState('state-ready');
      // Modale d'accueil : uniquement à la 1ʳᵉ visite ET carte chargée OK
      maybeShowWelcome();
    } catch (e) {
      console.error('[ma-carte] erreur', e);
      showState('state-error');
      if (e.code === 'CLIENT_NOT_FOUND') {
        $('error-msg').textContent = 'Carte introuvable. Vérifiez le lien reçu par SMS.';
      } else if (e.code === 'RATE_LIMITED') {
        $('error-msg').textContent = 'Trop de requêtes. Réessayez dans un instant.';
      } else {
        $('error-msg').textContent = 'Impossible de charger votre carte. Réessayez plus tard.';
      }
    }
  }

  // Service Worker registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(err => console.warn('[ma-carte] SW register fail:', err));
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
