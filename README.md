# OASIS Plateforme — Librairie & Maison d'édition

Deux plateformes intégrées, servies par **un seul serveur Node.js pur** (zéro dépendance npm, base de données JSON) :

| Plateforme | Rôle | URL |
|---|---|---|
| **OASIS Librairie EBook** | Boutique en ligne — vente de livres et manuels scolaires | `http://localhost:3000/librairie/` |
| **OASIS EBook Édition** | Maison d'édition — vitrine, extraits, soumission de manuscrits | `http://localhost:3000/livre/` |

## ⭐ L'intégration clé

Sur OASIS EBook Édition, chaque fiche propose **« Lire un extrait »** gratuitement.
Lorsqu'un visiteur clique sur **« Acheter ce livre sur OASIS Librairie EBook »**, il est redirigé vers :

```
/librairie/produit.html?id=<livre>&ajouter=1
```

Le paramètre `ajouter=1` **ajoute automatiquement le livre au panier** d'OASIS Librairie EBook, où le paiement s'effectue (MonCash, NatCash, carte, virement). Le badge du panier est partagé entre les deux sites (même `localStorage`).

## Activer la passerelle de paiement PLOP PLOP

La passerelle est déjà intégrée (paiements MonCash / NatCash / Kashpaw et retraits marchands signés en HMAC-SHA256). Il ne reste qu'à fournir vos clés :

1. Copiez `.env.exemple` sous le nom `.env`
2. Renseignez `PLOP_CLIENT_ID` et `PLOP_CLIENT_SECRET` (tableau de bord marchand PLOP PLOP, section API — ce ne sont pas vos identifiants de connexion au portail)
3. Vérifiez : `node tester-passerelle.js` — aucune transaction n'est créée
4. Démarrez : `node server.js` (ou double-cliquez `demarrer.bat` sous Windows)

Sans clés, la plateforme reste en mode démonstration : les paiements sont simulés.
Sur Render ou un VPS, utilisez les variables d'environnement de l'hébergeur plutôt qu'un fichier `.env`.

## Démarrage

```bash
node server.js
```

Aucune installation nécessaire. Node.js ≥ 16 suffit.
Port configurable : `PORT=8080 node server.js`.

## Fonctionnalités

### OASIS Librairie EBook (bleu #1E3A8A / orange #F97316 — design system de la maquette)
- **Accueil** : héros, catégories populaires, livres populaires, nouveautés, réassurance
- **Catalogue** : filtres (catégorie, niveau, matière, prix max), tri (populaire, note, prix), recherche (titre / auteur / ISBN)
- **Fiche produit** : couverture, specs (format, pages, taille, langue), onglets Description / Détails / Avis, suggestions « Vous aimerez aussi », lien vers la fiche éditeur OASIS EBook Édition
- **Panier** : quantités, suppression, **codes promo** (`EDUCA10`, `RENTREE15`, `NECTAR20`)
- **Paiement** : MonCash / NatCash / Carte / Virement, étapes 1-2-3, confirmation avec référence de commande — prêt à brancher sur **Educa Pay**
- **Ma bibliothèque** : livres achetés retrouvés par email, lecteur intégré
- **Dashboard Admin** : total ventes, livres vendus, acheteurs uniques, commandes, **graphique 30 jours en canvas natif**, top livres

### OASIS EBook Édition (marine #0B1B3A / or #F5B32E — identité éditoriale de la maquette)
- Bandeau supérieur, méga-en-tête avec recherche, navigation complète
- Héros « Des livres pour apprendre, comprendre et transformer »
- Nouveautés, catalogue complet, 12 catégories populaires
- **Lecture d'extraits** gratuits (typographie sérif, encadré doré)
- **Soumission de manuscrits** (API + accusé de réception avec référence)
- Services : Écoles & Universités, Impression à la demande, Bibliothèque numérique
- Bande de chiffres (500+ titres, 300+ auteurs…), newsletter

## API (JSON)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/livres?boutique=librairie\|livre&categorie=&q=&tri=` | Catalogue filtré |
| GET | `/api/livres/:id` | Fiche d'un livre |
| POST | `/api/commandes` | Créer une commande `{email, nom, paiement, codePromo, articles:[{id,quantite}]}` |
| GET | `/api/commandes?email=` | Bibliothèque d'un acheteur |
| GET | `/api/admin/stats` | KPI + ventes 30 jours + top livres |
| POST | `/api/manuscrits` | Soumission d'auteur `{nom, email, titre, resume}` |
| POST | `/api/newsletter` | Abonnement `{email}` |

## Structure

```
oasis-plateforme/
├── server.js              # Serveur HTTP + API (Node.js pur)
├── data/db.json           # 17 livres, commandes, manuscrits, newsletter
└── public/
    ├── librairie/         # index, catalogue, produit, panier,
    │                      # paiement, bibliotheque, admin (+ style, app.js)
    └── livre/             # index (maison d'édition), livre (fiche + extrait)
```

## Brancher Educa Pay (production)

Dans `paiement.html`, la fonction du bouton « Payer maintenant » appelle actuellement `POST /api/commandes` directement (paiement simulé). Pour la production, insérez avant cet appel la redirection vers votre passerelle Educa Pay (OAuth 2.0 + webhook HMAC), puis créez la commande à réception du webhook `paiement.confirme`.

---
© EDUCA Technologie — OASIS Librairie EBook & OASIS EBook Édition
