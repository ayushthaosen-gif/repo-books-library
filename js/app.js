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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
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
async function seedStarterBooks() {
  try {
    const seeded = JSON.parse(localStorage.getItem('books-library-seeded') || '[]');
    const books = await (await fetch('seed-books.json')).json();
    let added = 0;
    // With sync on, wait for the first pull so another device's copy (or delete) is respected.
    if (Sync.configured() && !Sync.hasPulled()) return;
    for (const b of books) {
      if (seeded.includes(b.isbn)) continue;
      seeded.push(b.isbn);
      const id = 'seed-' + b.isbn;
      if (!Store.getIncludingDeleted(id) && !Store.findByIsbn(b.isbn)) { Store.upsert({ ...b, id }); added++; }
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
  if (state === 'ok') seedStarterBooks();
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
