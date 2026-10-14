// /api/crm  —  Cold-call CRM backend (Vercel serverless function, Node, zero npm deps)
// ---------------------------------------------------------------------------
// Front end: /crm  (crm.html + crm.js + crm.css)
// Storage:   Supabase, via its REST (PostgREST) endpoint with the service-role
//            key. Tables are created by crm.sql (run once in the
//            Supabase SQL editor). The key lives ONLY here, never in the browser.
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL                 already set for the funnel
//   SUPABASE_SERVICE_ROLE_KEY    already set for the funnel
//   REVIEWS_ADMIN_TOKEN          already set — logs you in as "micah"
//   CRM_USERS                    extra logins, "name:pin,name:pin"
//                                e.g.  hayden:<pin>  (4+ characters; a PIN is fine
//                                because 5 wrong attempts freeze logins for 15 min)
//
// Every request carries  Authorization: Bearer <pin-or-token>.  It picks the
// user; the user's name is stamped on every call they log.
//
// Routes (all on this one function, picked by ?op=):
//   GET  op=bootstrap           settings + stats + first page of the queue
//   GET  op=queue&limit=        the next leads to dial, in order
//   GET  op=leads&q=&stage=&sort=&dir=&limit=&offset=
//   GET  op=lead&id=            one lead + its call history
//   GET  op=activity&limit=     latest logged calls, newest first
//   GET  op=stats
//   GET  op=export              every lead as CSV
//   POST op=lead_create  {lead}
//   POST op=lead_update  {id, patch}
//   POST op=lead_delete  {id}
//   POST op=call         {lead_id, outcome, note, next_at, booked_at}
//   POST op=skip         {lead_id, hours}
//   POST op=import       {rows:[...], new_fields:[...]}
//   POST op=settings_save {settings}
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONFIGURED = !!(SUPABASE_URL && SUPABASE_KEY);
const TZ = 'America/New_York';

// ----------------------------------------------------------------- defaults
const DEFAULT_SETTINGS = {
  stages: [
    { key: 'new',        label: 'New',            color: 'stone' },
    { key: 'contacted',  label: 'Contacted',      color: 'blue' },
    { key: 'follow_up',  label: 'Follow-up',      color: 'gold' },
    { key: 'booked',     label: 'Booked',         color: 'green' },
    { key: 'client',     label: 'Client',         color: 'oxblood' },
    { key: 'not_now',    label: 'Not interested', color: 'grey' },
    { key: 'dnc',        label: 'Do not call',    color: 'red' }
  ],
  // stages that drop a lead out of the dial queue
  terminal_stages: ['booked', 'client', 'not_now', 'dnc'],
  // user-added columns: {key, label, type: text|number|date|select|checkbox|url, options:[], in_queue:bool}
  fields: [],
  // built-in columns shown in the Leads table, in order
  columns: ['business', 'owner', 'phone', 'town', 'category', 'stage', 'next_at', 'last_called_at', 'call_count'],
  // how long before a no-answer / voicemail comes back around (days)
  retry_days: { no_answer: 1, voicemail: 2 },
  booking_url: 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0A_t4giLYdL8SPfgRt-xxpt_SlaOD0WBqVnDwwhwn6r8gs9VZQWhJy169st8PfEg9gOwg9gOc-'
};

// outcome → what happens to the lead. `stage: null` means "leave it alone".
const OUTCOMES = {
  no_answer:      { stage: null,        retry: 'no_answer' },
  voicemail:      { stage: null,        retry: 'voicemail' },
  contacted:      { stage: 'contacted' },
  follow_up:      { stage: 'follow_up', needs: 'next_at' },
  booked:         { stage: 'booked',    needs: 'booked_at' },
  not_interested: { stage: 'not_now' },
  dnc:            { stage: 'dnc' }
};

const LEAD_FIELDS = ['business', 'owner', 'phone', 'phone_display', 'email', 'town', 'state', 'category',
  'website', 'reviews', 'stage', 'notes', 'custom', 'next_at', 'booked_at', 'source'];
