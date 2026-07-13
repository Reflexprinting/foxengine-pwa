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
    let sig = '';   // signature HMAC obligatoire pour Supabase (sécurité)

    // 1. Query string ?code=XXX&sig=YYY
    try {
      const params = new URLSearchParams(window.location.search);
      code = (params.get('code') || '').trim();
      sig  = (params.get('sig') || params.get('s') || '').trim();
    } catch (_) { /* ignore */ }

    // 2. Hash #code=XXX&sig=YYY  (résiste mieux aux relances PWA installée iOS)
    if (!code) {
      try {
        const rawHash = (window.location.hash || '').replace(/^#/, '');
        if (rawHash) {
          const hashParams = new URLSearchParams(rawHash);
          code = (hashParams.get('code') || '').trim();
          if (!sig) sig = (hashParams.get('sig') || hashParams.get('s') || '').trim();
        }
      } catch (_) { /* ignore */ }
    }

    // 3. Fallback localStorage (PC / Android Chrome / contextes non isolés)
    if (!code) {
      code = safeStorageGet();
      if (!sig) { try { sig = (localStorage.getItem('fe_card_sig') || '').trim(); } catch (_) {} }
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
      // Mémoriser la signature (indispensable pour recharger la carte plus tard)
      if (sig) { try { localStorage.setItem('fe_card_sig', sig); } catch (_) {} }

      // Réinjecter ?code=XXX&sig=YYY dans l'URL pour cohérence (sans recharger).
      // IMPORTANT : on PRÉSERVE le sig, sinon Supabase renvoie "LIEN_INVALIDE".
      try {
        const newUrl = window.location.pathname
                     + '?code=' + encodeURIComponent(code)
                     + (sig ? '&sig=' + encodeURIComponent(sig) : '')
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

  // Valeur affichée d'un bon : remise en pourcentage, sinon montant en euros
  function bonVal(b) {
    return (b && b.type_valeur === 'pourcentage') ? ('-' + Number(b.montant) + '%') : fmtEuro(b && b.montant);
  }

  function renderBons(data) {
    _currentBons = Array.isArray(data.bons) ? data.bons : [];
    const box = $('bons-list');
    if (!_currentBons.length) {
      box.innerHTML = '<div class="empty">Aucun bon d\'achat actif.</div>';
      return;
    }
    box.innerHTML = _currentBons.map((b, idx) =>
      '<div class="bon" data-idx="' + idx + '" role="button" tabindex="0">' +
        '<div class="bon-amount">' + bonVal(b) + '</div>' +
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
    $('bon-modal-amount').textContent = bonVal(bon);
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

    // Derniers passages (bouton -> modale)
    if ($('passages-btn')) $('passages-btn').addEventListener('click', () => $('passages-modal').classList.add('open'));
    if ($('passages-close')) $('passages-close').addEventListener('click', () => $('passages-modal').classList.remove('open'));
    if ($('passages-modal')) $('passages-modal').addEventListener('click', (e) => {
      if (e.target.id === 'passages-modal') $('passages-modal').classList.remove('open');
    });

    // Activer / DÉSACTIVER les notifications (bouton bascule)
    if ($('notif-btn')) $('notif-btn').addEventListener('click', () => {
      const standalone = (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
      if (!standalone) {
        if ($('notif-hint')) $('notif-hint').textContent = 'Installez d’abord l’app sur votre écran d’accueil (bouton Partager → « Sur l’écran d’accueil »).';
        return;
      }
      // Déjà activées → clic = désactiver
      if (window.FoxPush && typeof window.FoxPush.isPushActive === 'function' && window.FoxPush.isPushActive()) {
        if (confirm('Désactiver les notifications ? Vous ne recevrez plus vos bons d’achat et offres par notification.')) {
          window.FoxPush.disablePush();
          if ($('notif-btn'))  $('notif-btn').textContent = '🔔 Activer mes notifications';
          if ($('notif-hint')) $('notif-hint').textContent = 'Notifications désactivées. Touchez pour les réactiver.';
        }
        return;
      }
      // Sinon → activer
      if (window.FoxPush && typeof window.FoxPush.requestPermission === 'function') {
        window.FoxPush.requestPermission();
        if ($('notif-hint')) $('notif-hint').textContent = 'Activation en cours… si rien ne se passe, fermez et rouvrez l’app.';
      } else if ($('notif-hint')) {
        $('notif-hint').textContent = 'Notifications indisponibles pour le moment.';
      }
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

    // Notifications (modale de démarrage)
    const pushGate = $('push-gate-modal');
    if (pushGate) {
      const closeGate = () => { pushGate.classList.remove('open'); _pushGateDismissed = true; };
      if ($('push-gate-later')) $('push-gate-later').addEventListener('click', closeGate);
      if ($('push-gate-activate')) $('push-gate-activate').addEventListener('click', () => {
        pushGate.classList.remove('open');
        _pushGateDismissed = true;
        if (window.FoxPush && typeof window.FoxPush.requestPermission === 'function') {
          window.FoxPush.requestPermission();
        }
        if ($('notif-hint')) $('notif-hint').textContent = 'Activation en cours… si rien ne se passe, fermez et rouvrez l’app.';
      });
      pushGate.addEventListener('click', (e) => { if (e.target.id === 'push-gate-modal') closeGate(); });
    }

    // Esc ferme toute modal ouverte
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        $('help-modal').classList.remove('open');
        if (welcomeModal && welcomeModal.classList.contains('open')) {
          welcomeModal.classList.remove('open');
          markWelcomeSeen();
        }
        const pg = $('push-gate-modal');
        if (pg && pg.classList.contains('open')) { pg.classList.remove('open'); _pushGateDismissed = true; }
        closeBonModal();
      }
    });
  }

  // ── MODALE NOTIFICATIONS (démarrage) ─────────────────
  // S'affiche si : app installée (standalone) ET permission encore "default".
  // Reste discrète si déjà accordée/refusée, ou si non installée (l'install flow gère).
  let _pushGateDismissed = false;
  function maybeShowPushGate() {
    try {
      const standalone = (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
      if (!standalone || _pushGateDismissed) return;
      let perm = 'default';
      try { if (typeof Notification !== 'undefined') perm = Notification.permission; } catch (_) {}
      if (perm !== 'default') return;
      const wm = $('welcome-modal');
      if (wm && wm.classList.contains('open')) return; // ne pas empiler sur l'accueil
      const m = $('push-gate-modal');
      if (m) m.classList.add('open');
    } catch (_) {}
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
    // Priorité à l'icône d'app CARRÉE (rendu net et arrondi propre sur iOS) ;
    // à défaut, on retombe sur le logo (rectangulaire, moins joli mais fonctionnel).
    var appIcon = (typeof boutique.appIcon === 'string') ? boutique.appIcon.trim() : '';
    var logoUrl = (typeof boutique.logoUrl === 'string') ? boutique.logoUrl.trim() : '';
    var href = appIcon || logoUrl;
    if (!href) return;
    try {
      const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleIcon) appleIcon.href = href;
    } catch (e) {
      console.warn('[ma-carte] setAppleTouchIcon failed', e);
    }
  }

  // ── INIT ───────────────────────────────────────────
  // ── Retrouver ma carte par SMS (OTP) : quand l'app est ouverte sans code (iPhone) ──
  var FOX_FN = 'https://cxbyblnzlivnadyhdwtz.supabase.co/functions/v1/card-recover';
  var FOX_ANON = 'sb_publishable_XjTXt9N9A-zBhu6lZfrxXw_Hxwfi3wp';
  var RECPHONE = '';
  async function foxFn(action, extra) {
    var r = await fetch(FOX_FN, { method: 'POST',
      headers: { apikey: FOX_ANON, Authorization: 'Bearer ' + FOX_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, extra || {})) });
    return r.json();
  }
  function showRecover(msg) {
    showState('state-error');
    var m = $('error-msg'); if (m) m.textContent = msg || 'Retrouvez votre carte avec votre numéro de téléphone :';
    var z = $('recover-zone'); if (!z) return;
    z.innerHTML =
      '<div id="rec-step1" style="margin-top:16px">' +
        '<input id="rec-phone" type="tel" inputmode="tel" placeholder="Votre téléphone" style="width:100%;padding:13px;border:2px solid #d7dbe0;border-radius:12px;font-size:17px;box-sizing:border-box">' +
        '<button id="rec-send" style="width:100%;margin-top:10px;padding:14px;border:none;border-radius:12px;font-size:16px;font-weight:700;color:#fff;background:#1c63c4;cursor:pointer">Recevoir mon code par SMS</button>' +
      '</div>' +
      '<div id="rec-step2" style="display:none;margin-top:16px">' +
        '<input id="rec-otp" type="tel" inputmode="numeric" maxlength="6" placeholder="Code à 6 chiffres" style="width:100%;padding:13px;border:2px solid #d7dbe0;border-radius:12px;font-size:22px;font-weight:800;text-align:center;letter-spacing:6px;box-sizing:border-box">' +
        '<button id="rec-verify" style="width:100%;margin-top:10px;padding:14px;border:none;border-radius:12px;font-size:16px;font-weight:700;color:#fff;background:#1a9e5a;cursor:pointer">Valider</button>' +
      '</div>' +
      '<p id="rec-msg" style="margin-top:10px;font-size:13px;color:#666"></p>';
    $('rec-send').onclick = recoverRequest;
  }
  async function recoverRequest() {
    var p = ($('rec-phone').value || '').trim();
    if (p.replace(/\D/g, '').length < 9) { $('rec-msg').textContent = 'Numéro invalide.'; return; }
    RECPHONE = p; $('rec-msg').textContent = 'Envoi du code…';
    try { await foxFn('request', { phone: p }); } catch (e) {}
    $('rec-step1').style.display = 'none'; $('rec-step2').style.display = '';
    $('rec-msg').textContent = 'Si ce numéro a une carte, un SMS vient de partir.';
    $('rec-verify').onclick = recoverVerify;
    var o = $('rec-otp'); if (o) o.focus();
  }
  async function recoverVerify() {
    var otp = ($('rec-otp').value || '').replace(/\D/g, '');
    if (otp.length < 4) { $('rec-msg').textContent = 'Entrez le code reçu.'; return; }
    $('rec-msg').textContent = 'Vérification…';
    var r; try { r = await foxFn('verify', { phone: RECPHONE, otp: otp }); } catch (e) { $('rec-msg').textContent = 'Service indisponible.'; return; }
    if (r && r.ok && r.code) {
      try { localStorage.setItem('foxengine_client_code', r.code); } catch (e) {}
      try { localStorage.setItem('fe_card_sig', r.sig || ''); } catch (e) {}
      $('rec-msg').textContent = 'Carte retrouvée ✓';
      location.replace('/ma-carte.html?code=' + encodeURIComponent(r.code) + (r.sig ? '&sig=' + encodeURIComponent(r.sig) : ''));
      return;
    }
    var errs = { AUCUN_CODE: 'Aucun code en cours. Renvoyez un code.', CODE_EXPIRE: 'Code expiré. Renvoyez un code.',
      TROP_ESSAIS: 'Trop d’essais. Renvoyez un code.', CODE_INVALIDE: 'Code invalide.',
      CODE_INCORRECT: 'Code incorrect.' + (r && r.restant != null ? ' Essais restants : ' + r.restant : '') };
    $('rec-msg').textContent = (r && errs[r.error]) || 'Échec. Réessayez.';
  }

  // ── Promo du jour : splash plein écran (image), 1×/jour à l'ouverture ──
  async function foxRpc(name, body) {
    var r = await fetch('https://cxbyblnzlivnadyhdwtz.supabase.co/rest/v1/rpc/' + name, {
      method: 'POST', headers: { apikey: FOX_ANON, Authorization: 'Bearer ' + FOX_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}) });
    return r.json();
  }
  var _promoCurrent = null;
  function _promoEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }

  // Ouvre le visuel plein écran de la promo (image + titre + texte)
  function openPromoOverlay(promo) {
    if (!promo) return;
    if (document.getElementById('promo-splash')) return;
    var esc = _promoEsc;
    var inner = '';
    if (promo.image_url) {
      inner += '<img src="' + esc(promo.image_url) + '" alt="Promo" style="max-width:100%;max-height:62vh;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5)">';
    }
    if (promo.titre || promo.texte) {
      inner += '<div style="background:#fff;color:#111;border-radius:16px;padding:18px 22px;max-width:92%;text-align:center;margin-top:' + (promo.image_url ? '14px' : '0') + '">'
        + (promo.titre ? '<div style="font-size:21px;font-weight:800;margin-bottom:6px">' + esc(promo.titre) + '</div>' : '')
        + (_promoDateLabel(promo) ? '<div style="font-size:13.5px;color:#667085;margin-bottom:8px">📅 ' + esc(_promoDateLabel(promo)) + '</div>' : '')
        + (promo.texte ? '<div style="font-size:15px;line-height:1.45;white-space:pre-wrap">' + esc(promo.texte) + '</div>' : '')
        + '</div>';
    }
    if (!inner) return;
    var ov = document.createElement('div');
    ov.id = 'promo-splash';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,12,20,.93);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;overflow:auto';
    ov.innerHTML = inner + '<button id="promo-close" style="margin-top:18px;padding:13px 28px;border:none;border-radius:12px;font-size:16px;font-weight:700;background:#fff;color:#111;cursor:pointer">Fermer</button>';
    document.body.appendChild(ov);
    function closeIt() { var el = document.getElementById('promo-splash'); if (el) el.remove(); }
    document.getElementById('promo-close').onclick = closeIt;
    ov.addEventListener('click', function (e) { if (e.target.id === 'promo-splash') closeIt(); });
  }

  // Libellé de période d'une promo (date_debut / date_fin)
  function _promoDateLabel(p) {
    function f(d) { try { var x = new Date(d); if (isNaN(x.getTime())) return ''; return x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); } catch (_) { return ''; } }
    var fa = p && p.date_debut ? f(p.date_debut) : '';
    var fb = p && p.date_fin   ? f(p.date_fin)   : '';
    if (fa && fb) return (fa === fb) ? ('Le ' + fa) : ('Du ' + fa + ' au ' + fb);
    if (fb) return "Jusqu'au " + fb;
    if (fa) return 'À partir du ' + fa;
    return '';
  }

  // Une carte promo cliquable (retourne l'élément DOM)
  function buildPromoCardEl(promo) {
    var esc = _promoEsc;
    var visuel = promo.image_url
      ? '<img src="' + esc(promo.image_url) + '" alt="Promo" style="width:100%;max-height:180px;object-fit:cover;display:block">'
      : '<div style="padding:22px 16px;background:linear-gradient(135deg,#ef8f1c,#c0392b);color:#fff;font-weight:800;font-size:18px;text-align:center">' + esc(promo.titre || 'Promo') + '</div>';
    var el = document.createElement('div');
    el.style.cssText = 'cursor:pointer;border-radius:16px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.12);border:1px solid rgba(0,0,0,.06);margin-bottom:12px';
    var dateLbl = _promoDateLabel(promo);
    el.innerHTML = visuel
      + '<div style="padding:10px 14px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:10px">'
      +   '<div style="min-width:0">'
      +     '<div style="font-weight:700;color:#111">' + esc(promo.titre || 'Promo du moment') + '</div>'
      +     (dateLbl ? '<div style="font-size:12.5px;color:#667085;margin-top:2px">📅 ' + esc(dateLbl) + '</div>' : '')
      +   '</div>'
      +   '<span style="color:#2f74d0;font-weight:700;white-space:nowrap">Voir ›</span>'
      + '</div>';
    el.onclick = function () { openPromoOverlay(promo); };
    return el;
  }

  // Rend TOUTES les promos actives dans l'app (cartes empilées, cliquables)
  function renderPromoCards(list) {
    var host = document.getElementById('promo-card');
    if (!host) return;
    host.innerHTML = '';
    var promos = (Array.isArray(list) ? list : []).filter(function (p) { return p && (p.image_url || p.titre); });
    if (!promos.length) { host.style.display = 'none'; return; }
    for (var i = 0; i < promos.length; i++) host.appendChild(buildPromoCardEl(promos[i]));
    host.style.display = 'block';
  }

  var SITE_URLS = {
    'Rochefort':    'https://www.boucherie-rochefort.fr',
    'Royan':        'https://www.boucherie-royan.fr',
    'Saint-Pierre': 'https://www.boucherie-oleron.fr',
    'Paron':        'https://www.boucherie-paron.fr',
    'Joigny':       'https://www.boucherie-joigny.fr',
    'Charny':       'https://www.boucherie-charny.fr'
  };
  function renderSiteButton(boutique) {
    var sec = document.getElementById('site-section');
    var lnk = document.getElementById('site-link');
    if (!sec || !lnk) return;
    var url = SITE_URLS[String(boutique || '').trim()];
    if (!url) { sec.style.display = 'none'; return; }
    lnk.setAttribute('href', url);
    sec.style.display = 'block';
  }

  function _getSig() {
    try {
      var p = new URLSearchParams(window.location.search);
      var s = (p.get('sig') || p.get('s') || '').trim();
      if (!s && window.location.hash) {
        var hp = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        s = (hp.get('sig') || hp.get('s') || '').trim();
      }
      if (!s) s = (localStorage.getItem('fe_card_sig') || '').trim();
      return s;
    } catch (_) { return ''; }
  }

  // 🎉 Feu d'artifice de confettis (jour d'anniversaire), 1×/jour à l'ouverture
  function birthdayConfetti() {
    try {
      var today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem('fox_bday_confetti') === today) return;
      localStorage.setItem('fox_bday_confetti', today);
    } catch (_) {}
    var cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    function size() { cv.width = window.innerWidth; cv.height = window.innerHeight; }
    size();
    var colors = ['#c0392b', '#ef8f1c', '#6a5acd', '#2f74d0', '#27ae60', '#f1c40f', '#e84393', '#ffffff'];
    var parts = [];
    function burst(x, y) {
      for (var i = 0; i < 70; i++) {
        var a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 8;
        parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6,
          g: 0.16 + Math.random() * 0.12, c: colors[(Math.random() * colors.length) | 0],
          s: 5 + Math.random() * 7, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35, life: 1 });
      }
    }
    var W = cv.width, H = cv.height;
    burst(W * 0.5, H * 0.38);
    setTimeout(function () { burst(W * 0.22, H * 0.5); }, 220);
    setTimeout(function () { burst(W * 0.78, H * 0.5); }, 420);
    setTimeout(function () { burst(W * 0.5, H * 0.3); }, 650);
    var t0 = Date.now();
    function frame() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.006;
        if (p.life <= 0) continue;
        ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.62); ctx.restore();
      }
      if (Date.now() - t0 < 4200) { requestAnimationFrame(frame); } else { cv.remove(); }
    }
    requestAnimationFrame(frame);
  }

  // Ouvre l'offre anniversaire : le bon (code-barres) s'il existe, sinon un aperçu décoré
  function openBirthdayOffer(data) {
    var bons = Array.isArray(window._currentBonsRef) ? window._currentBonsRef : [];
    var anniv = null;
    for (var i = 0; i < bons.length; i++) { if (bons[i] && String(bons[i].source || '').toUpperCase() === 'ANNIVERSAIRE') { anniv = bons[i]; break; } }
    if (anniv && typeof openBonModal === 'function') { openBonModal(anniv); return; }
    // Aperçu (pas encore de bon généré) — montant depuis le réglage Manager
    if (document.getElementById('bday-offer-splash')) return;
    var montant = Number((data && data.anniversaireMontant) || 0);
    var mtxt = montant > 0 ? (Number.isInteger(montant) ? montant : montant.toFixed(2)) + ' €' : 'un cadeau';
    var ov = document.createElement('div');
    ov.id = 'bday-offer-splash';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,12,20,.92);display:flex;align-items:center;justify-content:center;padding:18px';
    ov.innerHTML =
      '<div style="max-width:360px;width:100%;border-radius:22px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5)">'
      + '<div style="background:linear-gradient(135deg,#c0392b,#ef8f1c 55%,#6a5acd);color:#fff;text-align:center;padding:28px 20px">'
      +   '<div style="font-size:58px;line-height:1">🎂</div>'
      +   '<div style="font-size:24px;margin-top:2px">🎉 🎊 🎈</div>'
      +   '<div style="font-weight:900;font-size:20px;margin-top:10px">Votre bon cadeau anniversaire</div>'
      +   '<div style="font-size:44px;font-weight:900;margin-top:8px">' + mtxt + '</div>'
      +   '<div style="font-size:13px;opacity:.95;margin-top:8px">À présenter en caisse le jour de votre anniversaire. Votre bon apparaîtra ici automatiquement 🎁</div>'
      + '</div>'
      + '<button id="bday-offer-close" style="width:100%;padding:15px;border:none;font-size:16px;font-weight:800;background:#fff;color:#111;cursor:pointer">Fermer</button>'
      + '</div>';
    document.body.appendChild(ov);
    function close() { var el = document.getElementById('bday-offer-splash'); if (el) el.remove(); }
    document.getElementById('bday-offer-close').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target.id === 'bday-offer-splash') close(); });
  }

  // Anniversaire : bannière le jour J + collecte de la date si absente
  function renderBirthday(data) {
    if (!data) return;
    try { window._currentBonsRef = Array.isArray(data.bons) ? data.bons : []; } catch (_) {}
    var banner = document.getElementById('bday-banner-sec');
    var collect = document.getElementById('bday-collect-sec');
    if (banner) {
      if (data.isBirthdayToday) {
        var n = document.getElementById('bday-name'); if (n) n.textContent = data.prenom || '';
        banner.style.display = 'block';
        var ob = document.getElementById('bday-offer-btn');
        if (ob && !ob._wired) { ob._wired = true; ob.addEventListener('click', function () { openBirthdayOffer(data); }); }
        setTimeout(function () { try { birthdayConfetti(); } catch (_) {} }, 500);
      }
      else banner.style.display = 'none';
    }
    if (collect) {
      if (data.hasBirthdate) { collect.style.display = 'none'; }
      else {
        collect.style.display = 'block';
        var btn = document.getElementById('bday-save');
        var inp = document.getElementById('bday-input');
        var msg = document.getElementById('bday-msg');
        if (btn && inp && !btn._wired) {
          btn._wired = true;
          btn.addEventListener('click', async function () {
            var val = (inp.value || '').trim();
            if (!val) { if (msg) msg.textContent = 'Choisissez une date.'; return; }
            var code = (typeof getCodeFromUrl === 'function') ? getCodeFromUrl() : ((data && data.code_client) || '');
            var sig = _getSig();
            btn.disabled = true; if (msg) msg.textContent = 'Enregistrement…';
            try {
              var r = await foxRpc('rpc_client_set_birthdate', { p_code: code, p_sig: sig, p_birthdate: val });
              if (r && r.ok === true) { if (msg) msg.textContent = '✅ Merci ! Votre cadeau vous attendra le jour J.'; setTimeout(function(){ if (collect) collect.style.display='none'; }, 1500); }
              else { if (msg) msg.textContent = 'Impossible d’enregistrer (' + ((r && r.error) || 'erreur') + ').'; btn.disabled = false; }
            } catch (e) { if (msg) msg.textContent = 'Réseau indisponible, réessayez.'; btn.disabled = false; }
          });
        }
      }
    }
  }

  async function showPromoDuJour(boutique) {
    if (!boutique) return;
    try {
      var list = await foxRpc('rpc_promos_active', { p_boutique: boutique });
      if (!Array.isArray(list) || !list.length) { renderPromoCards([]); return; }
      _promoCurrent = list;
      // Cartes persistantes : TOUTES les promos actives, toujours visibles
      renderPromoCards(list);
      // Splash plein écran : 1×/jour, la 1re promo avec image (sinon la 1re)
      var featured = null;
      for (var i = 0; i < list.length; i++) { if (list[i] && list[i].image_url) { featured = list[i]; break; } }
      if (!featured) featured = list[0];
      var today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem('fox_promo_day') !== today) {
        openPromoOverlay(featured);
        try { localStorage.setItem('fox_promo_day', today); } catch (e) {}
      }
    } catch (e) {}
  }

  async function init() {
    bindModals();

    const code = getCodeFromUrl();
    if (!code) {
      showRecover('Ouvrez le lien reçu par SMS, ou retrouvez votre carte avec votre numéro de téléphone :');
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
      // Promo du jour : splash plein écran (image), 1×/jour
      showPromoDuJour(data.boutique && (data.boutique.boutiqueId || data.boutique));
      renderSiteButton(data.boutique && (data.boutique.boutiqueId || data.boutique));
      renderBirthday(data);

      // ════════════════════════════════════════════════════════════
      // POLISH-17 — Hook install flow (après render carte + welcome)
      // ════════════════════════════════════════════════════════════
      if (window.FoxInstall && typeof window.FoxInstall.init === 'function') {
        try {
          window.FoxInstall.init(data);
        } catch (e) {
          console.warn('[ma-carte] FoxInstall.init failed', e);
        }
      }

      // ════════════════════════════════════════════════════════════
      // POLISH-18 — Hook OneSignal push flow
      // ════════════════════════════════════════════════════════════
      if (window.FoxPush && typeof window.FoxPush.init === 'function') {
        try {
          window.FoxPush.init(data);
        } catch (e) {
          console.warn('[ma-carte] FoxPush.init failed', e);
        }
      }

      // Modale notifications : proposée au démarrage (app installée + non encore activées)
      setTimeout(maybeShowPushGate, 1400);
    } catch (e) {
      console.error('[ma-carte] erreur', e);
      if (e.code === 'CLIENT_NOT_FOUND' || e.code === 'LIEN_INVALIDE') {
        showRecover('Lien expiré ou invalide. Retrouvez votre carte avec votre numéro de téléphone :');
        return;
      }
      showState('state-error');
      if (e.code === 'RATE_LIMITED') {
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


// ════════════════════════════════════════════════════════════════════
// POLISH-17 — Module pwaInstallFlow (FoxInstall)
// ════════════════════════════════════════════════════════════════════
// Module isolé pour gérer :
//   - détection display-mode (browser / standalone / minimal-ui)
//   - détection plateforme (ios / android / desktop)
//   - tracking backend via registerPushDevice (stub, sans OneSignal)
//   - modale install (texte business validé)
//   - écran choix appareil
//   - 3 tutoriels (iOS / Android / Autre)
//   - section "Installer ma carte" dans modale Aide existante
//   - snooze 7j + max 3 refus auto
//
// Ce module ne touche PAS au code principal de ma-carte.js.
// Il se branche via window.FoxInstall.init(data) appelé dans init().
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Configuration ───────────────────────────────────────────────
  var APP_VERSION       = 'phase3-polish-17';
  var REGISTER_ENDPOINT = 'https://cxbyblnzlivnadyhdwtz.supabase.co/functions/v1/push-register';
  var REGISTER_ANON = 'sb_publishable_XjTXt9N9A-zBhu6lZfrxXw_Hxwfi3wp';
  var WELCOME_DELAY_MS  = 1500;     // délai après welcome fermé
  var SNOOZE_DAYS       = 7;
  var MAX_DISMISS_AUTO  = 3;

  // ── Clés localStorage (préfixe fe_pwa_install_*) ────────────────
  var LS_DISMISSED_COUNT     = 'fe_pwa_install_dismissed_count';
  var LS_LAST_DISMISSED_AT   = 'fe_pwa_install_last_dismissed_at';
  var LS_SHOWN_COUNT         = 'fe_pwa_install_shown_count';

  // ── État interne ────────────────────────────────────────────────
  var _carteData     = null;
  var _displayMode   = 'browser';
  var _platform      = 'desktop';

  // ── Détection ───────────────────────────────────────────────────
  function detectDisplayMode() {
    try {
      if (window.navigator.standalone === true) return 'standalone';   // iOS Safari
      if (window.matchMedia &&
          window.matchMedia('(display-mode: standalone)').matches) {
        return 'standalone';
      }
      if (window.matchMedia &&
          window.matchMedia('(display-mode: minimal-ui)').matches) {
        return 'minimal-ui';
      }
    } catch (_) { /* ignore */ }
    return 'browser';
  }

  function detectPlatform() {
    var ua = (navigator.userAgent || '').toString();
    // iPad moderne : userAgent indique "Macintosh" mais on a touch → traité iOS
    var isIPad = /iPad|Macintosh/.test(ua) && 'ontouchend' in document;
    if (/iPhone|iPod/.test(ua) || isIPad) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }

  // ── localStorage (safe) ─────────────────────────────────────────
  function lsGetNumber(key) {
    try {
      var v = parseInt(localStorage.getItem(key) || '0', 10);
      return isNaN(v) ? 0 : v;
    } catch (_) { return 0; }
  }
  function lsGetString(key) {
    try { return localStorage.getItem(key) || ''; }
    catch (_) { return ''; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, String(value)); }
    catch (_) { /* ignore */ }
  }

  // ── Logique snooze ──────────────────────────────────────────────
  function isSnoozedNow() {
    var lastIso = lsGetString(LS_LAST_DISMISSED_AT);
    if (!lastIso) return false;
    try {
      var last = new Date(lastIso);
      if (isNaN(last.getTime())) return false;
      var diffMs  = Date.now() - last.getTime();
      var diffDays = diffMs / (24 * 60 * 60 * 1000);
      return diffDays < SNOOZE_DAYS;
    } catch (_) { return false; }
  }

  function reachedMaxDismiss() {
    return lsGetNumber(LS_DISMISSED_COUNT) >= MAX_DISMISS_AUTO;
  }

  function recordDismissedLocal() {
    var c = lsGetNumber(LS_DISMISSED_COUNT) + 1;
    lsSet(LS_DISMISSED_COUNT, c);
    lsSet(LS_LAST_DISMISSED_AT, new Date().toISOString());
  }

  function recordShownLocal() {
    var c = lsGetNumber(LS_SHOWN_COUNT) + 1;
    lsSet(LS_SHOWN_COUNT, c);
  }

  // ── Backend tracking (silencieux) ───────────────────────────────
  // Ne JAMAIS bloquer ni faire échouer la PWA si registerPushDevice
  // est down. Erreurs absorbées en console.warn uniquement.
  function postRegister(extraFlags) {
    if (!_carteData || !_carteData.code_client || !_carteData.boutique_id) {
      console.warn('[FoxInstall] tracking skipped: missing code_client or boutique_id');
      return;
    }

    var payload = {
      codeClient:        String(_carteData.code_client),
      boutiqueId:        String(_carteData.boutique_id),
      permissionStatus:  'default',
      pushEnabled:       false,
      subscriptionId:    null,
      oneSignalUserId:   null,
      platform:          _platform,
      appVersion:        APP_VERSION,
      userAgent:         (navigator.userAgent || '').substring(0, 250),
      pwaInstalled:      (_displayMode === 'standalone'),
      displayMode:       _displayMode,
      installPromptShown:     !!(extraFlags && extraFlags.shown),
      installPromptDismissed: !!(extraFlags && extraFlags.dismissed)
    };

    try {
      fetch(REGISTER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': REGISTER_ANON, 'Authorization': 'Bearer ' + REGISTER_ANON },
        body: JSON.stringify(payload),
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
        keepalive: true
      }).then(function (res) {
        if (!res.ok) {
          console.warn('[FoxInstall] register HTTP ' + res.status);
        }
      }).catch(function (err) {
        // Silencieux : erreur réseau, bloqueurs CORS, offline, etc.
        console.warn('[FoxInstall] register fetch failed', err);
      });
    } catch (e) {
      console.warn('[FoxInstall] register exception', e);
    }
  }

  // ── DOM helpers ─────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function openModal(id) {
    var el = $(id);
    if (el) el.classList.add('open');
  }
  function closeModal(id) {
    var el = $(id);
    if (el) el.classList.remove('open');
  }
  function closeAllInstallModals() {
    closeModal('install-modal');
    closeModal('device-modal');
    closeModal('tuto-ios-modal');
    closeModal('tuto-android-modal');
    closeModal('tuto-other-modal');
  }

  // ── Ouverture flow depuis Aide ou auto ──────────────────────────
  function openInstallFlowFromHelp() {
    // Depuis Aide : on saute la modale install (l'utilisateur a déjà
    // explicitement choisi de voir les étapes) et on ouvre directement
    // le choix appareil.
    closeModal('help-modal');
    recordShownLocal();
    postRegister({ shown: true });
    openModal('device-modal');
  }

  function openInstallFlowAuto() {
    // Auto après welcome : ouvre la modale install d'abord
    openModal('install-modal');
  }

  function openTutorialFor(device) {
    closeModal('device-modal');
    if (device === 'ios') {
      openModal('tuto-ios-modal');
    } else if (device === 'android') {
      openModal('tuto-android-modal');
    } else {
      openModal('tuto-other-modal');
    }
  }

  // ── Wiring boutons ──────────────────────────────────────────────
  function wireInstallButtons() {
    // Bouton "Voir les étapes d'installation" en haut de la modale Aide
    var helpInstallBtn = $('help-install-btn');
    if (helpInstallBtn) {
      helpInstallBtn.addEventListener('click', openInstallFlowFromHelp);
    }

    // Modale install — bouton "Voir les étapes d'installation"
    var showSteps = $('install-show-steps');
    if (showSteps) {
      showSteps.addEventListener('click', function () {
        closeModal('install-modal');
        recordShownLocal();
        postRegister({ shown: true });
        openModal('device-modal');
      });
    }

    // Modale install — bouton "J'ai compris"
    var dismissBtn = $('install-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        closeModal('install-modal');
        recordDismissedLocal();
        postRegister({ dismissed: true });
      });
    }

    // Modale install — close (X) = équivalent dismiss
    var installClose = $('install-modal-close');
    if (installClose) {
      installClose.addEventListener('click', function () {
        closeModal('install-modal');
        recordDismissedLocal();
        postRegister({ dismissed: true });
      });
    }
    var installModal = $('install-modal');
    if (installModal) {
      installModal.addEventListener('click', function (e) {
        if (e.target.id === 'install-modal') {
          closeModal('install-modal');
          recordDismissedLocal();
          postRegister({ dismissed: true });
        }
      });
    }

    // Modale choix appareil — boutons device
    var deviceModal = $('device-modal');
    if (deviceModal) {
      var deviceBtns = deviceModal.querySelectorAll('.fe-device-btn');
      Array.prototype.forEach.call(deviceBtns, function (btn) {
        btn.addEventListener('click', function () {
          var device = btn.getAttribute('data-device') || 'other';
          openTutorialFor(device);
        });
      });

      // Close (X)
      var deviceClose = $('device-modal-close');
      if (deviceClose) {
        deviceClose.addEventListener('click', function () {
          closeModal('device-modal');
        });
      }
      // Click outside
      deviceModal.addEventListener('click', function (e) {
        if (e.target.id === 'device-modal') closeModal('device-modal');
      });
    }

    // Tutoriels — boutons Retour (vers choix appareil)
    var backBtns = document.querySelectorAll('.fe-tuto-back');
    Array.prototype.forEach.call(backBtns, function (btn) {
      btn.addEventListener('click', function () {
        var which = btn.getAttribute('data-back');
        if (which === 'ios')     closeModal('tuto-ios-modal');
        if (which === 'android') closeModal('tuto-android-modal');
        if (which === 'other')   closeModal('tuto-other-modal');
        openModal('device-modal');
      });
    });

    // Tutoriels — boutons Fermer (X)
    var closeBtns = document.querySelectorAll('.fe-tuto-close');
    Array.prototype.forEach.call(closeBtns, function (btn) {
      btn.addEventListener('click', function () {
        var which = btn.getAttribute('data-close');
        if (which === 'ios')     closeModal('tuto-ios-modal');
        if (which === 'android') closeModal('tuto-android-modal');
        if (which === 'other')   closeModal('tuto-other-modal');
      });
    });

    // Click outside tutoriels
    var tutoIds = ['tuto-ios-modal', 'tuto-android-modal', 'tuto-other-modal'];
    tutoIds.forEach(function (id) {
      var el = $(id);
      if (el) {
        el.addEventListener('click', function (e) {
          if (e.target.id === id) closeModal(id);
        });
      }
    });

    // ESC ferme toutes les modales install
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAllInstallModals();
    });
  }

  // ── Logique d'affichage automatique ─────────────────────────────
  function shouldShowAutoModal() {
    // 1. Mode standalone : déjà installé → pas de modale
    if (_displayMode === 'standalone') return false;

    // 2. Desktop : pas de modale auto (accessible via Aide)
    if (_platform === 'desktop') return false;

    // 3. Snooze 7 jours actif
    if (isSnoozedNow()) return false;

    // 4. Trop de refus comptabilisés
    if (reachedMaxDismiss()) return false;

    return true;
  }

  function tryShowAutoAfterWelcome() {
    if (!shouldShowAutoModal()) return;

    // On vérifie que la carte est bien rendered avant d'afficher
    var stateReady = $('state-ready');
    if (!stateReady || !stateReady.classList.contains('active')) return;

    // Si la modale welcome est ouverte, on attend qu'elle soit fermée.
    // Sinon on enchaîne directement avec un petit délai esthétique.
    var welcomeModal = $('welcome-modal');
    if (welcomeModal && welcomeModal.classList.contains('open')) {
      // Observer la fermeture du welcome via mutation observer
      var observer = new MutationObserver(function () {
        if (!welcomeModal.classList.contains('open')) {
          observer.disconnect();
          setTimeout(function () {
            // Re-vérifier les conditions au moment de l'affichage
            if (shouldShowAutoModal()) openInstallFlowAuto();
          }, WELCOME_DELAY_MS);
        }
      });
      observer.observe(welcomeModal, {
        attributes: true,
        attributeFilter: ['class']
      });
    } else {
      // Pas de welcome ouverte → délai court puis affichage
      setTimeout(function () {
        if (shouldShowAutoModal()) openInstallFlowAuto();
      }, WELCOME_DELAY_MS);
    }
  }

  // ── API publique ────────────────────────────────────────────────
  window.FoxInstall = {
    init: function (data) {
      _carteData   = data || null;
      _displayMode = detectDisplayMode();
      _platform    = detectPlatform();

      // Tracking initial : à chaque ouverture PWA, on signale lastPwaOpenAt
      // (et pwaInstalled si standalone). Pas de flag shown/dismissed.
      postRegister({});

      // Wire des boutons (bouton Aide + modales install)
      wireInstallButtons();

      // Affichage auto modale install si éligible
      tryShowAutoAfterWelcome();
    }
  };

})();



