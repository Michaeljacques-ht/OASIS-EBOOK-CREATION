/* Menu mobile de la maison d'édition — chargé par toutes ses pages.
   S'installe tout seul et repère la page courante depuis l'URL. */
(function () {
  if (document.getElementById('menu-mobile')) return;

  const page = (location.pathname.split('/').pop() || 'index.html');
  const actif = (p) => page === p ? 'actif' : '';

  const panneau = document.createElement('div');
  panneau.innerHTML = `
    <div class="ui-voile" id="voile-menu"></div>
    <aside class="ui-menu-mobile" id="menu-mobile" role="dialog" aria-label="Menu" aria-modal="true">
      <div class="ui-menu-tete">
        <img src="/images/logo-edition.png" alt="OASIS EBook Édition">
        <button class="ui-menu-fermer" id="fermer-menu" aria-label="Fermer le menu">✕</button>
      </div>

      <div class="ui-menu-section">
        <p class="ui-menu-titre">Maison d'édition</p>
        <a href="index.html" class="${actif('index.html')}"><span class="ico">🏠</span> Accueil</a>
        <a href="index.html#catalogue"><span class="ico">📚</span> Nos livres</a>
        <a href="auteurs.html" class="${actif('auteurs.html')}"><span class="ico">✍️</span> Nos auteurs</a>
        <a href="index.html#manuscrit"><span class="ico">📝</span> Soumettre un manuscrit</a>
      </div>

      <div class="ui-menu-section">
        <p class="ui-menu-titre">Découvrir</p>
        <a href="evenements.html" class="${actif('evenements.html')}"><span class="ico">📅</span> Événements</a>
        <a href="blog.html" class="${actif('blog.html')}"><span class="ico">📰</span> Blog</a>
        <a href="apropos.html" class="${actif('apropos.html')}"><span class="ico">🏛️</span> À propos</a>
        <a href="contact.html" class="${actif('contact.html')}"><span class="ico">✉️</span> Nous contacter</a>
      </div>

      <div class="ui-menu-section">
        <p class="ui-menu-titre">Services</p>
        <a href="contact.html?sujet=impression"><span class="ico">🖨️</span> Impression à la demande</a>
        <a href="contact.html?sujet=partenariat"><span class="ico">🏫</span> Écoles et bibliothèques</a>
      </div>

      <div class="ui-menu-section">
        <p class="ui-menu-titre">Boutique</p>
        <a href="/librairie/"><span class="ico">🛍️</span> OASIS Librairie EBook</a>
        <a href="/librairie/panier.html"><span class="ico">🛒</span> Mon panier
          <span class="compteur" id="menu-compteur-panier" style="display:none">0</span></a>
        <a href="/librairie/bibliotheque.html"><span class="ico">📖</span> Ma bibliothèque</a>
        <a href="/librairie/favoris.html"><span class="ico">♡</span> Mes favoris</a>
        <a href="/librairie/suivi.html"><span class="ico">📦</span> Suivi de commande</a>
        <a href="/librairie/faq.html"><span class="ico">❓</span> Questions fréquentes</a>
      </div>

      <div class="ui-menu-pied">
        <a class="ui-btn ui-btn-marine" href="/librairie/compte.html">Mon compte</a>
        <a class="ui-btn ui-btn-contour" href="admin.html">✏️ Espace éditeur</a>
      </div>
    </aside>`;
  document.body.appendChild(panneau);

  const menu = document.getElementById('menu-mobile');
  const voile = document.getElementById('voile-menu');
  const burger = document.getElementById('bouton-menu');

  const ouvrir = () => {
    menu.classList.add('ouvert'); voile.classList.add('ouvert');
    burger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  };
  const fermer = () => {
    menu.classList.remove('ouvert'); voile.classList.remove('ouvert');
    burger?.setAttribute('aria-expanded', 'false');
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
    if (!zone) { location.href = '/librairie/catalogue.html'; return; }
    const ouverte = zone.classList.toggle('ouverte');
    loupe.setAttribute('aria-expanded', String(ouverte));
    if (ouverte) zone.querySelector('input').focus();
  });

  // Compteur du panier, partagé avec la librairie
  try {
    const n = (JSON.parse(localStorage.getItem('oasis_panier')) || [])
      .reduce((s, x) => s + x.quantite, 0);
    const c = document.getElementById('menu-compteur-panier');
    if (c && n) { c.textContent = n; c.style.display = 'inline-block'; }
  } catch {}
})();
