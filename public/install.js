// /install: the guide in the page's language (Italian or English, the switch in the bar).
const guide = HFInstall.mount(document.getElementById('guide'), { lang: document.documentElement.classList.contains('it') ? 'it' : 'en' });
new MutationObserver(() => guide.setLang(document.documentElement.classList.contains('it') ? 'it' : 'en'))
  .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
