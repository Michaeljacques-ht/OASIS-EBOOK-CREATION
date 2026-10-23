/**
 * OASIS Plateforme — Serveur unifié
 * ---------------------------------
 * OASIS Librairie EBook  →  http://localhost:3000/librairie/
 * OASIS EBook Édition      →  http://localhost:3000/livre/
 *
 * Node.js pur — zéro dépendance npm — base de données JSON.
 * © EDUCA Technologie
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ═══════════ CONFIGURATION (.env) ═══════════
 * Au démarrage, on lit un fichier .env placé à côté de ce serveur, s'il existe.
 * Les variables déjà définies dans l'environnement gardent la priorité.
 * Le fichier .env ne doit JAMAIS être versionné (voir .gitignore).
 */
(function chargerEnv() {
  const fichier = require('path').join(__dirname, '.env');
  if (!require('fs').existsSync(fichier)) return;
  for (const ligne of require('fs').readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const nette = ligne.trim();
    if (!nette || nette.startsWith('#')) continue;
    const sep = nette.indexOf('=');
    if (sep < 1) continue;
    const cle = nette.slice(0, sep).trim();
    let valeur = nette.slice(sep + 1).trim();
    if ((valeur.startsWith('"') && valeur.endsWith('"')) ||
        (valeur.startsWith("'") && valeur.endsWith("'"))) valeur = valeur.slice(1, -1);
    if (process.env[cle] === undefined) process.env[cle] = valeur;
  }
  console.log('\u2713 Configuration chargée depuis .env');
})();

/* ═══════════ PASSERELLE DE PAIEMENT PLOP PLOP ═══════════
 * Module partagé avec Konekte : plopplop.js
 * ⚠️ Clés dans les variables d'environnement PLOP_CLIENT_ID / PLOP_CLIENT_SECRET
 *    (ou le fichier .env), jamais dans le code.
 */
const plopplop = require('./plopplop.js');
const PLOP = plopplop.PLOP;
const passerelleActive = plopplop.passerelleActive;

/* 💰 Toute la plateforme fonctionne en GOURDES (HTG) — devise unique.
 *    Les prix du catalogue, les commandes et les paiements sont en HTG. */
const DEVISE = 'HTG';

const PORT = process.env.PORT || 3000;

// ⚙️ MOT DE PASSE ADMIN — changez-le ici avant la mise en production
const MOT_DE_PASSE_ADMIN = process.env.ADMIN_MDP || 'educa2026';
const jetonsAdmin = new Set(); // jetons de session en mémoire
const RACINE = __dirname;
const PUBLIC = path.join(RACINE, 'public');
const DB_FICHIER = path.join(RACINE, 'data', 'db.json');

/* ---------- Base de données JSON ---------- */

// Au premier démarrage (ex. disque persistant vide sur Render), on initialise
// la base à partir du catalogue de départ livré avec le code.
function initialiserDB() {
  if (fs.existsSync(DB_FICHIER)) return;
  const graine = path.join(RACINE, 'data', 'db-initial.json');
  fs.mkdirSync(path.dirname(DB_FICHIER), { recursive: true });
  fs.writeFileSync(DB_FICHIER, fs.existsSync(graine)
    ? fs.readFileSync(graine, 'utf8')
    : JSON.stringify({ categories: [], codesPromo: {}, livres: [], commandes: [],
                       manuscrits: [], newsletter: [], retraits: [] }, null, 2), 'utf8');
  console.log('✓ Base de données initialisée : data/db.json');
}
initialiserDB();

function lireDB() {
  return JSON.parse(fs.readFileSync(DB_FICHIER, 'utf8'));
}
function ecrireDB(db) {
  fs.writeFileSync(DB_FICHIER, JSON.stringify(db, null, 2), 'utf8');
}

/* ---------- Utilitaires HTTP ---------- */

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function envoyerJSON(res, code, objet) {
  const corps = JSON.stringify(objet);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(corps);
}

