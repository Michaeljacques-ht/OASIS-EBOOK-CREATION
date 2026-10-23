'use strict';
/* ============================================================
   OASIS EBOOK CRÉATION — Passerelle de paiement PLOP PLOP
   Documentation : https://plopplop.solutionip.app/paiement-doc

   Module partagé avec Konekte et OASIS Centre numérique.

   PAIEMENT (2 appels)
     POST api/paiement-marchand  { client_id, refference_id, montant, payment_method }
       → { status, url, transaction_id }   → le client paie sur `url`
     POST api/paiement-verify    { client_id, refference_id }
       → { trans_status: 'ok', id_transaction, method, date, heure }

   RETRAIT MARCHAND (3 étapes + signature HMAC-SHA256)
     1. POST api/auth/marchand                  { client_id, client_secret } → token
     2. POST api/auth/marchand/withdrawal-token { amount, method, recipient,
            reference, timestamp, withdrawal_signature }  (Bearer token)
            → withdrawal_token
     3. POST api/withdraw/marchand              { amount, method, recipient, reference }
            (Bearer withdrawal_token) → { success, data:{ status, transaction_id,
                                          fee, balance_after } }
     Vérification : POST api/withdraw/marchand/verify { reference } (Bearer token)

   ⚠️ Ne jamais écrire les clés dans le code : variables d'environnement
      PLOP_CLIENT_ID et PLOP_CLIENT_SECRET.
      PowerShell :  $env:PLOP_CLIENT_ID="pp_..."; $env:PLOP_CLIENT_SECRET="..."
   ============================================================ */
const https = require('https');
const crypto = require('crypto');

const PLOP = {
  hote: process.env.PLOP_HOTE || 'plopplop.solutionip.app',
  clientId: process.env.PLOP_CLIENT_ID || '',
  clientSecret: process.env.PLOP_CLIENT_SECRET || '',
  montantMinHTG: 20   // minimum imposé par l'API PLOP PLOP
};

/** La passerelle est-elle configurée ? */
const passerelleActive = () => !!(PLOP.clientId && PLOP.clientSecret);

/** Méthodes de paiement acceptées ('all' = laisser le client choisir sur la passerelle). */
const METHODES = [
  { id: 'all', label: 'Toutes les méthodes', emoji: '💳' },
  { id: 'moncash', label: 'MonCash', emoji: '🔴' },
  { id: 'natcash', label: 'NatCash', emoji: '🔵' },
  { id: 'kashpaw', label: 'Kashpaw', emoji: '🟢' }
];
const METHODES_RETRAIT = ['moncash', 'natcash'];

/* ---------- Appel HTTPS JSON sortant (module natif) ---------- */
function appelPlop(chemin, corps, jeton) {
  return new Promise((resoudre, rejeter) => {
    const donnees = JSON.stringify(corps);
    const entetes = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(donnees)
    };
    if (jeton) entetes['Authorization'] = 'Bearer ' + jeton;
    const [hote, port] = String(PLOP.hote).split(':');
    const requete = https.request({
      hostname: hote, port: port ? Number(port) : 443,
      path: '/' + chemin.replace(/^\//, ''),
      method: 'POST', headers: entetes, timeout: 25000
    }, (reponse) => {
      let brut = '';
      reponse.on('data', (m) => brut += m);
      reponse.on('end', () => {
        try { resoudre({ code: reponse.statusCode, corps: JSON.parse(brut || '{}') }); }
        catch { resoudre({ code: reponse.statusCode, corps: { message: brut.slice(0, 300) } }); }
      });
    });
    requete.on('timeout', () => { requete.destroy(); rejeter(new Error('Passerelle injoignable (délai dépassé)')); });
    requete.on('error', (e) => rejeter(new Error('Passerelle injoignable : ' + e.message)));
    requete.write(donnees);
    requete.end();
  });
}

/** Signature HMAC-SHA256 exigée à l'étape 2 du retrait. */
function signatureRetrait(montant, methode, destinataire, reference, timestamp) {
  const charge = [montant, methode, destinataire, reference, timestamp].join('|');
  return crypto.createHmac('sha256', PLOP.clientSecret).update(charge).digest('hex');
}

/* ============ PAIEMENT ============ */

/**
 * Ouvre une transaction. `reference` est notre identifiant de commande (ord_…).
 * Retourne { ok, urlPaiement, transactionId } ou { ok:false, error }.
 */
async function initierPaiement({ reference, montant, methode }) {
  if (!passerelleActive()) {
    return { ok: false, error: 'Passerelle non configurée (PLOP_CLIENT_ID / PLOP_CLIENT_SECRET).' };
  }
  const choisie = METHODES.some(m => m.id === methode) ? methode : 'all';
  let reponse;
  try {
    reponse = await appelPlop('api/paiement-marchand', {
      client_id: PLOP.clientId,
      refference_id: reference,
      montant: Math.max(PLOP.montantMinHTG, Math.round(montant)),  // gourdes
      payment_method: choisie
    });
  } catch (e) { return { ok: false, error: e.message }; }

  if (reponse.code !== 200 || !reponse.corps.status || !reponse.corps.url) {
    return { ok: false,
      error: reponse.corps.message || 'La passerelle a refusé la transaction.',
      codePasserelle: reponse.code };
  }
  return { ok: true, urlPaiement: reponse.corps.url,
    transactionId: reponse.corps.transaction_id || null, methode: choisie };
}