// ════════════════════════════════════════════════════════════════════
// POLISH-18 v2 — Module FoxPush (OneSignal Web SDK v16)
// ════════════════════════════════════════════════════════════════════
// VERSION OPTIMISÉE BUSINESS — MAXIMISER LE TAUX D'ACTIVATION
//
// Stratégie :
//   1. Bandeau UNIQUEMENT si PWA installée (display-mode standalone)
//      → iPhone navigateur : NON
//      → Android navigateur : NON
//      → Desktop navigateur : NON
//      → PWA installée toutes plateformes : OUI
//
//   2. Bandeau affiché APRÈS engagement client (premier des deux) :
//      - Fermeture d'un bon d'achat (modale bon-modal fermée)
//      - OU 10 secondes après chargement de la carte
//
//   3. Texte personnalisé avec nom boutique dynamique :
//      "{nomBoutique} vous envoie vos bons et promotions..."
//
//   4. Snooze 3 jours après "Plus tard"
//      Max 3 dismiss → bandeau ne s'affiche plus auto
//      Bouton manuel dans Aide reste accessible
//
//   5. Init OneSignal SDK + tags + login(codeClient) :
//      identique à v1 (validé)
//
// Ce module ne touche PAS au code principal de ma-carte.js.
// Il se branche via window.FoxPush.init(data) appelé dans init().
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Configuration ───────────────────────────────────────────────
  var APP_VERSION       = 'phase3-polish-18-v2.1';
  var REGISTER_ENDPOINT = 'https://cxbyblnzlivnadyhdwtz.supabase.co/functions/v1/push-register';
  var REGISTER_ANON = 'sb_publishable_XjTXt9N9A-zBhu6lZfrxXw_Hxwfi3wp';
  var SNOOZE_DAYS       = 3;          // ⚠️ v2 : 3 jours (vs 7j v1)
  var MAX_DISMISS_AUTO  = 3;
  var SDK_TIMEOUT_MS    = 8000;
  var ENGAGEMENT_DELAY_MS = 10000;    // ⚠️ v2 : 10s timer engagement

  // ── Clés localStorage (préfixe fe_push_cta_*) ────────────────────
  var LS_DISMISSED_COUNT   = 'fe_push_cta_dismissed_count';
  var LS_LAST_DISMISSED_AT = 'fe_push_cta_last_dismissed_at';
  var LS_SHOWN_COUNT       = 'fe_push_cta_shown_count';

  // ── État interne ────────────────────────────────────────────────
  var _carteData         = null;
  var _appId             = null;
  var _displayMode       = 'browser';
  var _platform          = 'desktop';
  var _isOSReady         = false;
  var _isOSAttempted     = false;
  var _engagementTimer   = null;
  var _engagementFired   = false;
  var _bonModalObserver  = null;
  var _bonWasOpen        = false;
  var _boutiqueName      = '';

  // ── Détection (mêmes règles que polish-17 FoxInstall) ───────────
  function detectDisplayMode() {
    try {
      if (window.navigator.standalone === true) return 'standalone';
      if (window.matchMedia &&
          window.matchMedia('(display-mode: standalone)').matches) {
        return 'standalone';
      }
      if (window.matchMedia &&
          window.matchMedia('(display-mode: minimal-ui)').matches) {
        return 'minimal-ui';
      }
    } catch (_) { /* ignore */ }
    return 'browser';
  }

  function detectPlatform() {
    var ua = (navigator.userAgent || '').toString();
    var isIPad = /iPad|Macintosh/.test(ua) && 'ontouchend' in document;
    if (/iPhone|iPod/.test(ua) || isIPad) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'desktop';
  }

  // ── localStorage (safe) ─────────────────────────────────────────
  function lsGetNumber(key) {
    try {
      var v = parseInt(localStorage.getItem(key) || '0', 10);
      return isNaN(v) ? 0 : v;
    } catch (_) { return 0; }
  }
  function lsGetString(key) {
    try { return localStorage.getItem(key) || ''; }
    catch (_) { return ''; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, String(value)); }
    catch (_) { /* ignore */ }
  }

  // ── Snooze 3 jours v2 ───────────────────────────────────────────
  function isSnoozedNow() {
    var lastIso = lsGetString(LS_LAST_DISMISSED_AT);
    if (!lastIso) return false;
    try {
      var last = new Date(lastIso);
      if (isNaN(last.getTime())) return false;
      var diffMs   = Date.now() - last.getTime();
      var diffDays = diffMs / (24 * 60 * 60 * 1000);
      return diffDays < SNOOZE_DAYS;
    } catch (_) { return false; }
  }

  function reachedMaxDismiss() {
    return lsGetNumber(LS_DISMISSED_COUNT) >= MAX_DISMISS_AUTO;
  }

  function recordDismissedLocal() {
    var c = lsGetNumber(LS_DISMISSED_COUNT) + 1;
    lsSet(LS_DISMISSED_COUNT, c);
    lsSet(LS_LAST_DISMISSED_AT, new Date().toISOString());
  }

  function recordShownLocal() {
    var c = lsGetNumber(LS_SHOWN_COUNT) + 1;
    lsSet(LS_SHOWN_COUNT, c);
  }

  // ── DOM helpers ─────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function showBanner() {
    var el = $('push-banner');
    if (el) el.hidden = false;
  }
  function hideBanner() {
    var el = $('push-banner');
    if (el) el.hidden = true;
  }

  // ── Texte dynamique avec nom boutique ───────────────────────────
  function resolveBoutiqueName(data) {
    if (!data || !data.boutique) return '';
    var b = data.boutique;
    var name = b.enseigne || b.nom || b.title || '';
    return String(name).trim();
  }

  function buildBannerMessage() {
    var msg;
    if (_boutiqueName) {
      msg = _boutiqueName + ' vous envoie vos bons et promotions directement sur votre téléphone.';
    } else {
      // Fallback si nom boutique absent (ne devrait pas arriver)
      msg = 'Soyez averti dès qu\'un bon d\'achat ou une promotion arrive.';
    }
    return msg;
  }

  function applyDynamicTexts() {
    // Bandeau
    var bannerMsg = $('push-banner-message');
    if (bannerMsg) bannerMsg.textContent = buildBannerMessage();

    // Section Aide
    var helpMsg = $('help-push-message');
    if (helpMsg) helpMsg.textContent = buildBannerMessage();
  }

  // ── Récupération AppId (cascade — identique v1) ─────────────────
  function resolveAppId(data) {
    var fromBoutique = (data && data.boutique && data.boutique.oneSignalAppId)
                       ? String(data.boutique.oneSignalAppId).trim()
                       : '';
    if (fromBoutique) return fromBoutique;

    var fromData = (data && data.oneSignalAppId)
                   ? String(data.oneSignalAppId).trim()
                   : '';
    if (fromData) return fromData;

    try {
      var meta = document.querySelector('meta[name="onesignal-app-id-fallback"]');
      if (meta) {
        var v = String(meta.getAttribute('content') || '').trim();
        if (v) return v;
      }
    } catch (_) { /* ignore */ }

    return null;
  }

  // ── Backend tracking (silencieux) ───────────────────────────────
  function postRegister(extras) {
    if (!_carteData || !_carteData.code_client || !_carteData.boutique_id) {
      console.warn('[FoxPush v2] tracking skipped: missing code_client or boutique_id');
      return;
    }

    var payload = {
      codeClient:        String(_carteData.code_client),
      boutiqueId:        String(_carteData.boutique_id),
      platform:          _platform,
      appVersion:        APP_VERSION,
      userAgent:         (navigator.userAgent || '').substring(0, 250),
      pwaInstalled:      (_displayMode === 'standalone'),
      displayMode:       _displayMode,

      permissionStatus:  (extras && extras.permissionStatus) || 'default',
      pushEnabled:       !!(extras && extras.pushEnabled),
      subscriptionId:    (extras && extras.subscriptionId)   || null,
      oneSignalUserId:   (extras && extras.oneSignalUserId)  || null,

      installPromptShown:     !!(extras && extras.installPromptShown),
      installPromptDismissed: !!(extras && extras.installPromptDismissed)
    };

    try {
      fetch(REGISTER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': REGISTER_ANON, 'Authorization': 'Bearer ' + REGISTER_ANON },
        body: JSON.stringify(payload),
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
        keepalive: true
      }).then(function (res) {
        if (!res.ok) {
          console.warn('[FoxPush v2] register HTTP ' + res.status);
        }
      }).catch(function (err) {
        console.warn('[FoxPush v2] register fetch failed', err);
      });
    } catch (e) {
      console.warn('[FoxPush v2] register exception', e);
    }
  }

  // ── Init OneSignal SDK ──────────────────────────────────────────
  function initOneSignal() {
    if (_isOSAttempted) return;
    _isOSAttempted = true;

    if (!_appId) {
      console.warn('[FoxPush v2] no AppId available, OneSignal not initialized');
      return;
    }

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(function (OneSignal) {
      OneSignal.init({
        appId: _appId,
        allowLocalhostAsSecureOrigin: false,
        autoResubscribe: true,
        // ⚠️ POLISH-18-v2.1 — correctif Service Worker combiné
        // OneSignal doit utiliser notre sw.js combiné (qui inclut
        // déjà importScripts OneSignal en haut), et non chercher
        // un OneSignalSDKWorker.js séparé à la racine.
        serviceWorkerPath: 'sw.js',
        serviceWorkerParam: { scope: '/' },
        notifyButton: { enable: false },
        promptOptions: {
          slidedown: {
            prompts: []
          }
        }
      }).then(function () {
        _isOSReady = true;

        // Login(codeClient) — aligne oneSignalUserId
        if (_carteData && _carteData.code_client) {
          try {
            OneSignal.login(String(_carteData.code_client));
          } catch (e) {
            console.warn('[FoxPush v2] OneSignal.login failed', e);
          }
        }

        // Tags multi-tenant
        applyTags(OneSignal);

        // Listeners
        try {
          OneSignal.User.PushSubscription.addEventListener(
            'change',
            handleSubscriptionChange
          );
          OneSignal.Notifications.addEventListener(
            'permissionChange',
            handlePermissionChange
          );
        } catch (e) {
          console.warn('[FoxPush v2] OneSignal addEventListener failed', e);
        }

        // POST état actuel (réelles valeurs OneSignal)
        readAndPostState(OneSignal);

        // Mise à jour section Aide
        updateAideStatus(OneSignal);
        syncNotifHint(OneSignal);

        // ⚠️ v2 : on N'AFFICHE PAS le bandeau immédiatement.
        // L'affichage est conditionné à l'engagement client.
        // → setupEngagementTracking() s'occupe de tryShowBanner()

      }).catch(function (err) {
        console.warn('[FoxPush v2] OneSignal.init failed', err);
      });
    });

    setTimeout(function () {
      if (!_isOSReady) {
        console.warn('[FoxPush v2] OneSignal SDK not ready after ' + SDK_TIMEOUT_MS + 'ms');
      }
    }, SDK_TIMEOUT_MS);
  }

  // ── Tags multi-tenant ──────────────────────────────────────────
  function applyTags(OneSignal) {
    if (!_carteData) return;
    try {
      OneSignal.User.addTags({
        boutiqueId: String(_carteData.boutique_id || ''),
        codeClient: String(_carteData.code_client || ''),
        platform:   _platform,
        appVersion: APP_VERSION
      });
    } catch (e) {
      console.warn('[FoxPush v2] addTags failed', e);
    }
  }

  // ── Lecture état OneSignal et POST backend ──────────────────────
  function readAndPostState(OneSignal) {
    try {
      var permissionStatus = 'default';
      var pushEnabled = false;
      var subscriptionId = null;
      var oneSignalUserId = null;

      try {
        var perm = OneSignal.Notifications.permission;
        if (typeof perm === 'string') {
          permissionStatus = perm;
        } else if (perm === true) {
          permissionStatus = 'granted';
        } else {
          if (typeof Notification !== 'undefined' && Notification.permission) {
            permissionStatus = Notification.permission;
          }
        }
      } catch (_) { /* ignore */ }

      try {
        var sub = OneSignal.User.PushSubscription;
        if (sub) {
          subscriptionId = sub.id || sub.token || null;
          pushEnabled    = (sub.optedIn === true) && (permissionStatus === 'granted');
        }
      } catch (_) { /* ignore */ }

      try {
        oneSignalUserId = OneSignal.User.onesignalId || null;
      } catch (_) { /* ignore */ }

      postRegister({
        permissionStatus: permissionStatus,
        pushEnabled:      pushEnabled,
        subscriptionId:   subscriptionId,
        oneSignalUserId:  oneSignalUserId
      });
    } catch (e) {
      console.warn('[FoxPush v2] readAndPostState failed', e);
    }
  }

  // ── Listeners ──────────────────────────────────────────────────
  function handleSubscriptionChange(event) {
    if (!window.OneSignal) return;
    readAndPostState(window.OneSignal);
    // En cas de changement (granted ou denied) : cacher bandeau
    hideBanner();
    updateAideStatus(window.OneSignal);
    syncNotifHint(window.OneSignal);
  }

  function handlePermissionChange(event) {
    if (!window.OneSignal) return;
    readAndPostState(window.OneSignal);
    hideBanner();
    updateAideStatus(window.OneSignal);
    syncNotifHint(window.OneSignal);
  }

  // ── ⚠️ v2 — Conditions strictes affichage bandeau ───────────────
  function shouldShowBanner(OneSignal) {
    // 1. PWA OBLIGATOIREMENT installée (toutes plateformes)
    if (_displayMode !== 'standalone') {
      return false;
    }

    // 2. AppId obligatoire
    if (!_appId) return false;

    // 3. SDK doit être prêt
    if (!_isOSReady || !OneSignal) return false;

    // 4. Lire état permission
    var permissionStatus = 'default';
    try {
      var perm = OneSignal.Notifications.permission;
      if (typeof perm === 'string') permissionStatus = perm;
      else if (perm === true) permissionStatus = 'granted';
      else if (typeof Notification !== 'undefined') permissionStatus = Notification.permission;
    } catch (_) { /* ignore */ }

    // Pas de bandeau si déjà granted ou denied
    if (permissionStatus !== 'default') return false;

    // 5. Snooze actif (3 jours)
    if (isSnoozedNow()) return false;

    // 6. Trop de refus
    if (reachedMaxDismiss()) return false;

    return true;
  }

  // ── ⚠️ v2 — Tentative affichage bandeau (post-engagement) ───────
  function tryShowBanner() {
    if (!_isOSReady || !window.OneSignal) {
      // SDK pas encore prêt : on retentera quand listeners seront en place
      return;
    }
    if (shouldShowBanner(window.OneSignal)) {
      applyDynamicTexts();
      showBanner();
      recordShownLocal();
    }
  }

  // ── ⚠️ v2 — Engagement Tracker ──────────────────────────────────
  // Premier des deux atteint déclenche tryShowBanner() :
  //   A) Fermeture d'une modale bon-modal (open puis close)
  //   B) 10 secondes écoulées depuis init
  function setupEngagementTracking() {
    if (_engagementFired) return;

    // A) Timer 10s
    _engagementTimer = setTimeout(function () {
      if (_engagementFired) return;
      _engagementFired = true;
      console.log('[FoxPush v2] engagement timer 10s fired');
      tryShowBanner();
    }, ENGAGEMENT_DELAY_MS);

    // B) Observer modale bon-modal : open → close
    var bonModal = $('bon-modal');
    if (!bonModal) {
      // Pas de modale bon dans le DOM : seul le timer comptera
      return;
    }

    try {
      _bonModalObserver = new MutationObserver(function () {
        var isOpen = bonModal.classList.contains('open');

        if (isOpen) {
          _bonWasOpen = true;
          return;
        }

        // Modale fermée APRÈS avoir été ouverte = engagement
        if (!isOpen && _bonWasOpen) {
          _bonWasOpen = false;

          if (_engagementFired) return;
          _engagementFired = true;

          // Annuler le timer (engagement déjà acquis)
          if (_engagementTimer) {
            clearTimeout(_engagementTimer);
            _engagementTimer = null;
          }

          // Petit délai (300ms) pour laisser la modale finir son anim de fermeture
          // avant d'afficher le bandeau (évite chevauchement visuel).
          console.log('[FoxPush v2] engagement bon-modal closed fired');
          setTimeout(function () { tryShowBanner(); }, 300);
        }
      });

      _bonModalObserver.observe(bonModal, {
        attributes: true,
        attributeFilter: ['class']
      });
    } catch (e) {
      console.warn('[FoxPush v2] MutationObserver setup failed', e);
    }
  }

  // ── Mise à jour section Aide ────────────────────────────────────
  function updateAideStatus(OneSignal) {
    var section = $('help-push-section');
    var statusBlock = $('help-push-status');
    var statusValue = $('help-push-status-value');
    var hint = $('help-push-hint');
    var btn = $('help-push-activate-btn');

    if (!section || !statusBlock || !statusValue || !hint || !btn) return;

    // Si pas d'AppId : indisponible
    if (!_appId) {
      section.hidden = false;
      statusBlock.hidden = false;
      statusValue.textContent = 'Indisponible';
      statusValue.className = 'fe-push-status-value is-default';
      hint.hidden = false;
      hint.textContent = 'Le service de notifications n\'est pas encore configuré pour cette boutique.';
      btn.hidden = true;
      return;
    }

    // SDK pas prêt : chargement
    if (!_isOSReady || !OneSignal) {
      section.hidden = false;
      statusBlock.hidden = false;
      statusValue.textContent = 'Chargement…';
      statusValue.className = 'fe-push-status-value is-default';
      hint.hidden = true;
      btn.hidden = true;
      return;
    }

    // ⚠️ v2 — PWA pas installée : recommander d'installer d'abord
    if (_displayMode !== 'standalone') {
      section.hidden = false;
      statusBlock.hidden = false;
      statusValue.textContent = 'Non activées';
      statusValue.className = 'fe-push-status-value is-default';
      hint.hidden = false;
      hint.textContent = 'Pour recevoir vos bons en notifications, vous devez d\'abord installer la carte sur votre écran d\'accueil.';
      btn.hidden = true;
      return;
    }

    // PWA installée : cas standards
    var permissionStatus = 'default';
    try {
      var perm = OneSignal.Notifications.permission;
      if (typeof perm === 'string') permissionStatus = perm;
      else if (perm === true) permissionStatus = 'granted';
      else if (typeof Notification !== 'undefined') permissionStatus = Notification.permission;
    } catch (_) { /* ignore */ }

    section.hidden = false;
    statusBlock.hidden = false;

    if (permissionStatus === 'granted') {
      statusValue.textContent = '✅ Activées';
      statusValue.className = 'fe-push-status-value is-granted';
      hint.hidden = true;
      btn.hidden = true;
    } else if (permissionStatus === 'denied') {
      statusValue.textContent = '❌ Désactivées';
      statusValue.className = 'fe-push-status-value is-denied';
      hint.hidden = false;
      hint.textContent = 'Pour les réactiver, allez dans les paramètres de votre navigateur ou téléphone (paramètres du site).';
      btn.hidden = true;
    } else {
      // ⚠️ v2 — bouton manuel TOUJOURS accessible (même après 3 refus)
      statusValue.textContent = 'Non activées';
      statusValue.className = 'fe-push-status-value is-default';
      hint.hidden = true;
      btn.hidden = false;
    }
  }

  // ── Synchronise le petit hint du bouton carte avec l'état réel ──
  function syncNotifHint(OneSignal) {
    var hint = $('notif-hint');
    var btn  = $('notif-btn');
    if (!hint) return;
    // PWA non installée
    var standalone = (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
    if (!standalone) {
      hint.textContent = 'Installez d’abord l’app sur votre écran d’accueil (bouton Partager → « Sur l’écran d’accueil »).';
      return;
    }
    if (!OneSignal || !_isOSReady) return; // laisse le texte courant
    var permissionStatus = 'default';
    try {
      var perm = OneSignal.Notifications.permission;
      if (typeof perm === 'string') permissionStatus = perm;
      else if (perm === true) permissionStatus = 'granted';
      else if (typeof Notification !== 'undefined') permissionStatus = Notification.permission;
    } catch (_) {}
    var optedIn = false;
    try { optedIn = OneSignal.User.PushSubscription.optedIn === true; } catch (_) {}
    if (permissionStatus === 'granted' && optedIn) {
      hint.textContent = 'Touchez pour gérer vos notifications.';
      if (btn) btn.textContent = '✅ Notifications activées';
    } else if (permissionStatus === 'denied') {
      hint.textContent = 'Notifications refusées. Réactivez-les dans les réglages de votre téléphone (paramètres du site).';
    } else {
      hint.textContent = '';
    }
  }

  // ── Demande permission (déclenchée par bouton client) ───────────
  function requestPermission() {
    if (!_isOSReady || !window.OneSignal) {
      console.warn('[FoxPush v2] cannot request permission: SDK not ready');
      return;
    }

    // ⚠️ v2 — règle stricte : PWA installée obligatoire (toutes plateformes)
    if (_displayMode !== 'standalone') {
      console.warn('[FoxPush v2] PWA not installed: permission not allowed');
      return;
    }

    var OneSignal = window.OneSignal;

    function forceSub() {
      // Force l'abonnement + re-tag même si iOS dit déjà "accordé"
      try { OneSignal.User.PushSubscription.optIn(); } catch (e) {}
      try { applyTags(OneSignal); } catch (e) {}
      if (_carteData && _carteData.code_client) { try { OneSignal.login(String(_carteData.code_client)); } catch (e) {} }
      readAndPostState(OneSignal);
      hideBanner();
      updateAideStatus(OneSignal);
      syncNotifHint(OneSignal);
    }
    try {
      OneSignal.Notifications.requestPermission().then(forceSub).catch(function (err) {
        console.warn('[FoxPush v2] requestPermission failed', err);
        forceSub();
      });
    } catch (e) {
      console.warn('[FoxPush v2] requestPermission exception', e);
    }
  }

  // ── État réel de l'abonnement push (permission accordée + opt-in) ─
  function isPushActive() {
    var OneSignal = window.OneSignal;
    if (!_isOSReady || !OneSignal) return false;
    var granted = false, optedIn = false;
    try {
      var p = OneSignal.Notifications.permission;
      granted = (p === true || p === 'granted' ||
        (typeof Notification !== 'undefined' && Notification.permission === 'granted'));
    } catch (_) {}
    try { optedIn = OneSignal.User.PushSubscription.optedIn === true; } catch (_) {}
    return granted && optedIn;
  }

  // ── Désactiver les notifications (opt-out depuis l'app) ──────────
  function disablePush() {
    var OneSignal = window.OneSignal;
    if (!_isOSReady || !OneSignal) return;
    try { OneSignal.User.PushSubscription.optOut(); } catch (e) {}
    try { readAndPostState(OneSignal); } catch (e) {}
    try { updateAideStatus(OneSignal); } catch (e) {}
    try { syncNotifHint(OneSignal); } catch (e) {}
  }

  // ── Wiring boutons ──────────────────────────────────────────────
  function wireButtons() {
    // Bandeau : Activer
    var bannerActivate = $('push-banner-activate');
    if (bannerActivate) {
      bannerActivate.addEventListener('click', function () {
        requestPermission();
      });
    }

    // Bandeau : Plus tard
    var bannerDismiss = $('push-banner-dismiss');
    if (bannerDismiss) {
      bannerDismiss.addEventListener('click', function () {
        hideBanner();
        recordDismissedLocal();
      });
    }

    // Section Aide : Activer (toujours dispo, même après 3 refus)
    var helpActivate = $('help-push-activate-btn');
    if (helpActivate) {
      helpActivate.addEventListener('click', function () {
        requestPermission();
      });
    }
  }

  // ── API publique ────────────────────────────────────────────────
  window.FoxPush = {
    init: function (data) {
      _carteData     = data || null;
      _displayMode   = detectDisplayMode();
      _platform      = detectPlatform();
      _appId         = resolveAppId(data);
      _boutiqueName  = resolveBoutiqueName(data);

      // Appliquer textes dynamiques (avec nom boutique) immédiatement
      applyDynamicTexts();

      // Wiring boutons (toujours, même si AppId absent)
      wireButtons();

      // Affichage initial section Aide (avant init SDK)
      updateAideStatus(null);

      // Si AppId absent : on s'arrête ici. Pas d'init OneSignal.
      if (!_appId) {
        console.warn('[FoxPush v2] AppId absent, OneSignal disabled');
        return;
      }

      // Si PWA pas installée : on init OneSignal quand même pour mettre à
      // jour le tracking backend, mais le bandeau ne s'affichera pas
      // (cf. shouldShowBanner). La section Aide affichera la recommandation.
      initOneSignal();

      // ⚠️ v2 — Engagement tracking (premier des deux) :
      //   - timer 10s
      //   - fermeture bon-modal
      // Ne démarre que si PWA installée ET conditions globales OK.
      // Petite vérification préliminaire pour économiser les listeners.
      var earlyCheck =
        (_displayMode === 'standalone') &&
        (!isSnoozedNow()) &&
        (!reachedMaxDismiss());

      if (earlyCheck) {
        setupEngagementTracking();
      } else {
        console.log('[FoxPush v2] engagement tracking skipped',
          'displayMode=' + _displayMode,
          'snoozed=' + isSnoozedNow(),
          'maxDismiss=' + reachedMaxDismiss());
      }
    },

    // Méthodes publiques
    requestPermission: requestPermission,
    disablePush: disablePush,
    isPushActive: isPushActive
  };

})();
