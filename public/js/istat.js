// HostelFlow — ISTAT report (Settings → ISTAT): for each day, how many guests
// of each nationality arrived and how many left. Simple on purpose.
// Plain scripts loaded in order by index.html; they share globals.

// ===== ISTAT report =====

const isoOf = ddmmyyyy => ddmmyyyy.split('.').reverse().join('-');

function openIstat() {
  // The last week, today included.
  if (!$('is-to').value) $('is-to').value = isoOf(dayIn(0));
  if (!$('is-from').value) $('is-from').value = isoOf(dayIn(-6));
  $('is-modal').hidden = false;
  loadIstat();
}
function closeIstat() { $('is-modal').hidden = true; }

async function loadIstat() {
  if (!state.property) return;
  const out = $('is-out');
  out.replaceChildren(text('p', 'Counting…', 'muted'));
  try {
    const r = await api('GET', `/api/properties/${state.property.id}/istat/report?from=${$('is-from').value}&to=${$('is-to').value}${state.adminPropertyId === state.property.id ? stQuery() : ''}`);
    renderIstat(r.days);
  } catch (err) {
    out.replaceChildren(text('p', err.message, 'err'));
  }
}

function renderIstat(days) {
  const out = $('is-out');
  const sum = list => list.reduce((n, x) => n + x.n, 0);
  // The whole period first, then day by day (newest on top).
  const total = new Map();
  for (const d of days) {
    for (const x of d.arrived) total.set(x.nationality, { a: (total.get(x.nationality)?.a || 0) + x.n, d: total.get(x.nationality)?.d || 0 });
    for (const x of d.departed) total.set(x.nationality, { a: total.get(x.nationality)?.a || 0, d: (total.get(x.nationality)?.d || 0) + x.n });
  }
  if (!total.size) {
    out.replaceChildren(text('p', 'Nobody arrived or left in these days.', 'muted'));
    return;
  }
  const table = document.createElement('table');
  table.className = 'is-table';
  const row = (cells, tag = 'td') => {
    const tr = document.createElement('tr');
    for (const c of cells) tr.append(text(tag, String(c)));
    return tr;
  };
  table.append(row(['Nationality', 'Arrived', 'Departed'], 'th'));
  const sorted = [...total].sort((x, y) => (y[1].a + y[1].d) - (x[1].a + x[1].d) || x[0].localeCompare(y[0]));
  for (const [nat, v] of sorted) table.append(row([nat, v.a, v.d]));
  const tot = row(['Total', sorted.reduce((n, [, v]) => n + v.a, 0), sorted.reduce((n, [, v]) => n + v.d, 0)]);
  tot.className = 'tot';
  table.append(tot);

  const list = document.createElement('div');
  list.className = 'is-days';
  for (const d of [...days].reverse()) {
    const day = document.createElement('div');
    day.className = 'is-day';
    day.append(text('b', calDayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' })));
    const line = (label, cls, items) => {
      const p = document.createElement('div');
      p.className = cls;
      p.append(text('span', t(label, { n: sum(items) }), 'is-k'),
        text('span', items.length ? items.map(x => `${x.nationality} ${x.n}`).join(', ') : '—', 'is-v'));
      return p;
    };
    day.append(line('Arrived {n}', 'is-in', d.arrived), line('Departed {n}', 'is-outl', d.departed));
    list.append(day);
  }
  out.replaceChildren(text('div', 'Whole period', 'section'), table, text('div', 'Day by day', 'section'), list);
}

$('is-open').onclick = openIstat;
$('is-close').onclick = closeIstat;
$('is-from').addEventListener('change', loadIstat);
$('is-to').addEventListener('change', loadIstat);
$('is-modal').addEventListener('click', e => { if (e.target === $('is-modal')) closeIstat(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('is-modal').hidden) closeIstat(); });
