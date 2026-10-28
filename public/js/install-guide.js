// "Put HostelFlow on your phone": pick the browser, then one step at a time,
// each with a drawing of the phone showing exactly where to tap. Used by the
// public page /install and inside the app (user menu → Add to home screen).
// Where the browser allows it (Chrome/Edge on Android or a computer), one
// button installs the app; on an iPhone Apple allows no such button, so the
// steps it is.
//   HFInstall.mount(element, { lang: 'it'|'en'|'es'|'fr', inApp: bool })
(function () {
  // The browser's own install prompt (Chrome, Edge): kept for the button.
  let deferred = null;
  const waiting = new Set();
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; waiting.forEach(f => f()); });
  addEventListener('appinstalled', () => { deferred = null; waiting.forEach(f => f()); });

  const ua = navigator.userAgent;
  const IOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ANDROID = /Android/.test(ua);
  const IOS_CHROME = IOS && /CriOS/.test(ua);
  const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const guess = () => IOS ? (IOS_CHROME ? 'chrome-ios' : 'safari') : ANDROID ? 'chrome-android' : 'computer';

  // The browsers' own words, as the person sees them on their phone.
  const L = {
    en: {
      title: 'Which browser do you use?', sub: 'Pick it and we’ll show you, one step at a time, where to tap.',
      safari: 'Safari', chrome: 'Chrome', computer: 'Computer', iphone: 'iPhone', android: 'Android', mine: 'Your browser',
      quick: 'Quick way', quickText: 'Your browser can do it in one tap:', install: 'Install HostelFlow', installed: 'Done — HostelFlow is on your home screen ✓',
      orSteps: 'Or step by step:', back: 'Back', next: 'Next', done: 'Done', other: 'Other browser', step: 'Step {n} of {m}',
      already: 'You opened HostelFlow from your home screen — it’s already installed ✓',
      share: 'Share', addHome: 'Add to Home Screen', add: 'Add', cancel: 'Cancel', webApp: 'Open as Web App',
      copy: 'Copy', reading: 'Add to Reading List', bookmark: 'Add Bookmark', fav: 'Add to Favourites', find: 'Find on Page',
      aHome: 'Add to Home screen', aInstall: 'Install', aInstallT: 'Install app', newTab: 'New tab', incog: 'New Incognito tab', hist: 'History', dl: 'Downloads', bms: 'Bookmarks', sett: 'Settings', shareA: 'Share…', findA: 'Find in page',
      pcInstall: 'Install', pcInstallQ: 'Install app?',
      s: {
        safari: [
          ['Open HostelFlow in Safari', 'Go to hostelflow.it and sign in. Already here in Safari? Then just go on.'],
          ['Tap ⋯ at the bottom right', 'The three dots next to the address. On an older iPhone there are no dots: tap the Share button (square with an arrow) in the middle of the bottom bar and skip the next step.'],
          ['Tap “Share”', 'At the top of the menu that opens.'],
          ['Tap “Add to Home Screen”', 'Scroll the list down a little if you don’t see it (sometimes it’s under “More”).'],
          ['Tap “Add”', 'Top right. Leave “Open as Web App” switched on.'],
          ['Done!', 'The HostelFlow icon is on your home screen. From now on open it from there — full screen, already signed in.'],
        ],
        'chrome-android': [
          ['Open HostelFlow in Chrome', 'Go to hostelflow.it and sign in.'],
          ['Tap ⋮ at the top right', 'The three dots next to the address.'],
          ['Tap “Add to Home screen”', 'On some phones it’s called “Install app”.'],
          ['Tap “Install”', 'Confirm in the little window.'],
          ['Done!', 'HostelFlow is on your home screen and among your apps. From now on open it from there.'],
        ],
        'chrome-ios': [
          ['Open HostelFlow in Chrome', 'Go to hostelflow.it and sign in.'],
          ['Tap Share in the address bar', 'The square with an arrow, at the right end of the address.'],
          ['Tap “Add to Home Screen”', 'Scroll the list down a little if you don’t see it (sometimes it’s under “More”).'],
          ['Tap “Add”', 'Top right.'],
          ['Done!', 'The HostelFlow icon is on your home screen. From now on open it from there.'],
        ],
        computer: [
          ['Open HostelFlow in Chrome or Edge', 'Go to hostelflow.it and sign in.'],
          ['Click the install icon', 'At the right end of the address bar: a small screen with an arrow.'],
          ['Click “Install”', 'In the little window that opens.'],
          ['Done!', 'HostelFlow opens in its own window, with its icon in the taskbar or the Dock.'],
        ],
      },
    },
    it: {
      title: 'Che browser usi?', sub: 'Sceglilo e ti mostriamo, un passo alla volta, dove toccare.',
      safari: 'Safari', chrome: 'Chrome', computer: 'Computer', iphone: 'iPhone', android: 'Android', mine: 'Il tuo browser',
      quick: 'Il modo più veloce', quickText: 'Il tuo browser lo fa con un tocco:', install: 'Installa HostelFlow', installed: 'Fatto — HostelFlow è nella schermata Home ✓',
      orSteps: 'Oppure passo per passo:', back: 'Indietro', next: 'Avanti', done: 'Fatto', other: 'Altro browser', step: 'Passo {n} di {m}',
      already: 'Hai aperto HostelFlow dalla schermata Home: è già installato ✓',
      share: 'Condividi', addHome: 'Aggiungi alla schermata Home', add: 'Aggiungi', cancel: 'Annulla', webApp: 'Apri come app web',
      copy: 'Copia', reading: 'Aggiungi a Elenco lettura', bookmark: 'Aggiungi segnalibro', fav: 'Aggiungi a Preferiti', find: 'Trova nella pagina',
      aHome: 'Aggiungi a schermata Home', aInstall: 'Installa', aInstallT: 'Installa app', newTab: 'Nuova scheda', incog: 'Nuova scheda di navigazione in incognito', hist: 'Cronologia', dl: 'Download', bms: 'Preferiti', sett: 'Impostazioni', shareA: 'Condividi…', findA: 'Trova nella pagina',
      pcInstall: 'Installa', pcInstallQ: 'Installare l’app?',
      s: {
        safari: [
          ['Apri HostelFlow in Safari', 'Vai su hostelflow.it e accedi. Sei già qui in Safari? Allora vai avanti.'],
          ['Tocca ⋯ in basso a destra', 'I tre puntini accanto all’indirizzo. Su un iPhone meno recente i puntini non ci sono: tocca Condividi (il quadrato con la freccia) in basso al centro e salta il passo successivo.'],
          ['Tocca «Condividi»', 'In alto nel menu che si apre.'],
          ['Tocca «Aggiungi alla schermata Home»', 'Scorri un po’ l’elenco se non la vedi (a volte è sotto «Altro»).'],
          ['Tocca «Aggiungi»', 'In alto a destra. Lascia attivo «Apri come app web».'],
          ['Fatto!', 'L’icona di HostelFlow è nella schermata Home. D’ora in poi aprilo da lì: a schermo intero, già connesso.'],
        ],
        'chrome-android': [
          ['Apri HostelFlow in Chrome', 'Vai su hostelflow.it e accedi.'],
          ['Tocca ⋮ in alto a destra', 'I tre puntini accanto all’indirizzo.'],
          ['Tocca «Aggiungi a schermata Home»', 'Su alcuni telefoni si chiama «Installa app».'],
          ['Tocca «Installa»', 'Conferma nella finestrella.'],
          ['Fatto!', 'HostelFlow è nella schermata Home e tra le app. D’ora in poi aprilo da lì.'],
        ],
        'chrome-ios': [
          ['Apri HostelFlow in Chrome', 'Vai su hostelflow.it e accedi.'],
          ['Tocca Condividi nella barra dell’indirizzo', 'Il quadrato con la freccia, a destra dell’indirizzo.'],
          ['Tocca «Aggiungi alla schermata Home»', 'Scorri un po’ l’elenco se non la vedi (a volte è sotto «Altro»).'],
          ['Tocca «Aggiungi»', 'In alto a destra.'],
          ['Fatto!', 'L’icona di HostelFlow è nella schermata Home. D’ora in poi aprilo da lì.'],
        ],
        computer: [
          ['Apri HostelFlow in Chrome o Edge', 'Vai su hostelflow.it e accedi.'],
          ['Clicca l’icona «Installa»', 'A destra nella barra degli indirizzi: un piccolo schermo con una freccia.'],
          ['Clicca «Installa»', 'Nella finestrella che si apre.'],
          ['Fatto!', 'HostelFlow si apre nella sua finestra, con l’icona nella barra delle applicazioni o nel Dock.'],
        ],
      },
    },
    es: {
      title: '¿Qué navegador usas?', sub: 'Elígelo y te mostramos, paso a paso, dónde tocar.',
      safari: 'Safari', chrome: 'Chrome', computer: 'Ordenador', iphone: 'iPhone', android: 'Android', mine: 'Tu navegador',
      quick: 'La forma más rápida', quickText: 'Tu navegador lo hace con un toque:', install: 'Instalar HostelFlow', installed: 'Listo — HostelFlow está en tu pantalla de inicio ✓',
      orSteps: 'O paso a paso:', back: 'Atrás', next: 'Siguiente', done: 'Listo', other: 'Otro navegador', step: 'Paso {n} de {m}',
      already: 'Has abierto HostelFlow desde la pantalla de inicio: ya está instalado ✓',
      share: 'Compartir', addHome: 'Añadir a pantalla de inicio', add: 'Añadir', cancel: 'Cancelar', webApp: 'Abrir como app web',
      copy: 'Copiar', reading: 'Añadir a la lista de lectura', bookmark: 'Añadir marcador', fav: 'Añadir a Favoritos', find: 'Buscar en la página',
      aHome: 'Añadir a pantalla de inicio', aInstall: 'Instalar', aInstallT: 'Instalar aplicación', newTab: 'Nueva pestaña', incog: 'Nueva pestaña de incógnito', hist: 'Historial', dl: 'Descargas', bms: 'Marcadores', sett: 'Configuración', shareA: 'Compartir…', findA: 'Buscar en la página',
      pcInstall: 'Instalar', pcInstallQ: '¿Instalar la aplicación?',
      s: {
        safari: [
          ['Abre HostelFlow en Safari', 'Ve a hostelflow.it e inicia sesión. ¿Ya estás aquí en Safari? Sigue.'],
          ['Toca ⋯ abajo a la derecha', 'Los tres puntos junto a la dirección. En un iPhone más antiguo no hay puntos: toca Compartir (el cuadrado con la flecha) abajo en el centro y salta el paso siguiente.'],
          ['Toca «Compartir»', 'Arriba en el menú que se abre.'],
          ['Toca «Añadir a pantalla de inicio»', 'Desliza un poco la lista si no lo ves (a veces está en «Más»).'],
          ['Toca «Añadir»', 'Arriba a la derecha. Deja activado «Abrir como app web».'],
          ['¡Listo!', 'El icono de HostelFlow está en tu pantalla de inicio. A partir de ahora ábrelo desde ahí.'],
        ],
        'chrome-android': [
          ['Abre HostelFlow en Chrome', 'Ve a hostelflow.it e inicia sesión.'],
          ['Toca ⋮ arriba a la derecha', 'Los tres puntos junto a la dirección.'],
          ['Toca «Añadir a pantalla de inicio»', 'En algunos teléfonos se llama «Instalar aplicación».'],
          ['Toca «Instalar»', 'Confirma en la ventanita.'],
          ['¡Listo!', 'HostelFlow está en tu pantalla de inicio y entre tus aplicaciones.'],
        ],
        'chrome-ios': [
          ['Abre HostelFlow en Chrome', 'Ve a hostelflow.it e inicia sesión.'],
          ['Toca Compartir en la barra de direcciones', 'El cuadrado con la flecha, a la derecha de la dirección.'],
          ['Toca «Añadir a pantalla de inicio»', 'Desliza un poco la lista si no lo ves (a veces está en «Más»).'],
          ['Toca «Añadir»', 'Arriba a la derecha.'],
          ['¡Listo!', 'El icono de HostelFlow está en tu pantalla de inicio.'],
        ],
        computer: [
          ['Abre HostelFlow en Chrome o Edge', 'Ve a hostelflow.it e inicia sesión.'],
          ['Haz clic en el icono de instalar', 'A la derecha de la barra de direcciones: una pantallita con una flecha.'],
          ['Haz clic en «Instalar»', 'En la ventanita que se abre.'],
          ['¡Listo!', 'HostelFlow se abre en su propia ventana, con su icono en la barra de tareas o el Dock.'],
        ],
      },
    },
    fr: {
      title: 'Quel navigateur utilisez-vous ?', sub: 'Choisissez-le : nous vous montrons, étape par étape, où toucher.',
      safari: 'Safari', chrome: 'Chrome', computer: 'Ordinateur', iphone: 'iPhone', android: 'Android', mine: 'Votre navigateur',
      quick: 'Le plus rapide', quickText: 'Votre navigateur le fait en un geste :', install: 'Installer HostelFlow', installed: 'C’est fait — HostelFlow est sur l’écran d’accueil ✓',
      orSteps: 'Ou étape par étape :', back: 'Retour', next: 'Suivant', done: 'Terminé', other: 'Autre navigateur', step: 'Étape {n} sur {m}',
      already: 'Vous avez ouvert HostelFlow depuis l’écran d’accueil : il est déjà installé ✓',
      share: 'Partager', addHome: 'Sur l’écran d’accueil', add: 'Ajouter', cancel: 'Annuler', webApp: 'Ouvrir en tant qu’app web',
      copy: 'Copier', reading: 'Ajouter à la liste de lecture', bookmark: 'Ajouter un signet', fav: 'Ajouter aux favoris', find: 'Rechercher dans la page',
      aHome: 'Ajouter à l’écran d’accueil', aInstall: 'Installer', aInstallT: 'Installer l’application', newTab: 'Nouvel onglet', incog: 'Nouvel onglet de navigation privée', hist: 'Historique', dl: 'Téléchargements', bms: 'Favoris', sett: 'Paramètres', shareA: 'Partager…', findA: 'Rechercher dans la page',
      pcInstall: 'Installer', pcInstallQ: 'Installer l’application ?',
      s: {
        safari: [
          ['Ouvrez HostelFlow dans Safari', 'Allez sur hostelflow.it et connectez-vous. Déjà ici dans Safari ? Continuez.'],
          ['Touchez ⋯ en bas à droite', 'Les trois points à côté de l’adresse. Sur un iPhone plus ancien, pas de points : touchez Partager (le carré avec une flèche) en bas au centre et sautez l’étape suivante.'],
          ['Touchez « Partager »', 'En haut du menu qui s’ouvre.'],
          ['Touchez « Sur l’écran d’accueil »', 'Faites défiler un peu la liste si vous ne le voyez pas (parfois sous « Plus »).'],
          ['Touchez « Ajouter »', 'En haut à droite. Laissez « Ouvrir en tant qu’app web » activé.'],
          ['C’est fait !', 'L’icône HostelFlow est sur l’écran d’accueil. Désormais, ouvrez-le depuis là.'],
        ],
        'chrome-android': [
          ['Ouvrez HostelFlow dans Chrome', 'Allez sur hostelflow.it et connectez-vous.'],
          ['Touchez ⋮ en haut à droite', 'Les trois points à côté de l’adresse.'],
          ['Touchez « Ajouter à l’écran d’accueil »', 'Sur certains téléphones : « Installer l’application ».'],
          ['Touchez « Installer »', 'Confirmez dans la petite fenêtre.'],
          ['C’est fait !', 'HostelFlow est sur l’écran d’accueil et parmi vos applications.'],
        ],
        'chrome-ios': [
          ['Ouvrez HostelFlow dans Chrome', 'Allez sur hostelflow.it et connectez-vous.'],
          ['Touchez Partager dans la barre d’adresse', 'Le carré avec une flèche, à droite de l’adresse.'],
          ['Touchez « Sur l’écran d’accueil »', 'Faites défiler un peu la liste si vous ne le voyez pas (parfois sous « Plus »).'],
          ['Touchez « Ajouter »', 'En haut à droite.'],
          ['C’est fait !', 'L’icône HostelFlow est sur l’écran d’accueil.'],
        ],
        computer: [
          ['Ouvrez HostelFlow dans Chrome ou Edge', 'Allez sur hostelflow.it et connectez-vous.'],
          ['Cliquez sur l’icône d’installation', 'À droite de la barre d’adresse : un petit écran avec une flèche.'],
          ['Cliquez sur « Installer »', 'Dans la petite fenêtre qui s’ouvre.'],
          ['C’est fait !', 'HostelFlow s’ouvre dans sa propre fenêtre, avec son icône dans la barre des tâches ou le Dock.'],
        ],
      },
    },
  };

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Small icons drawn the way the browsers draw them.
  const I = {
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M6 11H5v9h14v-9h-1"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>',
    vdots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    plusSq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.8 6.2.8-4.5 4.3 1.1 6.1L12 17l-5.6 3 1.1-6.1L3 9.6l6.2-.8z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
    install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 8v6M9 11l3 3 3-3M8 21h8"/></svg>',
    tabs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 11l8-7 8 7v9H4z"/></svg>',
  };
  const ICON = '/icon-192.png';

  // The app as it looks inside the browser: our header, a few cards.
  const page = () => `<div class="ig-page"><div class="ig-app-bar"><span class="ig-logo">hostel<b>flow</b></span><span class="ig-av">MR</span></div>
    <div class="ig-cards"><i></i><i></i><i class="s"></i><i></i></div></div>`;
  const status = dark => `<div class="ig-status${dark ? ' dark' : ''}"><b>9:41</b><span>▂▄▆ ▮</span></div>`;
  const safariBar = hl => `<div class="ig-sbar"><span class="ig-sb">${I.back}</span><span class="ig-sb ig-addr">${I.lock} hostelflow.it</span><span class="ig-sb${hl ? ' ig-hl' : ''}">${I.dots}</span></div>`;
  const chromeTop = (hl, ios) => `<div class="ig-ctop">${ios ? '' : `<span class="ig-cb">${I.home}</span>`}<span class="ig-omni">${I.lock} hostelflow.it${ios ? `<span class="ig-omni-sh${hl ? ' ig-hl' : ''}">${I.share}</span>` : ''}</span>${ios ? '' : `<span class="ig-cb">${I.tabs}</span><span class="ig-cb${hl ? ' ig-hl' : ''}">${I.vdots}</span>`}</div>`;
  const chromeBottomIos = () => `<div class="ig-cbot"><span>${I.back}</span><span style="transform:scaleX(-1)">${I.back}</span><span>${I.plusSq}</span><span>${I.tabs}</span><span>${I.dots}</span></div>`;
  const phone = (os, inner, dim) => `<div class="ig-phone ${os}"><div class="ig-screen">${inner}${dim ? '<div class="ig-dim"></div>' : ''}</div></div>`;
  const iosSheet = (t, hlHome) => `<div class="ig-sheet"><div class="ig-sheet-h"><img src="${ICON}" alt=""><div><b>HostelFlow</b><small>hostelflow.it</small></div></div>
    <div class="ig-apps"><i style="background:#34c759"></i><i style="background:#0a84ff"></i><i style="background:#ff9f0a"></i><i style="background:#bf5af2"></i></div>
    <div class="ig-list">${[[t.copy, I.copy], [t.reading, I.book], [t.bookmark, I.book], [t.fav, I.star], [t.find, I.search]].map(([l, i]) => `<div class="ig-li"><span>${esc(l)}</span>${i}</div>`).join('')}
    <div class="ig-li${hlHome ? ' ig-hl' : ''}"><span>${esc(t.addHome)}</span>${I.plusSq}</div></div></div>`;
  const iosAdd = t => `<div class="ig-addscr"><div class="ig-add-top"><span>${esc(t.cancel)}</span><b>${esc(t.addHome)}</b><span class="ig-blue ig-hl">${esc(t.add)}</span></div>
    <div class="ig-add-card"><img src="${ICON}" alt=""><div><b>HostelFlow</b><small>hostelflow.it/app</small></div></div>
    <div class="ig-add-card ig-toggle"><span>${esc(t.webApp)}</span><i class="on"></i></div></div>`;
  const homeScreen = os => `<div class="ig-home ${os}">${status(true)}<div class="ig-grid">${['#5ac8fa', '#34c759', '#ff9500', '#ff2d55', '#af52de', '#5856d6', '#ffcc00', '#8e8e93', '#30b0c7', '#a2845e', '#ff3b30'].map(c => `<i style="background:${c}"></i>`).join('')}<span class="ig-hf ig-hl"><img src="${ICON}" alt=""><small>HostelFlow</small></span></div></div>`;

  function shot(flow, i, t) {
    if (flow === 'safari') {
      return [
        () => phone('ios', status() + page() + safariBar(false).replace('ig-sb ig-addr', 'ig-sb ig-addr ig-hl')),
        () => phone('ios', status() + page() + safariBar(true)),
        () => phone('ios', status() + page() + safariBar(false) + `<div class="ig-pop">${[[t.share, I.share, 1], [t.bookmark, I.book], [t.fav, I.star], [t.find, I.search]].map(([l, ic, h]) => `<div class="ig-li${h ? ' ig-hl' : ''}"><span>${esc(l)}</span>${ic}</div>`).join('')}</div>`, true),
        () => phone('ios', status() + page() + iosSheet(t, true), true),
        () => phone('ios', status() + iosAdd(t)),
        () => phone('ios', homeScreen('ios')),
      ][i]();
    }
    if (flow === 'chrome-ios') {
      return [
        () => phone('ios', status() + chromeTop(false, true).replace('ig-omni', 'ig-omni ig-hl') + page() + chromeBottomIos()),
        () => phone('ios', status() + chromeTop(true, true) + page() + chromeBottomIos()),
        () => phone('ios', status() + chromeTop(false, true) + page() + iosSheet(t, true), true),
        () => phone('ios', status() + iosAdd(t)),
        () => phone('ios', homeScreen('ios')),
      ][i]();
    }
    if (flow === 'chrome-android') {
      const menu = `<div class="ig-amenu"><div class="ig-arow">${[I.back, I.star, I.install, I.search].map(x => `<span>${x}</span>`).join('')}</div>${[t.newTab, t.incog, t.hist, t.dl, t.bms, t.shareA, t.findA].map(l => `<div class="ig-ai">${esc(l)}</div>`).join('')}<div class="ig-ai ig-hl">${esc(t.aHome)}</div><div class="ig-ai">${esc(t.sett)}</div></div>`;
      const dialog = `<div class="ig-adlg"><b>${esc(t.aInstallT)}</b><div class="ig-adlg-app"><img src="${ICON}" alt=""><div><b>HostelFlow</b><small>hostelflow.it</small></div></div><div class="ig-adlg-btns"><span>${esc(t.cancel)}</span><span class="ig-hl">${esc(t.aInstall)}</span></div></div>`;
      return [
        () => phone('android', status() + chromeTop(false, false).replace('ig-omni', 'ig-omni ig-hl') + page()),
        () => phone('android', status() + chromeTop(true, false) + page()),
        () => phone('android', status() + chromeTop(false, false) + page() + menu),
        () => phone('android', status() + chromeTop(false, false) + page() + dialog, true),
        () => phone('android', homeScreen('android')),
      ][i]();
    }
    // A computer: a browser window.
    const win = (inner, hlIcon) => `<div class="ig-pc"><div class="ig-pc-tabs"><i></i><i></i><i></i><span>HostelFlow</span></div><div class="ig-pc-bar"><span class="ig-pc-addr">${I.lock} hostelflow.it/app<span class="ig-pc-inst${hlIcon ? ' ig-hl' : ''}">${I.install}</span></span></div><div class="ig-pc-page">${page()}${inner || ''}</div></div>`;
    return [
      () => win('', false).replace('ig-pc-addr', 'ig-pc-addr ig-hl'),
      () => win('', true),
      () => win(`<div class="ig-pc-pop"><b>${esc(t.pcInstallQ)}</b><div class="ig-adlg-app"><img src="${ICON}" alt=""><div><b>HostelFlow</b><small>hostelflow.it</small></div></div><div class="ig-adlg-btns"><span class="ig-hl ig-fill">${esc(t.pcInstall)}</span><span>${esc(t.cancel)}</span></div></div>`, false),
      () => `<div class="ig-pc ig-pc-app"><div class="ig-pc-tabs"><img src="${ICON}" alt=""><span>HostelFlow</span></div><div class="ig-pc-page">${page()}</div></div>`,
    ][i]();
  }

  function mount(root, opts = {}) {
    let lang = opts.lang || 'en';
    let flow = null, step = 0;
    const render = () => {
      const t = L[lang] || L.en;
      root.classList.add('ig');
      if (STANDALONE && opts.inApp) { root.innerHTML = `<p class="ig-ok">${esc(t.already)}</p>`; return; }
      const quick = deferred && (flow === 'chrome-android' || flow === 'computer' || !flow)
        ? `<div class="ig-quick"><b>${esc(t.quick)}</b><span>${esc(t.quickText)}</span><button type="button" class="ig-btn ig-primary" data-act="prompt">${esc(t.install)}</button></div>` : '';
      if (!flow) {
        const mine = guess();
        const card = (id, name, sub, logo) => `<button type="button" class="ig-pick${mine === id ? ' mine' : ''}" data-flow="${id}">${logo}<span><b>${esc(name)}</b><small>${esc(sub)}</small></span>${mine === id ? `<em>${esc(t.mine)}</em>` : ''}</button>`;
        root.innerHTML = `${quick}<h3 class="ig-h">${esc(t.title)}</h3><p class="ig-sub">${esc(t.sub)}</p><div class="ig-picks">
          ${card('safari', t.safari, t.iphone, '<span class="ig-logo-b safari"></span>')}
          ${card('chrome-android', t.chrome, t.android, '<span class="ig-logo-b chrome"></span>')}
          ${card('chrome-ios', t.chrome, t.iphone, '<span class="ig-logo-b chrome"></span>')}
          ${card('computer', t.computer, 'Chrome · Edge', `<span class="ig-logo-b pc">${I.install}</span>`)}</div>`;
        return;
      }
      const steps = t.s[flow];
      const [title, text] = steps[step];
      const last = step === steps.length - 1;
      root.innerHTML = `${step === 0 ? quick : ''}<div class="ig-wiz">
        <div class="ig-top"><button type="button" class="ig-link" data-act="pick">← ${esc(t.other)}</button><span class="ig-count">${esc(t.step.replace('{n}', step + 1).replace('{m}', steps.length))}</span></div>
        <div class="ig-stage">${shot(flow, step, t)}</div>
        <div class="ig-dots">${steps.map((_, k) => `<i class="${k === step ? 'on' : k < step ? 'done' : ''}"></i>`).join('')}</div>
        <h3 class="ig-h">${esc(title)}</h3><p class="ig-sub">${esc(text)}</p>
        <div class="ig-nav"><button type="button" class="ig-btn" data-act="prev" ${step ? '' : 'disabled'}>${esc(t.back)}</button>
          <button type="button" class="ig-btn ig-primary" data-act="${last ? 'finish' : 'next'}">${esc(last ? t.done : t.next)} ${last ? '' : '→'}</button></div></div>`;
    };
    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-flow],[data-act]');
      if (!b) return;
      if (b.dataset.flow) { flow = b.dataset.flow; step = 0; }
      else if (b.dataset.act === 'pick') flow = null;
      else if (b.dataset.act === 'prev') step = Math.max(0, step - 1);
      else if (b.dataset.act === 'next') step += 1;
      else if (b.dataset.act === 'finish') { if (opts.onDone) return opts.onDone(); flow = null; }
      else if (b.dataset.act === 'prompt' && deferred) {
        const ev = deferred;
        ev.prompt();
        const choice = await ev.userChoice.catch(() => null);
        if (choice && choice.outcome === 'accepted') { deferred = null; root.innerHTML = `<p class="ig-ok">${esc((L[lang] || L.en).installed)}</p>`; return; }
      }
      render();
      const stage = root.querySelector('.ig-stage, .ig-picks');
      if (stage && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    // Swipe between steps on a phone.
    let x0 = null;
    let y0 = null;
    root.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    root.addEventListener('touchend', e => {
      if (x0 === null || !flow) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      const dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) < 50 || Math.abs(dx) < 1.5 * Math.abs(dy)) return; // a scroll, not a swipe
      const n = (L[lang] || L.en).s[flow].length;
      step = Math.min(n - 1, Math.max(0, step + (dx < 0 ? 1 : -1)));
      render();
    });
    const again = () => render();
    waiting.add(again);
    render();
    return { setLang(l) { lang = l; render(); }, reset() { flow = null; step = 0; render(); }, canPrompt: () => !!deferred };
  }

  window.HFInstall = { mount, canPrompt: () => !!deferred, prompt: async () => { if (!deferred) return false; const ev = deferred; ev.prompt(); const c = await ev.userChoice.catch(() => null); if (c && c.outcome === 'accepted') deferred = null; return !!c && c.outcome === 'accepted'; }, onChange: f => waiting.add(f), standalone: STANDALONE, ios: IOS };
})();
