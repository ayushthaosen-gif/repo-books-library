const $ = s => document.querySelector(s);
let tab = 'library';

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const all = Store.all();
  $('#count-library').textContent = all.filter(b => b.list === 'library').length;
  $('#count-wishlist').textContent = all.filter(b => b.list === 'wishlist').length;
  const items = all.filter(b => b.list === tab &&
    (!q || [b.title, b.author, b.notes, b.isbn].some(f => (f || '').toLowerCase().includes(q))));
  const ul = $('#list');
  ul.replaceChildren();
  for (const b of items) {
    const li = document.createElement('li');
    const cover = b.cover ? Object.assign(document.createElement('img'), { src: b.cover, alt: '', loading: 'lazy' }) : Object.assign(document.createElement('div'), { className: 'ph', textContent: '📖' });
    if (b.cover) cover.onerror = () => cover.replaceWith(Object.assign(document.createElement('div'), { className: 'ph', textContent: '📖' }));
    const info = document.createElement('div');
    for (const [cls, text] of [['t', b.title], ['a', b.author], ['n', b.notes]]) {
      if (!text) continue;
      info.append(Object.assign(document.createElement('div'), { className: cls, textContent: text }));
    }
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

// ---- add / edit ----
const dlg = $('#edit-dialog'), form = $('#edit-form');
let editingId = null;

function openEdit(b = {}) {
  editingId = b.id || null;
  $('#edit-title').textContent = b.id ? 'Edit book' : 'Add a book';
  for (const f of ['title', 'author', 'isbn', 'cover', 'notes']) form.elements[f].value = b[f] || '';
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
    else openEdit({ isbn: Store.cleanIsbn(raw), list, notes: '' }), alert('No details found for that ISBN. Fill in the title by hand.');
  } catch (e) {
    status.textContent = e.message + ' Try again or type the ISBN.';
  } finally {
    busy = false;
  }
}
function stopScan() { Scanner.stop(); if (sdlg.open) sdlg.close(); }
$('#btn-scan').onclick = async () => {
  status.textContent = 'Starting camera…';
  sdlg.showModal();
  try {
    await Scanner.start($('#video'), handleIsbn);
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

render();
