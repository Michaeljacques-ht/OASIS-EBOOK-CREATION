/* OASIS Librairie EBook — composants partagés (Node.js pur côté serveur, vanilla JS côté client) */

const API = '/api';
const CLE_PANIER = 'oasis_panier';
const CLE_EMAIL = 'oasis_email';

/* ---------- Panier (localStorage) ---------- */
const Panier = {
  lire() { try { return JSON.parse(localStorage.getItem(CLE_PANIER)) || []; } catch { return []; } },
  ecrire(p) { localStorage.setItem(CLE_PANIER, JSON.stringify(p)); majBadgePanier(); },
  ajouter(id, quantite = 1) {
    const p = Panier.lire();
    const existant = p.find(a => a.id === id);
    if (existant) existant.quantite += quantite;
    else p.push({ id, quantite });
    Panier.ecrire(p);
  },
  changerQuantite(id, quantite) {
    let p = Panier.lire();
    const a = p.find(x => x.id === id);
    if (a) a.quantite = Math.max(1, quantite);
    Panier.ecrire(p);
  },
  retirer(id) { Panier.ecrire(Panier.lire().filter(a => a.id !== id)); },
  vider() { Panier.ecrire([]); },
  nombre() { return Panier.lire().reduce((s, a) => s + a.quantite, 0); }
};

function majBadgePanier() {
  const n = Panier.nombre();
  for (const id of ['badge-panier', 'badge-panier-mobile']) {
    const b = document.getElementById(id);
    if (b) { b.textContent = n; b.style.display = n ? 'grid' : 'none'; }
  }
  const compteur = document.getElementById('menu-compteur-panier');
  if (compteur) { compteur.textContent = n; compteur.style.display = n ? 'inline-block' : 'none'; }
}

/* ---------- Notifications ---------- */
function notifier(message) {
  let n = document.querySelector('.notif');
  if (!n) { n = document.createElement('div'); n.className = 'notif'; document.body.appendChild(n); }
  n.textContent = message;
  n.classList.add('visible');
  clearTimeout(n._t);
  n._t = setTimeout(() => n.classList.remove('visible'), 2400);
}

/* ---------- Aides ---------- */
/* ---------- Devise : gourdes (HTG) ---------- */
let CONFIG = { devise: 'HTG', montantMin: 20 };
let _promesseConfig = null;

async function initConfig() {
  if (!_promesseConfig) {
    _promesseConfig = fetch(API + '/config')
      .then(r => r.json())
      .then(c => { CONFIG = c; })
      .catch(() => {});
  }
  return _promesseConfig;
}

// Les prix sont stockés et affichés en gourdes
function prix(montant) {
  return Math.round(montant).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ') + ' HTG';
}

const etoiles = (note) => '★ ' + note.toFixed(1);

function htmlCouverture(livre, classes = '') {
  if (livre.couvertureUrl) {
    return `<div class="couverture ${classes}" style="padding:0;background:#111827">
      <img src="${livre.couvertureUrl}" alt="Couverture : ${livre.titre}"
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    </div>`;
  }
  return `<div class="couverture ${classes}" style="background:linear-gradient(150deg,${livre.couleur},${livre.couleur2})">
    <div class="titre-couv">${livre.titre}</div>
    <div class="marque-couv">OASIS ÉDITION</div>
  </div>`;
}

function styleMiniCouv(livre) {
  return livre && livre.couvertureUrl
    ? `url(${livre.couvertureUrl}) center/cover`
    : `linear-gradient(150deg,${(livre && livre.couleur) || '#1E3A8A'},${(livre && livre.couleur2) || '#3B82F6'})`;
}

function htmlCarteLivre(livre) {
  const etiquettes = [];
  if (livre.nouveaute) etiquettes.push('<span class="ui-etiq ui-etiq-vedette">Nouveau</span>');
  else if (livre.ventes > 180) etiquettes.push('<span class="ui-etiq ui-etiq-dispo">Populaire</span>');
  etiquettes.push(`<span class="ui-etiq ui-etiq-cat">${livre.categorie}</span>`);
  const note = livre.avis > 0
    ? `<span class="etoiles">${etoiles(livre.note)} <span class="small">(${livre.avis})</span></span>` : '';

  return `<article class="carte-livre">
    <a class="zone-couv" href="produit.html?id=${livre.id}">${htmlCouverture(livre)}</a>
    <div class="carte-livre-corps">
      <div class="etiquettes">${etiquettes.join('')}</div>
      <a class="titre" href="produit.html?id=${livre.id}">${livre.titre}</a>
      <span class="auteur">✍️ ${livre.auteur}</span>
      ${note}
      <div class="ligne-prix">
        <span class="prix">${prix(livre.prix)}</span>
        <button class="ui-btn ui-btn-marine btn-acheter"
          aria-label="Ajouter ${livre.titre} au panier"
          onclick="Panier.ajouter('${livre.id}');notifier('Ajouté au panier : ${livre.titre.replace(/'/g, "\\'")}')">
          Ajouter <span class="fleche">→</span>
        </button>
      </div>
    </div>
  </article>`;
}


