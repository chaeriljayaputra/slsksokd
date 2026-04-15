// Vercel serverless function: /api/testimonials
// Requires env vars on Vercel: GITHUB_TOKEN, TESTI_ADMIN_PASS
// Uses GitHub Contents API to read/write testimonials.json in this repo root.
const OWNER = 'chaeriljayaputra';
const REPO = 'slsksokd';
const PATH = 'testimonials.json';
const GITHUB_API = 'https://api.github.com';

async function getFile() {
  const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${PATH}`, {
    headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
  });
  if (res.status === 404) return { content: null, sha: null };
  if (!res.ok) throw new Error(`GitHub get error: ${res.status}`);
  const json = await res.json();
  const content = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8') || '[]');
  return { content, sha: json.sha };
}

async function putFile(contentObj, sha, message = 'chore: update testimonials.json') {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(contentObj, null, 2)).toString('base64'),
  };
  if (sha) body.sha = sha;
  const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${PATH}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub put error ${res.status}: ${t}`);
  }
  return await res.json();
}

function requireAdmin(req) {
  const pass = req.headers['x-admin-pass'] || '';
  if (!process.env.TESTI_ADMIN_PASS) return false;
  return pass === process.env.TESTI_ADMIN_PASS;
}

module.exports = async (req, res) => {
  try {
    // Route detection: /api/testimonials or /api/testimonials/verify or /api/testimonials/:id
    const url = req.url || '';
    // Normalize
    if (req.method === 'GET' && (url === '/' || url === '' || !url.includes('/verify'))) {
      // GET: return testimonials (read)
      const { content } = await getFile().catch(() => ({ content: [] }));
      return res.status(200).json({ ok: true, data: content || [] });
    }

    // POST /api/testimonials with action=verify -> verify admin pass
    if (req.method === 'POST' && url.includes('/verify')) {
      if (!requireAdmin(req)) return res.status(401).json({ ok: false, error: 'invalid admin pass' });
      return res.status(200).json({ ok: true, message: 'admin verified' });
    }

    // POST create new testimonial (anon)
    if (req.method === 'POST' && !url.includes('/verify')) {
      const body = req.body || req.json || {};
      // Accept application/json or form-encoded body (Vercel passes JSON)
      const payload = typeof body === 'object' ? body : JSON.parse(body || '{}');
      const name = (payload.name || 'Anonim').toString().trim().slice(0, 60);
      const message = (payload.message || '').toString().trim().slice(0, 2000);
      if (!message) return res.status(400).json({ ok: false, error: 'message required' });

      const { content, sha } = await getFile().catch(() => ({ content: [], sha: null }));
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2,8);
      const item = { id, name, message, created_at: new Date().toISOString() };
      const newContent = Array.isArray(content) ? [item, ...content] : [item];
      await putFile(newContent, sha, `chore: add testimonial ${id}`);
      return res.status(201).json({ ok: true, data: item });
    }

    // PUT (edit) / DELETE (delete) require admin
    if ((req.method === 'PUT' || req.method === 'DELETE')) {
      if (!requireAdmin(req)) return res.status(401).json({ ok: false, error: 'invalid admin pass' });
      // Expect ID in query: /api/testimonials?id=abcdef
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const id = urlObj.searchParams.get('id') || (req.query && req.query.id);
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });

      const { content, sha } = await getFile().catch(() => ({ content: [], sha: null }));
      const arr = Array.isArray(content) ? content : [];
      const idx = arr.findIndex(i => i.id === id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'not found' });

      if (req.method === 'DELETE') {
        arr.splice(idx, 1);
        await putFile(arr, sha, `chore: delete testimonial ${id}`);
        return res.status(200).json({ ok: true, id });
      } else {
        // PUT: update message/name
        const payload = req.body || req.json || {};
        const p = typeof payload === 'object' ? payload : JSON.parse(payload || '{}');
        const name = p.name ? p.name.toString().trim().slice(0,60) : arr[idx].name;
        const message = p.message ? p.message.toString().trim().slice(0,2000) : arr[idx].message;
        arr[idx] = { ...arr[idx], name, message, updated_at: new Date().toISOString() };
        await putFile(arr, sha, `chore: edit testimonial ${id}`);
        return res.status(200).json({ ok: true, data: arr[idx] });
      }
    }

    return res.status(405).json({ ok: false, error: 'method not allowed' });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: 'internal error', detail: err.message });
  }
};
