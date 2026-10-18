// Book PDFs and EPUBs kept on this phone (IndexedDB) and a page-turning reader styled after Apple Books.
// pdf.js and epub.js are loaded the first time a book of that kind is opened, so they cost nothing until then.
// Opens a dialog with a zoom that grows out of rect (the tapped cover), or out of the middle.
window.zoomOpen = (d, rect) => {
  if (d.open) return;
  d.style.animation = 'none';
  d.showModal();
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = d.getBoundingClientRect();
  const ox = rect ? rect.left + rect.width / 2 - r.left : r.width / 2, oy = rect ? rect.top + rect.height / 2 - r.top : r.height / 2;
  d.style.transformOrigin = `${ox}px ${oy}px`;
  const a = d.animate([{ transform: `scale(${rect ? .35 : .88})`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' });
  a.onfinish = a.oncancel = () => { d.style.transformOrigin = ''; };
};
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
  let under = null, underFor = null, underBusy = null;
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
    if (under) under.themes.select(theme);
  }
  const EPUB_THEMES = {
    light: { bg: '#f4f1ea', fg: '#1c1c1e' },
    sepia: { bg: '#e9dcc0', fg: '#3b2f1e' },
    night: { bg: '#000000', fg: '#d8d8dc' },
  };
  const FONT = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
  const SANS = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
  // Pictures must never sit on top of text. A small floated picture is a drop cap and is kept to about four lines; any other
  // floated or positioned picture is put back into the normal flow of the page.
  function tameImages(contents) {
    const d = contents.document, w = d.defaultView;
    const fix = () => {
      for (const im of d.querySelectorAll('img, svg')) {
        const cs = w.getComputedStyle(im), set = (k, v) => im.style.setProperty(k, v, 'important');
        const floated = cs.float && cs.float !== 'none', placed = cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'relative';
        const r = im.getBoundingClientRect();
        const dropCap = floated && im.tagName === 'IMG' && r.width <= w.innerWidth * .36 && r.height <= w.innerHeight * .3;
        if (placed) { set('position', 'static'); set('transform', 'none'); set('opacity', '1'); set('z-index', 'auto'); }
        if (dropCap) { set('max-height', '4.6em'); set('width', 'auto'); set('height', 'auto'); set('max-width', '30%'); set('margin-left', '0'); }
        else if (floated || placed || parseFloat(cs.marginLeft) < 0 || parseFloat(cs.marginRight) < 0) {
          set('float', 'none'); set('display', 'block'); set('margin', '.6em auto'); set('max-width', '100%'); set('height', 'auto');
        }
      }
    };
    fix();
    for (const im of d.querySelectorAll('img')) if (!im.complete) im.addEventListener('load', fix, { once: true });
  }
  function registerThemes(r) {
    const p = prefs(), fam = { serif: FONT, sans: SANS, orig: '' }[p.font || 'serif'], lh = p.lh || 1.55;
    for (const [name, c] of Object.entries(EPUB_THEMES)) {
      r.themes.register(name, {
        body: { margin: '0 !important', background: c.bg + ' !important', color: c.fg + ' !important', ...(fam ? { 'font-family': fam + ' !important' } : {}), 'line-height': lh + ' !important' },
        'p, div, span, li, h1, h2, h3, h4, h5, h6, em, strong, blockquote': { color: c.fg + ' !important' },
        a: { color: c.fg + ' !important' },
        'img, svg, video': { 'max-width': '100% !important', 'max-height': '86vh !important', 'object-fit': 'contain' },
        'h1, h2, h3, h4, h5, h6': { 'break-after': 'avoid', 'page-break-after': 'avoid', '-webkit-column-break-after': 'avoid' },
        'p, li': { orphans: '2', widows: '2' },
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

  // ---- marks: highlights, notes and bookmarks, kept with the book so the family sees them ----
  let marks = { hl: [], bm: [] }, cbMarks = null, cbPos = null, lastPosAt = 0, lastLoc = null;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const HL = { yellow: '#ffd84d', green: '#7fd48b', blue: '#7fb8ff', pink: '#ff9ec4' };
  const saveMarks = () => { savePrefs(p => { (p.marks = p.marks || {})[bookId] = marks; }); if (cbMarks) cbMarks(marks); };
  const paintHl = h => { try { rendition.annotations.highlight(h.cfi, { id: h.id }, null, 'rd-hl', { fill: HL[h.color] || HL.yellow, 'fill-opacity': '.38' }); } catch (e) {} };
  const unpaintHl = h => { try { rendition.annotations.remove(h.cfi, 'highlight'); } catch (e) {} };
  const cmp = (a, b) => new window.ePub.CFI().compare(a, b);
  const pageMarked = loc => loc && loc.start && marks.bm.find(m => { try { return cmp(m.cfi, loc.start.cfi) >= 0 && cmp(m.cfi, loc.end.cfi) <= 0; } catch (e) { return false; } });
  function paintMark(loc) { const m = !!pageMarked(loc); $('#rd-ribbon').hidden = !m; $('#rd-mark').classList.toggle('on', m); }
  $('#rd-mark').onclick = () => {
    if (!rendition) return;
    const loc = rendition.currentLocation();
    if (!loc || !loc.start) return;
    const m = pageMarked(loc);
    if (m) marks.bm = marks.bm.filter(x => x !== m); else marks.bm.push({ id: uid(), cfi: loc.start.cfi, by: who, at: Date.now() });
    saveMarks(); paintMark(loc);
  };
  let who = '';
  const pageNo = cfi => { try { return epub.locations.length() ? epub.locations.locationFromCfi(cfi) + 1 : 0; } catch (e) { return 0; } };

  // Page X of N, and time left, for the open EPUB (from reading locations of about 1000 characters each).
  function folio(loc) {
    const book = epub;
    if (!book || !loc || !loc.start) return;
    lastLoc = loc;
    let t = '', pct = loc.start.percentage || 0;
    if (book.locations && book.locations.length()) {
      const tot = book.locations.length();
      pct = book.locations.percentageFromCfi(loc.start.cfi) || 0;
      t = `Page ${Math.max(1, book.locations.locationFromCfi(loc.start.cfi) + 1)} of ${tot}`;
      const min = Math.ceil((1 - pct) * tot * 1000 / 1200);
      if (min > 0) t += ' · ' + (min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min') + ' left';
      $('#rd-range').value = Math.round(pct * 100);
    } else t = Math.round(pct * 100) + '%';
    $('#rd-pos').textContent = t;
    $('#rd-folio').textContent = t;
    paintMark(loc);
    if (cbPos && Date.now() - lastPosAt > 15000) { lastPosAt = Date.now(); cbPos(loc.start.cfi, pct, Date.now()); }
  }
  function flushPos() { if (cbPos && lastLoc && lastLoc.start) { const pct = epub && epub.locations.length() ? epub.locations.percentageFromCfi(lastLoc.start.cfi) : lastLoc.start.percentage; cbPos(lastLoc.start.cfi, pct || 0, Date.now()); } }

  // ---- page turn: a curl (default), a slide, or none ----
  let flipping = false;
  const reduce = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function curlAt(pr) {
    const box = $('#rd-epub-box'), flap = $('#rd-flap');
    const X = 118 - pr * 136, sl = 9, xt = X + sl, xb = X - sl;
    box.style.clipPath = `polygon(0 0, ${xt}% 0, ${xb}% 100%, 0 100%)`;
    const lt = clamp(2 * xt - 100, 0, 100), lb = clamp(2 * xb - 100, 0, 100), ct = clamp(xt, 0, 100), cb = clamp(xb, 0, 100);
    flap.hidden = ct <= 0 && cb <= 0;
    const back = flap.firstElementChild;
    back.style.clipPath = `polygon(${lt}% 0, ${ct}% 0, ${cb}% 100%, ${lb}% 100%)`;
    back.style.background = `linear-gradient(to right, rgba(0,0,0,0) ${lt}%, rgba(0,0,0,.05) ${(lt + ct) / 2}%, rgba(0,0,0,.2) ${ct}%), linear-gradient(var(--rd-bg), var(--rd-bg))`;
  }
  function curlEnd() { $('#rd-epub-box').style.clipPath = ''; $('#rd-flap').hidden = true; }
  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const sweep = (from, to, ms) => new Promise(res => {
    const t0 = performance.now();
    const step = now => { const k = Math.min(1, (now - t0) / ms); curlAt(from + (to - from) * ease(k)); if (k < 1) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step);
  });
  // A second, hidden rendition draws the page under the curl, so the next (or previous) page shows as the corner lifts.
  function ensureUnder() {
    if (under || !epub) return;
    under = epub.renderTo($('#rd-under'), { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });
    registerThemes(under);
    under.hooks.content.register(tameImages);
    under.themes.select(theme);
    under.themes.fontSize(fontPct + '%');
  }
  // Puts the page that follows (dir 1) or is the current one (dir -1) into the under layer.
  function prepUnder(dir) {
    const loc = rendition && rendition.currentLocation();
    if (!loc || !loc.start) return Promise.resolve(false);
    const key = dir + '|' + loc.start.cfi;
    if (underFor === key && underBusy) return underBusy;
    ensureUnder();
    underFor = key;
    underBusy = (async () => {
      try {
        if (dir > 0) { await under.display(loc.end.cfi); await under.next(); }
        else await under.display(loc.start.cfi);
        return underFor === key;
      } catch (e) { return false; }
    })();
    return underBusy;
  }
  const showUnder = on => { $('#rd-under').style.visibility = on ? 'visible' : 'hidden'; };
  async function flip(dir) {
    if (!rendition || flipping) return;
    flipping = true;
    const el = $('#rd-epub-box'), style = reduce() ? 'none' : (prefs().turn || 'curl');
    try {
      if (style === 'curl') {
        const ok = await Promise.race([prepUnder(dir), new Promise(r => setTimeout(() => r(false), 900))]);
        if (ok) showUnder(true);
        if (dir > 0) { await sweep(0, 1, 380); await rendition.next(); curlEnd(); showUnder(false); if (!ok) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 }); }
        else { curlAt(1); await rendition.prev(); await sweep(1, 0, 380); }
      } else if (style === 'slide') {
        const out = el.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * 36}px)`, opacity: .1 }], { duration: 110, easing: 'ease-in', fill: 'forwards' });
        await Promise.all([out.finished, dir > 0 ? rendition.next() : rendition.prev()]);
        out.cancel();
        el.animate([{ transform: `translateX(${dir * 36}px)`, opacity: .1 }, { transform: 'none', opacity: 1 }], { duration: 170, easing: 'ease-out' });
      } else await (dir > 0 ? rendition.next() : rendition.prev());
    } catch (e) {} finally { curlEnd(); showUnder(false); flipping = false; setTimeout(() => { if ((prefs().turn || 'curl') === 'curl') prepUnder(1); }, 60); }
  }

  // ---- sheets (contents, search, notes, display, dictionary) ----
  const sheet = (title, node) => { $('#rd-sheet-title').textContent = title; $('#rd-sheet-body').replaceChildren(...[].concat(node)); $('#rd-sheet').hidden = false; };
  const closeSheet = () => { $('#rd-sheet').hidden = true; };
  $('#rd-sheet-x').onclick = closeSheet;
  $('#rd-sheet').addEventListener('click', e => { if (e.target.id === 'rd-sheet') closeSheet(); });
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const goto = target => { closeSheet(); chrome(false); if (rendition) rendition.display(target); };

  $('#rd-toc').onclick = async () => {
    if (!epub) return;
    const nav = await epub.loaded.navigation;
    const ul = el('ul', { className: 'rd-list' });
    const add = (items, depth) => { for (const it of items) { ul.append(el('li', { onclick: () => goto(it.href), style: `padding-left:${4 + depth * 16}px` }, el('div', { className: 'tx', textContent: (it.label || '').trim() || 'Untitled' }))); if (it.subitems && it.subitems.length) add(it.subitems, depth + 1); } };
    add(nav.toc || [], 0);
    sheet('Contents', ul.childElementCount ? ul : el('p', { textContent: 'This book has no contents list.' }));
  };

  $('#rd-find').onclick = () => {
    if (!epub) return;
    const inp = el('input', { type: 'search', placeholder: 'Search in this book', autocomplete: 'off' });
    const res = el('div');
    let run = 0;
    inp.onkeydown = async e => {
      if (e.key !== 'Enter') return;
      const q = inp.value.trim(), my = ++run;
      if (q.length < 2) return;
      res.replaceChildren(el('p', { textContent: 'Searching…' }));
      const hits = [];
      for (const item of epub.spine.spineItems) {
        if (my !== run) return;
        try { await item.load(epub.load.bind(epub)); for (const r of item.find(q)) hits.push(r); } catch (err) {} finally { try { item.unload(); } catch (err) {} }
        if (hits.length >= 60) break;
      }
      hits.length = Math.min(hits.length, 60);
      if (my !== run) return;
      const ul = el('ul', { className: 'rd-list' });
      for (const h of hits) ul.append(el('li', { onclick: () => goto(h.cfi) }, el('div', { className: 'tx' }, el('div', { textContent: '…' + h.excerpt.trim() + '…' }), el('div', { className: 'sub', textContent: pageNo(h.cfi) ? 'Page ' + pageNo(h.cfi) : '' }))));
      res.replaceChildren(hits.length ? ul : el('p', { textContent: 'No matches.' }));
    };
    sheet('Search', [inp, res]);
    setTimeout(() => inp.focus(), 50);
  };

  $('#rd-notes').onclick = () => {
    const wrap = el('div');
    const render = () => {
      wrap.replaceChildren();
      const items = [...marks.bm.map(m => ({ k: 'bm', m })), ...marks.hl.map(m => ({ k: 'hl', m }))].sort((a, b) => (pageNo(a.m.cfi) || 0) - (pageNo(b.m.cfi) || 0));
      if (!items.length) return wrap.append(el('p', { textContent: 'No notes yet. Tap the ribbon to bookmark a page. Touch and hold a word to highlight or add a note.' }));
      const ul = el('ul', { className: 'rd-list' });
      for (const { k, m } of items) {
        const pg = pageNo(m.cfi) ? 'Page ' + pageNo(m.cfi) : '';
        const x = el('button', { type: 'button', textContent: '✕', ariaLabel: 'Delete', onclick: e => { e.stopPropagation(); if (k === 'bm') marks.bm = marks.bm.filter(y => y !== m); else { unpaintHl(m); marks.hl = marks.hl.filter(y => y !== m); } saveMarks(); if (lastLoc) paintMark(lastLoc); render(); } });
        const body = k === 'bm' ? el('div', { className: 'tx' }, el('div', { textContent: 'Bookmark' }), el('div', { className: 'sub', textContent: [pg, m.by].filter(Boolean).join(' · ') }))
          : el('div', { className: 'tx' }, el('div', { className: 'hlq', style: `--c:${HL[m.color] || HL.yellow}`, textContent: m.text }), m.note ? el('div', { textContent: 'Note: ' + m.note }) : '', el('div', { className: 'sub', textContent: [pg, m.by].filter(Boolean).join(' · ') }));
        ul.append(el('li', { onclick: () => goto(m.cfi) }, body, x));
      }
      const copy = el('button', { type: 'button', className: 'rd-chip', textContent: 'Copy highlights', onclick: async () => { try { await navigator.clipboard.writeText(marks.hl.map(h => '“' + h.text + '”' + (h.note ? ' — ' + h.note : '')).join('\n\n')); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Could not copy'; } } });
      wrap.append(ul, marks.hl.length ? copy : '');
    };
    render();
    sheet('Notes and bookmarks', wrap);
  };

  const chips = (label, opts, cur, set) => el('div', { className: 'rd-opt' }, el('span', { textContent: label }), el('div', { className: 'chips' }, ...opts.map(([v, t]) => { const b = el('button', { type: 'button', className: 'rd-chip' + (String(cur) === String(v) ? ' on' : ''), textContent: t, onclick: () => { set(v); showDisplay(); } }); return b; })));
  function retype() { if (!rendition) return; registerThemes(rendition); rendition.themes.select(theme); rendition.themes.fontSize(fontPct + '%'); }
  function applyMargin() { const m = { s: 4, m: 12, l: 30 }[prefs().margin || 'm']; $('#rd-epub-box').style.setProperty('--rd-pad', m + 'px'); $('#rd-under').style.setProperty('--rd-pad', m + 'px'); if (rendition) setTimeout(() => { try { rendition.resize(); if (under) under.resize(); } catch (e) {} underFor = null; }, 30); }
  function showDisplay() {
    const p = prefs();
    sheet('Display', [
      chips('Page colour', [['light', 'Paper'], ['sepia', 'Sepia'], ['night', 'Night']], theme, v => setTheme(v)),
      chips('Text size', [['-', 'A−'], ['+', 'A+']], '', v => font(v === '+' ? 10 : -10)),
      chips('Font', [['serif', 'Serif'], ['sans', 'Sans'], ['orig', "Book's own"]], p.font || 'serif', v => { savePrefs(q => { q.font = v; }); retype(); }),
      chips('Line spacing', [[1.3, 'Tight'], [1.55, 'Normal'], [1.8, 'Loose']], p.lh || 1.55, v => { savePrefs(q => { q.lh = +v; }); retype(); }),
      chips('Margins', [['s', 'Narrow'], ['m', 'Normal'], ['l', 'Wide']], p.margin || 'm', v => { savePrefs(q => { q.margin = v; }); applyMargin(); }),
      chips('Page turn', [['curl', 'Curl'], ['slide', 'Slide'], ['none', 'None']], p.turn || 'curl', v => savePrefs(q => { q.turn = v; })),
    ]);
  }

  async function define(word) {
    const out = el('p', { textContent: 'Looking up…' });
    sheet('Define “' + word + '”', out);
    try {
      const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.toLowerCase()));
      if (!r.ok) throw new Error('none');
      const j = await r.json(), ul = el('ul', { className: 'rd-list' });
      for (const m of (j[0] && j[0].meanings) || []) for (const d of m.definitions.slice(0, 2)) ul.append(el('li', {}, el('div', { className: 'tx' }, el('div', { textContent: d.definition }), el('div', { className: 'sub', textContent: m.partOfSpeech }))));
      out.replaceWith(ul.childElementCount ? ul : el('p', { textContent: 'No definition found.' }));
    } catch (e) { out.textContent = navigator.onLine ? 'No definition found for that word.' : 'Connect to the internet to look up words.'; }
  }
  $('#rd-theme').onclick = () => { if (mode === 'epub') showDisplay(); else setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]); };

  // ---- touch and hold a word to highlight, note, define or copy ----
  const pop = () => $('#rd-pop');
  const hidePop = () => { pop().hidden = true; try { const f = $('#rd-epub-box iframe'); if (f) f.contentWindow.getSelection().removeAllRanges(); } catch (e) {} };
  const isWord = c => /[\p{L}\p{N}'’\-]/u.test(c || '');
  function wordRange(d, x, y) {
    const pos = d.caretRangeFromPoint ? d.caretRangeFromPoint(x, y) : null;
    if (!pos || pos.startContainer.nodeType !== 3) return null;
    const node = pos.startContainer, t = node.data;
    let i = pos.startOffset;
    if (!isWord(t[i]) && isWord(t[i - 1])) i--;
    if (!isWord(t[i])) return null;
    let a = i, b = i;
    while (a > 0 && isWord(t[a - 1])) a--;
    while (b < t.length && isWord(t[b])) b++;
    const r = d.createRange(); r.setStart(node, a); r.setEnd(node, b);
    return r;
  }
  function widen(d, r, how) {
    const node = r.startContainer, t = node.data || '';
    if (how === 'sentence' && node.nodeType === 3) {
      let a = r.startOffset, b = r.endOffset;
      while (a > 0 && !/[.!?…]/.test(t[a - 1])) a--;
      while (a < t.length && /\s/.test(t[a])) a++;
      while (b < t.length && !/[.!?…]/.test(t[b])) b++;
      if (b < t.length) b++;
      while (b < t.length && /["”’)]/.test(t[b])) b++;
      const n = d.createRange(); n.setStart(node, a); n.setEnd(node, b); return n;
    }
    const blk = (node.nodeType === 3 ? node.parentElement : node).closest('p,li,blockquote,h1,h2,h3,h4,h5,h6,div') || d.body;
    const n = d.createRange(); n.selectNodeContents(blk); return n;
  }
  function showPop(d, fr, r) {
    const sel = d.defaultView.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    const text = r.toString().replace(/\s+/g, ' ').trim();
    const contents = rendition.getContents()[0];
    const cfi = contents.cfiFromRange(r);
    const old = marks.hl.find(h => h.text.includes(text) && text.length > 2);
    const P = pop();
    P.replaceChildren();
    const done = () => { P.hidden = true; try { sel.removeAllRanges(); } catch (e) {} };
    const addHl = (color, note) => {
      if (old) { unpaintHl(old); marks.hl = marks.hl.filter(h => h !== old); }
      const h = { id: uid(), cfi, text, color, note: note || '', by: who, at: Date.now() };
      marks.hl.push(h); paintHl(h); saveMarks(); done();
    };
    for (const c of Object.keys(HL)) P.append(el('button', { type: 'button', className: 'sw', style: `background:${HL[c]}`, ariaLabel: 'Highlight ' + c, onclick: () => addHl(c, old && old.note) }));
    P.append(el('button', { type: 'button', textContent: 'Note', onclick: () => { const n = prompt('Your note', (old && old.note) || ''); if (n !== null) addHl((old && old.color) || 'yellow', n.trim()); } }));
    if (!/\s/.test(text)) P.append(el('button', { type: 'button', textContent: 'Define', onclick: () => { done(); define(text); } }));
    P.append(el('button', { type: 'button', textContent: 'Copy', onclick: async () => { try { await navigator.clipboard.writeText(text); } catch (e) {} done(); } }));
    P.append(el('button', { type: 'button', textContent: 'Sentence', onclick: () => showPop(d, fr, widen(d, r, 'sentence')) }));
    P.append(el('button', { type: 'button', textContent: 'Paragraph', onclick: () => showPop(d, fr, widen(d, r, 'paragraph')) }));
    if (old) P.append(el('button', { type: 'button', textContent: 'Remove', onclick: () => { unpaintHl(old); marks.hl = marks.hl.filter(h => h !== old); saveMarks(); done(); } }));
    P.hidden = false;
    const rc = r.getBoundingClientRect(), vw = window.innerWidth;
    const w = P.offsetWidth, h = P.offsetHeight;
    const top = rc.top + fr.top > 120 + h ? rc.top + fr.top - h - 10 : rc.bottom + fr.top + 12;
    P.style.top = clamp(top, 8, window.innerHeight - h - 8) + 'px';
    P.style.left = clamp(rc.left + fr.left + rc.width / 2 - w / 2, 8, vw - w - 8) + 'px';
  }
  function selectAt(x, y) {
    const f = $('#rd-epub-box iframe');
    if (!f || !f.contentDocument) return false;
    const fr = f.getBoundingClientRect(), d = f.contentDocument;
    const r = wordRange(d, x - fr.left, y - fr.top);
    if (!r) return false;
    showPop(d, fr, r);
    return true;
  }

  async function openEpub(rec, id, title, opts = {}) {
    const lib = await loadEpub();
    const book = lib();
    await book.open(await rec.blob.arrayBuffer(), 'binary');
    epub = book; bookId = id; mode = 'epub';
    const p = prefs();
    fontPct = p.epubFont || 110;
    who = opts.who || '';
    cbMarks = opts.onMarks || null; cbPos = opts.onPos || null; lastPosAt = Date.now(); lastLoc = null;
    const mine = (p.marks || {})[id], theirs = opts.marks;
    marks = { hl: [], bm: [] };
    for (const src of [mine, theirs]) for (const k of ['hl', 'bm']) for (const m of (src && src[k]) || []) if (!marks[k].some(x => x.id === m.id)) marks[k].push(m);
    $('#rd-title').textContent = title;
    dlg().dataset.mode = 'epub';
    $('#rd-pos').textContent = 'Opening…'; $('#rd-folio').textContent = '';
    $('#rd-range').max = 100; $('#rd-range').value = 0;
    closeSheet(); hidePop(); curlEnd();
    chrome(true);
    zoomOpen(dlg(), opts.from);
    applyMargin();
    const box = $('#rd-epub-box');
    box.replaceChildren(); $('#rd-under').replaceChildren(); showUnder(false);
    rendition = book.renderTo(box, { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });
    registerThemes(rendition);
    rendition.hooks.content.register(tameImages);
    setTheme(p.theme);
    rendition.themes.fontSize(fontPct + '%');
    rendition.on('relocated', loc => {
      const cfi = loc && loc.start && loc.start.cfi;
      if (cfi) savePrefs(q => { (q.pages = q.pages || {})[id] = cfi; (q.at = q.at || {})[id] = Date.now(); });
      hidePop();
      folio(loc);
      if (!flipping && (prefs().turn || 'curl') === 'curl') setTimeout(() => prepUnder(1), 250);
    });
    for (const h of marks.hl) paintHl(h);
    const local = (p.pages || {})[id], localAt = (p.at || {})[id] || 0;
    const start = opts.startCfi && (opts.startAt || 0) > localAt ? opts.startCfi : local;
    await rendition.display(typeof start === 'string' ? start : undefined);
    book.ready.then(() => book.locations.generate(1000)).then(() => { if (rendition) folio(rendition.currentLocation()); }).catch(() => {});
  }
  function closeEpub() {
    try { flushPos(); } catch (e) {}
    try { if (under) under.destroy(); if (rendition) rendition.destroy(); if (epub) epub.destroy(); } catch (e) {}
    under = null; underFor = null; underBusy = null;
    rendition = null; epub = null; lastLoc = null; cbPos = null; cbMarks = null;
    try { closeSheet(); hidePop(); curlEnd(); } catch (e) {}
  }

  async function open(id, title, opts) {
    const rec = await store.get(id);
    if (!rec) throw new Error('This book is not on this phone yet.');
    if (isEpub(rec)) return openEpub(rec, id, title, opts);
    mode = 'pdf';
    dlg().dataset.mode = 'pdf';
    const lib = await loadLib();
    pdf = await lib.getDocument({ data: await rec.blob.arrayBuffer() }).promise;
    bookId = id; zoom = 1;
    const p = prefs();
    setTheme(p.theme);
    $('#rd-title').textContent = title;
    chrome(true);
    zoomOpen(dlg(), (opts || {}).from);
    await show((p.pages || {})[id] || 1);
  }
  function close() {
    token++;
    closeEpub();
    if (pdf) { pdf.destroy(); pdf = null; }
    if (dlg().open) dlg().close();
  }

  // EPUB pages are drawn in an iframe that swallows touches, so a transparent layer on top handles swipes and edge taps.
  const gest = $('#rd-gest');
  for (const t of ['contextmenu', 'selectstart', 'dragstart']) gest.addEventListener(t, e => e.preventDefault());
  let gx = 0, gy = 0;
  const zone = x => { const r = gest.getBoundingClientRect(), f = (x - r.left) / r.width; if (!rendition) return; if (f < .25) flip(-1); else if (f > .75) flip(1); else chrome(); };
  let held = null, longDone = false;
  gest.addEventListener('touchstart', e => {
    gx = e.touches[0].clientX; gy = e.touches[0].clientY; longDone = false;
    if (!pop().hidden) { hidePop(); longDone = true; return; }
    clearTimeout(held);
    held = setTimeout(() => { if (rendition && selectAt(gx, gy)) { longDone = true; try { navigator.vibrate && navigator.vibrate(12); } catch (err) {} } }, 480);
  }, { passive: true });
  gest.addEventListener('touchmove', e => { const t = e.touches[0]; if (Math.abs(t.clientX - gx) > 10 || Math.abs(t.clientY - gy) > 10) clearTimeout(held); }, { passive: true });
  gest.addEventListener('touchend', e => {
    e.preventDefault();
    clearTimeout(held);
    if (longDone) return;
    const t = e.changedTouches[0], dx = t.clientX - gx, dy = t.clientY - gy;
    if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.2) flip(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) zone(t.clientX);
  });
  gest.addEventListener('click', e => { if (!pop().hidden) return hidePop(); zone(e.clientX); });

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
  $('#rd-range').oninput = e => {
    if (mode === 'epub') { if (epub && epub.locations.length()) rendition.display(epub.locations.cfiFromPercentage(+e.target.value / 100)); return; }
    show(+e.target.value);
  };
  const font = d => { fontPct = Math.max(80, Math.min(220, fontPct + d)); savePrefs(p => { p.epubFont = fontPct; }); if (rendition) rendition.themes.fontSize(fontPct + '%'); if (under) under.themes.fontSize(fontPct + '%'); underFor = null; };
  $('#rd-zin').onclick = () => { if (mode === 'epub') return font(10); zoom = Math.min(3, +(zoom + .5).toFixed(1)); show(n); };
  $('#rd-zout').onclick = () => { if (mode === 'epub') return font(-10); zoom = Math.max(1, +(zoom - .5).toFixed(1)); show(n); };
  dlg().addEventListener('close', () => { token++; closeEpub(); if (pdf) { pdf.destroy(); pdf = null; } });
  dlg().addEventListener('keydown', e => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    if (mode === 'epub' && rendition) flip(d); else turn(d);
  });
  window.addEventListener('resize', () => { if (pdf && mode === 'pdf') show(n); });

  // Title, author, description and cover page that the EPUB file itself carries (null for other files).
  async function meta(blob) {
    try {
      const lib = await loadEpub();
      const book = lib();
      await book.open(await blob.arrayBuffer(), 'binary');
      const m = await book.loaded.metadata;
      let cover = null;
      try { const u = await book.coverUrl(); if (u) cover = await (await fetch(u)).blob(); } catch (e) {}
      book.destroy();
      const clean = t => (t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return { title: clean(m.title), author: clean(m.creator), description: clean(m.description), publisher: clean(m.publisher), published: clean(m.pubdate), cover };
    } catch (e) { return null; }
  }

  return { meta, has: async id => !!(await store.get(id).catch(() => null)), info: id => store.get(id).catch(() => null), put: store.put, remove: id => store.remove(id).catch(() => {}), open, close };
})();
