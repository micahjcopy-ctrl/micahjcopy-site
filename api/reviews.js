// /api/reviews  —  Vercel serverless function (Node, zero npm deps)
// ---------------------------------------------------------------------------
// POST            (public)  create a review          -> stored in Supabase
// GET  ?public=1  (public)  list APPROVED reviews     -> for rendering on the site
// GET             (admin)   list ALL reviews          -> requires Bearer REVIEWS_ADMIN_TOKEN
// PATCH           (admin)   update a review's status  -> requires Bearer REVIEWS_ADMIN_TOKEN
//
// Storage: Supabase via its REST (PostgREST) endpoint, called with the
// service-role key. The key lives ONLY here on the server, never in the browser.
//
// Env vars (Vercel project settings):
//   SUPABASE_URL                 e.g. https://xxxx.supabase.co   (already set for the funnel)
//   SUPABASE_SERVICE_ROLE_KEY    the service_role secret          (already set for the funnel)
//   REVIEWS_ADMIN_TOKEN          any long random string you pick  (gates the dashboard)
//
// If Supabase env vars are missing the function runs in graceful DEMO mode:
// POST returns ok (logs the review), admin GET returns an empty list. Nothing crashes.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_TOKEN  = process.env.REVIEWS_ADMIN_TOKEN;
const TABLE = 'reviews';
const CONFIGURED = !!(SUPABASE_URL && SUPABASE_KEY);
const VALID_STATUS = ['new', 'approved', 'featured', 'archived'];

function sb(path, init) {
  init = init || {};
  return fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, init, {
    headers: Object.assign({
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json'
    }, init.headers || {})
  }));
}

function readBody(req) {
  var b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return {};
}

function str(v, max) { return (v == null ? '' : String(v)).trim().slice(0, max); }

function isAdmin(req) {
  var h = req.headers['authorization'] || req.headers['Authorization'] || '';
  var token = h.replace(/^Bearer\s+/i, '').trim();
  return !!ADMIN_TOKEN && token === ADMIN_TOKEN;
}

module.exports = async function handler(req, res) {
  const method = req.method;

  try {
    // ----- POST: create a review (public) -----
    if (method === 'POST') {
      const b = readBody(req);
      const name = str(b.name, 120) || 'Anonymous';
      let rating = parseInt(b.rating, 10);
      if (!(rating >= 1 && rating <= 5)) rating = null;

      const row = {
        name: name,
        title: str(b.title, 160),
        company: str(b.company, 160),
        website: str(b.website, 300),
        email: str(b.email, 200),
        rating: rating,
        relationship: str(b.relationship, 4000),
        experience: str(b.experience, 4000),
        quality: str(b.quality, 4000),
        recommend: str(b.recommend, 4000),
        testimonial: str(b.testimonial, 6000),
        consent: !!b.consent,
        status: 'new'
      };

      if (!row.testimonial && !row.relationship && !row.experience && !row.quality && !row.recommend) {
        return res.status(400).json({ ok: false, error: 'empty' });
      }
      if (!CONFIGURED) { console.log('[reviews] DEMO mode — not stored:', JSON.stringify(row)); return res.status(200).json({ ok: true, demo: true }); }

      const r = await sb(TABLE, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (!r.ok) { console.error('[reviews] insert failed', r.status, await r.text()); return res.status(500).json({ ok: false, error: 'store_failed' }); }
      return res.status(200).json({ ok: true });
    }

    // ----- GET ?public=1: reviews for the site (public) -----
    // Shows every review the reviewer consented to publish, newest first.
    // The ONLY thing hidden is anything explicitly archived from the admin
    // dashboard (the spam/abuse escape hatch). No manual approval step.
    // Email is never selected here, so reviewers' private emails stay private.
    if (method === 'GET' && req.query && (req.query.public === '1' || req.query.public === 'true')) {
      if (!CONFIGURED) return res.status(200).json({ ok: true, reviews: [] });
      const q = TABLE + '?select=name,title,company,website,rating,testimonial,created_at'
              + '&consent=is.true&status=neq.archived&order=created_at.desc';
      const r = await sb(q, { method: 'GET' });
      const data = r.ok ? await r.json() : [];
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ ok: true, reviews: data });
    }

    // ----- everything below is admin-only -----
    if (method === 'GET' || method === 'PATCH') {
      if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

      if (method === 'GET') {
        if (!CONFIGURED) return res.status(200).json({ ok: true, demo: true, reviews: [] });
        const r = await sb(TABLE + '?select=*&order=created_at.desc', { method: 'GET' });
        if (!r.ok) return res.status(500).json({ ok: false, error: 'read_failed' });
        return res.status(200).json({ ok: true, reviews: await r.json() });
      }

      // PATCH: { id, status }
      const b = readBody(req);
      const id = str(b.id, 64);
      const status = str(b.status, 20);
      if (!id || VALID_STATUS.indexOf(status) === -1) return res.status(400).json({ ok: false, error: 'bad_request' });
      if (!CONFIGURED) return res.status(200).json({ ok: true, demo: true });
      const r = await sb(TABLE + '?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: status }) });
      if (!r.ok) return res.status(500).json({ ok: false, error: 'update_failed' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[reviews] unhandled', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
};
