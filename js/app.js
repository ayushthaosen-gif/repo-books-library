const $ = s => document.querySelector(s);
let tab = 'library';
let fillBusy = false;

// Picture shown for an item: your own photo first, then the looked-up cover.
const pic = b => b.photo || b.cover || '';

// A Google Drive file link in any of its usual forms gives the file id.
function driveId(url) {
  const m = /drive\.google\.com\/(?:file\/d\/|open\?(?:[^#]*&)?id=|uc\?(?:[^#]*&)?id=)([\w-]{10,})/.exec(url || '') || /docs\.google\.com\/[a-z]+\/d\/([\w-]{10,})/.exec(url || '');
  return m ? m[1] : '';
}
// Each person sets their name once on their phone; books then show who is reading them and at which page.
const ME_KEY = 'books-library-me';
const myName = () => { try { return (localStorage.getItem(ME_KEY) || '').trim(); } catch (e) { return ''; } };
const readersOf = b => Object.entries(b.readers || {}).filter(([, r]) => r && r.status);
const READ_LABEL = { reading: 'reading', read: 'finished' };
const STATUS_LABEL = { unread: 'Unread', reading: 'Reading', read: 'Read' };

const DIGITAL_SHELF = 'Digital';
function refreshRooms() {
  const rooms = [...new Set([DIGITAL_SHELF, ...Store.all().map(b => (b.room || '').trim()).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const sel = $('#f-room'), cur = sel.value;
  sel.replaceChildren(new Option('All shelves', ''), ...rooms.map(r => new Option(r, r)));
  sel.value = rooms.includes(cur) ? cur : '';
  $('#rooms').replaceChildren(...rooms.map(r => new Option(r)));
}

const GENRES = ['Fiction', 'Non-fiction', 'Biography', 'History', 'Politics', 'Law', 'Medicine', 'Religion and spirituality', 'Self-help', 'Business', 'Science', 'Poetry', 'Children', 'Reference', 'Textbook', 'Comics', 'Travel', 'Cooking'];
const themesOf = b => (b.themes || '').split(',').map(t => t.trim()).filter(Boolean);
// Best guess at a book's type from the subject labels of Google Books / Open Library.
function guessGenre(text) {
  const t = (text || '').toLowerCase();
  const rules = [['Biography', /biograph|memoir|autobiograph/], ['Law', /\blaw\b|legal|constitution/], ['Medicine', /medic|health|clinical/], ['History', /histor/], ['Politics', /politic|government/],
    ['Religion and spirituality', /religio|spiritual|philosoph/], ['Self-help', /self-help|self help|personal development|motivation/], ['Business', /business|econom|management|finance/],
    ['Science', /scien|technolog|mathemat/], ['Poetry', /poetry|poems/], ['Children', /juvenile|children|young adult/], ['Comics', /comic|graphic novel/], ['Cooking', /cooking|cookery/], ['Travel', /travel/],
    ['Reference', /reference|dictionar|guide/], ['Fiction', /fiction|novel|stories/]];
  const hit = rules.find(r => r[1].test(t));
  return hit ? hit[0] : t ? 'Non-fiction' : '';
}
// Short theme tags from subject labels: "Business & Economics / Leadership" gives "business, economics, leadership".
const themesFrom = text => [...new Set((text || '').toLowerCase().split(/[,/;&]| and /).map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x.length > 2 && x.length < 30 && !/^(fiction|general|nonfiction|non-fiction)$/.test(x)))].slice(0, 4).join(', ');

function refreshTypes() {
  const all = Store.all().filter(b => b.kind !== 'game');
  const genres = [...new Set(all.map(b => (b.genre || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const themes = [...new Set(all.flatMap(themesOf).map(t => t.toLowerCase()))].sort();
  const fill = (id, first, list) => { const sel = $(id), cur = sel.value; sel.replaceChildren(new Option(first, ''), ...list.map(x => new Option(x, x))); sel.value = list.includes(cur) ? cur : ''; };
  fill('#f-genre', 'All types', genres);
  fill('#f-theme', 'All themes', themes);
  $('#genres').replaceChildren(...[...new Set([...GENRES, ...genres])].map(g => new Option(g)));
}

// Backup nudge: books live only on this phone unless sync is on or a backup was saved.
const BKEY = 'books-library-last-backup';
let saveFailed = false;
function paintBackupNote() {
  const note = $('#backup-note');
  let last = 0;
  try { last = +localStorage.getItem(BKEY) || 0; } catch (e) {}
  const n = Store.all().length;
  const synced = Sync.configured();
  const stale = !synced && n >= 5 && (!last || Date.now() - last > 30 * 864e5);
  note.hidden = !(saveFailed || stale);
  note.classList.toggle('bad', saveFailed);
  note.textContent = saveFailed
    ? 'Your phone could not save the latest change (storage is full or blocked). Tap here to save a backup file now.'
    : last ? 'It has been over a month since your last backup. Tap here to save one.' : 'Your books are stored only on this phone. Tap here to save a backup file.';
}
$('#backup-note').onclick = () => $('#btn-export').click();
Store.onSaveError(() => { saveFailed = true; paintBackupNote(); });

function paintFilterSummary() {
  const on = ['#f-room', '#f-status', '#f-genre', '#f-theme'].filter(s => $(s).value && !$(s).closest('[hidden]')).length + ($('#f-lent').checked ? 1 : 0) + ($('#f-sort').value !== 'added' ? 1 : 0);
  $('#filter-sum').textContent = on ? `Filters and sort (${on} on)` : 'Filters and sort';
}

// ---- shelves view: covers standing on shelf rows, grouped by shelf, type, theme, author or status ----
const VIEW_KEY = 'books-library-view', GROUP_KEY = 'books-library-shelf-by';
const stored = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
let view = stored(VIEW_KEY, 'list');
$('#shelf-by').value = stored(GROUP_KEY, 'shelf');
function groupsOf(b, by) {
  const none = { shelf: 'Library Shelf', type: 'No type', theme: 'No theme', author: 'No author', status: 'Unread' }[by];
  if (by === 'shelf') return [(b.room || '').trim() || none];
  if (by === 'type') return [(b.genre || '').trim() || none];
  if (by === 'theme') return themesOf(b).length ? themesOf(b).map(t => t.replace(/^./, c => c.toUpperCase())) : [none];
  if (by === 'author') return [(b.author || '').trim() || none];
  return [STATUS_LABEL[b.status || 'unread']];
}
// Corner mark on a cover: Physical, Digital, or both when a physical copy also has a digital file (Drive, link or on this phone).
const digitalOnly = b => !!b.digitalOnly || /^drv/.test(b.id);
function formatMark(b) {
  const el = document.createElement('span');
  const set = dig => {
    const both = dig && !digitalOnly(b);
    el.className = 'fmt ' + (both ? 'both' : dig ? 'dig' : 'phy');
    el.textContent = both ? 'Physical + Digital' : dig ? 'Digital' : 'Physical';
  };
  const dig = !!(b.driveFile || b.pdf);
  set(dig);
  if (!dig) Reader.has(b.id).then(h => { if (h) set(true); }).catch(() => {});
  return el;
}
function paintShelves(items) {
  const box = $('#shelves');
  box.replaceChildren();
  let by = $('#shelf-by').value;
  if (tab === 'games' && (by === 'type' || by === 'theme' || by === 'status')) by = 'shelf';
  const groups = new Map();
  for (const b of items) for (const g of groupsOf(b, by)) (groups.get(g) || groups.set(g, []).get(g)).push(b);
  const isNone = g => g === 'Library Shelf' || /^No /.test(g);
  if (by === 'shelf' && tab !== 'games' && !$('#search').value.trim() && !$('#f-room').value && !groups.has(DIGITAL_SHELF)) groups.set(DIGITAL_SHELF, []);
  const names = [...groups.keys()].sort((a, b) => isNone(a) - isNone(b) || a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (by === 'shelf' && names.length === 1 && isNone(names[0]) && items.length) box.append(Object.assign(document.createElement('p'), { className: 'shelves-hint', textContent: 'Give your books a shelf or room (in Edit) to see them on separate shelves, or change "Group by" above.' }));
  for (const g of names) {
    const h = document.createElement('h3');
    h.append(g, Object.assign(document.createElement('span'), { textContent: groups.get(g).length }));
    const row = document.createElement('div');
    row.className = 'shelf';
    for (const b of groups.get(g)) {
      const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'bk', title: b.title, ariaLabel: b.title });
      const img = Object.assign(document.createElement('img'), { src: pic(b) || genericCover(b), alt: '', loading: 'lazy' });
      if (pic(b)) img.onerror = () => { img.onerror = null; img.src = genericCover(b); };
      btn.append(img);
      if (b.kind !== 'game') btn.append(formatMark(b));
      if (b.lentTo) btn.append(Object.assign(document.createElement('span'), { className: 'dot', title: 'Lent to ' + b.lentTo }));
      else if (tab === 'library' && b.kind !== 'game' && b.status === 'reading') btn.append(Object.assign(document.createElement('span'), { className: 'dot reading', title: 'Reading' }));
      btn.onclick = () => openDetail(b);
      row.append(btn);
    }
    if (!groups.get(g).length) row.append(Object.assign(document.createElement('span'), { className: 'shelf-empty', textContent: 'Books from your Drive folder appear here.' }));
    box.append(h, row);
  }
}
document.querySelectorAll('.seg button').forEach(x => x.onclick = () => { view = x.dataset.view; try { localStorage.setItem(VIEW_KEY, view); } catch (e) {} render(); });
$('#shelf-by').onchange = () => { try { localStorage.setItem(GROUP_KEY, $('#shelf-by').value); } catch (e) {} render(); };

function render() {
  refreshRooms();
  paintBackupNote();
  paintFilterSummary();
  refreshTypes();
  if (typeof paintFillLabel === 'function' && !fillBusy) paintFillLabel();
  const q = $('#search').value.trim().toLowerCase();
  const room = $('#f-room').value, status = $('#f-status').value, lentOnly = $('#f-lent').checked;
  const all = Store.all();
  const isGame = b => b.kind === 'game';
  $('#count-library').textContent = all.filter(b => !isGame(b) && b.list === 'library').length;
  $('#count-wishlist').textContent = all.filter(b => !isGame(b) && b.list === 'wishlist').length;
  $('#count-games').textContent = all.filter(isGame).length;
  const games = tab === 'games';
  $('#f-status').hidden = games;
  $('#f-types').hidden = games;
  $('#btn-add').textContent = games ? 'Add a game' : 'Add by hand';
  $('#btn-add').className = games ? '' : 'secondary';
  const items = all.filter(b => (games ? isGame(b) : !isGame(b) && b.list === tab) &&
    (!q || [b.title, b.author, b.genre, b.themes, b.room, b.notes, b.isbn, b.lentTo].some(f => (f || '').toLowerCase().includes(q))) &&
    (!room || b.room === room) &&
    (games || !$('#f-genre').value || b.genre === $('#f-genre').value) &&
    (games || !$('#f-theme').value || themesOf(b).some(t => t.toLowerCase() === $('#f-theme').value)) &&
    (games || !status || (b.status || 'unread') === status) &&
    (!lentOnly || b.lentTo));
  const sort = $('#f-sort').value;
  const byText = f => (x, y) => (x[f] || '\uffff').localeCompare(y[f] || '\uffff', undefined, { sensitivity: 'base' });
  if (sort === 'title') items.sort(byText('title'));
  else if (sort === 'author') items.sort(byText('author'));
  else items.sort((x, y) => (y.added || '').localeCompare(x.added || ''));
  const shelvesOn = view === 'shelves';
  $('#list').hidden = shelvesOn;
  $('#shelves').hidden = !shelvesOn;
  $('#shelf-by').hidden = !shelvesOn;
  document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x.dataset.view === view));
  if (shelvesOn) paintShelves(items); else $('#shelves').replaceChildren();
  const ul = $('#list');
  ul.replaceChildren();
  for (const b of shelvesOn ? [] : items) {
    const li = document.createElement('li');
    const cover = Object.assign(document.createElement('img'), { src: pic(b) || genericCover(b), alt: '', loading: 'lazy' });
    if (pic(b)) cover.onerror = () => { cover.onerror = null; cover.src = genericCover(b); };
    const info = document.createElement('div');
    for (const [cls, text] of [['t', b.title], ['a', b.author], ['abs', ((readCache()[b.id] || {}).description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()], ['n', [b.genre, b.themes, b.room, b.notes].filter(Boolean).join(' · ')]]) {
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
    if (tab === 'library') for (const [who, r] of readersOf(b).filter(([, r]) => r.status === 'reading')) badges.append(Object.assign(document.createElement('span'), { className: 'badge rd', textContent: who + ' reading' }));
    const pub = (readCache()[b.id] || {}).rating;
    if (b.rating) badges.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: '★'.repeat(b.rating), title: 'Your rating' }));
    else if (pub) badges.append(Object.assign(document.createElement('span'), { className: 'badge pub', textContent: '★ ' + pub.toFixed(1), title: 'Google Books rating' }));
    if (badges.childElementCount) info.append(badges);
    if (b.kind !== 'game') {
      const cv = Object.assign(document.createElement('div'), { className: 'cv' });
      cv.append(cover, formatMark(b));
      li.append(cv, info);
    } else li.append(cover, info);
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
['#f-room', '#f-status', '#f-lent', '#f-genre', '#f-theme'].forEach(s => $(s).onchange = render);

// ---- book detail ----
const ddlg = $('#detail-dialog');
const DKEY = 'books-library-details-v1';
function readCache() { try { return JSON.parse(localStorage.getItem(DKEY)) || {}; } catch (e) { return {}; } }
function writeCache(id, v) { try { const c = readCache(); c[id] = v; localStorage.setItem(DKEY, JSON.stringify(c)); } catch (e) {} }
let detailBook = null;
$('#d-cover').onerror = () => { if (detailBook) $('#d-cover').src = genericCover(detailBook); };

function paintDetail(b, d) {
  $('#d-cover').hidden = false;
  $('#d-cover').src = pic(b) || (d && d.cover) || genericCover(b);
  const rt = $('#d-rating');
  rt.hidden = !(d && d.rating);
  if (d && d.rating) rt.textContent = `★ ${d.rating.toFixed(1)} / 5` + (d.ratings ? ` (${d.ratings.toLocaleString()} ratings on Google Books)` : ' (Google Books)');
  $('#d-about-h').textContent = 'About this book';
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
  if (b.genre) badge('', b.genre);
  for (const t of themesOf(b)) badge('', t);
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
  const rd = $('#d-readers');
  rd.replaceChildren();
  for (const [who, r] of readersOf(b)) {
    const pages = (readCache()[b.id] || {}).pages;
    const p = document.createElement('p');
    p.append(Object.assign(document.createElement('span'), { className: 'k', textContent: who + ': ' }), document.createTextNode(READ_LABEL[r.status] + (r.status === 'reading' && r.page ? ` · page ${r.page}` + (pages ? ` of ${pages}` : '') : '')));
    rd.append(p);
  }
  const me = myName(), myRead = (b.readers || {})[me] || {};
  $('#d-me').hidden = b.kind === 'game' || b.list === 'wishlist' || !me;
  $('#d-me-status').value = myRead.status || '';
  $('#d-me-page').value = myRead.page || '';
  $('#d-move').hidden = b.list !== 'wishlist';
  $('#d-pdf').hidden = !(b.kind !== 'game' && driveId(b.pdf));
  $('#d-pdfrow').hidden = b.kind === 'game';
  $('#d-pdfmsg').hidden = true;
  $('#d-read').hidden = $('#d-unattach').hidden = true;
  $('#d-attach').textContent = 'Add PDF or EPUB from phone';
  if (b.kind !== 'game') Reader.info(b.id).then(rec => {
    if (!detailBook || detailBook.id !== b.id) return;
    $('#d-read').hidden = $('#d-unattach').hidden = !rec;
    if (rec) { $('#d-attach').textContent = 'Replace file'; const m = $('#d-pdfmsg'); m.hidden = false; m.textContent = `On this phone: ${rec.name} (${(rec.size / 1048576).toFixed(1)} MB)`; }
    else if (b.driveFile) { $('#d-read').hidden = false; pdfMsg((digitalOnly(b) ? 'Digital book in the family Drive.' : 'You have a physical copy and a digital copy (in the family Drive).') + ' Tap Read to download it to this phone and open it.'); }
  });
  $('#d-status-row').hidden = b.kind === 'game' || b.list === 'wishlist';
  $('#d-status').value = b.status || 'unread';
  if (b.kind === 'game') {
    $('#d-cover').hidden = false;
    $('#d-cover').src = pic(b) || genericCover(b);
    $('#d-rating').hidden = true; $('#d-meta').textContent = '';
    $('#d-about-h').textContent = 'About this game';
    $('#d-desc').textContent = (b.desc || '').replace(/\(\s*[;,]\s*(?:from|pronounced)[^)]*\)/i, '').replace(/\(\s*[;,]?\s*\)/g, '').replace(/\s{2,}/g, ' ').trim() || (b.notes ? '' : 'Tap Edit to add notes, player count or play time.');
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
// Fills blanks of a book from the metadata inside its EPUB (author, cover, description), without overwriting what is already there.
async function fillFromFile(id, blob, name) {
  if (!/\.epub$/i.test(name || '')) return;
  const m = await Reader.meta(blob);
  const b = Store.get(id);
  if (!m || !b) return;
  const patch = {};
  if (!b.author && m.author) patch.author = m.author;
  if (m.title && b.driveFile && b.title === fileBook(b.driveFile.name).title) patch.title = m.title;
  if (!pic(b) && m.cover) { try { patch.cover = await shrink(m.cover); } catch (e) {} }
  if (Object.keys(patch).length) Store.upsert({ id, ...patch });
  const c = readCache()[id];
  if (m.description && !(c && c.description)) writeCache(id, { ...(c || {}), src: (c && c.src) || 'epub', description: m.description, publisher: (c && c.publisher) || m.publisher, published: (c && c.published) || m.published });
  render();
}
const pdfMsg = t => { const m = $('#d-pdfmsg'); m.hidden = !t; m.textContent = t || ''; };
$('#d-read').onclick = async () => {
  const b = detailBook;
  try {
    if (b.driveFile && !(await Reader.has(b.id))) {
      if (!confirm('This is a digital book in the family Drive. Download it to this phone and open it?')) return;
      pdfMsg('Downloading…');
      const f = b.driveFile;
      const blob = await (await Sync.drive('action=file&id=' + encodeURIComponent(f.id) + '&name=' + encodeURIComponent(f.name))).blob();
      await Reader.put(b.id, new File([blob], f.name, { type: /\.epub$/i.test(f.name) ? 'application/epub+zip' : 'application/pdf' }));
      await fillFromFile(b.id, blob, f.name);
      $('#d-unattach').hidden = false; $('#d-attach').textContent = 'Replace file';
      pdfMsg(`On this phone: ${f.name} (${(blob.size / 1048576).toFixed(1)} MB)`);
    }
    const who = myName() || '';
    const pos = ((Store.get(b.id) || {}).pos || {})[who || 'me'] || {};
    await Reader.open(b.id, b.title, {
      who, marks: (Store.get(b.id) || {}).marks, startCfi: pos.cfi, startAt: pos.at,
      onMarks: m => Store.upsert({ id: b.id, marks: m }),
      onPos: (cfi, pct, at) => Store.upsert({ id: b.id, pos: { ...((Store.get(b.id) || {}).pos || {}), [who || 'me']: { cfi, pct, at } } }),
    });
  } catch (e) { pdfMsg('Could not open this book: ' + e.message); }
};
$('#d-attach').onclick = () => $('#d-file').click();
$('#d-file').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (!/\.(pdf|epub)$/i.test(f.name) && !/pdf|epub/i.test(f.type)) return pdfMsg('That is not a PDF or EPUB file.');
  pdfMsg('Saving to this phone…');
  try {
    await Reader.put(detailBook.id, f);
    await fillFromFile(detailBook.id, f, f.name);
    $('#d-read').hidden = $('#d-unattach').hidden = false;
    $('#d-attach').textContent = 'Replace file';
    pdfMsg(`On this phone: ${f.name} (${(f.size / 1048576).toFixed(1)} MB)`);
  } catch (err) { pdfMsg(err.message); }
};
$('#d-unattach').onclick = async () => {
  if (!confirm('Remove this file from the phone? The book stays, and the copy in Drive is not touched.')) return;
  await Reader.remove(detailBook.id);
  $('#d-read').hidden = $('#d-unattach').hidden = true;
  $('#d-attach').textContent = 'Add PDF or EPUB from phone';
  pdfMsg('Removed from this phone.');
};
// In-app reader: the Drive preview of the PDF in a full-screen window.
const pdlg = $('#pdf-dialog');
$('#d-pdf').onclick = () => {
  const id = driveId(detailBook.pdf);
  if (!id) return;
  $('#pdf-title').textContent = detailBook.title;
  $('#pdf-open').href = 'https://drive.google.com/file/d/' + id + '/view';
  $('#pdf-frame').src = 'https://drive.google.com/file/d/' + id + '/preview';
  pdlg.showModal();
};
$('#pdf-close').onclick = () => pdlg.close();
pdlg.addEventListener('close', () => { $('#pdf-frame').src = 'about:blank'; });
function saveMine() {
  const me = myName();
  if (!me || !detailBook) return;
  const cur = Store.get(detailBook.id) || detailBook, readers = { ...(cur.readers || {}) };
  const status = $('#d-me-status').value, page = +$('#d-me-page').value || 0;
  if (status) readers[me] = { status, page: status === 'reading' ? page : 0, at: new Date().toISOString() }; else delete readers[me];
  Store.upsert({ id: cur.id, readers });
  detailBook = Store.get(cur.id) || detailBook;
  const rd = $('#d-readers');
  rd.replaceChildren();
  for (const [who, r] of readersOf(detailBook)) { const p = document.createElement('p'); p.append(Object.assign(document.createElement('span'), { className: 'k', textContent: who + ': ' }), document.createTextNode(READ_LABEL[r.status] + (r.status === 'reading' && r.page ? ` · page ${r.page}` : ''))); rd.append(p); }
  render();
}
$('#d-me-status').onchange = saveMine;
$('#d-me-page').onchange = saveMine;
function askName() {
  const v = prompt('Your name, so the family can see what you are reading (for example Mum, Dad, Ayush):', myName());
  if (v === null) return;
  try { localStorage.setItem(ME_KEY, v.trim()); } catch (e) {}
  $('#btn-me').textContent = myName() ? 'I am ' + myName() : 'Set my name';
}
$('#btn-me').onclick = askName;
$('#btn-me').textContent = myName() ? 'I am ' + myName() : 'Set my name';
// Change reading status without opening the editor.
$('#d-status').onchange = () => {
  if (!detailBook) return;
  const status = $('#d-status').value;
  Store.upsert({ id: detailBook.id, status });
  detailBook = Store.get(detailBook.id) || detailBook;
  const st = $('#d-badges').querySelector('.badge.unread,.badge.reading,.badge.read');
  if (st) { st.className = 'badge ' + status; st.textContent = STATUS_LABEL[status]; }
  render();
};
$('#d-edit').onclick = () => { ddlg.close(); openEdit(Store.get(detailBook.id) || detailBook); };
$('#d-move').onclick = () => { Store.upsert({ id: detailBook.id, list: 'library' }); ddlg.close(); render(); };

// ---- add / edit ----
const dlg = $('#edit-dialog'), form = $('#edit-form');
let editingId = null, fromScan = false, editingKind = 'book';

function paintEditPic() {
  $('#edit-cover').hidden = false;
  $('#edit-cover').src = form.elements.photo.value || form.elements.cover.value || genericCover({ title: form.elements.title.value, author: form.elements.author.value, kind: editingKind });
  $('#photo-remove').hidden = !form.elements.photo.value;
}
// Shrinks a picture to a small JPEG so it stays light on the phone and in sync.
function shrink(file, max = 420) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that picture.')); };
    img.src = url;
  });
}
$('#photo-btn').onclick = () => $('#photo-file').click();
$('#photo-file').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { form.elements.photo.value = await shrink(f); paintEditPic(); }
  catch (err) { alert(err.message); }
};
$('#photo-remove').onclick = () => { form.elements.photo.value = ''; paintEditPic(); };

function openEdit(b = {}, scanned = false) {
  fromScan = scanned;
  editingId = b.id || null;
  const game = b.kind === 'game' || (!b.id && tab === 'games');
  editingKind = game ? 'game' : 'book';
  $('#edit-title').textContent = (b.id ? 'Edit ' : 'Add a ') + (game ? 'game' : 'book');
  $('#lbl-author').textContent = game ? 'Publisher or designer' : 'Author';
  document.querySelectorAll('[data-book]').forEach(e => e.hidden = game);
  document.querySelectorAll('[data-game]').forEach(e => e.hidden = !game);
  for (const f of ['players', 'playtime', 'desc']) form.elements[f].value = b[f] || '';
  for (const f of ['title', 'author', 'isbn', 'cover', 'photo', 'genre', 'themes', 'pdf', 'room', 'lentTo', 'lentSince', 'notes', 'review', 'page']) form.elements[f].value = b[f] || '';
  form.elements.rating.value = b.rating || '';
  $('#find-results').hidden = true;
  form.elements.status.value = b.status || 'unread';
  form.elements.list.value = b.list || (tab === 'wishlist' ? 'wishlist' : 'library');
  paintEditPic();
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
  v.title = v.title.trim();
  if (!v.title) { form.elements.title.focus(); return; }
  if (editingId) v.id = editingId;
  v.kind = editingKind;
  v.pdf = (v.pdf || '').trim();
  if (v.pdf && !driveId(v.pdf)) { const w = $('#edit-warn'); w.hidden = false; w.textContent = 'That does not look like a Google Drive file link. In Drive, open the file, tap Share, then Copy link.'; form.elements.pdf.focus(); return; }
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
$('#find-game').onclick = () => runFind(Lookup.searchGame, form.elements.title.value.trim());
$('#find-btn').onclick = () => runFind(Lookup.searchTitle, [form.elements.title.value, form.elements.author.value].filter(Boolean).join(' ').trim());
async function runFind(search, q) {
  const out = $('#find-results');
  if (!q) { out.hidden = false; out.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Type a title first.' })); return; }
  out.hidden = false;
  out.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Searching…' }));
  try {
    const rs = await search(q);
    out.replaceChildren();
    if (!rs.length) { out.append(Object.assign(document.createElement('li'), { textContent: 'No matches. Fill in the details by hand.' })); return; }
    for (const r of rs) {
      const li = document.createElement('li');
      li.append(Object.assign(document.createElement('div'), { className: 't', textContent: r.title }), Object.assign(document.createElement('div'), { className: 'a', textContent: r.author }));
      li.onclick = () => {
        form.elements.title.value = r.title;
        if (r.author) form.elements.author.value = r.author;
        if (r.desc) form.elements.desc.value = r.desc;
        if (r.isbn && !form.elements.isbn.value) form.elements.isbn.value = r.isbn;
        if (r.cover && !form.elements.cover.value) { form.elements.cover.value = r.cover; paintEditPic(); }
        out.hidden = true;
      };
      out.append(li);
    }
  } catch (e) {
    out.replaceChildren(Object.assign(document.createElement('li'), { textContent: e.message }));
  }
}
$('#edit-cancel').onclick = () => { const again = fromScan && $('#keep-scanning').checked; fromScan = false; dlg.close(); if (again) setTimeout(() => $('#btn-scan').click(), 150); };
$('#edit-delete').onclick = () => { if (confirm('Delete this ' + (editingKind === 'game' ? 'game' : 'book') + '?')) { Reader.remove(editingId); Store.remove(editingId); dlg.close(); render(); } };
$('#btn-add').onclick = () => openEdit({});

// ---- scan ----
const sdlg = $('#scan-dialog'), status = $('#scan-status');
let busy = false;

let scanGames = false;
async function handleIsbn(raw) {
  if (busy) return;
  busy = true;
  status.textContent = 'Looking up ' + raw + '…';
  const list = document.querySelector('input[name=scan-target]:checked').value;
  try {
    if (scanGames) {
      raw = raw.replace(/\D/g, '');
      let found = null;
      try { found = await Lookup.byBarcode(raw); } catch (e) { found = null; }
      stopScan();
      openEdit({ ...(found || {}), kind: 'game', notes: found ? '' : 'Barcode ' + raw, list }, true);
      if (!found) {
        const warn = $('#edit-warn');
        warn.hidden = false;
        warn.textContent = 'No match for this barcode. Type the name and tap Find details by name, or fill it in by hand.';
      }
      return;
    }
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
  scanGames = tab === 'games';
  $('#scan-title').textContent = scanGames ? 'Scan a game barcode' : 'Scan a barcode';
  status.textContent = 'Starting camera…';
  sdlg.showModal();
  try {
    const torch = $('#torch');
    torch.hidden = true;
    await Scanner.start($('#video'), handleIsbn, toggle => {
      torch.hidden = false;
      torch.onclick = async () => { torch.textContent = (await toggle()) ? 'Torch off' : 'Torch on'; };
      torch.textContent = 'Torch on';
    }, scanGames ? 'product' : 'isbn', msg => { status.textContent = msg; });
    status.textContent = scanGames ? 'Point the camera at the barcode on the game box.' : 'Point the camera at the barcode on the back of the book.';
  } catch (e) {
    status.textContent = 'Camera unavailable (' + e.message + '). You can type the ISBN instead.';
  }
};
$('#scan-close').onclick = stopScan;
sdlg.addEventListener('close', () => Scanner.stop());
$('#isbn-go').onclick = () => handleIsbn($('#isbn-manual').value);

// ---- CSV export ----
$('#btn-csv').onclick = () => {
  const cols = ['kind', 'title', 'author', 'isbn', 'players', 'playtime', 'list', 'status', 'rating', 'review', 'page', 'genre', 'themes', 'pdf', 'room', 'lentTo', 'lentSince', 'notes', 'added'];
  const esc = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [cols.join(','), ...Store.all().map(b => cols.map(c => esc(b[c])).join(','))].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })),
    download: 'books-library.csv',
  });
  a.click();
};

async function findCover(b) {
  const tries = b.kind === 'game'
    ? [async () => Lookup.gameCover(b.title, b.isbn)]
    : [async () => Lookup.coverFor(b)];
  for (const t of tries) { try { const c = await t(); if (c) return c; } catch (e) {} }
  return '';
}

// Blank details of a book (author, ISBN, cover) found by matching its title across the book sources.
// Only blanks are filled, never anything already there. Returns the patch ({} when nothing is known).
const needsDetails = b => b.kind === 'game' ? !pic(b) : !pic(b) || !b.author || !b.isbn;
async function fillDetails(b) {
  const patch = {};
  if (b.kind !== 'game' && (!b.author || !b.isbn || !pic(b))) {
    let r = null;
    try { r = await Lookup.matchBook(b); } catch (e) {}
    if (r) {
      if (!b.author && r.author) patch.author = r.author;
      if (!b.isbn && r.isbn) patch.isbn = r.isbn;
      if (!pic(b) && r.cover && await Lookup.imageOk(r.cover)) patch.cover = r.cover;
    }
  }
  if (!pic(b) && !patch.cover) { const c = await findCover({ ...b, ...patch }); if (c) patch.cover = c; }
  return patch;
}

// Quietly looks up covers for books that have none (at most once per book per device per day).
// Type and themes for books whose description was already looked up on an earlier day (no network needed).
function fillTypesFromCache() {
  const cache = readCache();
  for (const b of Store.all().filter(b => b.kind !== 'game' && (!b.genre || !b.themes) && cache[b.id] && cache[b.id].categories)) {
    const patch = {};
    if (!b.genre) patch.genre = guessGenre(cache[b.id].categories);
    if (!b.themes) patch.themes = themesFrom(cache[b.id].categories);
    for (const k of Object.keys(patch)) if (!patch[k]) delete patch[k];
    if (Object.keys(patch).length) Store.upsert({ id: b.id, ...patch });
  }
}
async function autoCovers() {
  fillTypesFromCache();
  if (!navigator.onLine) return;
  let tried = {};
  try { tried = JSON.parse(localStorage.getItem('books-library-cover-tried') || '{}'); } catch (e) {}
  const today = new Date().toISOString().slice(0, 10);
  const covers = async () => { for (const b of Store.all().filter(b => needsDetails(b) && tried[b.id] !== today)) {
    tried[b.id] = today;
    try {
      const patch = await fillDetails(b);
      if (Object.keys(patch).length) Store.upsert({ id: b.id, ...patch });
    } catch (e) {}
  } };
  // Descriptions, public star ratings (and a last-resort cover) from Google Books
  const dets = async () => { for (const b of Store.all().filter(b => b.kind !== 'game' && (!readCache()[b.id] || (readCache()[b.id].src === 'epub' && !readCache()[b.id].rating)) && tried['d' + b.id] !== today)) {
    tried['d' + b.id] = today;
    try {
      const d = await Lookup.details(b);
      if (d) {
        const old = readCache()[b.id];
        writeCache(b.id, old && old.src === 'epub' ? { ...d, src: 'epub', description: old.description || d.description, publisher: old.publisher || d.publisher, published: old.published || d.published } : d);
        const patch = {};
        if (!pic(b) && d.cover) patch.cover = d.cover;
        if (!b.genre && d.categories) patch.genre = guessGenre(d.categories);
        if (!b.themes && d.categories) patch.themes = themesFrom(d.categories);
        for (const k of Object.keys(patch)) if (!patch[k]) delete patch[k];
        if (Object.keys(patch).length) Store.upsert({ id: b.id, ...patch }); else render();
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 800));
  } };
  await Promise.all([covers(), dets()]);
  try { localStorage.setItem('books-library-cover-tried', JSON.stringify(tried)); } catch (e) {}
}
setTimeout(autoCovers, 4000);

// ---- fill missing covers ----
function paintFillLabel() {
  const n = Store.all().filter(needsDetails).length;
  $('#btn-fill').textContent = n ? `Find missing covers and details (${n} incomplete)` : 'All items are complete';
}
$('#btn-fill').onclick = async () => {
  const btn = $('#btn-fill');
  const todo = Store.all().filter(needsDetails);
  if (!todo.length) return alert('Nothing to fill in: every item already has its picture, author and ISBN.');
  if (!navigator.onLine) return alert('You are offline. Try again when connected.');
  const filled = [], notFound = [];
  let failed = 0;
  fillBusy = true;
  for (let i = 0; i < todo.length; i++) {
    btn.textContent = `Filling ${i + 1} of ${todo.length}…`;
    const b = todo[i];
    try {
      const patch = await fillDetails(b);
      if (Object.keys(patch).length) {
        Store.upsert({ id: b.id, ...patch });
        filled.push(b.title + ' (' + Object.keys(patch).map(k => k === 'cover' ? 'cover' : k + ': ' + patch[k]).join(', ') + ')');
      }
      else notFound.push(b.title);
    } catch (e) { failed++; notFound.push(b.title); }
  }
  fillBusy = false;
  paintFillLabel();
  alert(`Updated ${filled.length} of ${todo.length} items.\n\n` + (filled.length ? 'Check these:\n' + filled.join('\n') + '\n\n' : '') +
    (notFound.length ? `No confident match for ${notFound.length}${failed ? ' (some lookups failed, try again)' : ''}. Open them and tap Edit, then Take or choose photo.` : ''));
};

// ---- backup ----
$('#btn-export').onclick = () => {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([Store.exportJson()], { type: 'application/json' })),
    download: 'books-library-backup.json',
  });
  a.click();
  try { localStorage.setItem(BKEY, String(Date.now())); } catch (e) {}
  saveFailed = false;
  paintBackupNote();
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
        for (const f of ['author', 'isbn', 'cover', 'room']) if (have && !have[f] && b[f]) patch[f] = b[f];
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

