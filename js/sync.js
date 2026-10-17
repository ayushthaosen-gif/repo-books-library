// Optional cloud sync through a free Supabase project (REST + email/password sign-in, no SDK).
// The browser copy stays the working copy; this pushes changes up and pulls other devices' changes down.
const Sync = (() => {
  const KEY = 'books-library-sync-v1';
  const preset = window.BOOKS_CONFIG || {};
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  const save = () => localStorage.setItem(KEY, JSON.stringify(cfg));
  let running = false, again = false, timer = null, onStatus = () => {};

  const url = () => (cfg.url || preset.supabaseUrl || '').replace(/\/+$/, '');
  const key = () => cfg.key || preset.supabaseAnonKey || '';
  const status = (state, msg) => onStatus({ state, msg });

  async function authCall(grant, body) {
    const r = await fetch(`${url()}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST', headers: { apikey: key(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'Sign-in failed (' + r.status + ')');
    cfg.session = { access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
    save();
  }
  async function token() {
    if (!cfg.session) throw new Error('Not signed in');
    if (Date.now() > cfg.session.expires) await authCall('refresh_token', { refresh_token: cfg.session.refresh });
    return cfg.session.access;
  }
  async function rest(path, opts = {}) {
    const r = await fetch(`${url()}/rest/v1/${path}`, {
      ...opts,
      headers: { apikey: key(), Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (!r.ok) throw new Error('Sync failed (' + r.status + '): ' + (await r.text()).slice(0, 120));
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }

  // With a family library, books are saved under the library owner's id so everybody reads and writes the same set.
  async function resolveOwner() {
    if (cfg.owner !== undefined) return;
    try {
      const rows = await rest('family?select=owner&member_email=eq.' + encodeURIComponent((cfg.email || '').toLowerCase()) + '&limit=1');
      cfg.owner = rows && rows[0] ? rows[0].owner : '';
    } catch (e) { cfg.owner = ''; }
    save();
  }
  const toRow = b => ({ ...(cfg.owner ? { user_id: cfg.owner } : {}), id: b.id, data: b, updated_at: b.updated, deleted: !!b.deleted });
  const fromRow = r => ({ ...r.data, id: r.id, updated: r.data.updated || r.updated_at, ...(r.deleted ? { deleted: true } : {}) });

  async function runOnce() {
    await resolveOwner();
    // Pull (with a minute of overlap; merging is idempotent), then push what is newer locally.
    const since = cfg.lastPull ? new Date(Date.parse(cfg.lastPull) - 60000).toISOString() : null;
    const rows = await rest('books?select=id,data,updated_at,deleted&order=updated_at.asc&limit=5000' + (since ? `&updated_at=gt.${encodeURIComponent(since)}` : ''));
    Store.mergeRemote(rows.map(fromRow));
    if (rows.length) cfg.lastPull = rows[rows.length - 1].updated_at;
    else if (!cfg.lastPull) cfg.lastPull = new Date(0).toISOString();
    const dirty = Store.changedSince(cfg.lastPush);
    if (dirty.length) {
      await rest('books?on_conflict=user_id,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(dirty.map(toRow)) });
      cfg.lastPush = dirty.reduce((m, b) => (b.updated > m ? b.updated : m), '');
    }
    cfg.pulled = true;
    save();
  }
  async function now() {
    if (!Sync.configured()) return;
    if (running) { again = true; return; }
    running = true;
    status('busy', 'Syncing…');
    try {
      do { again = false; await runOnce(); } while (again);
      status('ok', 'Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (cfg.owner ? ' (family library)' : ''));
    } catch (e) {
      status('error', navigator.onLine ? e.message : 'Offline. Changes will sync later.');
    } finally { running = false; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(now, 1500); }

  const Sync = {
    configured: () => !!(url() && key() && cfg.session),
    hasPulled: () => !!cfg.pulled,
    settings: () => ({ url: url(), key: key(), email: cfg.email || '' }),
    async signIn(u, k, email, password) {
      cfg = { ...cfg, url: u.trim(), key: k.trim(), email: email.trim(), lastPull: null, lastPush: null, pulled: false, owner: undefined };
      await authCall('password', { email: cfg.email, password });
      await now();
    },
    signOut() { cfg = { url: cfg.url, key: cfg.key, email: cfg.email }; save(); status('off', 'Sync is off'); },
    api: rest,
    // Calls the family's Drive function on Supabase with the signed-in login.
    async drive(qs) {
      const r = await fetch(`${url()}/functions/v1/drive?${qs}`, { headers: { apikey: key(), Authorization: 'Bearer ' + await token() } });
      if (!r.ok) {
        let m = '';
        try { m = (await r.clone().json()).error; } catch (e) {}
        throw new Error(r.status === 404 && !m ? 'The Drive function is not set up yet (see docs/DRIVE.md).' : m || 'Drive request failed (' + r.status + ')');
      }
      return r;
    },
    now,
    onStatus(f) { onStatus = f; },
    start() {
      Store.onChange(() => { if (Sync.configured()) schedule(); });
      addEventListener('online', now);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) now(); });
      if (Sync.configured()) now(); else status('off', 'Sync is off');
    },
  };
  return Sync;
})();
