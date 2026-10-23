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
  const b = document.getElementById('badge-panier');
  if (!b) return;
  const n = Panier.nombre();
  b.textContent = n;
  b.style.display = n ? 'grid' : 'none';
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
    </div>
    <nav class="nav-principale" aria-label="Navigation principale">
      <a href="index.html" class="${pageActive === 'accueil' ? 'actif' : ''}">Accueil</a>
      <a href="catalogue.html" class="${pageActive === 'catalogue' ? 'actif' : ''}">Catégories</a>
      <a href="catalogue.html?nouveaute=1" class="${pageActive === 'nouveautes' ? 'actif' : ''}">Nouveautés</a>
      <a href="catalogue.html?tri=note">Promotions</a>
      <a href="/livre/">Auteurs & Éditions</a>
    </nav>
  </div>`;
  majBadgePanier();
  majEnteteCompte();
}

async function majEnteteCompte() {
  const lien = document.getElementById('lien-compte');
  if (!lien) return;
  if (!Compte.connecte()) { lien.title = 'Se connecter ou créer un compte'; return; }
  const d = await Compte.charger();
  if (!d) { lien.title = 'Se connecter ou créer un compte'; return; }
  const initiale = (d.compte.nom || d.compte.email)[0].toUpperCase();
  lien.innerHTML = `<span class="pastille-compte">${initiale}</span>`;
  lien.title = d.compte.nom + ' — mon compte';
  const badge = document.getElementById('badge-favoris');
  const n = (d.compte.favoris || []).length;
  if (badge && n) { badge.textContent = n; badge.style.display = 'grid'; }
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
