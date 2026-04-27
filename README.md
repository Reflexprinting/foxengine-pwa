# FoxEngine PWA — Phase 2.1 polish-14
## Déploiement via Cloudflare Pages Functions + GitHub

### Nouveauté polish-14
Manifest dynamique par boutique servi par une **Cloudflare Pages Function** sur l'URL HTTPS réelle `/manifest.webmanifest?code=XXX`. Plus aucun blob: → l'icône d'app installée sur Android est désormais correcte.

---

## Structure du projet

```
foxengine-pwa-phase2.1-polish-14/
├── public/                                 (assets statiques — drag&drop possible aussi)
│   ├── _config.json                        v phase2.1-polish-14
│   ├── manifest.webmanifest                FALLBACK statique FoxEngine (sera masqué par la Function)
│   ├── ma-carte.html
│   ├── index.html
│   ├── sw.js
│   └── assets/
│       ├── css/ma-carte.css
│       ├── icons/                          icônes PWA fallback FoxEngine
│       └── js/
│           ├── api.js
│           ├── jsbarcode.min.js
│           ├── ma-carte.js                 ← simplifié, plus de blob
│           ├── qrcode.min.js
│           └── theme.js
└── functions/                              ← NOUVEAU dossier
    └── manifest.webmanifest.js             Cloudflare Pages Function
                                            Route : /manifest.webmanifest
```

---

## Procédure de déploiement (premier déploiement avec Functions)

### Étape 1 — Pousser les fichiers sur GitHub

1. Décompresse le ZIP `foxengine-pwa-phase2.1-polish-14.zip`
2. Tu obtiens un dossier `foxengine-pwa-phase2.1-polish-14/` contenant `public/` et `functions/`
3. Va sur https://github.com/Reflexprinting/foxengine-pwa
4. Si le repo est vide ou différent de cette structure, tu as 2 options :

#### Option 1A — Via interface web GitHub (le plus simple, pas de Git en local)
- Sur la page du repo, clique sur **Add file → Upload files**
- Glisse-dépose **les 2 dossiers** `public/` et `functions/` dans la zone d'upload
- Si le repo a déjà du contenu : supprime d'abord les anciens fichiers (cocher "Replace all files" n'existe pas, il faut supprimer manuellement ou créer une PR)
- En bas, message de commit : `polish-14: Cloudflare Pages Functions manifest dynamique`
- Clique **Commit changes**

#### Option 1B — Via Git en local (plus rapide ensuite)
```bash
git clone https://github.com/Reflexprinting/foxengine-pwa.git
cd foxengine-pwa
# Supprime tout le contenu existant
rm -rf public functions README.md
# Copie le contenu du ZIP décompressé
cp -r /chemin/vers/foxengine-pwa-phase2.1-polish-14/* .
git add .
git commit -m "polish-14: Cloudflare Pages Functions manifest dynamique"
git push origin main
```

### Étape 2 — Reconfigurer Cloudflare Pages en mode Git

⚠️ **Important** : Cloudflare Pages Functions ne fonctionnent **PAS** avec le drag&drop. Il faut basculer en mode Git.

