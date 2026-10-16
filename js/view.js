// Read-only view of a shared library. Needs only the link's token; it never signs in and cannot write.
const $ = s => document.querySelector(s);
const STATUS_LABEL = { unread: 'Unread', reading: 'Reading', read: 'Read' };
let items = [], tab = 'library';

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const kind = b => (b.kind === 'game' ? 'games' : 'library');
  $('#count-library').textContent = items.filter(b => kind(b) === 'library').length;
  $('#count-games').textContent = items.filter(b => kind(b) === 'games').length;
  $('#tab-library').classList.toggle('active', tab === 'library');
  $('#tab-games').classList.toggle('active', tab === 'games');
  const shown = items.filter(b => kind(b) === tab && (!q || (b.title + ' ' + (b.author || '')).toLowerCase().includes(q)));
  const ul = $('#list');
  ul.replaceChildren();
  for (const b of shown) {
    const li = document.createElement('li');
    li.style.cursor = 'default';
    const img = Object.assign(document.createElement('img'), { src: b.cover || genericCover(b), alt: '', loading: 'lazy' });
    if (b.cover) img.onerror = () => { img.onerror = null; img.src = genericCover(b); };
    const info = document.createElement('div');
    info.append(Object.assign(document.createElement('div'), { className: 't', textContent: b.title }));
    if (b.author) info.append(Object.assign(document.createElement('div'), { className: 'a', textContent: b.author }));
    const badges = document.createElement('div');
    badges.className = 'badges';
    const tags = tab === 'games' ? [b.players && b.players + ' players', b.playtime] : [STATUS_LABEL[b.status] || 'Unread'];
    for (const t of tags) if (t) badges.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: t }));
    if (badges.childElementCount) info.append(badges);
    li.append(img, info);
    ul.append(li);
  }
  $('#msg').hidden = shown.length > 0 || !items.length ? true : false;
  if (!shown.length && items.length) { $('#msg').hidden = false; $('#msg').textContent = 'Nothing here.'; }
}

async function load() {
  const token = location.hash.slice(1);
  const cfg = window.BOOKS_CONFIG || {};
  if (!/^[0-9a-f]{48}$/.test(token)) { $('#msg').textContent = 'This link is not valid.'; return; }
  try {
    const r = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/shared_library', {
      method: 'POST',
      headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) throw new Error('status ' + r.status);
    items = await r.json();
  } catch (e) { $('#msg').textContent = 'Could not load the library. Check your connection and try again.'; return; }
  if (!items.length) { $('#msg').textContent = 'Nothing to show. The link may have been turned off.'; return; }
  $('#msg').hidden = true;
  render();
}
$('#tab-library').onclick = () => { tab = 'library'; render(); };
$('#tab-games').onclick = () => { tab = 'games'; render(); };
$('#q').oninput = render;
load();
addEventListener('hashchange', () => location.reload());
