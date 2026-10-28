// Draws the Town header: an old town at dusk under string lights.
// public/header-pc.svg is wide enough for a computer; public/header-phone.svg is
// the same town cut for a phone, whose header is narrower and taller (logo above
// the tabs), so houses and bulbs are drawn bigger and fewer.
// Deterministic (seeded), no libraries.
//   node scripts/make-header.mjs
import { writeFileSync } from 'node:fs';

// The drawing being made: its size (W × H) and k, how much bigger than on the
// computer its houses, windows and bulbs are. draw() sets them before town()
// and lights() run; seed restarts there so both pictures are the same town.
let W, H, k, seed;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const r = (a, b) => a + rnd() * (b - a);
const f = n => Math.round(n * 10) / 10;

// A row of houses: gables, flat roofs, chimneys, now and then a tower.
function town(base, minH, maxH, color, windows, share = 0.2) {
  minH *= k; maxH *= k;
  let x = -20;
  let d = `M-20 ${H}`;
  const lit = [];
  while (x < W + 20) {
    const w = r(46, 120) * k;
    const h = r(minH, maxH);
    const top = base - h;
    const kind = rnd();
    if (kind < 0.08) {
      // church tower with a spire
      const tw = r(34, 46) * k;
      const th = r(maxH * 1.4, maxH * 1.9);
      d += ` L${f(x)} ${f(base - th * 0.7)} L${f(x + tw / 2)} ${f(base - th)} L${f(x + tw)} ${f(base - th * 0.7)} L${f(x + tw)} ${f(base)}`;
      x += tw;
      continue;
    }
    if (kind < 0.62) {
      // gable roof, maybe a chimney
      const peak = top - r(18, 38) * k;
      d += ` L${f(x)} ${f(top)} L${f(x + w / 2)} ${f(peak)}`;
      if (rnd() < 0.5) {
        const cx = x + w * r(0.6, 0.75);
        const cy = top - (top - peak) * 0.55;
        d += ` L${f(cx)} ${f(cy + (peak - top) * 0.25)} L${f(cx)} ${f(cy - 14 * k)} L${f(cx + 9 * k)} ${f(cy - 14 * k)} L${f(cx + 9 * k)} ${f(cy + (peak - top) * 0.1)}`;
      }
      d += ` L${f(x + w)} ${f(top)}`;
    } else {
      // flat roof with a little parapet
      d += ` L${f(x)} ${f(top)} L${f(x + w)} ${f(top)}`;
    }
    if (windows) {
      for (let wy = top + 14 * k; wy < base - 18 * k; wy += r(22, 30) * k) {
        for (let wx = x + 10 * k; wx < x + w - 14 * k; wx += r(16, 24) * k) {
          if (rnd() < share) lit.push([wx, wy, rnd()]);
        }
      }
    }
    x += w;
    d += ` L${f(x)} ${f(base)}`;
  }
  d += ` L${W + 20} ${H} Z`;
  return { path: `<path d="${d}" fill="${color}"/>`, lit };
}

