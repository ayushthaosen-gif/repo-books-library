// Book PDFs and EPUBs kept on this phone (IndexedDB) and a page-turning reader styled after Apple Books.
// pdf.js and epub.js are loaded the first time a book of that kind is opened, so they cost nothing until then.
const Reader = (() => {
  const $ = s => document.querySelector(s);
  const DB = 'books-library-pdfs';
  const db = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, f) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('files', mode), q = f(t.objectStore('files'));
      t.oncomplete = () => { d.close(); res(q && q.result); };
      t.onerror = t.onabort = () => { d.close(); rej(t.error || new Error('Could not save the file on this phone (storage may be full).')); };
    });
  };
  const store = {
    put: (id, file) => tx('readwrite', s => s.put({ blob: file, name: file.name, size: file.size }, id)),
    get: id => tx('readonly', s => s.get(id)),
    remove: id => tx('readwrite', s => s.delete(id)),
  };

  let lib = null;
  function loadLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return lib || (lib = new Promise((res, rej) => {
      const s = Object.assign(document.createElement('script'), { src: 'vendor/pdfjs/pdf.min.js' });
      s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; res(pdfjsLib); };
      s.onerror = () => { lib = null; rej(new Error('Could not load the reader. Connect once to the internet and try again.')); };
      document.head.append(s);
    }));
  }

  const addScript = src => new Promise((res, rej) => {
    const el = Object.assign(document.createElement('script'), { src });
    el.onload = res;
    el.onerror = () => rej(new Error('Could not load the reader. Connect once to the internet and try again.'));
    document.head.append(el);
  });
  let epubLib = null;
  function loadEpub() {
    if (window.ePub) return Promise.resolve(window.ePub);
    return epubLib || (epubLib = (async () => {
      try { if (!window.JSZip) await addScript('vendor/epubjs/jszip.min.js'); await addScript('vendor/epubjs/epub.min.js'); return window.ePub; }
      catch (e) { epubLib = null; throw e; }
    })());
  }

  const dlg = () => $('#reader-dialog');
  let pdf = null, bookId = '', n = 1, zoom = 1, token = 0, theme = 'light';
  let epub = null, rendition = null, mode = 'pdf', fontPct = 110;
  const THEMES = ['light', 'sepia', 'night'];
  const KEY = 'books-library-reader';
  const prefs = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const savePrefs = f => { try { const p = prefs(); f(p); localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} };

  function setTheme(t) {
    theme = THEMES.includes(t) ? t : 'light';
    dlg().dataset.theme = theme;
    savePrefs(p => { p.theme = theme; });
    if (rendition) rendition.themes.select(theme);
  }
  const EPUB_THEMES = {
    light: { bg: '#f4f1ea', fg: '#1c1c1e' },
    sepia: { bg: '#e9dcc0', fg: '#3b2f1e' },
    night: { bg: '#000000', fg: '#d8d8dc' },
  };
  const FONT = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
  function registerThemes(r) {
    for (const [name, c] of Object.entries(EPUB_THEMES)) {
      r.themes.register(name, {
        body: { background: c.bg + ' !important', color: c.fg + ' !important', 'font-family': FONT + ' !important', 'line-height': '1.55 !important' },
        'p, div, span, li, h1, h2, h3, h4, h5, h6, em, strong, blockquote': { color: c.fg + ' !important' },
        a: { color: c.fg + ' !important' },
      });
    }
  }
  async function show(page, dir = 0) {
    if (!pdf) return;
    n = Math.max(1, Math.min(pdf.numPages, page));
    const my = ++token;
    const canvas = $('#rd-canvas'), box = $('#rd-scroll');
    $('#rd-range').max = pdf.numPages; $('#rd-range').value = n;
    $('#rd-pos').textContent = `Page ${n} of ${pdf.numPages}`;
    savePrefs(p => { (p.pages = p.pages || {})[bookId] = n; });
    const pg = await pdf.getPage(n);
    if (my !== token) return;
    const base = pg.getViewport({ scale: 1 });
    const cssW = Math.max(200, (box.clientWidth - 16) * zoom), k = cssW / base.width, dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = pg.getViewport({ scale: k * dpr });
    const off = document.createElement('canvas');
    off.width = Math.round(vp.width); off.height = Math.round(vp.height);
    await pg.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
    if (my !== token) return;
    canvas.width = off.width; canvas.height = off.height;
    canvas.style.width = cssW + 'px'; canvas.style.height = (cssW * base.height / base.width) + 'px';
    canvas.getContext('2d').drawImage(off, 0, 0);
    box.scrollTop = 0; box.scrollLeft = 0;
    if (dir) { canvas.animate([{ transform: `translateX(${dir * 24}px)`, opacity: .2 }, { transform: 'none', opacity: 1 }], { duration: 180, easing: 'ease-out' }); }
  }
  const turn = d => { if (pdf && n + d >= 1 && n + d <= pdf.numPages) show(n + d, d); };
  const chrome = on => dlg().classList.toggle('bare', on === undefined ? !dlg().classList.contains('bare') : !on);

  const isEpub = rec => /\.epub$/i.test(rec.name || '') || (rec.blob && rec.blob.type === 'application/epub+zip');

  async function openEpub(rec, id, title) {
    const lib = await loadEpub();
    const book = lib();
    await book.open(await rec.blob.arrayBuffer(), 'binary');
    epub = book; bookId = id; mode = 'epub';
    const p = prefs();
    fontPct = p.epubFont || 110;
    $('#rd-title').textContent = title;
    dlg().dataset.mode = 'epub';
    $('#rd-pos').textContent = 'Opening…';
    $('#rd-range').max = 100; $('#rd-range').value = 0;
    chrome(true);
    dlg().showModal();
    const box = $('#rd-epub-box');
    box.replaceChildren();
    rendition = book.renderTo(box, { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });
    registerThemes(rendition);
    setTheme(p.theme);
    rendition.themes.fontSize(fontPct + '%');
    rendition.on('relocated', loc => {
      const cfi = loc && loc.start && loc.start.cfi;
      if (cfi) savePrefs(q => { (q.pages = q.pages || {})[id] = cfi; });
      const pct = book.locations && book.locations.length() ? Math.round((loc.start.percentage || 0) * 100) : null;
      if (pct != null) { $('#rd-pos').textContent = pct + '%'; $('#rd-range').value = pct; }
    });
    let sx = 0, sy = 0, swiped = false;
    rendition.on('touchstart', e => { sx = e.changedTouches[0].screenX; sy = e.changedTouches[0].screenY; swiped = false; });
    rendition.on('touchend', e => {
      const dx = e.changedTouches[0].screenX - sx, dy = e.changedTouches[0].screenY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 60) { swiped = true; (dx < 0 ? rendition.next() : rendition.prev()); }
    });
    rendition.on('click', e => {
      if (swiped) { swiped = false; return; }
      const f = (e.clientX || 0) / (box.clientWidth || window.innerWidth);
      if (f < .25) rendition.prev(); else if (f > .75) rendition.next(); else chrome();
    });
    const saved = (p.pages || {})[id];
    await rendition.display(typeof saved === 'string' ? saved : undefined);
    book.ready.then(() => book.locations.generate(1200)).then(() => {
      const loc = rendition.currentLocation();
      if (loc && loc.start) { const pct = Math.round((book.locations.percentageFromCfi(loc.start.cfi) || 0) * 100); $('#rd-pos').textContent = pct + '%'; $('#rd-range').value = pct; }
    }).catch(() => {});
  }
  function closeEpub() {
    try { if (rendition) rendition.destroy(); if (epub) epub.destroy(); } catch (e) {}
    rendition = null; epub = null;
  }

  async function open(id, title) {
    const rec = await store.get(id);
    if (!rec) throw new Error('This book is not on this phone yet.');
    if (isEpub(rec)) return openEpub(rec, id, title);
    mode = 'pdf';
    dlg().dataset.mode = 'pdf';
    const lib = await loadLib();
    pdf = await lib.getDocument({ data: await rec.blob.arrayBuffer() }).promise;
    bookId = id; zoom = 1;
    const p = prefs();
    setTheme(p.theme);
    $('#rd-title').textContent = title;
    chrome(true);
    dlg().showModal();
    await show((p.pages || {})[id] || 1);
  }
  function close() {
    token++;
    closeEpub();
    if (pdf) { pdf.destroy(); pdf = null; }
    if (dlg().open) dlg().close();
  }

  let x0 = 0, y0 = 0;
  const box = $('#rd-scroll');
  box.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  box.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (zoom === 1 && Math.abs(dx) > 60 && Math.abs(dy) < 50) { box.dataset.swiped = '1'; turn(dx < 0 ? 1 : -1); }
  }, { passive: true });
  box.addEventListener('click', e => {
    if (box.dataset.swiped) { delete box.dataset.swiped; return; }
    const r = box.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
    if (zoom === 1 && f < .25) turn(-1); else if (zoom === 1 && f > .75) turn(1); else chrome();
  });
  $('#rd-close').onclick = close;
  $('#rd-theme').onclick = () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
  $('#rd-range').oninput = e => {
    if (mode === 'epub') { if (epub && epub.locations.length()) rendition.display(epub.locations.cfiFromPercentage(+e.target.value / 100)); return; }
    show(+e.target.value);
  };
  const font = d => { fontPct = Math.max(80, Math.min(220, fontPct + d)); savePrefs(p => { p.epubFont = fontPct; }); if (rendition) rendition.themes.fontSize(fontPct + '%'); };
  $('#rd-zin').onclick = () => { if (mode === 'epub') return font(10); zoom = Math.min(3, +(zoom + .5).toFixed(1)); show(n); };
  $('#rd-zout').onclick = () => { if (mode === 'epub') return font(-10); zoom = Math.max(1, +(zoom - .5).toFixed(1)); show(n); };
  dlg().addEventListener('close', () => { token++; closeEpub(); if (pdf) { pdf.destroy(); pdf = null; } });
  dlg().addEventListener('keydown', e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    if (mode === 'epub' && rendition) { d > 0 ? rendition.next() : rendition.prev(); } else turn(d);
  });
  window.addEventListener('resize', () => { if (pdf && mode === 'pdf') show(n); });

  return { has: async id => !!(await store.get(id).catch(() => null)), info: id => store.get(id).catch(() => null), put: store.put, remove: id => store.remove(id).catch(() => {}), open, close };
})();