1. Va sur https://dash.cloudflare.com → **Workers & Pages** → projet `foxengine-pwa`
2. Onglet **Settings** → **Builds & deployments**
3. Tu devrais voir "Source: Direct Upload" — clique sur **Connect to Git** (ou créer un nouveau projet Pages connecté à Git si l'option n'apparaît pas)
4. Si tu dois créer un nouveau projet :
   - **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
   - Authorise GitHub si demandé
   - Sélectionne le repo `Reflexprinting/foxengine-pwa`
   - **Project name** : `foxengine-pwa` (ou un autre nom — l'URL pages.dev sera basée dessus)
   - **Production branch** : `main`
   - **Build settings** :
     - Framework preset : **None**
     - Build command : *(laisse vide)*
     - Build output directory : `public`
     - Root directory : *(laisse vide)*
   - Clique **Save and Deploy**

### Étape 3 — Vérifier que la Function est bien détectée

Après le 1ᵉʳ déploiement Git :
1. Cloudflare Pages → projet → **Functions** (onglet)
2. Tu dois voir `/manifest.webmanifest` listé comme route Function
3. Si elle n'apparaît pas, vérifie que le fichier est bien à `functions/manifest.webmanifest.js` à la racine du repo

### Étape 4 — Tester immédiatement

#### Test A — Endpoint Function direct (vérification raw)
Dans un navigateur, ouvre :
```
https://foxengine-pwa.pages.dev/manifest.webmanifest?code=BT-503721
```

Tu dois voir un JSON manifest avec :
- `"name": "Bœuf Tricolore Rochefort"` (ou enseigne CMS)
- `"theme_color": "#9F191A"` (couleurPrimaire CMS)
- `"background_color": "#0F4E8F"` (couleurSecondaire CMS)
- `"icons": [{ "src": "https://static.wixstatic.com/...", ... }, ...]` (logoUrl CMS en 1ʳᵉ position)
- `"start_url": "/ma-carte.html?code=BT-503721#code=BT-503721"`

Si tu vois ce JSON → la Function fonctionne ✅

#### Test B — Sans code (fallback FoxEngine)
```
https://foxengine-pwa.pages.dev/manifest.webmanifest
```
Tu dois voir le manifest FoxEngine générique avec icônes par défaut.

#### Test C — Console DevTools
Ouvre `https://foxengine-pwa.pages.dev/ma-carte?code=BT-503721#code=BT-503721`
- F12 → Application → Manifest
- Tu dois voir les valeurs CMS (name boutique, couleurs, icônes)
- F12 → Console : aucun warning Manifest

#### Test D — Réinstallation Android Chrome (le test critique)
1. Désinstalle l'ancienne PWA "Ma Carte" du Galaxy
2. Chrome → ouvre l'URL avec code
3. Menu 3 points → **Installer l'application**
4. ✅ **Attendu** : icône d'app installée = **logo Bœuf Tricolore CMS** (et non plus le F bleu FoxEngine)

#### Test E — iOS toujours OK (anti-régression)
1. Désinstalle ancienne PWA iPhone
2. Safari → ouvre l'URL avec code
3. Partager → Sur l'écran d'accueil → Ajouter
4. ✅ **Attendu** : carte se charge depuis l'icône, **logo Bœuf Tricolore** comme icône d'app

---

## Anti-régression respectée

- ❌ CODE128 (carte + bons) non touché
- ❌ API Wix non touchée (lit juste l'endpoint existant `getPublicClientData`)
- ❌ Endpoints Wix existants non modifiés
- ❌ Collections Wix non touchées
- ❌ Backend Wix non modifié
- ❌ Service Worker non touché
- ❌ Logique welcome non touchée
- ❌ Bouton Aide non touché
- ❌ Texte Samsung non touché
- ❌ Logique cookie/localStorage code non touchée
- ❌ CSS non touché
- ❌ Manifest statique fallback inchangé (md5 préservé)
- ✅ ma-carte.js simplifié : 2 fonctions blob remplacées par 2 fonctions simples (setManifestHref + setAppleTouchIcon)
- ✅ apple-touch-icon dynamique conservé pour iPhone

---

## Procédure pour les déploiements futurs (après config Git)

Une fois Cloudflare Pages connecté à GitHub :
- Chaque `git push origin main` (ou upload via interface web GitHub) déclenche **automatiquement** un nouveau déploiement
- Plus besoin de drag & drop
- Tu peux voir l'historique des déploiements dans Cloudflare Pages → Deployments

---

## Réserves connues (non bloquantes)

1. **Icônes PWA aux formats dédiés** : le `logoUrl` CMS est utilisé brut. Idéalement il faudrait des versions carrées 192/512/180 dédiées par boutique. Réserve consignée pour traitement futur.
2. **HMAC absent** : interdiction de diffusion publique large avant Phase 1B.

---

**md5 du ZIP** : à calculer après création (voir réponse Claude)
