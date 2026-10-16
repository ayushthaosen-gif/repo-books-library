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

  const norm = s => (s || '').toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  // Fill-in for books with no ISBN: look the book up by title (and author when known).
  // Only an exact title match is trusted. Returns {author, cover} (either may be empty) or null.
  async function byTitle(title, author) {
    const q = new URLSearchParams({ title: title.split(':')[0], limit: '8', fields: 'title,author_name,cover_i' });
    if (author) q.set('author', author.split(',')[0]);
    const docs = (await getJson('https://openlibrary.org/search.json?' + q)).docs || [];
    const want = norm(title.split(':')[0]);
    const hit = docs.find(d => norm(d.title) === want && (d.author_name || d.cover_i));
    if (!hit) return null;
    return {
      author: (hit.author_name || []).slice(0, 2).join(', '),
      cover: hit.cover_i ? `https://covers.openlibrary.org/b/id/${hit.cover_i}-M.jpg` : '',
    };
  }

  // Description, rating and extras for the detail page (Google Books). Returns null if nothing is known.
  async function details(book) {
    const q = book.isbn ? 'isbn:' + book.isbn : 'intitle:' + book.title.split(':')[0] + (book.author ? '+inauthor:' + book.author.split(',')[0] : '');
    const items = (await getJson('https://www.googleapis.com/books/v1/volumes?maxResults=5&q=' + encodeURIComponent(q).replace(/%2B/g, '+'))).items || [];
    const want = norm(book.title.split(':')[0]);
    const hit = book.isbn ? items[0] : items.find(v => norm((v.volumeInfo || {}).title) === want);
    if (!hit) return null;
    const i = hit.volumeInfo;
    const img = i.imageLinks || {};
    return {
      description: i.description || '',
      rating: i.averageRating || 0,
      ratings: i.ratingsCount || 0,
      pages: i.pageCount || 0,
      publisher: i.publisher || '',
      published: i.publishedDate || '',
      categories: (i.categories || []).join(', '),
      cover: (img.thumbnail || img.smallThumbnail || '').replace('http://', 'https://'),
      link: i.infoLink || '',
    };
  }

  // Title search for the Add form: up to 8 candidates from Open Library and Google Books.
  async function searchTitle(text) {
    const isbnOf = a => (a || []).find(x => /^\d{13}$/.test(x)) || '';
    const ol = getJson('https://openlibrary.org/search.json?limit=8&fields=title,subtitle,author_name,cover_i,isbn&q=' + encodeURIComponent(text))
      .then(j => (j.docs || []).map(d => ({ title: [d.title, d.subtitle].filter(Boolean).join(': '), author: (d.author_name || []).slice(0, 2).join(', '), cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '', isbn: isbnOf(d.isbn) })));
    const gb = getJson('https://www.googleapis.com/books/v1/volumes?maxResults=8&q=' + encodeURIComponent(text))
      .then(j => (j.items || []).map(v => { const i = v.volumeInfo || {}; const id = (i.industryIdentifiers || []).find(x => x.type === 'ISBN_13'); return { title: i.title ? i.title + (i.subtitle ? ': ' + i.subtitle : '') : '', author: (i.authors || []).slice(0, 2).join(', '), cover: ((i.imageLinks || {}).thumbnail || '').replace('http://', 'https://'), isbn: id ? id.identifier : '' }; }));
    const [a, b] = await Promise.allSettled([ol, gb]);
    if (a.status === 'rejected' && b.status === 'rejected') throw new Error('Could not reach the book databases.');
    const seen = new Set(), out = [];
    for (const r of [...(a.value || []), ...(b.value || [])]) {
      const k = norm(r.title) + '|' + norm(r.author);
      if (!r.title || seen.has(k)) continue;
      seen.add(k); out.push(r);
    }
    return out.slice(0, 8);
  }
  return { byIsbn, byTitle, details, searchTitle };
})();
