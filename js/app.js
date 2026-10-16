const $ = s => document.querySelector(s);
let tab = 'library';

const STATUS_LABEL = { unread: 'Unread', reading: 'Reading', read: 'Read' };

function refreshRooms() {
  const rooms = [...new Set(Store.all().map(b => (b.room || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sel = $('#f-room'), cur = sel.value;
  sel.replaceChildren(new Option('All shelves', ''), ...rooms.map(r => new Option(r, r)));
  sel.value = rooms.includes(cur) ? cur : '';
  $('#rooms').replaceChildren(...rooms.map(r => new Option(r)));
}

function render() {
  refreshRooms();
  const q = $('#search').value.trim().toLowerCase();
  const room = $('#f-room').value, status = $('#f-status').value, lentOnly = $('#f-lent').checked;
  const all = Store.all();
  $('#count-library').textContent = all.filter(b => b.list === 'library').length;
  $('#count-wishlist').textContent = all.filter(b => b.list === 'wishlist').length;
  const items = all.filter(b => b.list === tab &&
    (!q || [b.title, b.author, b.room, b.notes, b.isbn, b.lentTo].some(f => (f || '').toLowerCase().includes(q))) &&
    (!room || b.room === room) &&
    (!status || (b.status || 'unread') === status) &&
    (!lentOnly || b.lentTo));
  const ul = $('#list');
  ul.replaceChildren();
  for (const b of items) {
    const li = document.createElement('li');
    const cover = b.cover ? Object.assign(document.createElement('img'), { src: b.cover, alt: '', loading: 'lazy' }) : Object.assign(document.createElement('div'), { className: 'ph', textContent: '📖' });
    if (b.cover) cover.onerror = () => cover.replaceWith(Object.assign(document.createElement('div'), { className: 'ph', textContent: '📖' }));
    const info = document.createElement('div');
    for (const [cls, text] of [['t', b.title], ['a', b.author], ['n', [b.room, b.notes].filter(Boolean).join(' · ')]]) {
      if (!text) continue;
      info.append(Object.assign(document.createElement('div'), { className: cls, textContent: text }));
    }
    const badges = document.createElement('div');
    badges.className = 'badges';
    if (tab === 'library') {
      const st = b.status || 'unread';
      badges.append(Object.assign(document.createElement('span'), { className: 'badge ' + st, textContent: STATUS_LABEL[st] }));
      if (b.lentTo) badges.append(Object.assign(document.createElement('span'), { className: 'badge lent', textContent: 'Lent to ' + b.lentTo }));
    }
    if (badges.childElementCount) info.append(badges);
    li.append(cover, info);
    if (tab === 'wishlist') {
      const mv = Object.assign(document.createElement('button'), { className: 'move', textContent: 'Got it' });
      mv.onclick = e => { e.stopPropagation(); Store.upsert({ id: b.id, list: 'library' }); render(); };
      li.append(mv);
    }
    li.onclick = () => openEdit(b);
    ul.append(li);
  }
  const empty = $('#empty');
  empty.hidden = items.length > 0;
  empty.textContent = q ? 'No matches.' : tab === 'library' ? 'No books yet. Tap Scan or Add by hand.' : 'Your wishlist is empty.';
}

document.querySelectorAll('nav button').forEach(btn => btn.onclick = () => {
  tab = btn.dataset.tab;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b === btn));
  render();
});
$('#search').oninput = render;
['#f-room', '#f-status', '#f-lent'].forEach(s => $(s).onchange = render);

// ---- add / edit ----
const dlg = $('#edit-dialog'), form = $('#edit-form');
let editingId = null;

function openEdit(b = {}) {
  editingId = b.id || null;
  $('#edit-title').textContent = b.id ? 'Edit book' : 'Add a book';
  for (const f of ['title', 'author', 'isbn', 'cover', 'room', 'lentTo', 'notes']) form.elements[f].value = b[f] || '';
  form.elements.status.value = b.status || 'unread';
  form.elements.list.value = b.list || tab;
  $('#edit-cover').hidden = !b.cover;
  if (b.cover) $('#edit-cover').src = b.cover;
  $('#edit-delete').hidden = !b.id;
  const warn = $('#edit-warn');
  const dup = b.isbn && Store.findByIsbn(b.isbn);
  warn.hidden = !(dup && dup.id !== b.id);
  if (!warn.hidden) warn.textContent = `Already in your ${dup.list}: "${dup.title}".`;
  dlg.showModal();
}
form.onsubmit = e => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(form));
  if (editingId) v.id = editingId;
  Store.upsert(v);
  dlg.close();
  tab = v.list;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
};
$('#edit-cancel').onclick = () => dlg.close();
$('#edit-delete').onclick = () => { if (confirm('Delete this book?')) { Store.remove(editingId); dlg.close(); render(); } };
$('#btn-add').onclick = () => openEdit({});

// ---- scan ----
const sdlg = $('#scan-dialog'), status = $('#scan-status');
let busy = false;

async function handleIsbn(raw) {
  if (busy) return;
  busy = true;
  status.textContent = 'Looking up ' + raw + '…';
  const list = document.querySelector('input[name=scan-target]:checked').value;
  try {
    const found = await Lookup.byIsbn(raw);
    stopScan();
    if (found) openEdit({ ...found, list });
    else {
      openEdit({ isbn: Store.cleanIsbn(raw), list });
      const warn = $('#edit-warn');
      warn.hidden = false;
      warn.textContent = 'No details found for this ISBN. Fill in the title and author by hand.';
    }
  } catch (e) {
    status.textContent = e.message + ' You can also type the ISBN.';
  } finally {
    busy = false;
  }
}
function stopScan() { Scanner.stop(); if (sdlg.open) sdlg.close(); }
$('#btn-scan').onclick = async () => {
  status.textContent = 'Starting camera…';
  sdlg.showModal();
  try {
    const torch = $('#torch');
    torch.hidden = true;
    await Scanner.start($('#video'), handleIsbn, toggle => {
      torch.hidden = false;
      torch.onclick = async () => { torch.textContent = (await toggle()) ? 'Torch off' : 'Torch on'; };
      torch.textContent = 'Torch on';
    });
    status.textContent = 'Point the camera at the barcode on the back of the book.';
  } catch (e) {
    status.textContent = 'Camera unavailable (' + e.message + '). You can type the ISBN instead.';
  }
};
$('#scan-close').onclick = stopScan;
sdlg.addEventListener('close', () => Scanner.stop());
$('#isbn-go').onclick = () => handleIsbn($('#isbn-manual').value);

