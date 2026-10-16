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
  const isGame = b => b.kind === 'game';
  $('#count-library').textContent = all.filter(b => !isGame(b) && b.list === 'library').length;
  $('#count-wishlist').textContent = all.filter(b => !isGame(b) && b.list === 'wishlist').length;
  $('#count-games').textContent = all.filter(isGame).length;
  const games = tab === 'games';
  $('#f-status').hidden = games;
  $('#btn-scan').hidden = games;
  $('#btn-add').textContent = games ? 'Add a game' : 'Add by hand';
  $('#btn-add').className = games ? '' : 'secondary';
  const items = all.filter(b => (games ? isGame(b) : !isGame(b) && b.list === tab) &&
    (!q || [b.title, b.author, b.room, b.notes, b.isbn, b.lentTo].some(f => (f || '').toLowerCase().includes(q))) &&
    (!room || b.room === room) &&
    (games || !status || (b.status || 'unread') === status) &&
    (!lentOnly || b.lentTo));
  const sort = $('#f-sort').value;
  const byText = f => (x, y) => (x[f] || '\uffff').localeCompare(y[f] || '\uffff', undefined, { sensitivity: 'base' });
  if (sort === 'title') items.sort(byText('title'));
  else if (sort === 'author') items.sort(byText('author'));
  else items.sort((x, y) => (y.added || '').localeCompare(x.added || ''));
  const ul = $('#list');
  ul.replaceChildren();
  for (const b of items) {
    const li = document.createElement('li');
    const cover = b.cover ? Object.assign(document.createElement('img'), { src: b.cover, alt: '', loading: 'lazy' }) : placeholder(b);
    if (b.cover) cover.onerror = () => cover.replaceWith(placeholder(b));
    const info = document.createElement('div');
    for (const [cls, text] of [['t', b.title], ['a', b.author], ['abs', ((readCache()[b.id] || {}).description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()], ['n', [b.room, b.notes].filter(Boolean).join(' · ')]]) {
      if (!text) continue;
      info.append(Object.assign(document.createElement('div'), { className: cls, textContent: text }));
    }
    const badges = document.createElement('div');
    badges.className = 'badges';
    if (tab === 'games') {
      for (const t of [b.players && b.players + ' players', b.playtime]) if (t) badges.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: t }));
      if (b.list === 'wishlist') badges.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: 'Wishlist' }));
      if (b.lentTo) badges.append(Object.assign(document.createElement('span'), { className: 'badge lent', textContent: 'Lent to ' + b.lentTo }));
    } else if (tab === 'library') {
      const st = b.status || 'unread';
      badges.append(Object.assign(document.createElement('span'), { className: 'badge ' + st, textContent: STATUS_LABEL[st] }));
      if (b.lentTo) badges.append(Object.assign(document.createElement('span'), { className: 'badge lent', textContent: 'Lent to ' + b.lentTo }));
    }
    const pub = (readCache()[b.id] || {}).rating;
    if (b.rating) badges.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: '★'.repeat(b.rating), title: 'Your rating' }));
    else if (pub) badges.append(Object.assign(document.createElement('span'), { className: 'badge pub', textContent: '★ ' + pub.toFixed(1), title: 'Google Books rating' }));
    if (badges.childElementCount) info.append(badges);
    li.append(cover, info);
    if (tab === 'wishlist') {
      const mv = Object.assign(document.createElement('button'), { className: 'move', textContent: 'Got it' });
      mv.onclick = e => { e.stopPropagation(); Store.upsert({ id: b.id, list: 'library' }); render(); };
      li.append(mv);
    }
    li.onclick = () => openDetail(b);
    ul.append(li);
  }
  const empty = $('#empty');
  empty.hidden = items.length > 0;
  empty.textContent = q ? 'No matches.' : tab === 'games'
    ? 'No games yet. Tap Add a game to list your board games, card games and puzzles.'
    : tab === 'library'
    ? 'No books yet. Tap Scan and point the camera at the barcode on the back of a book, or tap Add by hand for books without one.'
    : 'Your wishlist is empty. Scan or add a book you want and choose Wishlist.';
}

document.querySelectorAll('nav button').forEach(btn => btn.onclick = () => {
  tab = btn.dataset.tab;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b === btn));
  render();
});
$('#search').oninput = render;
try { $('#f-sort').value = localStorage.getItem('books-library-sort') || 'added'; } catch (e) {}
$('#f-sort').onchange = () => { try { localStorage.setItem('books-library-sort', $('#f-sort').value); } catch (e) {} render(); };
['#f-room', '#f-status', '#f-lent'].forEach(s => $(s).onchange = render);

