// FoxEngine PWA — Page Ma Carte
(function() {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const showState = (name) => {
    document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
    const el = $(name);
    if (el) el.classList.add('active');
  };

  function getCodeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('code') || '').trim();
  }

  function fmtEuro(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) { return '—'; }
  }

  function renderShop(data) {
    const b = data.boutique || {};
    if (b.logoUrl) $('shop-logo').src = b.logoUrl;
    $('shop-name').textContent = b.enseigne || b.nom || '';
    $('shop-city').textContent = [b.codePostal, b.ville].filter(Boolean).join(' ');
  }

  function renderCard(data) {
    const fullName = ((data.prenom || '') + ' ' + (data.nom || '')).trim() || 'Client';
    $('card-name').textContent = fullName;
    $('card-code').textContent = data.code_client || '';

    const qrTarget = $('qr-canvas');
    qrTarget.innerHTML = '';
    new window.QRCode(qrTarget, {
      text: data.code_client || '',
      width: 140,
      height: 140
    });
  }

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
      $('fid-msg').innerHTML = 'Plus que <strong>' + fmtEuro(reste) + '</strong> avant votre prochain bon de ' + fmtEuro(data.montantBon || 0);
    } else {
      $('fid-msg').textContent = 'Bienvenue dans le programme fidélité.';
    }
  }

  function renderBons(data) {
    const list = Array.isArray(data.bons) ? data.bons : [];
    const box = $('bons-list');
    if (!list.length) {
      box.innerHTML = '<div class="empty">Aucun bon d\'achat actif.</div>';
      return;
    }
    box.innerHTML = list.map(b => `
      <div class="bon">
        <div class="bon-amount">${fmtEuro(b.montant)}</div>
        <div class="bon-meta">${b.code || '—'} · émis le ${fmtDate(b.date_creation)} · ${b.boutique_emission || '—'}</div>
      </div>
    `).join('');
  }

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
      return `
        <div class="passage">
          <div>
            <div class="passage-date">${fmtDate(p.date)}</div>
            <small style="color:var(--muted);font-size:11px;">${p.boutique || ''}${p.mode_paiement ? ' · ' + p.mode_paiement : ''}</small>
          </div>
          <div class="passage-amount ${cls}">${sign}${fmtEuro(Math.abs(m))}</div>
        </div>
      `;
    }).join('');
  }

  function renderInfos(data) {
    const i = data.infos || {};
    const rows = [];
    if (i.horairesLunVen) rows.push(`<div class="info-row"><strong>Lun–Ven</strong><span>${i.horairesLunVen}</span></div>`);
    if (i.horairesSam)    rows.push(`<div class="info-row"><strong>Samedi</strong><span>${i.horairesSam}</span></div>`);
    if (i.horairesDim)    rows.push(`<div class="info-row"><strong>Dimanche</strong><span>${i.horairesDim}</span></div>`);
    if (i.horairesFeries) rows.push(`<div class="info-row"><strong>Fériés</strong><span>${i.horairesFeries}</span></div>`);

    const promos = [];
    if (i.promoEnCours)  promos.push(`<div class="info-promo">🥩 ${i.promoEnCours}</div>`);
    if (i.offreSpeciale) promos.push(`<div class="info-promo">⭐ ${i.offreSpeciale}</div>`);
    if (i.infoMessage)   promos.push(`<div class="info-promo">ℹ️ ${i.infoMessage}</div>`);

    const html = rows.join('') + promos.join('');
    if (html.trim()) {
      $('infos-block').innerHTML = html;
      $('infos-section').style.display = 'block';
    } else {
      $('infos-section').style.display = 'none';
    }
  }

  function renderUpdated() {
    const now = new Date();
    $('updated-at').textContent = now.toLocaleDateString('fr-FR') + ' · ' +
                                  now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  $('help-btn').addEventListener('click', () => $('help-modal').classList.add('open'));
  $('help-close').addEventListener('click', () => $('help-modal').classList.remove('open'));
  $('help-modal').addEventListener('click', (e) => {
    if (e.target.id === 'help-modal') $('help-modal').classList.remove('open');
  });

  async function init() {
    const code = getCodeFromUrl();
    if (!code) {
      showState('state-error');
      $('error-msg').textContent = 'Aucun code client fourni dans l\'URL.';
      return;
    }

    showState('state-loading');

    try {
      const data = await window.FoxApi.getPublicClientData(code);
      window.FoxTheme.apply(data.boutique);
      renderShop(data);
      renderCard(data);
      renderFidelity(data);
      renderBons(data);
      renderPassages(data);
      renderInfos(data);
      renderUpdated();
      showState('state-ready');
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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .catch(err => console.warn('[ma-carte] SW register fail:', err));
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
