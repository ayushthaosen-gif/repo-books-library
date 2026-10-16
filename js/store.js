// Single-user storage in localStorage. Books: {id,title,author,isbn,cover,notes,list,added}
const Store = (() => {
  const KEY = 'books-library-v1';
  let books = [];
  try { books = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { books = []; }
  const save = () => localStorage.setItem(KEY, JSON.stringify(books));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const cleanIsbn = s => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return {
    all: () => books,
    get: id => books.find(b => b.id === id),
    findByIsbn(isbn) { const i = cleanIsbn(isbn); return i ? books.find(b => b.isbn === i) : undefined; },
    upsert(b) {
      b.isbn = cleanIsbn(b.isbn);
      const i = books.findIndex(x => x.id === b.id);
      if (i >= 0) books[i] = { ...books[i], ...b };
      else books.unshift({ id: uid(), added: new Date().toISOString(), ...b });
      save();
    },
    remove(id) { books = books.filter(b => b.id !== id); save(); },
    exportJson: () => JSON.stringify(books, null, 2),
    importJson(text) {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('Not a backup file');
      let n = 0;
      for (const b of data) {
        if (!b || !b.title) continue;
        if (b.isbn && books.some(x => x.isbn === cleanIsbn(b.isbn) && x.list === b.list)) continue;
        books.push({ id: uid(), added: new Date().toISOString(), list: 'library', ...b, id: uid() });
        n++;
      }
      save();
      return n;
    },
    cleanIsbn,
  };
})();