// ---- book detail ----
const ddlg = $('#detail-dialog');
const DKEY = 'books-library-details-v1';
function readCache() { try { return JSON.parse(localStorage.getItem(DKEY)) || {}; } catch (e) { return {}; } }
function writeCache(id, v) { try { const c = readCache(); c[id] = v; localStorage.setItem(DKEY, JSON.stringify(c)); } catch (e) {} }
let detailBook = null;
$('#d-cover').onerror = () => { $('#d-cover').hidden = true; };

function paintDetail(b, d) {
  const cover = b.cover || (d && d.cover);
  $('#d-cover').hidden = !cover;
  if (cover) $('#d-cover').src = cover;
  const rt = $('#d-rating');
  rt.hidden = !(d && d.rating);
  if (d && d.rating) rt.textContent = `★ ${d.rating.toFixed(1)} / 5` + (d.ratings ? ` (${d.ratings.toLocaleString()} ratings on Google Books)` : ' (Google Books)');
  $('#d-desc').textContent = d ? (d.description || 'No description found for this book.') : 'No description found for this book.';
  const meta = [d && d.publisher, d && d.published, d && d.pages ? d.pages + ' pages' : '', d && d.categories].filter(Boolean);
  $('#d-meta').textContent = meta.join(' · ');
  const q = encodeURIComponent(b.isbn || b.title + ' ' + (b.author || ''));
  const links = $('#d-links');
  links.replaceChildren();
  const add = (href, text) => links.append(Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener' }), ' ');
  add(d && d.link ? d.link : 'https://www.google.com/books?q=' + q, 'Reviews on Google Books');
  add('https://www.goodreads.com/search?q=' + q, 'Reviews on Goodreads');
}
async function openDetail(b) {
  detailBook = b;
  $('#d-title').textContent = b.title;
  $('#d-author').textContent = b.author || '';
  const badges = $('#d-badges');
  badges.replaceChildren();
  const badge = (cls, text) => badges.append(Object.assign(document.createElement('span'), { className: 'badge ' + cls, textContent: text }));
  if (b.kind === 'game') { if (b.players) badge('', b.players + ' players'); if (b.playtime) badge('', b.playtime); if (b.list === 'wishlist') badge('', 'Wishlist'); }
  else if (b.list === 'wishlist') badge('', 'Wishlist');
  else { const st = b.status || 'unread'; badge(st, STATUS_LABEL[st]); }
  if (b.room) badge('', b.room);
  if (b.lentTo) badge('lent', 'Lent to ' + b.lentTo);
  const mine = $('#d-mine');
  mine.replaceChildren();
  const row = (k, v, bar) => {
    const p = document.createElement('p');
    p.append(Object.assign(document.createElement('span'), { className: 'k', textContent: k + ': ' }), document.createTextNode(v));
    if (bar != null) p.append(Object.assign(document.createElement('div'), { className: 'bar' }));
    if (bar != null) p.lastChild.append(Object.assign(document.createElement('i'), { style: `width:${bar}%` }));
    mine.append(p);
  };
  const pages = (readCache()[b.id] || {}).pages;
  if (b.rating) row('My rating', '★'.repeat(b.rating) + '☆'.repeat(5 - b.rating));
  if (b.review) row('My review', b.review);
  if (b.page) row('Progress', pages ? `page ${b.page} of ${pages} (${Math.min(100, Math.round(b.page / pages * 100))}%)` : `page ${b.page}`, pages ? Math.min(100, Math.round(b.page / pages * 100)) : null);
  if (b.lentTo) row('Lent', `to ${b.lentTo}` + (b.lentSince ? ` since ${new Date(b.lentSince).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''));
  if (b.notes) row('Notes', b.notes);
  $('#d-move').hidden = b.list !== 'wishlist';
  if (b.kind === 'game') {
    $('#d-cover').hidden = !b.cover;
    if (b.cover) $('#d-cover').src = b.cover;
    $('#d-rating').hidden = true; $('#d-meta').textContent = '';
    $('#d-desc').textContent = b.notes ? '' : 'Tap Edit to add notes, player count or play time.';
    $('#d-links').replaceChildren(Object.assign(document.createElement('a'), { href: 'https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=' + encodeURIComponent(b.title), textContent: 'Look up on BoardGameGeek', target: '_blank', rel: 'noopener' }));
    if (!ddlg.open) ddlg.showModal();
    return;
  }
  const cached = readCache()[b.id];
  paintDetail(b, cached);
  if (!cached) $('#d-desc').textContent = 'Loading…';
  if (!ddlg.open) ddlg.showModal();
  if (cached || !navigator.onLine) { if (!cached) $('#d-desc').textContent = 'Connect to the internet to load the description and ratings.'; return; }
  try {
    const d = await Lookup.details(b);
    if (d) writeCache(b.id, d);
    if (detailBook === b && ddlg.open) paintDetail(b, d);
  } catch (e) {
    if (detailBook === b && ddlg.open) $('#d-desc').textContent = 'Could not load the description right now. Try again later.';
  }
}
$('#d-close').onclick = () => ddlg.close();
$('#d-edit').onclick = () => { ddlg.close(); openEdit(Store.get(detailBook.id) || detailBook); };
$('#d-move').onclick = () => { Store.upsert({ id: detailBook.id, list: 'library' }); ddlg.close(); render(); };

// ---- add / edit ----
const dlg = $('#edit-dialog'), form = $('#edit-form');
let editingId = null, fromScan = false, editingKind = 'book';

function openEdit(b = {}, scanned = false) {
  fromScan = scanned;
  editingId = b.id || null;
  const game = b.kind === 'game' || (!b.id && tab === 'games');
  editingKind = game ? 'game' : 'book';
  $('#edit-title').textContent = (b.id ? 'Edit ' : 'Add a ') + (game ? 'game' : 'book');
  $('#lbl-author').textContent = game ? 'Publisher or designer' : 'Author';
  document.querySelectorAll('[data-book]').forEach(e => e.hidden = game);
  document.querySelectorAll('[data-game]').forEach(e => e.hidden = !game);
  for (const f of ['players', 'playtime']) form.elements[f].value = b[f] || '';
  for (const f of ['title', 'author', 'isbn', 'cover', 'room', 'lentTo', 'lentSince', 'notes', 'review', 'page']) form.elements[f].value = b[f] || '';
  form.elements.rating.value = b.rating || '';
  $('#find-results').hidden = true;
  form.elements.status.value = b.status || 'unread';
  form.elements.list.value = b.list || (tab === 'wishlist' ? 'wishlist' : 'library');
  $('#edit-cover').hidden = !b.cover;
  if (b.cover) $('#edit-cover').src = b.cover;
  $('#edit-delete').hidden = !b.id;
  const warn = $('#edit-warn');
  const dup = !game && b.isbn && Store.findByIsbn(b.isbn);
  warn.hidden = !(dup && dup.id !== b.id);
  if (!warn.hidden) warn.textContent = `Already in your ${dup.list}: "${dup.title}".`;
  dlg.showModal();
}
form.onsubmit = e => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(form));
  if (editingId) v.id = editingId;
  v.kind = editingKind;
  v.rating = v.rating ? +v.rating : 0;
  v.page = v.page ? +v.page : 0;
  const today = new Date().toISOString().slice(0, 10);
  if (!v.lentTo.trim()) v.lentSince = '';
  else if (!v.lentSince) v.lentSince = today;
  Store.upsert(v);
  dlg.close();
  tab = v.kind === 'game' ? 'games' : v.list;
  const again = fromScan && $('#keep-scanning').checked;
  fromScan = false;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
  if (again) setTimeout(() => $('#btn-scan').click(), 150);
};
$('#find-btn').onclick = async () => {
  const q = [form.elements.title.value, form.elements.author.value].filter(Boolean).join(' ').trim();
  const out = $('#find-results');
  if (!q) { out.hidden = false; out.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Type a title first.' })); return; }
  out.hidden = false;
  out.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Searching…' }));
  try {
    const rs = await Lookup.searchTitle(q);
    out.replaceChildren();
    if (!rs.length) { out.append(Object.assign(document.createElement('li'), { textContent: 'No matches. Fill in the details by hand.' })); return; }
    for (const r of rs) {
      const li = document.createElement('li');
      li.append(Object.assign(document.createElement('div'), { className: 't', textContent: r.title }), Object.assign(document.createElement('div'), { className: 'a', textContent: r.author }));
      li.onclick = () => {
        form.elements.title.value = r.title;
        if (r.author) form.elements.author.value = r.author;
        if (r.isbn && !form.elements.isbn.value) form.elements.isbn.value = r.isbn;
        if (r.cover && !form.elements.cover.value) { form.elements.cover.value = r.cover; $('#edit-cover').src = r.cover; $('#edit-cover').hidden = false; }
        out.hidden = true;
      };
      out.append(li);
    }
  } catch (e) {
    out.replaceChildren(Object.assign(document.createElement('li'), { textContent: e.message }));
  }
};
$('#edit-cancel').onclick = () => { const again = fromScan && $('#keep-scanning').checked; fromScan = false; dlg.close(); if (again) setTimeout(() => $('#btn-scan').click(), 150); };
$('#edit-delete').onclick = () => { if (confirm('Delete this ' + (editingKind === 'game' ? 'game' : 'book') + '?')) { Store.remove(editingId); dlg.close(); render(); } };
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
    if (found) openEdit({ ...found, list }, true);
    else {
      openEdit({ isbn: Store.cleanIsbn(raw), list }, true);
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

// ---- CSV export ----
$('#btn-csv').onclick = () => {
  const cols = ['kind', 'title', 'author', 'isbn', 'players', 'playtime', 'list', 'status', 'rating', 'review', 'page', 'room', 'lentTo', 'lentSince', 'notes', 'added'];
  const esc = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [cols.join(','), ...Store.all().map(b => cols.map(c => esc(b[c])).join(','))].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })),
    download: 'books-library.csv',
  });
  a.click();
};

// ---- covers ----
function placeholder(b) {
  let h = 0;
  for (const c of b.title || '') h = (h * 31 + c.charCodeAt(0)) % 360;
  const d = document.createElement('div');
  d.className = 'ph';
  d.style.background = `hsl(${h} 35% 32%)`;
  d.textContent = b.title || '';
  return d;
}

async function findCover(b) {
  if (b.isbn) {
    try { const r = await Lookup.byIsbn(b.isbn); if (r && r.cover) return r.cover; } catch (e) {}
  }
  const r = await Lookup.byTitle(b.title, b.author);
  return (r && r.cover) || '';
}

// Quietly looks up covers for books that have none (at most once per book per device per day).
async function autoCovers() {
  if (!navigator.onLine) return;
  let tried = {};
  try { tried = JSON.parse(localStorage.getItem('books-library-cover-tried') || '{}'); } catch (e) {}
  const today = new Date().toISOString().slice(0, 10);
  const covers = async () => { for (const b of Store.all().filter(b => b.kind !== 'game' && !b.cover && tried[b.id] !== today)) {
    tried[b.id] = today;
    try {
      const cover = await findCover(b);
      if (cover) Store.upsert({ id: b.id, cover });
    } catch (e) {}
  } };
  // Descriptions, public star ratings (and a last-resort cover) from Google Books
  const dets = async () => { for (const b of Store.all().filter(b => b.kind !== 'game' && !readCache()[b.id] && tried['d' + b.id] !== today)) {
    tried['d' + b.id] = today;
    try {
      const d = await Lookup.details(b);
      if (d) { writeCache(b.id, d); if (!b.cover && d.cover) Store.upsert({ id: b.id, cover: d.cover }); else render(); }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 800));
  } };
  await Promise.all([covers(), dets()]);
  try { localStorage.setItem('books-library-cover-tried', JSON.stringify(tried)); } catch (e) {}
}
setTimeout(autoCovers, 4000);

// ---- fill missing details ----
$('#btn-fill').onclick = async () => {
  const btn = $('#btn-fill');
  const todo = Store.all().filter(b => b.kind !== 'game' && (!b.cover || (!b.isbn && !b.author)));
  if (!todo.length) return alert('Nothing to fill in: every book already has a cover.');
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
      if (!b.cover) { const c = (r && r.cover) || await findCover(b); if (c) patch.cover = c; }
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

// Install as an app
let installEvt = null;
const installBtn = document.getElementById('btn-install');
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone) installBtn.hidden = false;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { installBtn.hidden = true; });
installBtn.addEventListener('click', async () => {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  alert(ios
    ? 'To install: tap the Share button in Safari, then "Add to Home Screen".'
    : 'To install: open the browser menu (⋮) and tap "Install app" or "Add to Home screen". If you do not see it, open this page in Chrome.');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