/* ---------- Partage social ---------- */
function htmlPartage(titre, auteur, lien) {
  const url = encodeURIComponent(lien);
  const texte = encodeURIComponent(`« ${titre} » de ${auteur} — à lire sur OASIS Librairie EBook`);
  return `<div class="ui-partage">
    <span class="intitule">Partager :</span>
    <a class="pt-facebook" title="Partager sur Facebook" aria-label="Partager sur Facebook" target="_blank" rel="noopener"
       href="https://www.facebook.com/sharer/sharer.php?u=${url}">f</a>
    <a class="pt-whatsapp" title="Partager sur WhatsApp" aria-label="Partager sur WhatsApp" target="_blank" rel="noopener"
       href="https://wa.me/?text=${texte}%20${url}">✆</a>
    <a class="pt-x" title="Partager sur X" aria-label="Partager sur X" target="_blank" rel="noopener"
       href="https://twitter.com/intent/tweet?text=${texte}&url=${url}">𝕏</a>
    <a class="pt-linkedin" title="Partager sur LinkedIn" aria-label="Partager sur LinkedIn" target="_blank" rel="noopener"
       href="https://www.linkedin.com/sharing/share-offsite/?url=${url}">in</a>
    <button class="pt-lien" title="Copier le lien" aria-label="Copier le lien"
            onclick="copierLien(this, '${lien}')">🔗</button>
  </div>`;
}

async function copierLien(bouton, lien) {
  try {
    await navigator.clipboard.writeText(lien);
  } catch {
    // Repli pour les navigateurs sans presse-papiers (ou hors HTTPS)
    const zone = document.createElement('textarea');
    zone.value = lien; zone.style.position = 'fixed'; zone.style.opacity = '0';
    document.body.appendChild(zone); zone.select();
    try { document.execCommand('copy'); } catch {}
    zone.remove();
  }
  bouton.classList.add('copie'); bouton.textContent = '✓';
  if (typeof notifier === 'function') notifier('Lien copié');
  setTimeout(() => { bouton.classList.remove('copie'); bouton.textContent = '🔗'; }, 2000);
}

/* ---------- Session client ---------- */
const CLE_JETON_CLIENT = 'oasis_jeton_client';
const Compte = {
  jeton: () => localStorage.getItem(CLE_JETON_CLIENT),
  connecte: () => !!localStorage.getItem(CLE_JETON_CLIENT),
  entetes(supplement = {}) {
    const j = Compte.jeton();
    return j ? { ...supplement, Authorization: 'Bearer ' + j } : supplement;
  },
  async charger() {
    if (!Compte.connecte()) return null;
    try {
      const r = await fetch(API + '/compte/moi', { headers: Compte.entetes() });
      if (!r.ok) { Compte.oublier(); return null; }
      const d = await r.json();
      Compte.profil = d.compte;
      return d;
    } catch { return null; }
  },
  memoriser(jeton, compte) {
    localStorage.setItem(CLE_JETON_CLIENT, jeton);
    if (compte && compte.email) localStorage.setItem(CLE_EMAIL, compte.email);
    Compte.profil = compte;
  },
  oublier() { localStorage.removeItem(CLE_JETON_CLIENT); Compte.profil = null; },
  profil: null
};

