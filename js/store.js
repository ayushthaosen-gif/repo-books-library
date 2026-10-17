// Single-user storage in localStorage. Books: {id,title,author,isbn,cover,notes,room,status,lentTo,list,added,updated,deleted?}
// Deleted books stay as tombstones ({deleted:true}) so a delete can sync to other devices.
const Store = (() => {
  const KEY = 'books-library-v1';
  let books = [];
  const listeners = [];
  const errListeners = [];
  const load = () => {
    let raw = null;
    try { raw = localStorage.getItem(KEY); books = JSON.parse(raw) || []; if (!Array.isArray(books)) throw new Error('bad'); }
    catch (e) {
      books = [];
      // Unreadable data is set aside, never overwritten, so it can still be recovered.
      try { if (raw) localStorage.setItem(KEY + '-unreadable', raw); } catch (e2) {}
    }
    for (const b of books) if (!b.updated) b.updated = b.added || '1970-01-01T00:00:00.000Z';
  };
  load();
  // A full or blocked phone store must not fail silently: the books stay in memory and the app is told.
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(books)); return true; }
    catch (e) { errListeners.forEach(f => f(e)); return false; }
  };
  const changed = () => listeners.forEach(f => f());
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();
  const cleanIsbn = s => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  const SETTINGS = '__settings';
  const live = () => books.filter(b => !b.deleted && b.id !== SETTINGS);
  return {
    all: live,
    get: id => live().find(b => b.id === id),
    getIncludingDeleted: id => books.find(b => b.id === id),
    findByIsbn(isbn) { const i = cleanIsbn(isbn); return i ? live().find(b => b.isbn === i) : undefined; },
    upsert(b) {
      b = { ...b, updated: now() };
      if (b.isbn !== undefined) b.isbn = cleanIsbn(b.isbn);
      const i = books.findIndex(x => x.id === b.id);
      if (i >= 0) books[i] = { ...books[i], ...b };
      else books.unshift({ id: uid(), added: now(), ...b });
      save(); changed();
    },
    remove(id) {
      const i = books.findIndex(b => b.id === id);
      if (i >= 0) { books[i] = { id, deleted: true, updated: now() }; save(); changed(); }
    },
    // Sync support
    changedSince: ts => books.filter(b => !ts || b.updated > ts),
    // Take remote rows ({id, updated, ...book fields}); the newer side wins per book. Returns how many changed locally.
    mergeRemote(rows) {
      let n = 0;
      for (const r of rows) {
        const i = books.findIndex(b => b.id === r.id);
        if (i < 0) { books.push(r); n++; }
        else if (r.updated > books[i].updated) { books[i] = r; n++; }
      }
      if (n) { save(); changed(); }
      return n;
    },
    // Small shared settings (such as the family Drive folder) ride along with the books so every synced device gets them.
    setting: k => { const r = books.find(b => b.id === SETTINGS); return r ? r[k] || '' : ''; },
    setSetting(k, v) {
      const i = books.findIndex(b => b.id === SETTINGS);
      if (i >= 0) books[i] = { ...books[i], [k]: v, updated: now() };
      else books.push({ id: SETTINGS, title: SETTINGS, [k]: v, added: now(), updated: now() });
      save(); changed();
    },
    onChange: f => listeners.push(f),
    onSaveError: f => errListeners.push(f),
    // Another tab or the installed app changed the books: pick them up instead of overwriting them later.
    reload() { load(); changed(); },
    KEY,
    exportJson: () => JSON.stringify(live(), null, 2),
    importJson(text) {
      let data = JSON.parse(text);
      if (data && Array.isArray(data.books)) data = data.books;
      if (!Array.isArray(data)) throw new Error('Not a backup file');
      let n = 0;
      const norm = t => (t || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f\u0980-\u09ff]+/g, ' ').trim();
      for (const b of data) {
        if (!b || !b.title) continue;
        const list = b.list || 'library';
        // Importing the same file twice must not double the library: match by ISBN, else by title and author.
        if (live().some(x => (x.list || 'library') === list && (x.kind || 'book') === (b.kind || 'book') &&
          (b.isbn ? x.isbn === cleanIsbn(b.isbn) : norm(x.title) === norm(b.title) && norm(x.author) === norm(b.author)))) continue;
        books.push({ added: now(), list: 'library', ...b, id: uid(), updated: now(), deleted: undefined });
        n++;
      }
      save(); changed();
      return n;
    },
    cleanIsbn,
  };
})();
