// ISBN -> book details via Open Library (free, no key). Falls back to Google Books.
const Lookup = (() => {
  async function openLibrary(isbn) {
    const r = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    if (!r.ok) throw new Error('Open Library ' + r.status);
    const d = (await r.json())['ISBN:' + isbn];
    if (!d) return null;
    return {
      title: [d.title, d.subtitle].filter(Boolean).join(': '),
      author: (d.authors || []).map(a => a.name).join(', '),
      cover: d.cover ? (d.cover.medium || d.cover.large || d.cover.small) : `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`,
      isbn,
    };
  }
  async function googleBooks(isbn) {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!r.ok) throw new Error('Google Books ' + r.status);
    const v = ((await r.json()).items || [])[0];
    if (!v) return null;
    const i = v.volumeInfo;
    return {
      title: i.title + (i.subtitle ? ': ' + i.subtitle : ''),
      author: (i.authors || []).join(', '),
      cover: (i.imageLinks && i.imageLinks.thumbnail || '').replace('http://', 'https://'),
      isbn,
    };
  }
  // Returns book info, or null if no source knows it. Throws only if every source failed.
  async function byIsbn(raw) {
    const isbn = Store.cleanIsbn(raw);
    if (!/^(\d{9}[\dX]|\d{13})$/.test(isbn)) throw new Error('That does not look like an ISBN');
    let failed = 0;
    for (const fn of [openLibrary, googleBooks]) {
      try { const b = await fn(isbn); if (b) return b; } catch (e) { failed++; }
    }
    if (failed === 2) throw new Error('Could not reach the book databases. Check your connection.');
    return null;
  }
  return { byIsbn };
})();
