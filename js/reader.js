// Book PDFs kept on this phone (IndexedDB) and a page-turning reader styled after Apple Books.
// pdf.js is loaded the first time a book is opened, so it costs nothing until then.
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

  const dlg = () => $('#reader-dialog');
  let pdf = null, bookId = '', n = 1, zoom = 1, token = 0, theme = 'light';
  const THEMES = ['light', 'sepia', 'night'];
  const KEY = 'books-library-reader';
  const prefs = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const savePrefs = f => { try { const p = prefs(); f(p); localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} };

  function setTheme(t) {
    theme = THEMES.includes(t) ? t : 'light';
    dlg().dataset.theme = theme;
    savePrefs(p => { p.theme = theme; });
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

  async function open(id, title) {
    const rec = await store.get(id);
    if (!rec) throw new Error('This PDF is not on this phone yet.');
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
  $('#rd-range').oninput = e => show(+e.target.value);
  $('#rd-zin').onclick = () => { zoom = Math.min(3, +(zoom + .5).toFixed(1)); show(n); };
  $('#rd-zout').onclick = () => { zoom = Math.max(1, +(zoom - .5).toFixed(1)); show(n); };
  dlg().addEventListener('close', () => { token++; if (pdf) { pdf.destroy(); pdf = null; } });
  dlg().addEventListener('keydown', e => { if (e.key === 'ArrowRight') turn(1); else if (e.key === 'ArrowLeft') turn(-1); });
  window.addEventListener('resize', () => { if (pdf) show(n); });

  return { has: async id => !!(await store.get(id).catch(() => null)), info: id => store.get(id).catch(() => null), put: store.put, remove: id => store.remove(id).catch(() => {}), open, close };
})();
