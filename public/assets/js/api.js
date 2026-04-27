// FoxEngine PWA — Wrapper API
// Centralise les appels aux endpoints Wix. Aucune URL en dur ailleurs.

let _config = null;

async function loadConfig() {
  if (_config) return _config;
  const res = await fetch('/_config.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Config introuvable');
  _config = await res.json();
  return _config;
}

async function apiGet(endpoint, params) {
  const cfg = await loadConfig();
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const url = cfg.wixApiBase + '/' + endpoint + qs;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    let detail = {};
    try { detail = await res.json(); } catch (_) {}
    const err = new Error(detail.message || ('Erreur ' + res.status));
    err.status = res.status;
    err.code = detail.error || 'HTTP_ERROR';
    throw err;
  }
  return res.json();
}

async function apiPost(endpoint, body) {
  const cfg = await loadConfig();
  const url = cfg.wixApiBase + '/' + endpoint;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    let detail = {};
    try { detail = await res.json(); } catch (_) {}
    const err = new Error(detail.message || ('Erreur ' + res.status));
    err.status = res.status;
    err.code = detail.error || 'HTTP_ERROR';
    throw err;
  }
  return res.json();
}

window.FoxApi = {
  getPublicClientData: (code) => apiGet('getPublicClientData', { code }),
  getBoutiquePublic:   (boutiqueId) => apiGet('getBoutiquePublic', { boutiqueId }),
  getQrConfig:         (boutiqueId) => apiGet('getQrConfig', { boutiqueId }),
  signalerAide:        (payload) => apiPost('signalerDemandeAideInstallation', payload)
};