// ---- family Drive folder (a link kept on this device) ----
const DRIVE_KEY = 'books-library-drive-folder';
const driveFolder = () => { try { return Store.setting('driveFolder') || localStorage.getItem(DRIVE_KEY) || ''; } catch (e) { return ''; } };
function paintDrive() { $('#btn-drive').hidden = !driveFolder(); $('#btn-drive-set').textContent = driveFolder() ? 'Change Drive folder' : 'Set Drive folder'; }
$('#btn-drive').onclick = () => window.open(driveFolder(), '_blank', 'noopener');
$('#btn-drive-set').onclick = () => {
  const v = prompt('Paste the link to your Google Drive folder of books (leave empty to clear). In Drive, share the folder with your family first.', driveFolder());
  if (v === null) return;
  const link = v.trim();
  if (link && !/^https:\/\/(drive|docs)\.google\.com\//.test(link)) return alert('That is not a Google Drive link.');
  try { localStorage.setItem(DRIVE_KEY, link); } catch (e) {}
  Store.setSetting('driveFolder', link);
  paintDrive();
};
paintDrive();

// ---- PDFs from the family Drive folder (through the Supabase function) ----
const dpdlg = $('#drivepdf-dialog');
const wordsOf = t => (t || '').toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9\u0900-\u097f\u0980-\u09ff]+/g, ' ').split(' ').filter(w => w.length > 1);
function bestBook(name, books, min = 0.6) {
  const fw = new Set(wordsOf(name));
  let best = null, score = 0;
  for (const b of books) {
    const tw = wordsOf(b.title);
    if (!tw.length) continue;
    const sc = tw.filter(w => fw.has(w)).length / tw.length;
    if (sc > score) { score = sc; best = b; }
  }
  return score >= min ? best : null;
}
function fileBook(name) {
  const base = name.replace(/\.(pdf|epub)$/i, '').replace(/[_]+/g, ' ').replace(/\s*[\(\[][^\)\]]*(z-?lib|libgen|epub|pdf|retail|anna)[^\)\]]*[\)\]]/gi, '').replace(/\s+/g, ' ').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { title: m[1].trim(), author: m[2].trim() } : { title: base, author: '' };
}
// Lists the Drive folder and puts every file on the shelf as a digital book. Nothing is downloaded here.
let driveBusy = false;
async function syncDrive() {
  if (driveBusy) return null;
  driveBusy = true;
  try {
    const files = await (await Sync.drive('action=list')).json();
    const known = new Set(Store.all().map(b => b.driveFile && b.driveFile.id).filter(Boolean));
    let added = 0, linked = 0;
    for (const b of Store.all().filter(b => /^drv/.test(b.id) && (!b.room || b.room === 'Digital Library'))) Store.upsert({ id: b.id, room: DIGITAL_SHELF, digitalOnly: true });
    for (const f of files) {
      if (known.has(f.id)) continue;
      const free = Store.all().filter(b => b.kind !== 'game' && !b.driveFile);
      const match = bestBook(f.name, free, 0.8);
      if (match) { Store.upsert({ id: match.id, driveFile: { id: f.id, name: f.name } }); linked++; }
      else {
        const fb = fileBook(f.name);
        Store.upsert({ id: 'drv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: fb.title, author: fb.author, list: 'library', kind: 'book', status: 'unread', room: DIGITAL_SHELF, digitalOnly: true, driveFile: { id: f.id, name: f.name } });
        added++;
      }
      known.add(f.id);
    }
    try { localStorage.setItem('books-library-drive-sync', String(Date.now())); } catch (e) {}
    return { total: files.length, added, linked };
  } finally { driveBusy = false; }
}
$('#btn-pdfs').onclick = async () => {
  const msg = t => { $('#dp-msg').hidden = !t; $('#dp-msg').textContent = t || ''; };
  dpdlg.showModal();
  if (!Sync.configured()) return msg('Sign in to sync first (More, then the sync line). The Drive folder is read through your library login.');
  msg('Reading the Drive folder…');
  try {
    const r = await syncDrive();
    msg(!r ? 'Already syncing…' : !r.total ? 'The folder opened but has no PDF or EPUB files in it (or its sub-folders). Google Docs and shortcuts are not listed.'
      : `Found ${r.total} file${r.total === 1 ? '' : 's'} in Drive. ${r.added} new book${r.added === 1 ? '' : 's'} added to your library and ${r.linked} matched to books you already have. Open a book and tap Read to download it.`);
    render();
    autoCovers();
  } catch (e) { msg(e.message); }
};
$('#dp-close').onclick = () => dpdlg.close();
// Quietly refresh from Drive when the app opens (at most every 6 hours).
setTimeout(() => {
  try {
    if (!Sync.configured() || Date.now() - Number(localStorage.getItem('books-library-drive-sync') || 0) < 6 * 3600e3) return;
    syncDrive().then(() => { render(); autoCovers(); }).catch(() => {});
  } catch (e) {}
}, 4000);

// ---- share (read-only link) ----
const shdlg = $('#share-dialog');
const shareUrl = t => new URL('view.html', location.href).href + '#' + t;
function shareMsg(t) { $('#share-msg').hidden = !t; $('#share-msg').textContent = t || ''; }
function shareShow(token) {
  $('#share-on').hidden = !token;
  $('#share-start').hidden = !!token;
  if (token) $('#share-link').value = shareUrl(token);
  $('#share-send').hidden = !navigator.share;
}
$('#btn-share').onclick = async () => {
  shareMsg(''); shareShow(null); $('#share-start').hidden = true;
  shdlg.showModal();
  if (!Sync.configured()) return shareMsg('Sharing needs cloud sync. Turn on sync first (tap the sync line at the bottom), then come back here.');
  try {
    const rows = await Sync.api('shares?select=token');
    shareShow(rows[0] && rows[0].token);
  } catch (e) {
    shareMsg(/404|42P01|shares/.test(e.message) ? 'Sharing is not set up in your Supabase project yet. Run step 4 of docs/SYNC.md once, then try again.' : e.message);
  }
};
$('#share-start').onclick = async () => {
  shareMsg('');
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
    await Sync.now();
    await Sync.api('shares?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ token }) });
    shareShow(token);
  } catch (e) { shareMsg(e.message); }
};
$('#share-copy').onclick = async () => {
  const input = $('#share-link');
  try { await navigator.clipboard.writeText(input.value); $('#share-copy').textContent = 'Copied'; }
  catch (e) { input.select(); }
  setTimeout(() => { $('#share-copy').textContent = 'Copy link'; }, 1500);
};
$('#share-send').onclick = () => navigator.share({ title: 'My library', url: $('#share-link').value }).catch(() => {});
$('#share-stop').onclick = async () => {
  if (!confirm('Stop sharing? The current link will stop working.')) return;
  try {
    await Sync.api('shares?user_id=not.is.null', { method: 'DELETE' });
    shareShow(null); $('#share-start').hidden = false;
  } catch (e) { shareMsg(e.message); }
};
$('#share-close').onclick = () => shdlg.close();

paintDrive();
render();
Store.onChange(() => { paintDrive(); });
Store.onChange(render);
window.addEventListener('storage', e => { if (e.key === Store.KEY) Store.reload(); });
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
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
