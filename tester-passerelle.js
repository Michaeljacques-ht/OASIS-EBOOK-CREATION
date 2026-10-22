/**
 * Diagnostic de la passerelle PLOP PLOP — OASIS Plateforme
 * ─────────────────────────────────────────────────────────
 * Vérifie que vos clés marchand fonctionnent, SANS créer de vraie
 * transaction ni effectuer de retrait réel.
 *
 *   node tester-passerelle.js
 *
 * Lit les clés depuis .env (ou les variables d'environnement).
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Charger .env comme le fait le serveur
(function chargerEnv() {
  const fichier = path.join(__dirname, '.env');
  if (!fs.existsSync(fichier)) return;
  for (const ligne of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const n = ligne.trim();
    if (!n || n.startsWith('#')) continue;
    const i = n.indexOf('=');
    if (i < 1) continue;
    let v = n.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[n.slice(0, i).trim()] === undefined) process.env[n.slice(0, i).trim()] = v;
  }
})();

const HOTE = 'plopplop.solutionip.app';
const ID = process.env.PLOP_CLIENT_ID || '';
const SECRET = process.env.PLOP_CLIENT_SECRET || '';

const vert = (s) => '\x1b[32m' + s + '\x1b[0m';
const rouge = (s) => '\x1b[31m' + s + '\x1b[0m';
const jaune = (s) => '\x1b[33m' + s + '\x1b[0m';

function appel(chemin, corps, jeton) {
  return new Promise((ok, ko) => {
    const d = JSON.stringify(corps);
    const entetes = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) };
    if (jeton) entetes.Authorization = 'Bearer ' + jeton;
    const r = https.request({ hostname: HOTE, path: '/' + chemin, method: 'POST', headers: entetes, timeout: 20000 },
      (rep) => {
        let b = '';
        rep.on('data', (m) => b += m);
        rep.on('end', () => { try { ok({ code: rep.statusCode, corps: JSON.parse(b || '{}') }); }
                              catch { ok({ code: rep.statusCode, corps: { brut: b.slice(0, 200) } }); } });
      });
    r.on('timeout', () => { r.destroy(); ko(new Error('délai dépassé')); });
    r.on('error', ko);
    r.write(d); r.end();
  });
}

(async () => {
  console.log('\n═══ Diagnostic PLOP PLOP — OASIS Plateforme ═══\n');

  // 1. Présence des clés
  console.log('1. Clés marchand');
  if (!ID || !SECRET) {
    console.log('   ' + rouge('✗ Clés absentes.') + ' Créez un fichier .env à partir de .env.exemple,');
    console.log('     ou définissez PLOP_CLIENT_ID et PLOP_CLIENT_SECRET.\n');
    process.exit(1);
  }
  console.log('   ' + vert('✓') + ` client_id : ${ID.slice(0, 6)}…${ID.slice(-4)} (${ID.length} caractères)`);
  console.log('   ' + vert('✓') + ` client_secret : ${SECRET.length} caractères`);
  if (SECRET.length !== 64) console.log('   ' + jaune('⚠ La clé secrète fait habituellement 64 caractères.'));
  if (!ID.startsWith('pp_')) console.log('   ' + jaune('⚠ L\'identifiant commence habituellement par « pp_ ».'));

  // 2. Authentification marchand
  console.log('\n2. Authentification marchand (api/auth/marchand)');
  let jeton = null;
  try {
    const r = await appel('api/auth/marchand', { client_id: ID, client_secret: SECRET });
    if (r.code === 200 && r.corps.success) {
      jeton = r.corps.token;
      console.log('   ' + vert('✓ Authentification réussie') + ` — jeton valable ${r.corps.expires_in || '?'} s`);
    } else {
      console.log('   ' + rouge(`✗ HTTP ${r.code} — ${r.corps.message || 'refusé'}`));
      console.log('     Vérifiez vos clés dans le tableau de bord marchand.\n');
      process.exit(1);
    }
  } catch (e) {
    console.log('   ' + rouge('✗ Passerelle injoignable : ' + e.message) + '\n');
    process.exit(1);
  }

  // 3. Signature HMAC (contrôle local, sans exécuter de retrait)
  console.log('\n3. Signature HMAC-SHA256');
  const horodatage = Math.floor(Date.now() / 1000);
  const charge = [20, 'moncash', '50900000000', 'TEST-DIAGNOSTIC', horodatage].join('|');
  const signature = crypto.createHmac('sha256', SECRET).update(charge).digest('hex');
  console.log('   ' + vert('✓') + ` calculée sur « ${charge} »`);
  console.log('     → ' + signature.slice(0, 24) + '… (' + signature.length + ' caractères hexadécimaux)');

  // 4. Vérification d'une référence inexistante (lecture seule, aucun mouvement)
  console.log('\n4. Lecture d\'une transaction inexistante (api/paiement-verify)');
  try {
    const r = await appel('api/paiement-verify', { client_id: ID, refference_id: 'OASIS-DIAG-INEXISTANT' });
    console.log('   ' + vert('✓') + ` la passerelle répond (HTTP ${r.code})` +
      (r.corps.message ? ` — « ${r.corps.message} »` : ''));
  } catch (e) {
    console.log('   ' + jaune('⚠ ' + e.message));
  }

  console.log('\n' + vert('═══ Passerelle opérationnelle ═══'));
  console.log('Démarrez la plateforme avec « node server.js » :');
  console.log('les paiements clients passeront par PLOP PLOP, et le');
  console.log('dashboard admin affichera la section de retrait.\n');
  console.log(jaune('Aucune transaction ni retrait n\'a été effectué par ce diagnostic.\n'));
})();
