// Switches and helpers of the public website, kept out of worker.js: the
// Worker's main module may only export its handler (wrangler dev refuses any
// other export: "Incorrect type for map entry").

// The marketing pages — the front page in every language and the SEO pages —
// are hidden for now (Bob, 24. 10.): they send visitors to the app's sign-in
// and the sitemap is empty. /install and the legal pages stay. Set this to
// false to bring them all back. Staging always shows them (src/worker.js).
export const SITE_HIDDEN = false; // back on 29. 10. 2026, as free and open source

// /en: the Italian front page (/welcome) starting in English.
export function inEnglish(html) {
  const title = 'HostelFlow — Alloggiati Web on autopilot: guest check-in from one photo';
  return html
    .replace('<html lang="it" class="it" data-lang="it" data-auto>', '<html lang="en" class="en" data-lang="en">')
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, "$1Take a photo of the guest's ID and HostelFlow registers them on Alloggiati Web in one click — groups and families too, with ISTAT and Ross1000 from the same data. Free and open source, for hostels and B&amp;Bs.")
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, "$1Take a photo of the guest's ID and they're on Alloggiati Web in one click. Free and open source.")
    .replace('<meta property="og:url" content="https://hostelflow.it/welcome">', '<meta property="og:url" content="https://hostelflow.it/en">')
    .replace('<link rel="canonical" href="https://hostelflow.it/welcome">', '<link rel="canonical" href="https://hostelflow.it/en">');
}
