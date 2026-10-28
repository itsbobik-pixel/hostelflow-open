// HostelFlow — the public page.

// Links from our e-mails (#confirm=, #invite=, #reset=) belong to the app:
// before, they all pointed at the site's root.
if (/^#(confirm|invite|reset)=/.test(location.hash)) location.replace('/app' + location.hash);

// Italian or English: what the visitor picked with the switch before, else
// the browser's language (beta.html at /welcome: <html data-auto>) or the
// page's own (data-lang: /en stays English — src/worker.js). Search engines
// read the HTML itself: Italian at /welcome, English at /en.
const LANG_KEY = 'hf_site_lang';
function setLang(lang, picked) {
  document.documentElement.className = lang;
  document.documentElement.lang = lang;
  if (picked) try { localStorage.setItem(LANG_KEY, lang); } catch { /* not remembered */ }
}
const browserLang = (navigator.language || '').toLowerCase().startsWith('it') ? 'it' : 'en';
const pageLang = 'auto' in document.documentElement.dataset ? browserLang : document.documentElement.dataset.lang || browserLang;
let lang = null;
try { lang = localStorage.getItem(LANG_KEY); } catch { /* storage blocked */ }
setLang(lang === 'it' || lang === 'en' ? lang : pageLang);

document.addEventListener('DOMContentLoaded', () => {
  const langButton = document.getElementById('lang');
  if (langButton) langButton.addEventListener('click', () =>
    setLang(document.documentElement.classList.contains('it') ? 'en' : 'it', true));

  // The check-in video plays (muted, on a loop) only while it is on screen,
  // and only the one in the page's language. With reduced motion it waits
  // for a click on its own controls.
  const videos = [...document.querySelectorAll('.demo-video video')];
  const shown = () => videos.find(v => v.offsetParent !== null);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    videos.forEach(v => { v.controls = true; v.preload = 'metadata'; });
  } else if (videos.length) {
    let visible = false;
    const sync = () => videos.forEach(v => { if (visible && v === shown()) v.play().catch(() => { v.controls = true; }); else v.pause(); });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.35 })
      .observe(videos[0].parentElement);
    if (langButton) langButton.addEventListener('click', sync);
  }

  // The price calculator (#prezzi): Check-in by beds, plus the team part.
  // Both languages go in, the page's CSS shows one.
  const beds = document.getElementById('calc-beds');
  if (beds) {
    const team = document.getElementById('calc-team'), go = document.getElementById('calc-go');
    const both = (it, en) => `<span class="it">${it}</span><span class="en">${en}</span>`;
    const month = `<small>${both('/ mese', '/ month')}</small>`;
    const signup = go.innerHTML;
    const update = () => {
      const n = Number(beds.value), big = n > 100;
      document.getElementById('calc-beds-n').textContent = big ? '100+' : n;
      const base = n <= 20 ? 9 : n <= 40 ? 14 : n <= 60 ? 19 : n <= 80 ? 29 : 39, total = base + (team.checked ? 10 : 0);
      document.getElementById('calc-price').innerHTML = big ? both('Scrivici', 'Write to us') : `${both(`${total} €`, `€${total}`)} ${month}`;
      document.getElementById('calc-detail').innerHTML = big
        ? both('Oltre 100 letti facciamo un prezzo su misura.', 'Above 100 beds we make you a price of your own.')
        : both(`Check-in ${base} €${team.checked ? ' + team 10 €' : ''}`, `Check-in €${base}${team.checked ? ' + team €10' : ''}`);
      go.href = big ? 'mailto:support@hostelflow.it?subject=HostelFlow%20%E2%80%94%20more%20than%20100%20beds' : '/app#signup';
      go.innerHTML = big ? both('Scrivici', 'Write to us') : signup;
    };
    beds.addEventListener('input', update);
    team.addEventListener('change', update);
    update();
  }

  // A line under the bar once the page scrolls.
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Sections fade in as they come into view.
  const items = document.querySelectorAll('.step, .feat, .plan, .story-in, #faq details, .strip-in > div');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${(i % 3) * 80}ms`;
    io.observe(el);
  });
  // Never leave anything hidden (a browser that doesn't report scrolling, a print…).
  setTimeout(() => items.forEach(el => el.classList.add('in')), 4000);
});