// ---- fill missing details ----
$('#btn-fill').onclick = async () => {
  const btn = $('#btn-fill');
  const todo = Store.all().filter(b => !b.isbn && (!b.author || !b.cover));
  if (!todo.length) return alert('Nothing to fill in: every book without an ISBN already has an author and a cover.');
  if (!navigator.onLine) return alert('You are offline. Try again when connected.');
  const filled = [], notFound = [];
  let failed = 0;
  for (let i = 0; i < todo.length; i++) {
    btn.textContent = `Filling ${i + 1} of ${todo.length}…`;
    const b = todo[i];
    try {
      const r = await Lookup.byTitle(b.title, b.author);
      const patch = {};
      if (r && !b.author && r.author) patch.author = r.author;
      if (r && !b.cover && r.cover) patch.cover = r.cover;
      if (Object.keys(patch).length) { Store.upsert({ id: b.id, ...patch }); filled.push(b.title + (patch.author ? ' (author: ' + patch.author + ')' : '')); }
      else notFound.push(b.title);
    } catch (e) { failed++; notFound.push(b.title); }
  }
  btn.textContent = 'Fill missing details';
  alert(`Updated ${filled.length} of ${todo.length} books.\n\n` + (filled.length ? 'Check these:\n' + filled.join('\n') + '\n\n' : '') +
    (notFound.length ? `No confident match for ${notFound.length}${failed ? ' (some lookups failed, try again)' : ''}. Edit those by hand, or scan their barcode.` : ''));
};

// ---- backup ----
$('#btn-export').onclick = () => {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([Store.exportJson()], { type: 'application/json' })),
    download: 'books-library-backup.json',
  });
  a.click();
};
$('#file-import').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { alert(`Imported ${Store.importJson(await f.text())} books.`); render(); }
  catch (err) { alert('Import failed: ' + err.message); }
  e.target.value = '';
};

// Starter books: added once per ISBN (so deleting one later does not bring it back).
let syncTried = false;
async function seedStarterBooks() {
  try {
    const seeded = JSON.parse(localStorage.getItem('books-library-seeded') || '[]');
    const books = await (await fetch('seed-books.json')).json();
    let added = 0;
    // With sync on, wait for the first sync attempt so another device's copy (or delete) is respected; if sync fails, add locally anyway.
    if (Sync.configured() && !Sync.hasPulled() && !syncTried) return;
    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    for (const b of books) {
      const id = b.seedId || 'seed-' + b.isbn;
      if (seeded.includes(id) || (b.isbn && seeded.includes(b.isbn))) {
        // Already added: only fill fields that are still blank, never overwrite the user's edits.
        const have = Store.get(id);
        const patch = {};
        for (const f of ['author', 'isbn', 'cover']) if (have && !have[f] && b[f]) patch[f] = b[f];
        if (Object.keys(patch).length) { Store.upsert({ id, ...patch }); added++; }
        continue;
      }
      seeded.push(id);
      const dup = Store.all().some(x => (b.isbn && x.isbn === b.isbn) || norm(x.title) === norm(b.title));
      if (!Store.getIncludingDeleted(id) && !dup) { Store.upsert({ ...b, id, seedId: undefined }); added++; }
    }
    localStorage.setItem('books-library-seeded', JSON.stringify(seeded));
    if (added) render();
  } catch (e) {}
}

// ---- sync ----
const sydlg = $('#sync-dialog'), sform = $('#sync-form');
function showSyncState() {
  const on = Sync.configured();
  $('#sync-now').hidden = $('#sync-out').hidden = !on;
  $('#sync-signin').textContent = on ? 'Sign in again' : 'Sign in and sync';
}
Sync.onStatus(({ state, msg }) => {
  $('#sync-text').textContent = msg;
  $('#btn-sync').className = 'link sync-' + state;
  const m = $('#sync-msg');
  m.hidden = state !== 'error' || !sydlg.open;
  m.textContent = msg;
  if (state === 'ok' || state === 'error') { syncTried = true; seedStarterBooks(); }
});
$('#btn-sync').onclick = () => {
  const s = Sync.settings();
  for (const f of ['url', 'key', 'email']) sform.elements[f].value = s[f];
  sform.elements.password.value = '';
  $('#sync-msg').hidden = true;
  showSyncState();
  sydlg.showModal();
};
sform.onsubmit = async e => {
  e.preventDefault();
  const v = sform.elements;
  $('#sync-msg').hidden = true;
  try {
    await Sync.signIn(v.url.value, v.key.value, v.email.value, v.password.value);
    v.password.value = '';
    showSyncState();
    sydlg.close();
  } catch (err) {
    $('#sync-msg').hidden = false;
    $('#sync-msg').textContent = err.message;
  }
};
$('#sync-close').onclick = () => sydlg.close();
$('#sync-now').onclick = () => Sync.now();
$('#sync-out').onclick = () => { Sync.signOut(); showSyncState(); };

render();
Store.onChange(render);
Sync.start();
seedStarterBooks();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
