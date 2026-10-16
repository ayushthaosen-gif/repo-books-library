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
  async function googleDetails(book) {
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

  // Backup source for description/pages/publisher: Open Library search, then the work record.
  async function openLibraryDetails(book) {
    const q = new URLSearchParams({ limit: '5', fields: 'key,title,cover_i,number_of_pages_median,publisher,first_publish_year,subject' });
    if (book.isbn) q.set('isbn', book.isbn); else { q.set('title', book.title.split(':')[0]); if (book.author) q.set('author', book.author.split(',')[0]); }
    const docs = (await getJson('https://openlibrary.org/search.json?' + q)).docs || [];
    const want = norm(book.title.split(':')[0]);
    const hit = book.isbn ? docs[0] : docs.find(d => norm(d.title) === want);
    if (!hit) return null;
    let description = '';
    try {
      const w = await getJson(`https://openlibrary.org${hit.key}.json`);
      description = typeof w.description === 'string' ? w.description : (w.description && w.description.value) || '';
    } catch (e) {}
    return {
      description: description.split('\n----------')[0].trim(),
      rating: 0, ratings: 0,
      pages: hit.number_of_pages_median || 0,
      publisher: (hit.publisher || [])[0] || '',
      published: hit.first_publish_year ? String(hit.first_publish_year) : '',
      categories: (hit.subject || []).slice(0, 3).join(', '),
      cover: hit.cover_i ? `https://covers.openlibrary.org/b/id/${hit.cover_i}-M.jpg` : '',
      link: 'https://openlibrary.org' + hit.key,
    };
  }

  // Description, rating and extras: Google Books first, Open Library fills what is missing or covers for it when it fails.
  async function details(book) {
    let g = null, gErr = null;
    try { g = await googleDetails(book); } catch (e) { gErr = e; }
    if (g && g.description) return g;
    let o = null;
    try { o = await openLibraryDetails(book); } catch (e) { if (gErr) throw gErr; }
    if (!g) return o;
    if (!o) return g;
    return { ...o, ...Object.fromEntries(Object.entries(g).filter(([, v]) => v)), description: o.description };
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
  // Games: product barcode -> name (UPCitemdb free tier, limited per day). Returns {title, author (brand), cover} or null.
  async function byBarcode(code) {
    const j = await getJson('https://api.upcitemdb.com/prod/trial/lookup?upc=' + code);
    const i = (j.items || [])[0];
    if (!i || !i.title) return null;
    return { title: i.title, author: i.brand || '', cover: (i.images || []).find(u => /^https:/.test(u)) || '' };
  }

  // Games: search by name using Wikipedia (title, thumbnail, first sentences).
  async function searchGame(text) {
    const q = new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: text + ' game', gsrlimit: '8', prop: 'pageimages|extracts', piprop: 'thumbnail', pithumbsize: '300', exintro: '1', explaintext: '1', exsentences: '3' });
    const pages = Object.values(((await getJson('https://en.wikipedia.org/w/api.php?' + q)).query || {}).pages || {}).sort((a, b) => a.index - b.index);
    return pages.filter(p => /game|puzzle|cards?\b/i.test(p.extract || p.title)).map(p => ({
      title: p.title.replace(/\s*\((board |card |tabletop |dice )?game\)$/i, ''),
      author: '', isbn: '',
      cover: p.thumbnail ? p.thumbnail.source : '',
      desc: p.extract || '',
    }));
  }
  // Games: best-effort cover picture. Tries the exact Wikipedia article (with common game suffixes),
  // then a Wikipedia search, then the product-barcode photo.
  async function gameCover(title, barcode) {
    const thumb = async names => {
      const q = new URLSearchParams({ action: 'query', format: 'json', origin: '*', redirects: '1', titles: names.join('|'), prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '300' });
      const pages = Object.values(((await getJson('https://en.wikipedia.org/w/api.php?' + q)).query || {}).pages || {});
      const p = pages.find(p => p.thumbnail);
      return p ? p.thumbnail.source : '';
    };
    const base = title.split(':')[0].trim();
    for (const names of [[base + ' (board game)', base + ' (game)', base + ' (card game)', base + ' (tabletop game)', base]]) {
      try { const c = await thumb(names); if (c) return c; } catch (e) {}
    }
    try { const r = (await searchGame(base)).find(r => r.cover); if (r) return r.cover; } catch (e) {}
    if (/^\d{8,14}$/.test(barcode || '')) { try { const r = await byBarcode(barcode); if (r && r.cover) return r.cover; } catch (e) {} }
    return '';
  }
  return { byIsbn, byTitle, details, searchTitle, byBarcode, searchGame, gameCover };
})();
