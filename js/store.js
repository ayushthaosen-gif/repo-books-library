// Single-user storage in localStorage. Books: {id,title,author,isbn,cover,notes,room,status,lentTo,list,added,updated,deleted?}
// Deleted books stay as tombstones ({deleted:true}) so a delete can sync to other devices.
const Store = (() => {
  const KEY = 'books-library-v1';
  let books = [];
  const listeners = [];
  try { books = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { books = []; }
  for (const b of books) if (!b.updated) b.updated = b.added || '1970-01-01T00:00:00.000Z';
  const save = () => localStorage.setItem(KEY, JSON.stringify(books));
  const changed = () => listeners.forEach(f => f());
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();
  const cleanIsbn = s => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  const live = () => books.filter(b => !b.deleted);
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
    onChange: f => listeners.push(f),
    exportJson: () => JSON.stringify(live(), null, 2),
    importJson(text) {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('Not a backup file');
      let n = 0;
      for (const b of data) {
        if (!b || !b.title) continue;
        if (b.isbn && live().some(x => x.isbn === cleanIsbn(b.isbn) && x.list === (b.list || 'library'))) continue;
        books.push({ added: now(), list: 'library', ...b, id: uid(), updated: now(), deleted: undefined });
        n++;
      }
      save(); changed();
      return n;
    },
    cleanIsbn,
  };
})();