/* ---------- En-tête / pied de page ---------- */
function injecterEntete(pageActive = '') {
  const el = document.getElementById('entete');
  if (!el) return;
  const actif = (p) => pageActive === p ? 'actif' : '';
  el.innerHTML = `
  <div class="conteneur">
    <div class="entete-haut">
      <a class="logo" href="index.html">
        <img src="/images/logo-librairie.png" alt="OASIS Librairie EBook">
      </a>
      <form class="recherche" onsubmit="event.preventDefault();location='catalogue.html?q='+encodeURIComponent(this.q.value)">
        <input name="q" placeholder="Rechercher un livre, auteur, ISBN..." aria-label="Rechercher">
        <button type="submit" aria-label="Lancer la recherche">🔍</button>
      </form>
      <div class="actions-entete">
        <a class="icone-action" href="/livre/" title="OASIS EBook Édition — Maison d'édition">🏛️</a>
        <a class="icone-action" href="favoris.html" title="Mes favoris">♡<span class="badge" id="badge-favoris" style="display:none">0</span></a>
        <a class="icone-action" href="bibliotheque.html" title="Ma bibliothèque">📚</a>
        <a class="icone-action" href="panier.html" title="Panier">🛒<span class="badge" id="badge-panier">0</span></a>
        <a class="icone-action" href="compte.html" title="Mon compte" id="lien-compte">👤</a>
      </div>
      <!-- Mobile : recherche dépliable, panier et menu -->
      <button class="ui-loupe-mobile" id="bouton-loupe" aria-label="Rechercher" aria-expanded="false">🔍</button>
      <a class="icone-action icone-mobile" href="panier.html" aria-label="Panier">🛒<span class="badge" id="badge-panier-mobile">0</span></a>
      <button class="ui-burger" id="bouton-menu" aria-label="Ouvrir le menu" aria-expanded="false">☰</button>
    </div>

    <div class="ui-recherche-mobile" id="recherche-mobile">
      <form onsubmit="event.preventDefault();location='catalogue.html?q='+encodeURIComponent(this.q.value)">
        <input name="q" placeholder="Titre, auteur, matière…" aria-label="Rechercher un livre">
        <button type="submit" aria-label="Lancer la recherche">🔍</button>
      </form>
    </div>

    <nav class="nav-principale" aria-label="Navigation principale">
      <a href="index.html" class="${actif('accueil')}">Accueil</a>
      <a href="catalogue.html" class="${actif('catalogue')}">Catalogue</a>
      <a href="catalogue.html?nouveaute=1" class="${actif('nouveautes')}">Nouveautés</a>
      <a href="bibliotheque.html" class="${actif('bibliotheque')}">Ma bibliothèque</a>
      <a href="/livre/">Maison d'édition</a>
    </nav>
  </div>`;

  injecterMenuMobile(pageActive);
  majBadgePanier();
  majEnteteCompte();
}

/* ---------- Menu mobile ---------- */
function injecterMenuMobile(pageActive = '') {
  if (document.getElementById('menu-mobile')) return;
  const actif = (p) => pageActive === p ? 'actif' : '';
  const panneau = document.createElement('div');
  panneau.innerHTML = `
    <div class="ui-voile" id="voile-menu"></div>
    <aside class="ui-menu-mobile" id="menu-mobile" role="dialog" aria-label="Menu" aria-modal="true">
      <div class="ui-menu-tete">
        <img src="/images/logo-librairie.png" alt="OASIS Librairie EBook">
        <button class="ui-menu-fermer" id="fermer-menu" aria-label="Fermer le menu">✕</button>
      </div>

      <div class="ui-menu-section">
        <p class="ui-menu-titre">Boutique</p>
        <a href="index.html" class="${actif('accueil')}"><span class="ico">🏠</span> Accueil</a>
        <a href="catalogue.html" class="${actif('catalogue')}"><span class="ico">📚</span> Catalogue</a>
        <a href="catalogue.html?nouveaute=1"><span class="ico">✨</span> Nouveautés</a>
        <a href="panier.html"><span class="ico">🛒</span> Mon panier
          <span class="compteur" id="menu-compteur-panier" style="display:none">0</span></a>
      </div>

      <div class="ui-menu-section">
        <p class="ui-menu-titre">Mon espace</p>
        <a href="bibliotheque.html"><span class="ico">📖</span> Ma bibliothèque</a>
        <a href="favoris.html"><span class="ico">♡</span> Mes favoris
          <span class="compteur" id="menu-compteur-favoris" style="display:none">0</span></a>
        <a href="suivi.html"><span class="ico">📦</span> Suivi de commande</a>
        <a href="compte.html" id="menu-lien-compte"><span class="ico">👤</span> Mon compte</a>
      </div>

      <div class="ui-menu-section">
        <p class="ui-menu-titre">Maison d'édition</p>
        <a href="/livre/"><span class="ico">🏛️</span> OASIS EBook Édition</a>
        <a href="/livre/auteurs.html"><span class="ico">✍️</span> Nos auteurs</a>
        <a href="/livre/index.html#manuscrit"><span class="ico">📝</span> Publier un manuscrit</a>
      </div>

      <div class="ui-menu-section">
        <p class="ui-menu-titre">Aide</p>
        <a href="faq.html"><span class="ico">❓</span> Questions fréquentes</a>
        <a href="/livre/contact.html"><span class="ico">✉️</span> Nous contacter</a>
      </div>

      <div class="ui-menu-pied" id="menu-pied"></div>
    </aside>`;
  document.body.appendChild(panneau);

  const menu = document.getElementById('menu-mobile');
  const voile = document.getElementById('voile-menu');
  const burger = document.getElementById('bouton-menu');

  const ouvrir = () => {
    menu.classList.add('ouvert'); voile.classList.add('ouvert');
    burger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    menu.querySelector('a').focus({ preventScroll: true });
  };
  const fermer = () => {
    menu.classList.remove('ouvert'); voile.classList.remove('ouvert');
    burger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };
  burger?.addEventListener('click', ouvrir);
  voile.addEventListener('click', fermer);
  document.getElementById('fermer-menu').addEventListener('click', fermer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });

  // Recherche dépliable
  const loupe = document.getElementById('bouton-loupe');
  const zone = document.getElementById('recherche-mobile');
  loupe?.addEventListener('click', () => {
    const ouverte = zone.classList.toggle('ouverte');
    loupe.setAttribute('aria-expanded', String(ouverte));
    if (ouverte) zone.querySelector('input').focus();
  });
}

