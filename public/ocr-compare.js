// The scan bench page (/ocr-compare): upload sample documents, both models read
// them (src/ocrbench.js), mark per field who was right; the summary counts it.
const $ = id => document.getElementById(id);
const LABEL = { surname: 'Příjmení', given: 'Jméno', sex: 'Pohlaví', dob: 'Narození', nationality: 'Občanství', docType: 'Typ dokladu', docNumber: 'Číslo dokladu', country: 'Vydal (stát)', expiry: 'Platnost', birthPlace: 'Místo narození' };
const PICKS = [['main', 'Sonnet'], ['shadow', 'Haiku'], ['both', 'oba'], ['neither', 'ani jeden']];
let fields = [], rows = [];
const thumbs = {}; // id -> object URL of the photo (this browser only)

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const money = x => `$${x < 0.01 ? x.toFixed(4) : x.toFixed(3)}`;
const sec = ms => `${(ms / 1000).toFixed(1)} s`;
// 'same' = both read it alike: right for both unless changed.
const rightFor = (v, who) => v === 'same' || v === 'both' || v === who;

function renderSummary() {
  const box = $('summary');
  box.replaceChildren();
  if (!rows.length) { box.append(el('p', 'muted', 'Zatím nic — nahraj první fotky.')); return; }
  const ok = rows.filter(r => !r.main.error && !r.shadow.error);
  let judged = 0, m = 0, s = 0;
  const per = {};
  for (const f of fields) per[f] = { n: 0, m: 0, s: 0 };
  for (const r of ok) {
    for (const f of fields) {
      const v = r.verdict[f];
      if (!v) continue;
      judged++; per[f].n++;
      if (rightFor(v, 'main')) { m++; per[f].m++; }
      if (rightFor(v, 'shadow')) { s++; per[f].s++; }
    }
  }
  const avg = (k, who) => ok.length ? ok.reduce((a, r) => a + r[who][k], 0) / ok.length : 0;
  const grid = el('div', 'sum');
  const card = (title, big, sub) => { const b = el('div', 'box'); b.append(el('div', 'muted', title), el('div', 'big', big), el('div', 'muted', sub)); grid.append(b); };
  card('Skenů', String(rows.length), `${rows.length - ok.length} s chybou modelu`);
  card('Sonnet — správně', judged ? `${Math.round((m / judged) * 100)} %` : '—', `${m} z ${judged} polí · ${sec(avg('ms', 'main'))} · ${money(avg('cost', 'main'))}/sken`);
  card('Haiku — správně', judged ? `${Math.round((s / judged) * 100)} %` : '—', `${s} z ${judged} polí · ${sec(avg('ms', 'shadow'))} · ${money(avg('cost', 'shadow'))}/sken`);
  box.append(grid);
  const t = el('table');
  t.innerHTML = '<thead><tr><th>Pole</th><th>Posouzeno</th><th>Sonnet</th><th>Haiku</th></tr></thead>';
  const tb = el('tbody');
  for (const f of fields) {
    const p = per[f];
    const tr = el('tr');
    const pct = x => (p.n ? `${x}/${p.n} (${Math.round((x / p.n) * 100)} %)` : '—');
    tr.append(el('td', '', LABEL[f] || f), el('td', '', String(p.n)), el('td', '', pct(p.m)), el('td', '', pct(p.s)));
    if (p.n && p.s < p.m) tr.lastChild.style.color = 'var(--bad)';
    tb.append(tr);
  }
  t.append(tb);
  const wrap = el('div', 'tbl');
  wrap.append(t);
  box.append(wrap);
}

function renderRow(r) {
  const card = el('div', 'card');
  const head = el('div', 'card-head');
  if (thumbs[r.id]) { const img = el('img', 'thumb'); img.src = thumbs[r.id]; img.alt = ''; head.append(img); }
  const meta = el('div', 'meta');
  meta.append(el('div', '', `${r.label || 'sken'} · ${new Date(r.createdAt).toLocaleString('cs-CZ')}`));
  const line = (cls, name, x) => { const d = el('div'); const b = el('b', cls, name); d.append(b, ` ${r.models[cls === 'm' ? 'main' : 'shadow']} · ${sec(x.ms)} · ${money(x.cost)}`); if (x.error) d.append(el('div', 'err', x.error)); return d; };
  meta.append(line('m', 'Sonnet', r.main), line('s', 'Haiku', r.shadow));
  const del = el('button', 'x', 'smazat');
  del.onclick = async () => { if (!confirm('Smazat tenhle sken z porovnání?')) return; await call('DELETE', `/api/ocr-bench/${r.id}`); rows = rows.filter(x => x.id !== r.id); render(); };
  meta.append(del);
  head.append(meta);
  card.append(head);
  const t = el('table');
  t.innerHTML = '<thead><tr><th>Pole</th><th>Sonnet</th><th>Haiku</th><th>Kdo měl pravdu</th></tr></thead>';
  const tb = el('tbody');
  for (const f of fields) {
    const a = r.main.fields[f] || '', b = r.shadow.fields[f] || '';
    const v = r.verdict[f];
    const tr = el('tr', v === 'same' ? 'same' : 'diff');
    tr.append(el('td', '', LABEL[f] || f), el('td', 'v', a || '—'), el('td', 'v', b || '—'));
    const pick = el('div', 'pick');
    for (const [key, name] of PICKS) {
      const btn = el('button', key + ((v === key || (v === 'same' && key === 'both')) ? ' on' : ''), name);
      btn.type = 'button';
      btn.onclick = async () => {
        const next = (v === key || (v === 'same' && key === 'both')) ? null : key;
        try { r.verdict = (await call('PUT', `/api/ocr-bench/${r.id}`, { field: f, verdict: next })).verdict; render(); } catch (err) { alert(err.message); }
      };
      pick.append(btn);
    }
    const td = el('td');
    td.append(pick);
    tr.append(td);
    tb.append(tr);
  }
  t.append(tb);
  const wrap = el('div', 'tbl');
  wrap.append(t);
  card.append(wrap);
  return card;
}

function render() {
  renderSummary();
  $('rows').replaceChildren(...rows.map(renderRow));
}

// Photos as JPEG, at most 1800 px — the same size the app sends.
async function toDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

$('files').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const [i, file] of files.entries()) {
    $('busy').textContent = `Čtu ${i + 1} z ${files.length}: ${file.name}… (oba modely najednou, ~10 s)`;
    try {
      const row = await call('POST', '/api/ocr-bench', { image: await toDataUrl(file), label: file.name });
      thumbs[row.id] = URL.createObjectURL(file);
      rows.unshift(row);
      render();
    } catch (err) {
      $('busy').textContent = `${file.name}: ${err.message}`;
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  $('busy').textContent = files.length ? 'Hotovo. U rozdílů vyber, kdo měl pravdu.' : '';
});

(async () => {
  try {
    const data = await call('GET', '/api/ocr-bench');
    fields = data.fields;
    rows = data.rows;
    $('who').textContent = 'Přihlášen. Nahraj fotky vzorových dokladů.';
    $('tools').hidden = false;
    render();
  } catch (err) {
    $('who').innerHTML = err.status === 401
      ? 'Nejdřív se přihlas na <a href="/">hostelflow.it</a>, pak se sem vrať.'
      : 'Tahle stránka není pro tenhle účet otevřená.';
  }
})();
