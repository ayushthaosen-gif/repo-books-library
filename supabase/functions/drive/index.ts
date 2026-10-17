// Reads a private Google Drive folder for signed-in family members, using a Google service account.
// The robot's key is a Supabase secret, never in the app. Only people with a library login can call this.
//
// GET ?action=list           -> [{ id, name, size }] for every PDF in the folder (and its sub-folders)
// GET ?action=file&id=FILEID -> the PDF itself (only if it is inside the folder)
//
// Secrets: GOOGLE_SERVICE_ACCOUNT (the key file's JSON), DRIVE_FOLDER_ID, optional OWNER_EMAIL.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const b64u = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let cached: { token: string; exp: number } | null = null;
async function googleToken(env: Record<string, string | undefined>, fetchFn: typeof fetch) {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT || '{}');
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT is not set');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const r = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + b64u(sig) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Google sign-in failed: ' + (j.error_description || j.error));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}

// Only signed-in people who are the owner or listed as family may use this.
async function allowed(req: Request, env: Record<string, string | undefined>, fetchFn: typeof fetch) {
  const auth = req.headers.get('authorization') || '';
  const apikey = req.headers.get('apikey') || env.SUPABASE_ANON_KEY || '';
  const u = await fetchFn(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  if (!u.ok) return false;
  const user = await u.json();
  if (!user || !user.id) return false;
  if (env.OWNER_EMAIL && (user.email || '').toLowerCase() === env.OWNER_EMAIL.toLowerCase()) return true;
  const f = await fetchFn(`${env.SUPABASE_URL}/rest/v1/family?select=owner&limit=1`, { headers: { Authorization: auth, apikey } });
  if (!f.ok) return false;
  const rows = await f.json();
  return Array.isArray(rows) && rows.length > 0;
}

const drive = (path: string, token: string, fetchFn: typeof fetch) =>
  fetchFn('https://www.googleapis.com/drive/v3/' + path, { headers: { Authorization: 'Bearer ' + token } });

async function listPdfs(folder: string, token: string, fetchFn: typeof fetch) {
  const out: { id: string; name: string; size: number }[] = [];
  const queue = [folder], seen = new Set<string>();
  while (queue.length && seen.size < 40) {
    const f = queue.shift()!;
    seen.add(f);
    let page = '';
    do {
      const q = encodeURIComponent(`'${f}' in parents and trashed = false`);
      const r = await drive(`files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${page}`, token, fetchFn);
      if (!r.ok) throw new Error('Drive said ' + r.status + '. Is the folder shared with the robot?');
      const j = await r.json();
      for (const x of j.files || []) {
        if (x.mimeType === 'application/vnd.google-apps.folder') queue.push(x.id);
        else if (x.mimeType === 'application/pdf' || /\.pdf$/i.test(x.name)) out.push({ id: x.id, name: x.name, size: +x.size || 0 });
      }
      page = j.nextPageToken ? '&pageToken=' + encodeURIComponent(j.nextPageToken) : '';
    } while (page);
  }
  return out;
}

// A file may only be fetched if its parent chain leads to the shared folder.
async function insideFolder(id: string, folder: string, token: string, fetchFn: typeof fetch) {
  let cur = id;
  for (let i = 0; i < 8; i++) {
    const r = await drive(`files/${encodeURIComponent(cur)}?fields=parents&supportsAllDrives=true`, token, fetchFn);
    if (!r.ok) return false;
    const parents = ((await r.json()).parents || []) as string[];
    if (parents.includes(folder)) return true;
    if (!parents.length) return false;
    cur = parents[0];
  }
  return false;
}

export async function handler(req: Request, env: Record<string, string | undefined> = (globalThis as any).Deno?.env.toObject() || {}, fetchFn: typeof fetch = fetch) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!(await allowed(req, env, fetchFn))) return json({ error: 'Not allowed' }, 401);
    const folder = env.DRIVE_FOLDER_ID;
    if (!folder) return json({ error: 'DRIVE_FOLDER_ID is not set' }, 500);
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const token = await googleToken(env, fetchFn);
    if (action === 'list') return json(await listPdfs(folder, token, fetchFn));
    if (action === 'file') {
      const id = url.searchParams.get('id') || '';
      if (!/^[\w-]{10,}$/.test(id) || !(await insideFolder(id, folder, token, fetchFn))) return json({ error: 'File not found in the folder' }, 404);
      const r = await drive(`files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, token, fetchFn);
      if (!r.ok) return json({ error: 'Drive said ' + r.status }, 502);
      return new Response(r.body, { headers: { ...CORS, 'Content-Type': 'application/pdf', ...(r.headers.get('content-length') ? { 'Content-Length': r.headers.get('content-length')! } : {}) } });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

if ((globalThis as any).Deno) (globalThis as any).Deno.serve((req: Request) => handler(req));
