// FoxEngine PWA — Thème dynamique
// Applique couleurs boutique sur les variables CSS — aucune couleur en dur dans le rendu.
// Note : le logo boutique est désormais géré exclusivement par renderShop()
// dans ma-carte.js (validation stricte + fallback discret + log si absent).

window.FoxTheme = {
  apply(boutique) {
    if (!boutique) return;
    const root = document.documentElement.style;
    if (boutique.couleurPrimaire)   root.setProperty('--primary',   boutique.couleurPrimaire);
    if (boutique.couleurSecondaire) root.setProperty('--secondary', boutique.couleurSecondaire);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && boutique.couleurPrimaire) meta.setAttribute('content', boutique.couleurPrimaire);
  }
};

/* ─── Bloc 100% isolé : récupération carte sur clic d'un push de promo ───
   Problème traité : quand le client clique sur une notification de promotion,
   le lien ouvre /ma-carte?promo=<id> SANS code carte. Dans un navigateur neuf
   (ex. iOS : le push ouvre Safari, pas l'app installée → pas de code mémorisé),
   ma-carte.js affiche l'écran #state-error intitulé « Carte indisponible », ce
   qui ressemble à une erreur alors qu'une simple récupération suffit.

   Ce bloc ne s'active QUE dans ce cas précis (paramètre ?promo= présent ET
   aucun code dans l'URL) : il remplace le titre par « Retrouvez votre carte »
   et un message orienté offre. Le formulaire de récupération par téléphone
   (déjà injecté par ma-carte.js) reste identique.

   Il ne touche NI le push, NI ma-carte.js, NI le chargement normal de la carte
   (si un code est présent/mémorisé, la carte se charge et ce bloc ne fait rien).
   Entièrement réversible : supprimer ce bloc. */
(function () {
  try {
    if (!/\/ma-carte/i.test(location.pathname)) return;
    var qs = new URLSearchParams(location.search);
    var hasPromo = !!qs.get('promo');
    var hashCode = (location.hash || '').replace(/^#/, '').trim();
    var hasCode = !!(qs.get('code') || hashCode);
    if (!hasPromo || hasCode) return; // uniquement : clic promo, sans code

    function apply() {
      var sec = document.getElementById('state-error');
      if (!sec) return false;
      var shown = sec.offsetParent !== null ||
                  (window.getComputedStyle ? getComputedStyle(sec).display !== 'none' : false);
      if (!shown) return false;
      var h = sec.querySelector('h2');
      if (h) h.textContent = 'Retrouvez votre carte';
      var m = document.getElementById('error-msg');
      if (m) m.textContent = 'Une offre de votre boucherie vous attend — retrouvez votre carte avec votre numéro de téléphone pour en profiter :';
      return true;
    }

    function start() {
      if (apply()) return;
      var sec = document.getElementById('state-error');
      if (!sec || typeof MutationObserver === 'undefined') { setTimeout(apply, 800); return; }
      var obs = new MutationObserver(function () { if (apply()) obs.disconnect(); });
      obs.observe(sec, { attributes: true, attributeFilter: ['style', 'class'] });
      setTimeout(function () { try { obs.disconnect(); } catch (_) {} }, 8000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  } catch (_) {}
})();