function lireCorps(req, limite = 1e6) {
  return new Promise((resolve, reject) => {
    let brut = '';
    req.on('data', (morceau) => {
      brut += morceau;
      if (brut.length > limite) { req.destroy(); reject(new Error('Fichier trop volumineux')); }
    });
    req.on('end', () => {
      try { resolve(brut ? JSON.parse(brut) : {}); }
      catch (e) { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

/* ---------- Fichiers téléversés (couvertures, PDF, manuscrits) ---------- */

function sauverBase64(sousDossier, nomFichier, dataURL, maxOctets) {
  const virgule = dataURL.indexOf(',');
  const donnees = Buffer.from(virgule >= 0 ? dataURL.slice(virgule + 1) : dataURL, 'base64');
  if (donnees.length > maxOctets)
    throw new Error(`Fichier trop volumineux (max ${Math.round(maxOctets / 1e6)} Mo)`);
  const dossier = path.join(__dirname, 'data', 'fichiers', sousDossier);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, nomFichier), donnees);
  return donnees.length;
}

function extensionImage(dataURL) {
  const m = /^data:([\w/+.-]+);base64,/.exec(dataURL || '');
  const table = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  return (m && table[m[1]]) || 'jpg';
}

function extensionDocument(nom) {
  const ext = path.extname(nom || '').toLowerCase().slice(1);
  return ['pdf', 'epub', 'docx'].includes(ext) ? ext : 'pdf';
}

const TYPES_FICHIERS = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp',
  pdf: 'application/pdf', epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

function diffuserFichier(res, sousDossier, nomFichier, telechargement) {
  const chemin = path.join(__dirname, 'data', 'fichiers', sousDossier, nomFichier);
  if (!fs.existsSync(chemin)) return envoyerJSON(res, 404, { erreur: 'Fichier introuvable' });
  const ext = path.extname(nomFichier).toLowerCase().slice(1);
  const entetes = { 'Content-Type': TYPES_FICHIERS[ext] || 'application/octet-stream' };
  if (telechargement) entetes['Content-Disposition'] = `attachment; filename="${telechargement}"`;
  else entetes['Cache-Control'] = 'public, max-age=3600';
  res.writeHead(200, entetes);
  fs.createReadStream(chemin).pipe(res);
}

function supprimerFichierLivre(livre) {
  for (const [sousDossier, nom] of [['couvertures', livre.couvertureFichier], ['documents', livre.documentFichier]]) {
    if (!nom) continue;
    const chemin = path.join(__dirname, 'data', 'fichiers', sousDossier, nom);
    try { fs.unlinkSync(chemin); } catch {}
  }
}


/* ═══════════ COMPTES CLIENTS ═══════════
 * Mots de passe hachés avec scrypt (module natif), jamais en clair.
 * Les jetons sont stockés en base : ils survivent au redémarrage du serveur,
 * contrairement aux sessions admin.
 */
function hacherMotDePasse(motDePasse) {
  const sel = crypto.randomBytes(16).toString('hex');
  const empreinte = crypto.scryptSync(motDePasse, sel, 64).toString('hex');
  return sel + ':' + empreinte;
}
function verifierMotDePasse(motDePasse, stocke) {
  const [sel, empreinte] = String(stocke || '').split(':');
  if (!sel || !empreinte) return false;
  const calcul = crypto.scryptSync(motDePasse, sel, 64);
  const attendu = Buffer.from(empreinte, 'hex');
  return calcul.length === attendu.length && crypto.timingSafeEqual(calcul, attendu);
}
const JOURS_SESSION = 30;
function creerSessionClient(db, compte) {
  db.sessions = db.sessions || [];
  // Purge des sessions expirées
  const maintenant = Date.now();
  db.sessions = db.sessions.filter(s => new Date(s.expire).getTime() > maintenant);
  const jeton = crypto.randomBytes(32).toString('hex');
  db.sessions.push({
    jeton, email: compte.email,
    cree: new Date().toISOString(),
    expire: new Date(maintenant + JOURS_SESSION * 86400000).toISOString()
  });
  return jeton;
}
function compteDepuisJeton(db, req) {
  const jeton = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!jeton) return null;
  const session = (db.sessions || []).find(s => s.jeton === jeton);
  if (!session || new Date(session.expire).getTime() < Date.now()) return null;
  return (db.comptes || []).find(c => c.email === session.email) || null;
}
// Vue publique d'un compte (jamais le mot de passe)
const compteSansSecret = (c) => ({
  email: c.email, nom: c.nom, telephone: c.telephone || '',
  ville: c.ville || '', inscrit: c.inscrit, favoris: c.favoris || []
});
const emailValide = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(e || '').trim());

/* ---------- Construction d'une commande ---------- */

function construireCommande(db, corps, paye) {
  let sousTotal = 0;
  const lignes = [];
  for (const art of corps.articles) {
    const livre = db.livres.find(l => l.id === art.id);
    if (!livre) throw new Error(`Livre inconnu : ${art.id}`);
    const q = Math.max(1, parseInt(art.quantite, 10) || 1);
    sousTotal += livre.prix * q;
    lignes.push({ id: livre.id, titre: livre.titre, prix: livre.prix, quantite: q });
  }

  let remise = 0;
  if (corps.codePromo && db.codesPromo[corps.codePromo.toUpperCase()])
    remise = sousTotal * db.codesPromo[corps.codePromo.toUpperCase()];
  const total = Math.round(sousTotal - remise); // gourdes entières

  const maintenant = new Date().toISOString();
  const contientPapier = corps.articles.some(art => {
    const livre = db.livres.find(l => l.id === art.id);
    return livre && /papier/i.test(livre.format || '');
  });

  const suivi = [{ libelle: 'Commande reçue', date: maintenant }];
  suivi.push({
    libelle: 'Paiement confirmé (' + (corps.paiement || 'MonCash') + ')',
    date: paye ? maintenant : null
  });
  suivi.push({
    libelle: 'Livres numériques débloqués dans votre bibliothèque',
    date: paye ? maintenant : null
  });
  if (contientPapier) {
    suivi.push({ libelle: 'Impression de vos exemplaires papier', date: null });
    suivi.push({ libelle: 'Expédition', date: null });
    suivi.push({ libelle: 'Livraison', date: null });
  } else {
    suivi.push({ libelle: 'Commande terminée', date: paye ? maintenant : null });
  }

  return {
    id: 'CMD-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    date: maintenant,
    email: corps.email.trim().toLowerCase(),
    nom: corps.nom || '',
    articles: lignes,
    sousTotal: Math.round(sousTotal),
    remise: Math.round(remise),
    total,
    paiement: corps.paiement || 'MonCash',
    paye,
    statut: paye ? (contientPapier ? 'en préparation' : 'terminée') : 'en attente de paiement',
    suivi
  };
}

// Marquer une commande comme payée : débloque la bibliothèque et les compteurs
function confirmerPaiement(db, commande, infosTransaction = {}) {
  if (commande.paye) return commande;
  commande.paye = true;
  Object.assign(commande, infosTransaction);
  const maintenant = new Date().toISOString();
  const contientPapier = commande.articles.some(a => {
    const livre = db.livres.find(l => l.id === a.id);
    return livre && /papier/i.test(livre.format || '');
  });
  // Dater les étapes jusqu'au déblocage de la bibliothèque (et la clôture si tout numérique)
  for (const etape of commande.suivi) {
    if (etape.date) continue;
    if (/impression|expédition|livraison/i.test(etape.libelle)) break;
    etape.date = maintenant;
  }
  commande.statut = contientPapier ? 'en préparation' : 'terminée';
  for (const a of commande.articles) {
    const livre = db.livres.find(l => l.id === a.id);
    if (livre) livre.ventes += a.quantite;
  }
  return commande;
}

/* ---------- Routes API ---------- */

async function routerAPI(req, res, url) {
  const db = lireDB();
  const segments = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // Vérification du jeton admin (réutilisée par les routes protégées)
  const estAdmin = () => {
    const jeton = (req.headers.authorization || '').replace('Bearer ', '');
    return jetonsAdmin.has(jeton);
  };


  // GET /api/livres?boutique=librairie|livre&categorie=&niveau=&q=
  if (req.method === 'GET' && segments[1] === 'livres' && !segments[2]) {
    let livres = db.livres.slice();
    const p = url.searchParams;
    if (p.get('boutique') === 'librairie') livres = livres.filter(l => l.enVente);
    if (p.get('boutique') === 'livre') livres = livres.filter(l => l.editionEduca);
    if (p.get('categorie') && p.get('categorie') !== 'Tous')
      livres = livres.filter(l => l.categorie === p.get('categorie'));
    if (p.get('niveau') && p.get('niveau') !== 'Tous les niveaux')
      livres = livres.filter(l => l.niveau === p.get('niveau'));
    if (p.get('matiere') && p.get('matiere') !== 'Toutes les matières')
      livres = livres.filter(l => l.matiere === p.get('matiere'));
    if (p.get('nouveaute') === '1') livres = livres.filter(l => l.nouveaute);
    if (p.get('q')) {
      const q = p.get('q').toLowerCase();
      livres = livres.filter(l =>
        l.titre.toLowerCase().includes(q) ||
        l.auteur.toLowerCase().includes(q) ||
        (l.isbn || '').toLowerCase().includes(q));
    }
    const tri = p.get('tri');
    if (tri === 'prix-asc') livres.sort((a, b) => a.prix - b.prix);
    else if (tri === 'prix-desc') livres.sort((a, b) => b.prix - a.prix);
    else if (tri === 'note') livres.sort((a, b) => b.note - a.note);
    else livres.sort((a, b) => b.ventes - a.ventes); // populaire
    return envoyerJSON(res, 200, livres);
  }

  // GET /api/livres/:id
  if (req.method === 'GET' && segments[1] === 'livres' && segments[2]) {
    const livre = db.livres.find(l => l.id === segments[2]);
    if (!livre) return envoyerJSON(res, 404, { erreur: 'Livre introuvable' });
    return envoyerJSON(res, 200, livre);
  }

  // GET /api/categories
  if (req.method === 'GET' && segments[1] === 'categories') {
    return envoyerJSON(res, 200, db.categories);
  }

  // POST /api/commandes — paiement simulé (mode démo, si la passerelle n'est pas configurée)
  if (req.method === 'POST' && segments[1] === 'commandes') {
    const corps = await lireCorps(req);
    if (!corps.email || !Array.isArray(corps.articles) || corps.articles.length === 0)
      return envoyerJSON(res, 400, { erreur: 'Email et articles requis' });
    let commande;
    try { commande = construireCommande(db, corps, false); }
    catch (e) { return envoyerJSON(res, 400, { erreur: e.message }); }
    confirmerPaiement(db, commande, { modePaiement: 'simulé' });
    db.commandes.push(commande);
    ecrireDB(db);
    return envoyerJSON(res, 201, commande);
  }

  // GET /api/config — devise d'affichage et taux (public)
  if (req.method === 'GET' && segments[1] === 'config') {
    return envoyerJSON(res, 200, {
      devise: DEVISE,
      montantMin: PLOP.montantMinHTG,
      passerelleActive: passerelleActive()
    });
  }

  // GET /api/paiement/config — la passerelle est-elle active ? (info publique)
  if (req.method === 'GET' && segments[1] === 'paiement' && segments[2] === 'config') {
    return envoyerJSON(res, 200, {
      active: passerelleActive(),
      devise: DEVISE,
      methodes: plopplop.METHODES
    });
  }

  // POST /api/paiement/initier — créer la commande + la transaction PLOP PLOP
  if (req.method === 'POST' && segments[1] === 'paiement' && segments[2] === 'initier') {
    if (!passerelleActive())
      return envoyerJSON(res, 503, { erreur: 'Passerelle non configurée (PLOP_CLIENT_ID / PLOP_CLIENT_SECRET)' });
    const corps = await lireCorps(req);
    if (!corps.email || !Array.isArray(corps.articles) || corps.articles.length === 0)
      return envoyerJSON(res, 400, { erreur: 'Email et articles requis' });

    let commande;
    try { commande = construireCommande(db, corps, false); }
    catch (e) { return envoyerJSON(res, 400, { erreur: e.message }); }

    const resultat = await plopplop.initierPaiement({
      reference: commande.id,            // notre référence CMD-XXXXXXXX
      montant: commande.total,           // gourdes
      methode: corps.methode
    });
    if (!resultat.ok)
      return envoyerJSON(res, 502, {
        erreur: resultat.error, codePasserelle: resultat.codePasserelle
      });

    commande.methodePasserelle = resultat.methode;
    commande.transactionId = resultat.transactionId;
    commande.modePaiement = 'PLOP PLOP';
    db.commandes.push(commande);
    ecrireDB(db);

    return envoyerJSON(res, 201, {
      reference: commande.id,
      montant: commande.total,
      devise: DEVISE,
      urlPaiement: resultat.urlPaiement,
      transactionId: commande.transactionId
    });
  }

  // GET /api/paiement/verifier?ref= — interroger PLOP PLOP et confirmer si payé
  if (req.method === 'GET' && segments[1] === 'paiement' && segments[2] === 'verifier') {
    const ref = (url.searchParams.get('ref') || '').trim().toUpperCase();
    const commande = db.commandes.find(c => c.id === ref);
    if (!commande) return envoyerJSON(res, 404, { erreur: 'Commande introuvable' });
    if (commande.paye)
      return envoyerJSON(res, 200, { paye: true, statut: commande.statut, commande });
    if (!passerelleActive())
      return envoyerJSON(res, 503, { erreur: 'Passerelle non configurée' });

    const verif = await plopplop.verifierPaiement(commande.id);
    if (!verif.ok) return envoyerJSON(res, 502, { erreur: verif.error });

    if (verif.paye) {
      const infos = verif.infos || {};
      confirmerPaiement(db, commande, {
        transactionId: infos.transactionId || commande.transactionId,
        methodePasserelle: infos.methode || commande.methodePasserelle,
        dateTransaction: infos.dateTransaction || ''
      });
      ecrireDB(db);
      return envoyerJSON(res, 200, { paye: true, statut: commande.statut, commande });
    }
    return envoyerJSON(res, 200, {
      paye: false, statut: 'en attente de paiement',
      message: verif.message || 'Paiement non encore confirmé par la passerelle'
    });
  }

  // GET /api/commandes?email=  → bibliothèque de l'utilisateur
  if (req.method === 'GET' && segments[1] === 'commandes') {
    const email = (url.searchParams.get('email') || '').trim().toLowerCase();
    if (!email) return envoyerJSON(res, 400, { erreur: 'Email requis' });
    const commandes = db.commandes.filter(c => c.email === email && c.paye !== false);
    return envoyerJSON(res, 200, commandes);
  }

  // ═══════════ COMPTES CLIENTS ═══════════

  // POST /api/compte/inscription  { nom, email, motDePasse, telephone, ville }
  if (req.method === 'POST' && segments[1] === 'compte' && segments[2] === 'inscription') {
    const c = await lireCorps(req);
    const email = String(c.email || '').trim().toLowerCase();
    const nom = String(c.nom || '').trim();
    const motDePasse = String(c.motDePasse || '');
    if (!nom) return envoyerJSON(res, 400, { erreur: 'Votre nom est requis' });
    if (!emailValide(email)) return envoyerJSON(res, 400, { erreur: 'Adresse email invalide' });
    if (motDePasse.length < 8)
      return envoyerJSON(res, 400, { erreur: 'Le mot de passe doit contenir au moins 8 caractères' });

    db.comptes = db.comptes || [];
    if (db.comptes.some(x => x.email === email))
      return envoyerJSON(res, 409, { erreur: 'Un compte existe déjà avec cet email. Connectez-vous.' });

    const compte = {
      email, nom, motDePasse: hacherMotDePasse(motDePasse),
      telephone: String(c.telephone || '').trim(),
      ville: String(c.ville || '').trim(),
      inscrit: new Date().toISOString(), favoris: []
    };
    db.comptes.push(compte);
    const jeton = creerSessionClient(db, compte);
    ecrireDB(db);
    return envoyerJSON(res, 201, { jeton, compte: compteSansSecret(compte) });
  }

  // POST /api/compte/connexion  { email, motDePasse }
  if (req.method === 'POST' && segments[1] === 'compte' && segments[2] === 'connexion') {
    const c = await lireCorps(req);
    const email = String(c.email || '').trim().toLowerCase();
    const compte = (db.comptes || []).find(x => x.email === email);
    // Même message dans les deux cas : on ne révèle pas quels emails existent
    if (!compte || !verifierMotDePasse(String(c.motDePasse || ''), compte.motDePasse))
      return envoyerJSON(res, 401, { erreur: 'Email ou mot de passe incorrect' });
    const jeton = creerSessionClient(db, compte);
    ecrireDB(db);
    return envoyerJSON(res, 200, { jeton, compte: compteSansSecret(compte) });
  }

  // POST /api/compte/deconnexion
  if (req.method === 'POST' && segments[1] === 'compte' && segments[2] === 'deconnexion') {
    const jeton = (req.headers.authorization || '').replace('Bearer ', '').trim();
    db.sessions = (db.sessions || []).filter(s => s.jeton !== jeton);
    ecrireDB(db);
    return envoyerJSON(res, 200, { ok: true });
  }

  // GET /api/compte/moi — profil + commandes du client connecté
  if (req.method === 'GET' && segments[1] === 'compte' && segments[2] === 'moi') {
    const compte = compteDepuisJeton(db, req);
    if (!compte) return envoyerJSON(res, 401, { erreur: 'Session expirée, reconnectez-vous' });
    const commandes = db.commandes.filter(x => x.email === compte.email && x.paye !== false);
    const livresAchetes = new Set();
    commandes.forEach(cmd => cmd.articles.forEach(a => livresAchetes.add(a.id)));
    return envoyerJSON(res, 200, {
      compte: compteSansSecret(compte),
      commandes: commandes.length,
      livres: livresAchetes.size
    });
  }

  // PUT /api/compte/moi — modifier le profil (et le mot de passe)
  if (req.method === 'PUT' && segments[1] === 'compte' && segments[2] === 'moi') {
    const compte = compteDepuisJeton(db, req);
    if (!compte) return envoyerJSON(res, 401, { erreur: 'Session expirée, reconnectez-vous' });
    const c = await lireCorps(req);
    if (c.nom !== undefined) compte.nom = String(c.nom).trim() || compte.nom;
    if (c.telephone !== undefined) compte.telephone = String(c.telephone).trim();
    if (c.ville !== undefined) compte.ville = String(c.ville).trim();
    if (c.nouveauMotDePasse) {
      if (!verifierMotDePasse(String(c.motDePasseActuel || ''), compte.motDePasse))
        return envoyerJSON(res, 403, { erreur: 'Mot de passe actuel incorrect' });
      if (String(c.nouveauMotDePasse).length < 8)
        return envoyerJSON(res, 400, { erreur: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
      compte.motDePasse = hacherMotDePasse(String(c.nouveauMotDePasse));
      // Toutes les autres sessions sont révoquées
      const jetonActuel = (req.headers.authorization || '').replace('Bearer ', '').trim();
      db.sessions = (db.sessions || []).filter(s => s.email !== compte.email || s.jeton === jetonActuel);
    }
    ecrireDB(db);
    return envoyerJSON(res, 200, { compte: compteSansSecret(compte) });
  }

  // POST /api/compte/favoris  { id }  — bascule un livre en favori
  if (req.method === 'POST' && segments[1] === 'compte' && segments[2] === 'favoris') {
    const compte = compteDepuisJeton(db, req);
    if (!compte) return envoyerJSON(res, 401, { erreur: 'Connectez-vous pour gérer vos favoris' });
    const c = await lireCorps(req);
    const livre = db.livres.find(l => l.id === c.id);
    if (!livre) return envoyerJSON(res, 404, { erreur: 'Livre introuvable' });
    compte.favoris = compte.favoris || [];
    const i = compte.favoris.indexOf(livre.id);
    const ajoute = i === -1;
    if (ajoute) compte.favoris.push(livre.id); else compte.favoris.splice(i, 1);
    ecrireDB(db);
    return envoyerJSON(res, 200, { favori: ajoute, favoris: compte.favoris });
  }

  // GET /api/compte/favoris — les livres mis en favori
  if (req.method === 'GET' && segments[1] === 'compte' && segments[2] === 'favoris') {
    const compte = compteDepuisJeton(db, req);
    if (!compte) return envoyerJSON(res, 401, { erreur: 'Connectez-vous pour voir vos favoris' });
    const favoris = (compte.favoris || [])
      .map(id => db.livres.find(l => l.id === id)).filter(Boolean);
    return envoyerJSON(res, 200, favoris);
  }

  // ═══════════ PROFILS D'AUTEURS ═══════════
  // Chaque auteur du catalogue peut avoir une fiche publique qu'il remplit
  // lui-même, après que l'éditeur a relié son compte à son nom d'auteur.

  // GET /api/auteurs — tous les auteurs avec leur profil et leurs titres (public)
  if (req.method === 'GET' && segments[1] === 'auteurs' && !segments[2]) {
    const profils = db.auteurs || {};
    const parNom = new Map();
    for (const l of db.livres.filter(x => x.editionEduca)) {
      if (!parNom.has(l.auteur)) parNom.set(l.auteur, []);
      parNom.get(l.auteur).push({ id: l.id, titre: l.titre, prix: l.prix, matiere: l.matiere,
        categorie: l.categorie, couleur: l.couleur, couleur2: l.couleur2,
        couvertureUrl: l.couvertureUrl || null });
    }
    return envoyerJSON(res, 200, [...parNom.entries()].map(([nom, livres]) => ({
      nom, livres, profil: profils[nom] || null
    })));
  }

  // GET /api/auteurs/:nom — fiche d'un auteur (public)
  if (req.method === 'GET' && segments[1] === 'auteurs' && segments[2]) {
    const nom = decodeURIComponent(segments[2]);
    const livres = db.livres.filter(l => l.auteur === nom && l.editionEduca);
    if (!livres.length) return envoyerJSON(res, 404, { erreur: 'Auteur introuvable' });
    return envoyerJSON(res, 200, {
      nom, profil: (db.auteurs || {})[nom] || null,
      livres: livres.map(l => ({ id: l.id, titre: l.titre, prix: l.prix, matiere: l.matiere,
        categorie: l.categorie, description: l.description, couleur: l.couleur,
        couleur2: l.couleur2, couvertureUrl: l.couvertureUrl || null, nouveaute: l.nouveaute }))
    });
  }

  // GET /api/compte/auteur — le compte connecté est-il lié à un auteur ?
  if (req.method === 'GET' && segments[1] === 'compte' && segments[2] === 'auteur') {
    const compte = compteDepuisJeton(db, req);
    if (!compte) return envoyerJSON(res, 401, { erreur: 'Session expirée, reconnectez-vous' });
    if (!compte.auteurLie)
      return envoyerJSON(res, 200, { auteur: null,
        message: "Votre compte n'est pas encore relié à une fiche d'auteur." });
    return envoyerJSON(res, 200, {
      auteur: compte.auteurLie,
      profil: (db.auteurs || {})[compte.auteurLie] || null,
      livres: db.livres.filter(l => l.auteur === compte.auteurLie).length
    });
  }

  // PUT /api/compte/auteur — l'auteur remplit sa propre fiche
  if (req.method === 'PUT' && segments[1] === 'compte' && segments[2] === 'auteur') {
    const compte = compteDepuisJeton(db, req);
    if (!compte) return envoyerJSON(res, 401, { erreur: 'Session expirée, reconnectez-vous' });
    if (!compte.auteurLie)
      return envoyerJSON(res, 403, { erreur: "Votre compte n'est pas relié à une fiche d'auteur" });
    const c = await lireCorps(req, 8e6);   // photo comprise
    db.auteurs = db.auteurs || {};
    const profil = db.auteurs[compte.auteurLie] || {};

    const texte = (v, max) => String(v || '').trim().slice(0, max);
    if (c.titreProfessionnel !== undefined) profil.titreProfessionnel = texte(c.titreProfessionnel, 120);
    if (c.biographie !== undefined) profil.biographie = texte(c.biographie, 2500);
    if (c.ville !== undefined) profil.ville = texte(c.ville, 80);
    if (c.formation !== undefined) profil.formation = texte(c.formation, 300);
    if (c.siteWeb !== undefined) profil.siteWeb = texte(c.siteWeb, 200);
    if (c.facebook !== undefined) profil.facebook = texte(c.facebook, 200);
    if (c.linkedin !== undefined) profil.linkedin = texte(c.linkedin, 200);
    if (c.emailPublic !== undefined) profil.emailPublic = texte(c.emailPublic, 120);
    if (c.disponiblePour !== undefined)
      profil.disponiblePour = Array.isArray(c.disponiblePour)
        ? c.disponiblePour.slice(0, 6).map(x => texte(x, 60))
        : texte(c.disponiblePour, 300).split(',').map(s => s.trim()).filter(Boolean);

    if (c.photoBase64) {
      const nomFichier = compte.auteurLie.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        + '.' + extensionImage(c.photoBase64);
      sauverBase64('auteurs', nomFichier, c.photoBase64, 2e6);
      profil.photoFichier = nomFichier;
      profil.photoUrl = '/api/auteurs-photo/' + encodeURIComponent(nomFichier);
    }
    profil.majLe = new Date().toISOString();
    db.auteurs[compte.auteurLie] = profil;
    ecrireDB(db);
    return envoyerJSON(res, 200, { profil });
  }

  // GET /api/auteurs-photo/:fichier — portrait (public)
  if (req.method === 'GET' && segments[1] === 'auteurs-photo' && segments[2]) {
    const nomFichier = path.basename(decodeURIComponent(segments[2]));
    return diffuserFichier(res, 'auteurs', nomFichier);
  }

  // POST /api/admin/auteurs/lier  { email, auteur } — l'éditeur relie un compte 🔒
  if (req.method === 'POST' && segments[1] === 'admin' && segments[2] === 'auteurs' && segments[3] === 'lier') {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const c = await lireCorps(req);
    const email = String(c.email || '').trim().toLowerCase();
    const auteur = String(c.auteur || '').trim();
    const compte = (db.comptes || []).find(x => x.email === email);
    if (!compte) return envoyerJSON(res, 404, { erreur: "Aucun compte client avec cet email. L'auteur doit d'abord créer son compte sur la librairie." });
    if (auteur && !db.livres.some(l => l.auteur === auteur))
      return envoyerJSON(res, 404, { erreur: 'Aucun livre publié sous ce nom d\'auteur' });
    compte.auteurLie = auteur || null;
    ecrireDB(db);
    return envoyerJSON(res, 200, { email, auteur: compte.auteurLie });
  }

  // GET /api/admin/auteurs — liaisons existantes 🔒
  if (req.method === 'GET' && segments[1] === 'admin' && segments[2] === 'auteurs') {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const noms = [...new Set(db.livres.filter(l => l.editionEduca).map(l => l.auteur))];
    return envoyerJSON(res, 200, noms.map(nom => {
      const compte = (db.comptes || []).find(c => c.auteurLie === nom);
      const profil = (db.auteurs || {})[nom];
      return { nom, email: compte ? compte.email : null,
               profilRempli: !!(profil && profil.biographie),
               livres: db.livres.filter(l => l.auteur === nom).length };
    }));
  }

  // POST /api/admin/connexion  { motDePasse } → { jeton }
  if (req.method === 'POST' && segments[1] === 'admin' && segments[2] === 'connexion') {
    const corps = await lireCorps(req);
    if (corps.motDePasse !== MOT_DE_PASSE_ADMIN)
      return envoyerJSON(res, 401, { erreur: 'Mot de passe incorrect' });
    const jeton = crypto.randomBytes(24).toString('hex');
    jetonsAdmin.add(jeton);
    return envoyerJSON(res, 200, { jeton });
  }

  // POST /api/admin/deconnexion
  if (req.method === 'POST' && segments[1] === 'admin' && segments[2] === 'deconnexion') {
    const jeton = (req.headers.authorization || '').replace('Bearer ', '');
    jetonsAdmin.delete(jeton);
    return envoyerJSON(res, 200, { ok: true });
  }

  // POST /api/admin/livres — publier un livre (protégé)
  // ★ Publié une seule fois : visible sur OASIS EBook Édition ET OASIS Librairie EBook ★
  if (req.method === 'POST' && segments[1] === 'admin' && segments[2] === 'livres' && !segments[3]) {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const c = await lireCorps(req, 40e6); // jusqu'à ~25 Mo de document (base64)
    if (!c.titre || !c.auteur || !(parseFloat(c.prix) >= PLOP.montantMinHTG))
      return envoyerJSON(res, 400, { erreur: 'Titre, auteur et prix (minimum ' + PLOP.montantMinHTG + ' HTG) sont requis' });

    // Identifiant unique dérivé du titre
    let base = c.titre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'livre';
    let id = base, n = 2;
    while (db.livres.some(l => l.id === id)) id = base + '-' + n++;

    const pages = parseInt(c.pages, 10) || 200;
    const livre = {
      id,
      titre: String(c.titre).trim(),
      auteur: String(c.auteur).trim(),
      prix: Math.round(parseFloat(c.prix)),
      categorie: c.categorie || 'Secondaire',
      niveau: c.niveau || 'Secondaire',
      matiere: c.matiere || 'Général',
      note: 0, avis: 0, ventes: 0,
      pages,
      taille: c.taille || (Math.round(pages * 0.04 * 10) / 10).toFixed(1).replace('.', ',') + ' Mo',
      langue: c.langue || 'Français',
      format: c.format || 'PDF',
      isbn: c.isbn || ('978-99935-' + Math.floor(10 + Math.random() * 90) + '-' + Math.floor(100 + Math.random() * 900)),
      couleur: c.couleur || '#0B1B3A',
      couleur2: c.couleur2 || '#F5B32E',
      nouveaute: c.nouveaute !== false,
      enVente: true,        // → visible sur OASIS Librairie EBook
      editionEduca: true,   // → visible sur OASIS EBook Édition
      description: c.description || '',
      motsCles: Array.isArray(c.motsCles) ? c.motsCles
        : String(c.motsCles || '').split(',').map(m => m.trim()).filter(Boolean),
      extrait: c.extrait || ''
    };

    // 🖼️ Page de couverture importée (image, max 3 Mo)
    if (c.couvertureBase64) {
      const nomCouv = id + '.' + extensionImage(c.couvertureBase64);
      sauverBase64('couvertures', nomCouv, c.couvertureBase64, 3e6);
      livre.couvertureFichier = nomCouv;
      livre.couvertureUrl = '/api/couvertures/' + id;
    }
    // 📄 Document du livre importé (PDF/ePub/DOCX, max 25 Mo)
    if (c.documentBase64) {
      const nomDoc = id + '.' + extensionDocument(c.documentNom);
      const octets = sauverBase64('documents', nomDoc, c.documentBase64, 25e6);
      livre.documentFichier = nomDoc;
      livre.documentDisponible = true;
      livre.taille = Math.max(0.1, octets / 1e6).toFixed(1).replace('.', ',') + ' Mo'; // taille réelle
    }

    db.livres.push(livre);
    ecrireDB(db);
    return envoyerJSON(res, 201, livre);
  }

  // PUT /api/admin/livres/:id — modifier un livre (protégé)
  if (req.method === 'PUT' && segments[1] === 'admin' && segments[2] === 'livres' && segments[3]) {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const livre = db.livres.find(l => l.id === segments[3]);
    if (!livre) return envoyerJSON(res, 404, { erreur: 'Livre introuvable' });
    const c = await lireCorps(req, 40e6);
    const champs = ['titre', 'auteur', 'categorie', 'niveau', 'matiere', 'pages', 'taille',
      'langue', 'format', 'isbn', 'couleur', 'couleur2', 'description', 'extrait'];
    for (const champ of champs) if (c[champ] !== undefined) livre[champ] = c[champ];
    if (c.prix !== undefined) livre.prix = Math.round(parseFloat(c.prix));
    if (c.nouveaute !== undefined) livre.nouveaute = !!c.nouveaute;
    if (c.motsCles !== undefined) livre.motsCles = Array.isArray(c.motsCles) ? c.motsCles
      : String(c.motsCles).split(',').map(m => m.trim()).filter(Boolean);

    // Remplacement de la couverture / du document
    if (c.couvertureBase64) {
      const nomCouv = livre.id + '.' + extensionImage(c.couvertureBase64);
      sauverBase64('couvertures', nomCouv, c.couvertureBase64, 3e6);
      livre.couvertureFichier = nomCouv;
      livre.couvertureUrl = '/api/couvertures/' + livre.id;
    }
    if (c.documentBase64) {
      const nomDoc = livre.id + '.' + extensionDocument(c.documentNom);
      const octets = sauverBase64('documents', nomDoc, c.documentBase64, 25e6);
      livre.documentFichier = nomDoc;
      livre.documentDisponible = true;
      livre.taille = Math.max(0.1, octets / 1e6).toFixed(1).replace('.', ',') + ' Mo';
    }

    ecrireDB(db);
    return envoyerJSON(res, 200, livre);
  }

  // DELETE /api/admin/livres/:id — retirer un livre (protégé)
  if (req.method === 'DELETE' && segments[1] === 'admin' && segments[2] === 'livres' && segments[3]) {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const index = db.livres.findIndex(l => l.id === segments[3]);
    if (index === -1) return envoyerJSON(res, 404, { erreur: 'Livre introuvable' });
    const [retire] = db.livres.splice(index, 1);
    supprimerFichierLivre(retire); // nettoyage des fichiers associés
    ecrireDB(db);
    return envoyerJSON(res, 200, { ok: true, retire: retire.titre });
  }

  // POST /api/admin/retrait — retirer les fonds (3 étapes PLOP PLOP + HMAC) 🔒
  if (req.method === 'POST' && segments[1] === 'admin' && segments[2] === 'retrait' && !segments[3]) {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    if (!passerelleActive())
      return envoyerJSON(res, 503, { erreur: 'Passerelle non configurée (PLOP_CLIENT_ID / PLOP_CLIENT_SECRET)' });

    const c = await lireCorps(req);
    const reference = c.reference || plopplop.nouvelleReferenceRetrait();

    const resultat = await plopplop.retirer({
      montant: c.montant, methode: c.methode,
      destinataire: c.destinataire, reference
    });

    // Refus de validation locale (montant ou numéro) : rien n'a été tenté
    if (!resultat.ok && !resultat.etape)
      return envoyerJSON(res, 400, { erreur: resultat.error });

    const journal = resultat.ok ? { ...resultat.retrait, succes: true } : {
      reference: resultat.reference || reference,
      montant: Math.round(parseFloat(c.montant) * 100) / 100,
      methode: c.methode, destinataire: String(c.destinataire || '').replace(/\D/g, ''),
      date: new Date().toISOString(), succes: false, statut: 'échec',
      transactionId: null, frais: null, soldeApres: null,
      message: resultat.error || '', codeErreur: resultat.codeErreur || null,
      etape: resultat.etape || null
    };
    db.retraits = db.retraits || [];
    db.retraits.push(journal);
    ecrireDB(db);

    return envoyerJSON(res, resultat.ok ? 200 : 400, journal);
  }

  // GET /api/admin/retrait/verifier?reference= — statut d'un retrait 🔒
  if (req.method === 'GET' && segments[1] === 'admin' && segments[2] === 'retrait' && segments[3] === 'verifier') {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    if (!passerelleActive()) return envoyerJSON(res, 503, { erreur: 'Passerelle non configurée' });
    const reference = (url.searchParams.get('reference') || '').trim();
    if (!reference) return envoyerJSON(res, 400, { erreur: 'Référence requise' });
    const verif = await plopplop.verifierRetrait(reference);
    if (!verif.ok && verif.error) return envoyerJSON(res, 502, { erreur: verif.error });
    return envoyerJSON(res, verif.ok ? 200 : 400, verif.infos || {});
  }

  // GET /api/admin/retraits — historique local des retraits 🔒
  if (req.method === 'GET' && segments[1] === 'admin' && segments[2] === 'retraits') {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    return envoyerJSON(res, 200, {
      passerelleActive: passerelleActive(),
      retraits: (db.retraits || []).slice().reverse().slice(0, 30)
    });
  }

  // GET /api/admin/promos — codes promo 🔒
  if (req.method === 'GET' && segments[1] === 'admin' && segments[2] === 'promos') {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    return envoyerJSON(res, 200, Object.entries(db.codesPromo || {})
      .map(([code, taux]) => ({ code, pourcentage: Math.round(taux * 100) })));
  }

  // POST /api/admin/promos  { code, pourcentage } — créer ou modifier 🔒
  if (req.method === 'POST' && segments[1] === 'admin' && segments[2] === 'promos') {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const c = await lireCorps(req);
    const code = String(c.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pourcentage = parseInt(c.pourcentage, 10);
    if (code.length < 3) return envoyerJSON(res, 400, { erreur: 'Le code doit faire au moins 3 caractères (lettres et chiffres)' });
    if (!(pourcentage >= 1 && pourcentage <= 90))
      return envoyerJSON(res, 400, { erreur: 'La remise doit être comprise entre 1 et 90 %' });
    db.codesPromo = db.codesPromo || {};
    db.codesPromo[code] = pourcentage / 100;
    ecrireDB(db);
    return envoyerJSON(res, 200, { code, pourcentage });
  }

  // DELETE /api/admin/promos/:code 🔒
  if (req.method === 'DELETE' && segments[1] === 'admin' && segments[2] === 'promos' && segments[3]) {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const code = decodeURIComponent(segments[3]).toUpperCase();
    if (!db.codesPromo || !(code in db.codesPromo))
      return envoyerJSON(res, 404, { erreur: 'Code introuvable' });
    delete db.codesPromo[code];
    ecrireDB(db);
    return envoyerJSON(res, 200, { ok: true, code });
  }

  // GET /api/admin/stats — protégé par jeton
  if (req.method === 'GET' && segments[1] === 'admin' && segments[2] === 'stats') {
    if (!estAdmin())
      return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const payees = db.commandes.filter(c => c.paye !== false);
    const totalVentes = payees.reduce((s, c) => s + c.total, 0);
    const livresVendus = payees.reduce(
      (s, c) => s + c.articles.reduce((t, a) => t + a.quantite, 0), 0);
    const parLivre = {};
    for (const c of payees)
      for (const a of c.articles) {
        parLivre[a.titre] = parLivre[a.titre] || { titre: a.titre, montant: 0, quantite: 0 };
        parLivre[a.titre].montant += a.prix * a.quantite;
        parLivre[a.titre].quantite += a.quantite;
      }
    const topLivres = Object.values(parLivre)
      .sort((a, b) => b.montant - a.montant).slice(0, 5);

    // Ventes des 30 derniers jours
    const parJour = {};
    const maintenant = Date.now();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(maintenant - i * 86400000).toISOString().slice(0, 10);
      parJour[d] = 0;
    }
    for (const c of payees) {
      const d = c.date.slice(0, 10);
      if (d in parJour) parJour[d] += c.total;
    }
    return envoyerJSON(res, 200, {
      totalVentes: Math.round(totalVentes),
      livresVendus,
      utilisateurs: new Set(payees.map(c => c.email)).size,
      commandes: payees.length,
      topLivres,
      ventes30j: Object.entries(parJour).map(([date, montant]) => ({
        date, montant: Math.round(montant)
      }))
    });
  }

  // GET /api/suivi?ref=CMD-XXXX&email= — suivi public d'une commande
  if (req.method === 'GET' && segments[1] === 'suivi') {
    const ref = (url.searchParams.get('ref') || '').trim().toUpperCase();
    const email = (url.searchParams.get('email') || '').trim().toLowerCase();
    if (!ref || !email) return envoyerJSON(res, 400, { erreur: 'Référence et email requis' });
    const commande = db.commandes.find(c => c.id === ref && c.email === email);
    if (!commande)
      return envoyerJSON(res, 404, { erreur: 'Aucune commande ne correspond à cette référence et cet email' });
    return envoyerJSON(res, 200, {
      id: commande.id, date: commande.date, articles: commande.articles,
      total: commande.total, paiement: commande.paiement,
      statut: commande.statut, suivi: commande.suivi || []
    });
  }

  // GET /api/admin/commandes — liste des commandes (protégé)
  if (req.method === 'GET' && segments[1] === 'admin' && segments[2] === 'commandes' && !segments[3]) {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    return envoyerJSON(res, 200, db.commandes.slice().reverse().slice(0, 50));
  }

  // PUT /api/admin/commandes/:id/avancer — valider la prochaine étape (protégé)
  if (req.method === 'PUT' && segments[1] === 'admin' && segments[2] === 'commandes' &&
      segments[3] && segments[4] === 'avancer') {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const commande = db.commandes.find(c => c.id === segments[3]);
    if (!commande) return envoyerJSON(res, 404, { erreur: 'Commande introuvable' });
    const prochaine = (commande.suivi || []).find(e => !e.date);
    if (!prochaine) return envoyerJSON(res, 400, { erreur: 'Toutes les étapes sont déjà accomplies' });
    prochaine.date = new Date().toISOString();
    const resteEnAttente = commande.suivi.some(e => !e.date);
    commande.statut = resteEnAttente ? prochaine.libelle.toLowerCase() : 'terminée';
    ecrireDB(db);
    return envoyerJSON(res, 200, commande);
  }

  // POST /api/manuscrits  (OASIS EBook Édition — soumission d'auteur, avec fichiers)
  if (req.method === 'POST' && segments[1] === 'manuscrits') {
    const corps = await lireCorps(req, 40e6);
    if (!corps.nom || !corps.email || !corps.titre)
      return envoyerJSON(res, 400, { erreur: 'Nom, email et titre requis' });
    const ref = 'MAN-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const manuscrit = {
      id: ref,
      date: new Date().toISOString(),
      nom: corps.nom, email: corps.email,
      titre: corps.titre, genre: corps.genre || '',
      resume: corps.resume || '', statut: 'reçu',
      // ── Profil de l'auteur (évaluation par le comité éditorial) ──
      profil: {
        telephone: corps.telephone || '',
        villePays: corps.villePays || '',
        profession: corps.profession || '',
        biographie: corps.biographie || '',
        publicationsAnterieures: corps.publicationsAnterieures || 'Aucune',
        detailsPublications: corps.detailsPublications || '',
        siteOuReseaux: corps.siteOuReseaux || ''
      },
      // ── Détails du projet ──
      projet: {
        publicCible: corps.publicCible || '',
        nbPages: corps.nbPages || '',
        etatManuscrit: corps.etatManuscrit || 'Terminé',
        motivation: corps.motivation || ''
      }
    };
    // 📄 Manuscrit joint (PDF/DOCX/ePub, max 25 Mo)
    if (corps.documentBase64) {
      const nomDoc = ref + '-manuscrit.' + extensionDocument(corps.documentNom);
      sauverBase64('manuscrits', nomDoc, corps.documentBase64, 25e6);
      manuscrit.fichierDocument = nomDoc;
      manuscrit.documentNomOriginal = corps.documentNom || nomDoc;
    }
    // 🖼️ Proposition de couverture (image, max 3 Mo)
    if (corps.couvertureBase64) {
      const nomCouv = ref + '-couverture.' + extensionImage(corps.couvertureBase64);
      sauverBase64('manuscrits', nomCouv, corps.couvertureBase64, 3e6);
      manuscrit.fichierCouverture = nomCouv;
    }
    db.manuscrits.push(manuscrit);
    ecrireDB(db);
    return envoyerJSON(res, 201, manuscrit);
  }

  // GET /api/couvertures/:id — image de couverture (publique, tous les visiteurs)
  if (req.method === 'GET' && segments[1] === 'couvertures' && segments[2]) {
    const livre = db.livres.find(l => l.id === segments[2]);
    if (!livre || !livre.couvertureFichier)
      return envoyerJSON(res, 404, { erreur: 'Couverture introuvable' });
    return diffuserFichier(res, 'couvertures', livre.couvertureFichier);
  }

  // GET /api/telecharger/:id?email= — document complet, réservé aux acheteurs
  if (req.method === 'GET' && segments[1] === 'telecharger' && segments[2]) {
    const livre = db.livres.find(l => l.id === segments[2]);
    if (!livre || !livre.documentFichier)
      return envoyerJSON(res, 404, { erreur: 'Document indisponible pour ce livre' });
    const email = (url.searchParams.get('email') || '').trim().toLowerCase();
    const achete = db.commandes.some(c => c.email === email && c.paye !== false &&
      c.articles.some(a => a.id === livre.id));
    if (!achete)
      return envoyerJSON(res, 403, { erreur: 'Achat requis : ce document est réservé aux acheteurs' });
    const nomTelechargement = livre.titre.replace(/[^\w\sàâäéèêëîïôöùûüç-]/gi, '') +
      path.extname(livre.documentFichier);
    return diffuserFichier(res, 'documents', livre.documentFichier, nomTelechargement);
  }

  // GET /api/manuscrits/:id/fichier — pièce jointe d'un manuscrit (admin)
  if (req.method === 'GET' && segments[1] === 'manuscrits' && segments[2] && segments[3] === 'fichier') {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    const manuscrit = db.manuscrits.find(m => m.id === segments[2]);
    if (!manuscrit || !manuscrit.fichierDocument)
      return envoyerJSON(res, 404, { erreur: 'Aucun fichier joint' });
    return diffuserFichier(res, 'manuscrits', manuscrit.fichierDocument,
      manuscrit.documentNomOriginal || manuscrit.fichierDocument);
  }

  // POST /api/messages — formulaire de contact
  if (req.method === 'POST' && segments[1] === 'messages' && !segments[2]) {
    const c = await lireCorps(req);
    if (!c.nom || !emailValide(c.email) || !c.message)
      return envoyerJSON(res, 400, { erreur: 'Nom, email valide et message sont requis' });
    const message = {
      id: 'MSG-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
      date: new Date().toISOString(),
      nom: String(c.nom).trim(), email: String(c.email).trim().toLowerCase(),
      telephone: String(c.telephone || '').trim(),
      sujet: String(c.sujet || 'Autre'),
      message: String(c.message).slice(0, 4000),
      statut: 'nouveau'
    };
    db.messages = db.messages || [];
    db.messages.push(message);
    ecrireDB(db);
    return envoyerJSON(res, 201, { id: message.id });
  }

  // GET /api/admin/messages — boîte de réception 🔒
  if (req.method === 'GET' && segments[1] === 'admin' && segments[2] === 'messages') {
    if (!estAdmin()) return envoyerJSON(res, 401, { erreur: 'Connexion admin requise' });
    return envoyerJSON(res, 200, (db.messages || []).slice().reverse().slice(0, 50));
  }

  // POST /api/newsletter
  if (req.method === 'POST' && segments[1] === 'newsletter') {
    const corps = await lireCorps(req);
    if (!corps.email) return envoyerJSON(res, 400, { erreur: 'Email requis' });
    if (!db.newsletter.includes(corps.email)) db.newsletter.push(corps.email);
    ecrireDB(db);
    return envoyerJSON(res, 200, { ok: true });
  }

  envoyerJSON(res, 404, { erreur: 'Route API inconnue' });
}

/* ---------- Fichiers statiques ---------- */

/* ---------- Partage social : balises Open Graph ----------
 * Facebook, WhatsApp et consorts lisent le HTML brut, sans exécuter le
 * JavaScript. Les fiches livre sont donc enrichies à la volée : sans ces
 * balises, un lien partagé n'affiche ni titre, ni couverture, ni prix.
 */
const echapperHTML = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function baliserPourPartage(html, livre, url) {
  const origine = `${url.protocol}//${url.host}`;
  const image = livre.couvertureUrl ? origine + livre.couvertureUrl : origine + '/images/banniere-librairie.jpg';
  const titre = `${livre.titre} — ${livre.auteur}`;
  const resume = (livre.description || `${livre.titre}, par ${livre.auteur}.`).slice(0, 180);
  const lien = origine + url.pathname + url.search;
  const balises = `
  <meta property="og:type" content="book">
  <meta property="og:site_name" content="OASIS Librairie EBook">
  <meta property="og:title" content="${echapperHTML(titre)}">
  <meta property="og:description" content="${echapperHTML(resume)}">
  <meta property="og:image" content="${echapperHTML(image)}">
  <meta property="og:url" content="${echapperHTML(lien)}">
  <meta property="og:locale" content="fr_FR">
  <meta property="book:author" content="${echapperHTML(livre.auteur)}">
  <meta property="product:price:amount" content="${livre.prix}">
  <meta property="product:price:currency" content="HTG">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${echapperHTML(titre)}">
  <meta name="twitter:description" content="${echapperHTML(resume)}">
  <meta name="twitter:image" content="${echapperHTML(image)}">
  <meta name="description" content="${echapperHTML(resume)}">
`;
  return html
    .replace('</head>', balises + '</head>')
    .replace(/<title>[^<]*<\/title>/, `<title>${echapperHTML(titre)} — OASIS</title>`);
}

function servirStatique(res, chemin, url) {
  // Sécurité : rester dans /public
  const resolu = path.normalize(path.join(PUBLIC, chemin));
  if (!resolu.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end('Accès refusé');
  }
  let fichier = resolu;
  if (fs.existsSync(fichier) && fs.statSync(fichier).isDirectory())
    fichier = path.join(fichier, 'index.html');
  if (!fs.existsSync(fichier)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>404 — Page introuvable</h1><p><a href="/librairie/">Retour à OASIS Librairie EBook</a></p>');
  }
  const ext = path.extname(fichier).toLowerCase();

  // Fiche livre : on enrichit le HTML pour que le lien partagé ait un aperçu
  const idLivre = url && url.searchParams.get('id');
  if (ext === '.html' && idLivre && /(produit|livre)\.html$/.test(fichier)) {
    try {
      const livre = lireDB().livres.find(l => l.id === idLivre);
      if (livre) {
        const corps = baliserPourPartage(fs.readFileSync(fichier, 'utf8'), livre, url);
        res.writeHead(200, { 'Content-Type': TYPES_MIME[ext] });
        return res.end(corps);
      }
    } catch { /* en cas de souci, on sert la page telle quelle */ }
  }

  res.writeHead(200, { 'Content-Type': TYPES_MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fichier).pipe(res);
}

/* ---------- Serveur ---------- */

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await routerAPI(req, res, url);
    if (url.pathname === '/') {
      res.writeHead(302, { Location: '/librairie/' });
      return res.end();
    }
    servirStatique(res, decodeURIComponent(url.pathname), url);
  } catch (e) {
    envoyerJSON(res, 500, { erreur: e.message });
  }
});

serveur.listen(PORT, () => {
  console.log('════════════════════════════════════════════');
  console.log('  OASIS Plateforme démarrée');
  console.log(`  Librairie : http://localhost:${PORT}/librairie/`);
  console.log(`  Éditions  : http://localhost:${PORT}/livre/`);
  console.log(`  Admin     : http://localhost:${PORT}/librairie/admin.html`);
  console.log('════════════════════════════════════════════');
});