/**
 * Interroge la passerelle sur l'état d'une transaction.
 * Retourne { ok, paye, infos } — `paye` est vrai uniquement si trans_status === 'ok'.
 */
async function verifierPaiement(reference) {
  if (!passerelleActive()) {
    return { ok: false, paye: false, error: 'Passerelle non configurée.' };
  }
  let reponse;
  try {
    reponse = await appelPlop('api/paiement-verify', {
      client_id: PLOP.clientId, refference_id: reference
    });
  } catch (e) { return { ok: false, paye: false, error: e.message }; }

  const infos = reponse.corps || {};
  if (infos.trans_status === 'ok') {
    return { ok: true, paye: true, infos: {
      transactionId: infos.id_transaction || null,
      methode: infos.method || null,
      dateTransaction: [infos.date, infos.heure].filter(Boolean).join(' ')
    } };
  }
  return { ok: true, paye: false,
    message: infos.message || 'Paiement non encore confirmé par la passerelle.' };
}

/* ============ RETRAIT MARCHAND (3 étapes) ============ */

/** Référence unique de retrait — l'API refuse les doublons (HTTP 409). */
function nouvelleReferenceRetrait() {
  return 'WD-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' +
    crypto.randomBytes(3).toString('hex').toUpperCase();
}

/**
 * Verse des fonds vers un portefeuille MonCash ou NatCash.
 * Retourne { ok, retrait } ou { ok:false, error, etape }.
 */
async function retirer({ montant, methode, destinataire, reference }) {
  if (!passerelleActive()) {
    return { ok: false, error: 'Passerelle non configurée (PLOP_CLIENT_ID / PLOP_CLIENT_SECRET).' };
  }
  const somme = Math.round(parseFloat(montant) * 100) / 100;
  const moyen = METHODES_RETRAIT.includes(methode) ? methode : 'moncash';
  const numero = String(destinataire || '').replace(/\D/g, '');
  if (!(somme > 0)) return { ok: false, error: 'Montant invalide.' };
  if (!/^509\d{8}$/.test(numero)) {
    return { ok: false, error: 'Numéro destinataire invalide (format attendu : 509XXXXXXXX).' };
  }
  const ref = reference || nouvelleReferenceRetrait();

  try {
    /* ── Étape 1 : authentification marchand ── */
    const auth = await appelPlop('api/auth/marchand', {
      client_id: PLOP.clientId, client_secret: PLOP.clientSecret
    });
    if (auth.code !== 200 || !auth.corps.success) {
      return { ok: false, etape: 1,
        error: auth.corps.message || 'Authentification marchand refusée.' };
    }
    const jetonMarchand = auth.corps.token;

    /* ── Étape 2 : jeton de retrait signé HMAC-SHA256 ── */
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signatureRetrait(somme, moyen, numero, ref, timestamp);
    const jetonRetrait = await appelPlop('api/auth/marchand/withdrawal-token', {
      amount: somme, method: moyen, recipient: numero,
      reference: ref, timestamp, withdrawal_signature: signature
    }, jetonMarchand);
    if (jetonRetrait.code !== 200 || !jetonRetrait.corps.success) {
      return { ok: false, etape: 2,
        error: jetonRetrait.corps.message || 'Jeton de retrait refusé.',
        codeErreur: jetonRetrait.corps.error_code };
    }

    /* ── Étape 3 : exécution (paramètres strictement identiques à l'étape 2) ── */
    const reponse = await appelPlop('api/withdraw/marchand', {
      amount: somme, method: moyen, recipient: numero, reference: ref
    }, jetonRetrait.corps.withdrawal_token);
    const d = reponse.corps.data || {};
    const retrait = {
      reference: ref, montant: somme, methode: moyen, destinataire: numero,
      statut: d.status || (reponse.corps.success ? 'en cours' : 'échec'),
      transactionId: d.transaction_id || null,
      frais: d.fee ?? null,
      soldeApres: d.balance_after ?? null,
      message: reponse.corps.message || '',
      date: new Date().toISOString()
    };
    if (reponse.code !== 200 || !reponse.corps.success) {
      return { ok: false, etape: 3, reference: ref,
        error: reponse.corps.message || 'Le versement a été refusé par la passerelle.',
        codeErreur: reponse.corps.error_code };
    }
    return { ok: true, retrait };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Statut d'un retrait déjà exécuté (par sa référence WD-…). */
async function verifierRetrait(reference) {
  if (!passerelleActive()) return { ok: false, error: 'Passerelle non configurée.' };
  try {
    const auth = await appelPlop('api/auth/marchand', {
      client_id: PLOP.clientId, client_secret: PLOP.clientSecret
    });
    if (auth.code !== 200 || !auth.corps.success) {
      return { ok: false, error: 'Authentification marchand refusée.' };
    }
    const verif = await appelPlop('api/withdraw/marchand/verify', { reference }, auth.corps.token);
    return { ok: verif.code === 200, infos: verif.corps };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = {
  PLOP, passerelleActive, METHODES, METHODES_RETRAIT,
  initierPaiement, verifierPaiement,
  retirer, verifierRetrait, nouvelleReferenceRetrait
};