// A string of lights hanging between two points, bulbs along the curve.
function lights(x1, y1, x2, y2, sag, n, cls) {
  const cx = (x1 + x2) / 2;
  const cy = Math.max(y1, y2) + sag;
  const at = t => [
    (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2,
    (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2,
  ];
  let out = `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none" stroke="#0e0c18" stroke-width="${f(2 * k)}" opacity=".8"/>`;
  for (let i = 1; i < n; i++) {
    const [bx, by] = at(i / n);
    // Each bulb gets its own rhythm, so the string twinkles instead of pulsing as one.
    const dur = f(r(1.8, 3.6));
    const delay = f(-r(0, 3.6));
    out += `<g class="bulb" style="animation-duration:${dur}s;animation-delay:${delay}s"><circle class="halo" cx="${f(bx)}" cy="${f(by + 9 * k)}" r="${f(18 * k)}" fill="url(#glow)" style="animation-duration:${dur}s;animation-delay:${delay}s"/><circle cx="${f(bx)}" cy="${f(by + 9 * k)}" r="${f(4.4 * k)}" fill="#ffe7a8"/></g>`;
  }
  return out;
}

function draw(file, opts) {
  ({ W, H, k } = opts);
  seed = 7;
  const { span, sag, starCount, starTop, note } = opts;
  const back = town(H - 60 * k, 70, 130, '#6b4778', true, 0.12);
  const front = town(H - 4, 80, 150, '#2a2140', true, 0.2);
  let stars = '';
  for (let i = 0; i < starCount; i++) stars += `<circle cx="${f(r(0, W))}" cy="${f(r(6, starTop))}" r="${f(r(0.6, 1.6) * Math.sqrt(k))}" class="s${i % 3}"/>`;
  // Windows are drawn right after their own row, so a front house covers the back row's windows.
  const windowsOf = (lit, dim) => lit.map(([x, y, glow]) => `<rect x="${f(x)}" y="${f(y)}" width="${f(7 * k)}" height="${f(10 * k)}" rx="${f(1.5 * k)}" fill="#ffc96b" opacity="${f((0.55 + glow * 0.45) * dim)}"/>`).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
  <!-- ${note}: an old town at dusk under string lights. Our own drawing (scripts/make-header.mjs). -->
  <style>
    .s0,.s1,.s2{fill:#fff}
    .s1{animation:tw 5s ease-in-out infinite}.s2{animation:tw 7s ease-in-out infinite -2s}
    .bulb{animation:bulb 3s ease-in-out infinite}
    .halo{animation:halo 3s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
    @keyframes tw{50%{opacity:.2}}
    @keyframes bulb{0%,100%{opacity:1}45%{opacity:.28}}
    @keyframes halo{0%,100%{transform:scale(1.25)}45%{transform:scale(.6)}}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}}
  </style>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a1d3d"/>
      <stop offset=".34" stop-color="#3b2d63"/>
      <stop offset=".56" stop-color="#9c4f7a"/>
      <stop offset=".72" stop-color="#ee8763"/>
      <stop offset="1" stop-color="#ffc47a"/>
    </linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#ffd27a" stop-opacity=".85"/><stop offset=".35" stop-color="#ffb347" stop-opacity=".35"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
    <radialGradient id="dusk" cx=".7" cy=".78" r=".55"><stop offset="0" stop-color="#ffcf8a" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#dusk)"/>
  <g opacity=".75">${stars}</g>
  <path d="M0 ${f(H - 90 * k)} C${f(300 * k)} ${f(H - 140 * k)} ${f(520 * k)} ${f(H - 100 * k)} ${f(800 * k)} ${f(H - 120 * k)} S${f(1400 * k)} ${f(H - 150 * k)} ${f(1700 * k)} ${f(H - 110 * k)} S${f(2200 * k)} ${f(H - 135 * k)} ${W} ${f(H - 105 * k)} L${W} ${H} L0 ${H}Z" fill="#4a3460" opacity=".7"/>
  ${back.path}
  ${windowsOf(back.lit, 0.55)}
  ${front.path}
  ${windowsOf(front.lit, 1)}
  <g class="l">
    ${Array.from({ length: Math.ceil(W / span) + 1 }, (_, i) => lights(f(i * span - 40 * k), -6 + (i % 2) * 8, f(i * span + span - 40 * k), -2 - (i % 2) * 6, f(sag + (i % 3) * 8 * k), 16, 'l')).join(' ')}
  </g>
</svg>
`;
  writeFileSync(new URL(`../public/${file}`, import.meta.url), svg);
  console.log(file, svg.length, 'bytes');
}

// Computer: very wide on purpose: the page fits it to the header's height (never
// crops it), so lights and houses show the same on any screen, up to ~2900 px wide.
draw('header-pc.svg', { W: 8000, H: 420, k: 1, span: 860, sag: 88, starCount: 230, starTop: 150, note: 'Header art for computers' });
// Phone (app.css uses it up to 480 px, where the tabs wrap under the logo and the
// header is ~145 px tall): about 3.4:1, so up to ~490 px wide it is fitted to the
// header's height and only the sides are cut; houses and bulbs bigger, so they
// still read at that size.
draw('header-phone.svg', { W: 1900, H: 560, k: 1.45, span: 520, sag: 115, starCount: 70, starTop: 260, note: 'Header art for phones' });
