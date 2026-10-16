// ISBN -> book details. Open Library and Google Books are asked at the same time; first answer with data wins.
const Lookup = (() => {
  const TIMEOUT_MS = 8000;

  async function getJson(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function openLibrary(isbn) {
    const d = (await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`))['ISBN:' + isbn];
    if (!d) return null;
    return {
      title: [d.title, d.subtitle].filter(Boolean).join(': '),
      author: (d.authors || []).map(a => a.name).join(', '),
      cover: d.cover ? (d.cover.medium || d.cover.large || d.cover.small) : `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`,
      isbn,
    };
  }
  async function googleBooks(isbn) {
    const v = ((await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)).items || [])[0];
    if (!v) return null;
    const i = v.volumeInfo;
    return {
      title: i.title + (i.subtitle ? ': ' + i.subtitle : ''),
      author: (i.authors || []).join(', '),
      cover: ((i.imageLinks && i.imageLinks.thumbnail) || '').replace('http://', 'https://'),
      isbn,
    };
  }
  function toIsbn13(isbn) {
    if (isbn.length === 13) return isbn;
    const core = '978' + isbn.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += +core[i] * (i % 2 ? 3 : 1);
    return core + ((10 - (sum % 10)) % 10);
  }

  // Resolves to book info, or null when no source knows the ISBN.
  // Throws Error with a user-facing message if the sources could not be reached.
  function byIsbn(raw) {
    const isbn = Store.cleanIsbn(raw);
    if (!/^(\d{9}[\dX]|\d{13})$/.test(isbn)) return Promise.reject(new Error('That does not look like an ISBN. It should have 10 or 13 digits.'));
    const id = toIsbn13(isbn);
    if (!navigator.onLine) return Promise.reject(new Error('You are offline. Reconnect to look up details, or add the book by hand.'));
    return new Promise((resolve, reject) => {
      let pending = 2, failed = 0;
      const done = () => {
        if (--pending) return;
        reject(failed === 2 ? new Error('Could not reach the book databases. Check your connection and try again.') : null);
      };
      for (const fn of [openLibrary, googleBooks]) {
        fn(id).then(b => { if (b && b.title) resolve(b); else done(); }, () => { failed++; done(); });
      }
    }).catch(e => { if (e) throw e; return null; });
  }
  return { byIsbn };
})();
