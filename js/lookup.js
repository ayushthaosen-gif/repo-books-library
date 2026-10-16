// ISBN -> book details. Several sources are asked at the same time; first answer with data wins.
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
  // Open Library's search index and edition records sometimes hold books the bibkeys API above does not.
  async function openLibrarySearch(isbn) {
    const d = ((await getJson(`https://openlibrary.org/search.json?isbn=${isbn}&fields=title,subtitle,author_name,cover_i&limit=1`)).docs || [])[0];
    if (!d) return null;
    return {
      title: [d.title, d.subtitle].filter(Boolean).join(': '),
      author: (d.author_name || []).join(', '),
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
      isbn,
    };
  }
  async function openLibraryEdition(isbn) {
    const d = await getJson(`https://openlibrary.org/isbn/${isbn}.json`).catch(e => { if (/HTTP 404/.test(e.message)) return null; throw e; });
    if (!d || !d.title) return null;
    let author = '';
    try { if (d.authors && d.authors[0]) author = (await getJson(`https://openlibrary.org${d.authors[0].key}.json`)).name || ''; } catch (e) {}
    return {
      title: [d.title, d.subtitle].filter(Boolean).join(': '),
      author,
      cover: d.covers && d.covers[0] > 0 ? `https://covers.openlibrary.org/b/id/${d.covers[0]}-M.jpg` : '',
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
      const sources = [openLibrary, googleBooks, openLibrarySearch, openLibraryEdition];
      let pending = sources.length, failed = 0;
      const done = () => {
        if (--pending) return;
        reject(failed === sources.length ? new Error('Could not reach the book databases. Check your connection and try again.') : null);
      };
      for (const fn of sources) {
        fn(id).then(b => { if (b && b.title) resolve(b); else done(); }, () => { failed++; done(); });
      }
    }).catch(e => { if (e) throw e; return null; });
  }
  return { byIsbn };
})();