async function majEnteteCompte() {
  const lien = document.getElementById('lien-compte');
  const pied = document.getElementById('menu-pied');
  const lienMenu = document.getElementById('menu-lien-compte');

  if (!Compte.connecte()) {
    if (lien) lien.title = 'Se connecter ou créer un compte';
    if (pied) pied.innerHTML = `
      <a class="ui-btn ui-btn-marine" href="compte.html">Se connecter</a>
      <a class="ui-btn ui-btn-contour" href="compte.html?inscription=1">Créer un compte</a>
      <p>Vos livres, vos favoris et vos commandes au même endroit.</p>`;
    return;
  }

  const d = await Compte.charger();
  if (!d) {
    if (pied) pied.innerHTML = `<a class="ui-btn ui-btn-marine" href="compte.html">Se connecter</a>`;
    return;
  }

  const initiale = (d.compte.nom || d.compte.email)[0].toUpperCase();
  if (lien) {
    lien.innerHTML = `<span class="pastille-compte">${initiale}</span>`;
    lien.title = d.compte.nom + ' — mon compte';
  }
  if (lienMenu) lienMenu.innerHTML = `<span class="ico">👤</span> ${d.compte.nom}`;

  const n = (d.compte.favoris || []).length;
  for (const id of ['badge-favoris', 'menu-compteur-favoris']) {
    const b = document.getElementById(id);
    if (b && n) { b.textContent = n; b.style.display = id === 'badge-favoris' ? 'grid' : 'inline-block'; }
  }
  if (pied) pied.innerHTML = `
    <a class="ui-btn ui-btn-marine" href="bibliotheque.html">📚 Ma bibliothèque</a>
    <a class="ui-btn ui-btn-contour" href="compte.html">Mon compte</a>
    <p>Connecté en tant que ${d.compte.email}</p>`;
}

function injecterPied() {
  const el = document.getElementById('pied');
  if (!el) return;
  el.innerHTML = `
  <div class="conteneur">
    <div class="pied-grille">
      <div>
        <a class="logo" href="index.html" style="margin-bottom:10px">
          <img src="/images/logo-librairie.png" alt="OASIS Librairie EBook">
        </a>
        <p class="small">Découvrez, lisez, inspirez-vous. Des milliers d'ouvrages et manuels numériques conformes au curriculum du MENFP.</p>
      </div>
      <div>
        <b>Boutique</b>
        <a href="catalogue.html">Catalogue</a>
        <a href="catalogue.html?nouveaute=1">Nouveautés</a>
        <a href="bibliotheque.html">Ma bibliothèque</a>
        <a href="favoris.html">Mes favoris</a>
        <a href="suivi.html">Suivi de commande</a>
        <a href="compte.html">Mon compte</a>
      </div>
      <div>
        <b>OASIS EBook Édition</b>
        <a href="/livre/">Maison d'édition</a>
        <a href="/livre/#manuscrit">Soumettre un manuscrit</a>
        <a href="/livre/#auteurs">Nos auteurs</a>
      </div>
      <div>
        <b>Informations</b>
        <a href="faq.html">Questions fréquentes</a>
        <a href="conditions.html">Conditions d'utilisation</a>
        <a href="confidentialite.html">Politique de confidentialité</a>
        <a href="remboursement.html">Politique de remboursement</a>
      </div>
      <div>
        <b>Paiements acceptés</b>
        <p class="small">MonCash · NatCash · Kashpaw — paiements sécurisés à 100 %, propulsés par PLOP PLOP.</p>
      </div>
    </div>
    <p class="copyright">© ${new Date().getFullYear()} EDUCA Technologie — OASIS Librairie EBook & OASIS EBook Édition. Tous droits réservés.</p>
  </div>`;
}

/* ---------- API ---------- */
async function chargerLivres(parametres = {}) {
  await initConfig();
  const p = new URLSearchParams(parametres);
  const r = await fetch(`${API}/livres?${p}`);
  return r.json();
}
async function chargerLivre(id) {
  await initConfig();
  const r = await fetch(`${API}/livres/${id}`);
  if (!r.ok) throw new Error('introuvable');
  return r.json();
}