const SORTABLE = ['business', 'owner', 'town', 'category', 'stage', 'next_at', 'last_called_at', 'call_count',
  'created_at', 'updated_at', 'reviews', 'booked_at'];
const COLUMN_SELECT = 'id,business,owner,phone,phone_display,email,town,state,category,website,reviews,stage,notes,custom,'
  + 'next_at,last_called_at,last_outcome,call_count,booked_at,source,created_by,created_at,updated_at';

// ----------------------------------------------------------------- helpers
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

async function sbJson(path, init) {
  const r = await sb(path, init);
  const text = await r.text();
  if (!r.ok) {
    const err = new Error('supabase ' + r.status + ' ' + path.slice(0, 80) + ' ' + text.slice(0, 300));
    err.status = r.status;
    throw err;
  }
  return { data: text ? JSON.parse(text) : null, headers: r.headers };
}

function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return {};
}

function str(v, max) { return (v == null ? '' : String(v)).trim().slice(0, max || 500); }
function slug(s) { return str(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }

function normPhone(raw) {
  let d = str(raw, 40).replace(/[^\d]/g, '');
  if (d.length === 10) d = '1' + d;               // US without country code
  if (d.length < 7 || d.length > 15) return '';    // not a phone
  return d;
}

function isoOrNull(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : new Date(t).toISOString();
}

function addDays(d, days) { return new Date(d.getTime() + days * 86400000); }

// midnight today in New York, as an ISO instant (for "calls today")
function tzOffsetMinutes(date, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const o = {}; p.forEach(x => { o[x.type] = x.value; });
  const asUTC = Date.UTC(+o.year, +o.month - 1, +o.day, (+o.hour) % 24, +o.minute, +o.second);
  return (asUTC - date.getTime()) / 60000;
}
function todayStartIso(tz) {
  const now = new Date();
  const off = tzOffsetMinutes(now, tz);
  const local = new Date(now.getTime() + off * 60000);
  const midnightLocalAsUTC = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const off2 = tzOffsetMinutes(new Date(midnightLocalAsUTC), tz);
  return new Date(midnightLocalAsUTC - off2 * 60000).toISOString();
}

// PostgREST value quoting for filters (commas, dots, parens need quotes)
function pgVal(v) { return '"' + String(v).replace(/["\\]/g, '') + '"'; }
function inList(arr) { return '(' + arr.map(pgVal).join(',') + ')'; }

function contentRangeTotal(headers) {
  const cr = headers.get('content-range') || '';
  const m = cr.match(/\/(\d+|\*)$/);
  return m && m[1] !== '*' ? parseInt(m[1], 10) : null;
}

function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ----------------------------------------------------------------- auth
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && A.length > 0 && crypto.timingSafeEqual(A, B);
}

function users() {
  const list = [];
  if (process.env.REVIEWS_ADMIN_TOKEN) list.push({ name: process.env.CRM_OWNER_NAME || 'micah', token: process.env.REVIEWS_ADMIN_TOKEN });
  (process.env.CRM_USERS || '').split(',').forEach(pair => {
    const i = pair.indexOf(':');
    if (i < 1) return;
    const name = slug(pair.slice(0, i)), token = pair.slice(i + 1).trim();
    if (name && token.length >= 4) list.push({ name, token });
  });
  return list;
}

function bearer(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  return h.replace(/^Bearer\s+/i, '').trim();
}

function matchUser(token) {
  for (const u of users()) if (safeEqual(token, u.token)) return { name: u.name };
  return null;
}

// Brute-force lockout: short PINs are allowed as logins, so after LOCK_MAX wrong
// attempts inside LOCK_WINDOW the whole login is frozen for LOCK_MS. State lives
// in crm_settings (key auth_lock) because serverless instances share nothing.
const LOCK_KEY = 'auth_lock', LOCK_MAX = 5, LOCK_WINDOW_MS = 15 * 60000, LOCK_MS = 15 * 60000;
async function lockState() {
  try { const { data } = await sbJson('crm_settings?select=value&key=eq.' + LOCK_KEY); return data && data[0] ? data[0].value || {} : {}; }
  catch (e) { return {}; }
}
async function noteFailure() {
  const now = Date.now(), s = await lockState();
  const inWindow = s.first && now - s.first < LOCK_WINDOW_MS;
  const fails = inWindow ? (s.fails || 0) + 1 : 1;
  const first = inWindow ? s.first : now;
  const until = fails >= LOCK_MAX ? now + LOCK_MS : 0;
  const row = { key: LOCK_KEY, value: { fails, first, until }, updated_at: new Date().toISOString() };
  try { await sbJson('crm_settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) }); }
  catch (e) { console.error('[crm] could not record failed login', e.message); }
  return until;
}

// ----------------------------------------------------------------- settings
function cleanSettings(input) {
  const s = Object.assign({}, DEFAULT_SETTINGS, input && typeof input === 'object' ? input : {});
  const stages = [];
  const seen = new Set();
  (Array.isArray(s.stages) ? s.stages : DEFAULT_SETTINGS.stages).forEach(st => {
    const key = slug(st && st.key), label = str(st && st.label, 40) || key;
    if (!key || seen.has(key)) return;
    seen.add(key);
    stages.push({ key, label, color: slug(st.color) || 'stone' });
  });
  if (!stages.length) stages.push(...DEFAULT_SETTINGS.stages);
  const stageKeys = stages.map(x => x.key);

  const fields = [];
  const fseen = new Set();
  (Array.isArray(s.fields) ? s.fields : []).forEach(f => {
    const key = slug(f && f.key || f && f.label);
    if (!key || fseen.has(key) || LEAD_FIELDS.includes(key)) return;
    fseen.add(key);
    const type = ['text', 'number', 'date', 'select', 'checkbox', 'url'].includes(f.type) ? f.type : 'text';
    const options = type === 'select' && Array.isArray(f.options) ? f.options.map(o => str(o, 60)).filter(Boolean).slice(0, 50) : [];
    fields.push({ key, label: str(f.label, 40) || key, type, options, in_queue: !!f.in_queue });
  });

  const columns = (Array.isArray(s.columns) ? s.columns : DEFAULT_SETTINGS.columns).map(c => slug(c)).filter(Boolean).slice(0, 40);
  const rd = s.retry_days && typeof s.retry_days === 'object' ? s.retry_days : {};
  const retry_days = {
    no_answer: Math.min(30, Math.max(0, Number(rd.no_answer) || 0)) || DEFAULT_SETTINGS.retry_days.no_answer,
    voicemail: Math.min(30, Math.max(0, Number(rd.voicemail) || 0)) || DEFAULT_SETTINGS.retry_days.voicemail
  };
  const terminal_stages = (Array.isArray(s.terminal_stages) ? s.terminal_stages : DEFAULT_SETTINGS.terminal_stages)
    .map(slug).filter(k => stageKeys.includes(k));
  return { stages, terminal_stages, fields, columns, retry_days, booking_url: str(s.booking_url, 500) };
}

async function loadSettings() {
  const { data } = await sbJson('crm_settings?select=value&key=eq.schema');
  return cleanSettings(data && data[0] ? data[0].value : null);
}

async function saveSettings(settings) {
  const row = { key: 'schema', value: settings, updated_at: new Date().toISOString() };
  await sbJson('crm_settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
  return settings;
}

// ----------------------------------------------------------------- leads
function cleanLead(input, settings, forCreate) {
  const b = input && typeof input === 'object' ? input : {};
  const out = {};
  if (forCreate || 'business' in b) out.business = str(b.business, 200);
  if (forCreate || 'owner' in b) out.owner = str(b.owner, 120);
  if (forCreate || 'phone' in b) { out.phone = normPhone(b.phone); out.phone_display = str(b.phone, 40); }
  if (forCreate || 'email' in b) out.email = str(b.email, 200);
  if (forCreate || 'town' in b) out.town = str(b.town, 120);
  if (forCreate || 'state' in b) out.state = str(b.state, 40);
  if (forCreate || 'category' in b) out.category = str(b.category, 120);
  if (forCreate || 'website' in b) out.website = str(b.website, 300);
  if (forCreate || 'reviews' in b) { const n = parseInt(b.reviews, 10); out.reviews = isNaN(n) ? null : n; }
  if (forCreate || 'notes' in b) out.notes = str(b.notes, 8000);
  if (forCreate || 'source' in b) out.source = str(b.source, 120);
  if ('stage' in b) { const k = slug(b.stage); if (settings.stages.some(s => s.key === k)) out.stage = k; }
  if ('next_at' in b) out.next_at = isoOrNull(b.next_at);
  if ('booked_at' in b) out.booked_at = isoOrNull(b.booked_at);
  if ('custom' in b && b.custom && typeof b.custom === 'object') {
    const c = {};
    settings.fields.forEach(f => {
      if (!(f.key in b.custom)) return;
      const v = b.custom[f.key];
      if (f.type === 'checkbox') c[f.key] = !!v;
      else if (f.type === 'number') { const n = Number(v); c[f.key] = v === '' || v == null || isNaN(n) ? null : n; }
      else c[f.key] = str(v, 1000);
    });
    out.custom = c;
  }
  return out;
}

async function getLead(id) {
  const { data } = await sbJson('crm_leads?select=' + COLUMN_SELECT + '&id=eq.' + encodeURIComponent(id) + '&limit=1');
  return data && data[0] ? data[0] : null;
}

async function queue(settings, limit) {
  const now = new Date().toISOString();
  const notTerminal = settings.terminal_stages.length ? '&stage=not.in.' + inList(settings.terminal_stages) : '';
  const due = (await sbJson('crm_leads?select=' + COLUMN_SELECT + notTerminal + '&next_at=lte.' + now
    + '&order=next_at.asc&limit=' + limit)).data || [];
  let fresh = [];
  if (due.length < limit) {
    fresh = (await sbJson('crm_leads?select=' + COLUMN_SELECT + '&stage=eq.new&next_at=is.null'
      + '&order=created_at.asc&limit=' + (limit - due.length))).data || [];
  }
  const seen = new Set();
  return due.concat(fresh).filter(l => !seen.has(l.id) && seen.add(l.id));
}

async function stats(settings) {
  const start = todayStartIso(TZ);
  const [calls, stageCounts, dueR, totalR] = await Promise.all([
    sbJson('crm_calls?select=outcome,by_user&at=gte.' + start),
    sbJson('crm_stage_counts?select=stage,n'),
    sb('crm_leads?select=id' + (settings.terminal_stages.length ? '&stage=not.in.' + inList(settings.terminal_stages) : '')
      + '&next_at=lte.' + new Date().toISOString() + '&limit=1', { headers: { Prefer: 'count=exact' } }),
    sb('crm_leads?select=id&limit=1', { headers: { Prefer: 'count=exact' } })
  ]);
  const today = { calls: 0, contacted: 0, follow_ups: 0, booked: 0, by_user: {} };
  (calls.data || []).forEach(c => {
    today.calls++;
    if (['contacted', 'follow_up', 'booked'].includes(c.outcome)) today.contacted++;
    if (c.outcome === 'follow_up') today.follow_ups++;
    if (c.outcome === 'booked') today.booked++;
    const u = c.by_user || '?';
    today.by_user[u] = today.by_user[u] || { calls: 0, contacted: 0, booked: 0 };
    today.by_user[u].calls++;
    if (['contacted', 'follow_up', 'booked'].includes(c.outcome)) today.by_user[u].contacted++;
    if (c.outcome === 'booked') today.by_user[u].booked++;
  });
  const stages = {};
  (stageCounts.data || []).forEach(r => { stages[r.stage] = r.n; });
  return { today, stages, due_now: contentRangeTotal(dueR.headers) || 0, total: contentRangeTotal(totalR.headers) || 0, day_start: start };
}

async function listLeads(settings, q) {
  const parts = ['select=' + COLUMN_SELECT];
  const search = str(q.q, 80).replace(/["\\]/g, '');
  if (search) {
    const pat = '"*' + search.replace(/\*/g, '') + '*"';
    parts.push('or=(' + ['business', 'owner', 'phone', 'phone_display', 'town', 'email', 'category', 'notes']
      .map(c => c + '.ilike.' + pat).join(',') + ')');
  }
  const stage = str(q.stage, 200);
  if (stage) {
    const keys = stage.split(',').map(slug).filter(k => settings.stages.some(s => s.key === k));
    if (keys.length) parts.push('stage=in.' + inList(keys));
  }
  if (q.due === '1') parts.push('next_at=lte.' + new Date().toISOString());
  const sort = SORTABLE.includes(q.sort) ? q.sort : 'updated_at';
  const dir = q.dir === 'asc' ? 'asc' : 'desc';
  parts.push('order=' + sort + '.' + dir + '.nullslast');
  const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 100));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  parts.push('limit=' + limit, 'offset=' + offset);
  const r = await sb('crm_leads?' + parts.join('&'), { headers: { Prefer: 'count=exact' } });
  if (!r.ok) throw new Error('supabase ' + r.status + ' list ' + (await r.text()).slice(0, 200));
  const leads = await r.json();
  return { leads, total: contentRangeTotal(r.headers), limit, offset };
}

async function logCall(settings, user, body) {
  const lead = await getLead(str(body.lead_id, 64));
  if (!lead) return { error: 'not_found', status: 404 };
  const outcome = str(body.outcome, 30);
  const spec = OUTCOMES[outcome];
  if (!spec) return { error: 'bad_outcome', status: 400 };
  const now = new Date();
  const patch = { last_called_at: now.toISOString(), last_outcome: outcome, call_count: (lead.call_count || 0) + 1 };
  let next_at = isoOrNull(body.next_at), booked_at = isoOrNull(body.booked_at);

  if (spec.retry) {
    next_at = next_at || addDays(now, settings.retry_days[spec.retry] || 1).toISOString();
  } else if (spec.needs === 'next_at' && !next_at) {
    next_at = addDays(now, 1).toISOString();
  }
  if (outcome === 'booked' && !booked_at) booked_at = now.toISOString();

  if (spec.stage && settings.stages.some(s => s.key === spec.stage)) patch.stage = spec.stage;
  patch.next_at = spec.retry || spec.needs === 'next_at' || outcome === 'contacted' ? next_at : null;
  if (outcome === 'booked') { patch.booked_at = booked_at; patch.next_at = null; }

  const call = { lead_id: lead.id, outcome, note: str(body.note, 4000), by_user: user.name, at: now.toISOString(),
    next_at: patch.next_at || null, booked_at: outcome === 'booked' ? booked_at : null };
  await sbJson('crm_calls', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(call) });
  const { data } = await sbJson('crm_leads?id=eq.' + encodeURIComponent(lead.id) + '&select=' + COLUMN_SELECT,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return { lead: data && data[0], call };
}

async function importRows(settings, user, body) {
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
  // optional: new custom columns discovered in the file
  let settingsOut = settings;
  if (Array.isArray(body.new_fields) && body.new_fields.length) {
    const merged = cleanSettings(Object.assign({}, settings, { fields: settings.fields.concat(body.new_fields) }));
    // new columns should show up in the Leads table right away
    merged.columns = merged.columns.concat(merged.fields.map(f => f.key).filter(k => !merged.columns.includes(k) && !settings.fields.some(f => f.key === k)));
    settingsOut = await saveSettings(merged);
  }
  const cleaned = [];
  let skipped_empty = 0, skipped_dupes = 0;
  const seenPhones = new Set();
  rows.forEach(r => {
    const l = cleanLead(r, settingsOut, true);
    if (!l.business && !l.phone) { skipped_empty++; return; }
    if (!l.stage) l.stage = 'new';
    if (l.phone) { if (seenPhones.has(l.phone)) { skipped_dupes++; return; } seenPhones.add(l.phone); }
    l.created_by = user.name;
    if (!l.source) l.source = str(body.source, 120) || 'import';
    cleaned.push(l);
  });
  // de-dupe against what's already in the table (by phone)
  const phones = Array.from(seenPhones);
  const existing = new Set();
  for (let i = 0; i < phones.length; i += 150) {
    const chunk = phones.slice(i, i + 150);
    const { data } = await sbJson('crm_leads?select=phone&phone=in.' + inList(chunk));
    (data || []).forEach(x => existing.add(x.phone));
  }
  const toInsert = cleaned.filter(l => { if (l.phone && existing.has(l.phone)) { skipped_dupes++; return false; } return true; });
  for (let i = 0; i < toInsert.length; i += 200) {
    await sbJson('crm_leads', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(toInsert.slice(i, i + 200)) });
  }
  return { inserted: toInsert.length, skipped_dupes, skipped_empty, settings: settingsOut };
}

async function exportCsv(settings) {
  const cols = ['business', 'owner', 'phone_display', 'phone', 'email', 'town', 'state', 'category', 'website', 'reviews',
    'stage', 'notes', 'next_at', 'last_called_at', 'last_outcome', 'call_count', 'booked_at', 'source', 'created_at'];
  const custom = settings.fields.map(f => f.key);
  const lines = [cols.concat(custom).map(csvCell).join(',')];
  let offset = 0;
  for (;;) {
    const { data } = await sbJson('crm_leads?select=' + COLUMN_SELECT + '&order=created_at.asc&limit=1000&offset=' + offset);
    (data || []).forEach(l => {
      const c = l.custom || {};
      lines.push(cols.map(k => csvCell(l[k])).concat(custom.map(k => csvCell(c[k]))).join(','));
    });
    if (!data || data.length < 1000) break;
    offset += 1000;
  }
  return lines.join('\r\n');
}

// ----------------------------------------------------------------- handler
module.exports = async function handler(req, res) {
  const op = str((req.query && req.query.op) || (readBody(req).op), 40);
  try {
    if (!CONFIGURED) return res.status(503).json({ ok: false, error: 'not_configured', hint: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing' });
    const token = bearer(req);
    if (!token) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const lock = await lockState();
    if (lock.until && Date.now() < lock.until) {
      return res.status(429).json({ ok: false, error: 'locked', retry_after: Math.ceil((lock.until - Date.now()) / 1000) });
    }
    const user = matchUser(token);
    if (!user) {
      const until = await noteFailure();
      if (until) return res.status(429).json({ ok: false, error: 'locked', retry_after: Math.ceil((until - Date.now()) / 1000) });
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'GET') {
      const q = req.query || {};
      if (op === 'bootstrap') {
        const settings = await loadSettings();
        const [st, qu] = await Promise.all([stats(settings), queue(settings, 25)]);
        return res.status(200).json({ ok: true, user, settings, stats: st, queue: qu, outcomes: Object.keys(OUTCOMES), now: new Date().toISOString() });
      }
      if (op === 'queue') {
        const settings = await loadSettings();
        return res.status(200).json({ ok: true, queue: await queue(settings, Math.min(100, parseInt(q.limit, 10) || 25)) });
      }
      if (op === 'leads') {
        const settings = await loadSettings();
        return res.status(200).json(Object.assign({ ok: true }, await listLeads(settings, q)));
      }
      if (op === 'lead') {
        const lead = await getLead(str(q.id, 64));
        if (!lead) return res.status(404).json({ ok: false, error: 'not_found' });
        const { data } = await sbJson('crm_calls?select=*&lead_id=eq.' + encodeURIComponent(lead.id) + '&order=at.desc&limit=200');
        return res.status(200).json({ ok: true, lead, calls: data || [] });
      }
      if (op === 'activity') {
        const limit = Math.min(300, parseInt(q.limit, 10) || 60);
        const { data } = await sbJson('crm_calls?select=*,lead:crm_leads(id,business,owner,phone,phone_display,stage)&order=at.desc&limit=' + limit);
        return res.status(200).json({ ok: true, calls: data || [] });
      }
      if (op === 'stats') {
        return res.status(200).json({ ok: true, stats: await stats(await loadSettings()) });
      }
      if (op === 'settings') {
        return res.status(200).json({ ok: true, settings: await loadSettings() });
      }
      if (op === 'export') {
        const csv = await exportCsv(await loadSettings());
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="leads-' + new Date().toISOString().slice(0, 10) + '.csv"');
        return res.status(200).send(csv);
      }
      return res.status(400).json({ ok: false, error: 'unknown_op' });
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      if (op === 'lead_create') {
        const settings = await loadSettings();
        const lead = cleanLead(body.lead, settings, true);
        if (!lead.business && !lead.phone) return res.status(400).json({ ok: false, error: 'need_business_or_phone' });
        if (!lead.stage) lead.stage = 'new';
        lead.created_by = user.name;
        if (!lead.source) lead.source = 'manual';
        if (lead.phone) {
          const { data } = await sbJson('crm_leads?select=id,business&phone=eq.' + lead.phone + '&limit=1');
          if (data && data[0]) return res.status(409).json({ ok: false, error: 'duplicate_phone', existing: data[0] });
        }
        const { data } = await sbJson('crm_leads?select=' + COLUMN_SELECT, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(lead) });
        return res.status(200).json({ ok: true, lead: data && data[0] });
      }
      if (op === 'lead_update') {
        const settings = await loadSettings();
        const id = str(body.id, 64);
        const patch = cleanLead(body.patch, settings, false);
        if (!id || !Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'bad_request' });
        const { data } = await sbJson('crm_leads?id=eq.' + encodeURIComponent(id) + '&select=' + COLUMN_SELECT,
          { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
        if (!data || !data[0]) return res.status(404).json({ ok: false, error: 'not_found' });
        return res.status(200).json({ ok: true, lead: data[0] });
      }
      if (op === 'lead_delete') {
        const id = str(body.id, 64);
        if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
        await sbJson('crm_leads?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        return res.status(200).json({ ok: true });
      }
      if (op === 'call') {
        const settings = await loadSettings();
        const r = await logCall(settings, user, body);
        if (r.error) return res.status(r.status).json({ ok: false, error: r.error });
        return res.status(200).json({ ok: true, lead: r.lead, call: r.call });
      }
      if (op === 'skip') {
        const id = str(body.lead_id, 64);
        const hours = Math.min(24 * 30, Math.max(1, Number(body.hours) || 24));
        const { data } = await sbJson('crm_leads?id=eq.' + encodeURIComponent(id) + '&select=' + COLUMN_SELECT,
          { method: 'PATCH', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ next_at: new Date(Date.now() + hours * 3600000).toISOString() }) });
        if (!data || !data[0]) return res.status(404).json({ ok: false, error: 'not_found' });
        return res.status(200).json({ ok: true, lead: data[0] });
      }
      if (op === 'import') {
        const settings = await loadSettings();
        return res.status(200).json(Object.assign({ ok: true }, await importRows(settings, user, body)));
      }
      if (op === 'settings_save') {
        const settings = cleanSettings(body.settings);
        return res.status(200).json({ ok: true, settings: await saveSettings(settings) });
      }
      return res.status(400).json({ ok: false, error: 'unknown_op' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[crm] ' + op + ' failed:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: 'server_error', detail: String(err && err.message || err).slice(0, 300) });
  }
};
