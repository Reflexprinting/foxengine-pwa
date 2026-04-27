// FoxEngine PWA — Thème dynamique
// Applique couleurs boutique sur les variables CSS — aucune couleur en dur dans le rendu.

window.FoxTheme = {
  apply(boutique) {
    if (!boutique) return;
    const root = document.documentElement.style;
    if (boutique.couleurPrimaire)   root.setProperty('--primary',   boutique.couleurPrimaire);
    if (boutique.couleurSecondaire) root.setProperty('--secondary', boutique.couleurSecondaire);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && boutique.couleurPrimaire) meta.setAttribute('content', boutique.couleurPrimaire);

    const logoEl = document.getElementById('shop-logo');
    if (logoEl && boutique.logoUrl) logoEl.src = boutique.logoUrl;
  }
};
