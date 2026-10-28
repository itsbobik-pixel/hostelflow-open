// HostelFlow — The Vault (opens from the user menu): pages and files the team
// needs — procedures, contacts, rules — in folders, with search. Everyone
// reads; editing needs the 'vault' permission (src/vault.js).

let vtData = null;      // GET /vault: folders, items (no page text), canEdit, …
let vtFolder = null;    // the folder open now (null = the top)
let vtResults = null;   // search results, while there is a search
let vtEditing = null;   // { item } being edited, or { kind } being added
let vtSearchTimer;

const vaultBase = () => `/api/properties/${state.property.id}/vault`;
const vaultFileUrl = (id, download) => `${vaultBase()}/items/${id}/file${download ? '?download=1' : ''}`;

async function loadVault() {
  if (!state.property) return;
  try {
    vtData = await api('GET', vaultBase());
  } catch (err) { toast(tx(err.message)); return; }
  if (vtFolder && !vtData.folders.some(f => f.id === vtFolder)) vtFolder = null;
  if ($('vt-q').value.trim()) await searchVault();
  renderVault();
}

async function searchVault() {
  const q = $('vt-q').value.trim();
  if (!q) { vtResults = null; return; }
  try { vtResults = (await api('GET', `${vaultBase()}?q=${encodeURIComponent(q)}`)).items; }
  catch (err) { toast(tx(err.message)); }
}
$('vt-q').addEventListener('input', () => {
  clearTimeout(vtSearchTimer);
  vtSearchTimer = setTimeout(async () => { await searchVault(); renderVault(); }, 250);
});

const vaultFolderName = id => (vtData.folders.find(f => f.id === id) || {}).name || '';

function vaultSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${+(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${+(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// Line icons on a soft coloured tile (app.css .vt-ico), one colour per kind,
// so a long list reads at a glance and looks the same on every phone.
const VT_SVG = {
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  page: '<path d="M6.5 3h7.5l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"/><path d="M14 3v4.5h4.5M8.5 12.5h7M8.5 16h5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M20.5 16l-4.8-4.8L6 19.5"/>',
  pdf: '<path d="M6.5 3h7.5l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"/><path d="M14 3v4.5h4.5"/><path d="M8.5 13h7v4h-7z"/>',
  file: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l7.8-7.8a3.3 3.3 0 0 1 4.7 4.7l-7.8 7.8a1.7 1.7 0 0 1-2.4-2.4l7.2-7.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  pencil: '<path d="M15.5 4.5l4 4L8.5 19.5H4.5v-4z"/><path d="M13 7l4 4"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6"/>',
};
const vaultSvg = (name, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VT_SVG[name]}</svg>`;

function vaultKind(item) {
  if (item.kind === 'folder' || item.kind === 'page') return item.kind;
  if (/^image\//.test(item.type)) return 'image';
  if (item.type === 'application/pdf') return 'pdf';
  return 'file';
}

function renderVault() {
  if (!vtData) return;
  const edit = vtData.canEdit;
  $('vt-tools').hidden = !edit;
  $('vt-add-file').disabled = !vtData.files;
  $('vt-add-file').title = vtData.files ? '' : t('File uploads aren\'t available yet. Text pages work.');

  // Where we are: the top, a folder (with its own buttons) or a search.
  const path = $('vt-path');
  path.replaceChildren();
  const searching = vtResults !== null;
  if (searching || vtFolder) {
    const top = text('button', 'All', 'link');
    top.type = 'button';
    top.onclick = () => { vtFolder = null; $('vt-q').value = ''; vtResults = null; renderVault(); };
    path.append(top, text('span', '›', 'muted'));
    if (searching) path.append(text('b', t('Search: “{q}”', { q: $('vt-q').value.trim() })));
    else {
      path.append(text('b', vaultFolderName(vtFolder)));
      if (edit) {
        const rename = text('button', 'Rename', 'small');
        rename.type = 'button';
        rename.onclick = renameVaultFolder;
        const del = text('button', 'Delete folder', 'small danger');
        del.type = 'button';
        del.onclick = deleteVaultFolder;
        path.append(rename, del);
      }
      if (vtData.owner) {
        const who = text('button', 'Who can see', 'small vt-who');
        who.type = 'button';
        if (vaultFolderAccess(vtFolder)) who.insertAdjacentHTML('afterbegin', vaultSvg('lock', 15));
        who.onclick = openVaultAccess;
        path.append(who);
      }
    }
  }

  const list = $('vt-list');
  list.replaceChildren();
  let rows;
  if (searching) rows = vtResults;
  else if (vtFolder) rows = vtData.items.filter(i => i.folderId === vtFolder);
  else {
    const counts = {};
    for (const i of vtData.items) if (i.folderId) counts[i.folderId] = (counts[i.folderId] || 0) + 1;
    rows = [...vtData.folders.map(f => ({ kind: 'folder', id: f.id, title: f.name, count: counts[f.id] || 0, restricted: !!f.access })), ...vtData.items.filter(i => !i.folderId)];
  }
  for (const item of rows) list.append(vaultRow(item, searching));

  const empty = $('vt-empty');
  empty.hidden = rows.length > 0;
  empty.textContent = searching ? t('Nothing found.')
    : vtFolder ? t('This folder is empty.')
      : edit ? t('Nothing here yet. Add a page (e.g. how to close the bar, who to call when the boiler breaks) or upload a file.')
        : t('Nothing here yet.');
  // Space for files: all of the property's together (src/vault.js VAULT_LIMIT_BYTES).
  $('vt-usage').hidden = !vtData.files;
  const share = Math.min(1, vtData.used / vtData.limit);
  $('vt-bar').style.width = `${Math.max(vtData.used ? 2 : 0, Math.round(share * 100))}%`;
  $('vt-bar').parentElement.classList.toggle('full', share > 0.9);
  $('vt-usage-text').textContent = t('{used} of {limit} used', { used: vtData.used ? vaultSize(vtData.used) : '0 MB', limit: vaultSize(vtData.limit) });
}

function vaultRow(item, searching) {
  const row = document.createElement('div');
  row.className = 'row vt-row';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'vt-open grow';
  const kind = vaultKind(item);
  const icon = document.createElement('span');
  icon.className = `vt-ico vt-ico-${kind}`;
  icon.innerHTML = vaultSvg(kind);
  const words = document.createElement('span');
  words.className = 'vt-words';
  const name = document.createElement('span');
  name.className = 'vt-name';
  name.textContent = item.title; // their own words: never run through the dictionary
  words.append(name);
  const meta = [];
  if (item.kind === 'folder') {
    meta.push(item.count === 1 ? t('1 item') : t('{n} items', { n: item.count }));
    if (item.restricted) meta.push(t('Only some people')); // only owners get the rule
  }
  else {
    if (searching && item.folderId) meta.push(vaultFolderName(item.folderId));
    if (item.kind === 'file') meta.push(vaultSize(item.size));
    meta.push(new Date(item.updatedAt).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }));
    if (item.updatedBy) meta.push(item.updatedBy);
  }
  const small = document.createElement('small');
  small.className = 'muted';
  small.textContent = meta.join(' · ');
  if (item.restricted) small.insertAdjacentHTML('afterbegin', vaultSvg('lock', 13));
  words.append(small);
  open.append(icon, words);
  open.onclick = () => openVaultItem(item);
  row.append(open);

  if (item.kind === 'file') {
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'small vt-dl';
    dl.innerHTML = vaultSvg('download', 18);
    dl.title = t('Download');
    dl.setAttribute('aria-label', dl.title);
    dl.onclick = () => downloadVaultFile(item);
    row.append(dl);
  }
  if (vtData.canEdit && item.kind !== 'folder') {
    // The word on wide screens, a pencil on phones (app.css .vt-ed), so the
    // name keeps the room.
    const ed = document.createElement('button');
    ed.type = 'button';
    ed.className = 'small vt-ed';
    ed.innerHTML = vaultSvg('pencil', 18);
    ed.append(text('span', 'Edit'));
    ed.setAttribute('aria-label', t('Edit'));
    ed.onclick = () => openVaultEditor(item);
    // Deleting straight from the list, without opening the item first.
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'small danger vt-dl';
    del.innerHTML = vaultSvg('trash', 18);
    del.title = t('Delete');
    del.setAttribute('aria-label', del.title);
    del.onclick = () => deleteVaultItem(item, toast);
    row.append(ed, del);
  }
  return row;
}

function downloadVaultFile(item) {
  const a = document.createElement('a');
  a.href = vaultFileUrl(item.id, true);
  a.download = item.title;
  document.body.append(a);
  a.click();
  a.remove();
}

async function openVaultItem(item) {
  if (item.kind === 'folder') { vtFolder = item.id; renderVault(); window.scrollTo({ top: 0 }); return; }
  if (item.kind === 'file') {
    if (/^image\//.test(item.type) && item.inline) {
      $('vt-pic-title').textContent = item.title;
      $('vt-pic-img').src = vaultFileUrl(item.id);
      $('vt-pic-img').alt = item.title;
      $('vt-pic-download').onclick = () => downloadVaultFile(item);
      $('vt-pic').hidden = false;
    } else if (item.inline) {
      window.open(vaultFileUrl(item.id), '_blank', 'noopener'); // a PDF: the browser's own viewer
    } else downloadVaultFile(item);
    return;
  }
  try {
    const page = await api('GET', `${vaultBase()}/items/${item.id}`);
    $('vt-view-title').textContent = page.title;
    $('vt-view-body').replaceChildren(vaultText(page.body));
    const when = new Date(page.updatedAt).toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    $('vt-view-meta').textContent = page.updatedBy ? t('Last changed {when} by {name}', { when, name: page.updatedBy }) : t('Last changed {when}', { when });
    $('vt-view-foot').hidden = !vtData.canEdit;
    $('vt-view-edit').onclick = () => { $('vt-view').hidden = true; openVaultEditor({ ...item, body: page.body }); };
    $('vt-view').hidden = false;
  } catch (err) { toast(tx(err.message)); }
}

// A page's text, safely (only text nodes and a few elements, never HTML from
// the text): "# " a heading, "- " a list item, **bold**, web links.
function vaultText(body) {
  const out = document.createDocumentFragment();
  let list = null;
  let para = null;
  for (const line of String(body || '').split('\n')) {
    const s = line.trim();
    if (!s) { list = para = null; continue; }
    if (/^#{1,3}\s/.test(s)) {
      list = para = null;
      out.append(vaultInline(document.createElement('h3'), s.replace(/^#+\s*/, '')));
    } else if (/^[-*•]\s/.test(s)) {
      para = null;
      if (!list) { list = document.createElement('ul'); out.append(list); }
      list.append(vaultInline(document.createElement('li'), s.replace(/^[-*•]\s*/, '')));
    } else {
      list = null;
      if (para) para.append(document.createElement('br'));
      else { para = document.createElement('p'); out.append(para); }
      vaultInline(para, s);
    }
  }
  if (!out.childNodes.length) out.append(text('p', 'This page is empty.', 'muted'));
  return out;
}
function vaultInline(el, s) {
  // **bold** first, then links inside each piece.
  s.split(/(\*\*[^*]+\*\*)/).forEach(part => {
    if (/^\*\*[^*]+\*\*$/.test(part)) { const b = document.createElement('b'); b.textContent = part.slice(2, -2); el.append(b); return; }
    part.split(/(https?:\/\/[^\s<>"]+)/).forEach(bit => {
      if (/^https?:\/\//.test(bit)) {
        // A full stop or bracket after the address is not part of it.
        const url = bit.replace(/[.,;:!?)]+$/, '');
        const a = document.createElement('a');
        a.href = url;
        a.textContent = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        el.append(a, bit.slice(url.length));
      } else if (bit) el.append(bit);
    });
  });
  return el;
}

// ----- Adding and changing -----

function openVaultEditor(item) {
  vtEditing = item;
  const isNew = !item.id;
  const page = item.kind === 'page';
  $('vt-edit-title').textContent = t(isNew ? 'New page' : page ? 'Edit page' : 'Edit file');
  $('vt-edit-name-label').textContent = t(page ? 'Title' : 'File name');
  $('vt-edit-name').value = item.title || '';
  $('vt-edit-text-wrap').hidden = !page;
  $('vt-edit-text').value = item.body || '';
  $('vt-edit-folder').replaceChildren(new Option(t('— No folder —'), ''), ...vtData.folders.map(f => new Option(f.name, f.id)));
  $('vt-edit-folder').value = (isNew ? vtFolder : item.folderId) || '';
  $('vt-edit-delete').hidden = isNew;
  $('vt-edit-err').textContent = '';
  $('vt-edit').hidden = false;
  // An existing page: its text may still come (the list has none).
  if (page && !isNew && item.body === undefined) {
    api('GET', `${vaultBase()}/items/${item.id}`).then(p => { if (vtEditing === item) $('vt-edit-text').value = p.body; }).catch(() => {});
  }
  $('vt-edit-name').focus();
}
const closeVaultEditor = () => { $('vt-edit').hidden = true; vtEditing = null; };

bindForm('form-vt-edit', 'vt-edit-err', async () => {
  const item = vtEditing;
  const body = { title: $('vt-edit-name').value, folderId: $('vt-edit-folder').value || null };
  if (item.kind === 'page') body.body = $('vt-edit-text').value;
  if (item.id) await api('PUT', `${vaultBase()}/items/${item.id}`, body);
  else await api('POST', `${vaultBase()}/pages`, body);
  closeVaultEditor();
  toast(t('Saved ✓'));
  await loadVault();
});

// From the editor or from the list's bin: onError says where a failure shows.
async function deleteVaultItem(item, onError) {
  if (!item || !confirm(t('Delete “{name}”? It cannot be undone.', { name: item.title }))) return;
  try {
    await api('DELETE', `${vaultBase()}/items/${item.id}`);
    if (vtEditing) closeVaultEditor();
    toast(t('Deleted'));
    await loadVault();
  } catch (err) { onError(tx(err.message)); }
}
$('vt-edit-delete').onclick = () => deleteVaultItem(vtEditing, msg => { $('vt-edit-err').textContent = msg; });

$('vt-add-page').onclick = () => openVaultEditor({ kind: 'page' });

// A new folder, or a new name for the open one: a small window of our own
// (the browser's prompt looks out of place, above all on iPhones).
let vtFolderRename = false;
function openVaultFolderForm(rename) {
  vtFolderRename = rename;
  $('vt-folder-title').textContent = t(rename ? 'Rename folder' : 'New folder');
  $('vt-folder-save').textContent = t(rename ? 'Save' : 'Create');
  $('vt-folder-ico').innerHTML = vaultSvg('folder', 22);
  $('vt-folder-name').value = rename ? vaultFolderName(vtFolder) : '';
  $('vt-folder-err').textContent = '';
  $('vt-folder').hidden = false;
  $('vt-folder-name').focus();
}
function closeVaultFolderForm() { $('vt-folder').hidden = true; }
$('vt-add-folder').onclick = () => openVaultFolderForm(false);
function renameVaultFolder() { openVaultFolderForm(true); }
$('vt-folder-cancel').onclick = closeVaultFolderForm;
$('vt-folder').addEventListener('click', e => { if (e.target === $('vt-folder')) closeVaultFolderForm(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('vt-folder').hidden) closeVaultFolderForm(); });
bindForm('form-vt-folder', 'vt-folder-err', async () => {
  const name = $('vt-folder-name').value.trim();
  if (!name) { $('vt-folder-name').focus(); return; }
  if (vtFolderRename) await api('PUT', `${vaultBase()}/folders/${vtFolder}`, { name });
  else {
    const f = await api('POST', `${vaultBase()}/folders`, { name });
    vtFolder = f.id;
    $('vt-q').value = '';
    vtResults = null;
  }
  closeVaultFolderForm();
  await loadVault();
});

async function deleteVaultFolder() {
  const n = vtData.items.filter(i => i.folderId === vtFolder).length;
  const msg = n ? t('Delete the folder “{name}” and everything in it ({n})? It cannot be undone.', { name: vaultFolderName(vtFolder), n })
    : t('Delete the folder “{name}”?', { name: vaultFolderName(vtFolder) });
  if (!confirm(msg)) return;
  try {
    await api('DELETE', `${vaultBase()}/folders/${vtFolder}`);
    vtFolder = null;
    toast(t('Deleted'));
    await loadVault();
  } catch (err) { toast(tx(err.message)); }
}

// ----- Who can see a folder (owners only; the server hides it from the rest) -----

const vaultFolderAccess = id => (vtData.folders.find(f => f.id === id) || {}).access || null;

function vaultCheck(value, label, checked) {
  const row = document.createElement('label');
  row.className = 'vt-check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = value;
  box.checked = checked;
  const words = document.createElement('span');
  words.textContent = label;
  row.append(box, words);
  return row;
}

function openVaultAccess() {
  const rule = vaultFolderAccess(vtFolder);
  $('vt-acc-title').textContent = `${t('Who can see this folder')}: ${vaultFolderName(vtFolder)}`;
  $(rule ? 'vt-acc-some' : 'vt-acc-all').checked = true;
  // People only (no more Staff and Volunteer, 23. 10.): a folder kept to a
  // role before shows everyone who had that role ticked, saved as people.
  const roles = (rule && rule.roles) || [];
  const users = (rule && rule.users) || [];
  $('vt-acc-people').replaceChildren(...vtData.members.map(m => vaultCheck(m.id, m.name, users.includes(m.id) || roles.includes(m.role))));
  $('vt-acc-who').hidden = !rule;
  $('vt-acc-err').textContent = '';
  $('vt-acc').hidden = false;
}
for (const id of ['vt-acc-all', 'vt-acc-some']) $(id).addEventListener('change', () => { $('vt-acc-who').hidden = !$('vt-acc-some').checked; });
$('vt-acc-cancel').onclick = () => { $('vt-acc').hidden = true; };

bindForm('form-vt-acc', 'vt-acc-err', async () => {
  const picked = box => [...$(box).querySelectorAll('input:checked')].map(i => i.value);
  const access = $('vt-acc-some').checked ? { roles: [], users: picked('vt-acc-people') } : null;
  await api('PUT', `${vaultBase()}/folders/${vtFolder}/access`, { access });
  $('vt-acc').hidden = true;
  toast(t('Saved ✓'));
  await loadVault();
});

// Files: straight from the picker, one after another, into the folder open now.
$('vt-add-file').onclick = () => $('vt-file').click();
$('vt-file').addEventListener('change', async () => {
  const files = [...$('vt-file').files];
  $('vt-file').value = '';
  if (!files.length) return;
  let done = 0;
  for (const file of files) {
    if (file.size > vtData.maxFile) { toast(t('“{name}” is too big (at most 10 MB)', { name: file.name })); continue; }
    toast(files.length > 1 ? t('Uploading {i} of {n}…', { i: done + 1, n: files.length }) : t('Uploading…'));
    try {
      const res = await fetch(`${vaultBase()}/files${vtFolder ? `?folder=${encodeURIComponent(vtFolder)}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Vault-Name': encodeURIComponent(file.name) },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      done++;
    } catch (err) { toast(`${file.name}: ${tx(err.message)}`); }
  }
  if (done) toast(done === 1 ? t('File added ✓') : t('{n} files added ✓', { n: done }));
  await loadVault();
});

// Closing the dialogs: ×, Cancel, a tap outside, Escape.
for (const [modal, close] of [['vt-view', 'vt-view-close'], ['vt-edit', 'vt-edit-close'], ['vt-pic', 'vt-pic-close'], ['vt-acc', 'vt-acc-close']]) {
  const shut = () => { $(modal).hidden = true; if (modal === 'vt-edit') vtEditing = null; if (modal === 'vt-pic') $('vt-pic-img').removeAttribute('src'); };
  $(close).onclick = shut;
  $(modal).addEventListener('click', e => { if (e.target === $(modal)) shut(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$(modal).hidden) shut(); });
}
$('vt-edit-cancel').onclick = closeVaultEditor;
