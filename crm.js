/* /crm — cold-call CRM front end. Talks only to /api/crm. No build step. */
(function () {
  'use strict';

  // ------------------------------------------------------------ state
  const S = {
    token: '', user: null, settings: null, stats: null, outcomes: [],
    queue: [], current: null, history: [], historyFor: null, view: 'dial',
    leads: { q: '', stage: '', due: false, sort: 'updated_at', dir: 'desc', offset: 0, limit: 100, rows: [], total: 0 },
    activity: [], actUser: '', draft: null, busy: false
  };
  const OUTCOME_UI = [
    { key: 'no_answer',      label: 'No answer',      sub: 'retry later',  cls: '' },
    { key: 'voicemail',      label: 'Voicemail',      sub: 'left message', cls: '' },
    { key: 'contacted',      label: 'Contacted',      sub: 'spoke, no book', cls: 'good' },
    { key: 'follow_up',      label: 'Follow-up',      sub: 'pick a time',  cls: 'good' },
    { key: 'booked',         label: 'Booked',         sub: 'appointment set', cls: 'hot' },
    { key: 'not_interested', label: 'Not interested', sub: 'said no',      cls: 'bad' },
    { key: 'dnc',            label: 'Do not call',    sub: 'wrong # / closed', cls: 'bad' }
  ];
  const BUILTIN_COLS = [
    ['business', 'Business'], ['owner', 'Owner'], ['phone', 'Phone'], ['email', 'Email'], ['town', 'Town'], ['state', 'State'],
    ['category', 'Category'], ['website', 'Website'], ['reviews', 'Reviews'], ['stage', 'Stage'], ['next_at', 'Next'],
    ['last_called_at', 'Last call'], ['last_outcome', 'Last outcome'], ['call_count', 'Calls'], ['booked_at', 'Booked for'],
    ['source', 'Source'], ['created_at', 'Added']
  ];

  // ------------------------------------------------------------ helpers
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  function toast(msg, err) {
    const f = $('flash'); f.textContent = msg; f.classList.toggle('err', !!err); f.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => f.classList.remove('show'), err ? 4000 : 2200);
  }
  function fmtPhone(l) {
    const d = (l.phone || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') return '(' + d.slice(1, 4) + ') ' + d.slice(4, 7) + '-' + d.slice(7);
    return l.phone_display || d || '';
  }
  const telHref = (l) => l.phone ? 'tel:+' + l.phone : '';
  function fmtDT(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const now = new Date(), t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((day - t) / 86400000);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diff === 0) return 'Today ' + time;
    if (diff === 1) return 'Tomorrow ' + time;
    if (diff === -1) return 'Yesterday ' + time;
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time;
  }
  function fmtAgo(iso) {
    if (!iso) return 'never';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24); if (d < 14) return d + 'd ago';
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function toLocalInput(iso) {
    const d = iso ? new Date(iso) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  const fromLocalInput = (v) => { const t = Date.parse(v); return isNaN(t) ? null : new Date(t).toISOString(); };
  function at(hour, daysAhead) { const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(hour, 0, 0, 0); return d; }
  function nextWeekday(dow, hour) { const d = new Date(); d.setHours(hour, 0, 0, 0); do { d.setDate(d.getDate() + 1); } while (d.getDay() !== dow); return d; }
  const stageOf = (k) => (S.settings.stages.find(s => s.key === k)) || { key: k, label: k || '—', color: 'grey' };
  const pill = (k, extra) => { const s = stageOf(k); return '<span class="pill c-' + esc(s.color) + ' ' + (extra || '') + '">' + esc(s.label) + '</span>'; };
  const outcomeLabel = (k) => (OUTCOME_UI.find(o => o.key === k) || { label: k }).label;
  const isDue = (l) => l.next_at && Date.parse(l.next_at) <= Date.now();
  function custVal(l, f) {
    const v = l.custom && l.custom[f.key];
    if (v == null || v === '') return '';
    if (f.type === 'checkbox') return v ? 'Yes' : 'No';
    if (f.type === 'date') return v;
    return String(v);
  }

  // ------------------------------------------------------------ api
  async function api(op, opts) {
    opts = opts || {};
    const qs = new URLSearchParams(Object.assign({ op }, opts.query || {})).toString();
    const init = { headers: { Authorization: 'Bearer ' + S.token } };
    if (opts.body) { init.method = 'POST'; init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const r = await fetch('/api/crm?' + qs, init);
    if (opts.raw) return r;
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (r.status === 401) { signOut('That PIN was rejected.'); throw new Error('unauthorized'); }
    if (r.status === 429) { const mins = Math.max(1, Math.ceil(((j && j.retry_after) || 900) / 60)); signOut('Too many wrong attempts. Logins are frozen for ' + mins + ' min.'); throw new Error('locked'); }
    if (!r.ok || !j || !j.ok) {
      const e = new Error((j && (j.error + (j.detail ? ': ' + j.detail : ''))) || ('HTTP ' + r.status));
      e.data = j; throw e;
    }
    return j;
  }

  // ------------------------------------------------------------ auth / boot
  function signOut(msg) {
    S.token = ''; try { localStorage.removeItem('crm_token'); } catch (e) {}
    $('tabs').hidden = true; $('who').hidden = true;
    document.querySelectorAll('.view').forEach(v => { v.hidden = true; });
    $('gate').hidden = false; $('gateMsg').textContent = msg || '';
  }
  async function signIn(token) {
    S.token = token;
    $('gateMsg').textContent = ''; $('unlock').disabled = true;
    try {
      const b = await api('bootstrap');
      try { localStorage.setItem('crm_token', token); } catch (e) {}
      S.user = b.user; S.settings = b.settings; S.stats = b.stats; S.queue = b.queue; S.outcomes = b.outcomes;
      $('gate').hidden = true; $('tabs').hidden = false; $('who').hidden = false; $('who-name').textContent = cap(S.user.name);
      S.current = S.queue[0] || null;
      showView(location.hash.replace('#', '') || 'dial');
    } catch (e) {
      if (e.message !== 'unauthorized' && e.message !== 'locked') $('gateMsg').textContent = /not_configured/.test(e.message) ? 'Server is missing its Supabase settings.' : 'Could not reach the server: ' + e.message;
    } finally { $('unlock').disabled = false; }
  }

  // ------------------------------------------------------------ views
  function showView(name) {
    if (!['dial', 'leads', 'activity', 'settings'].includes(name)) name = 'dial';
    S.view = name;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.view === name ? 'true' : 'false'));
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + name; });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (name === 'dial') renderDial();
    if (name === 'leads') { renderStageChips(); loadLeads(); }
    if (name === 'activity') loadActivity();
    if (name === 'settings') renderSettings();
  }

  // ------------------------------------------------------------ DIAL
  function renderDial() { renderStats(); renderLeadCard(); renderUpNext(); renderByUser(); }

  function renderStats() {
    const st = S.stats || { today: { calls: 0, contacted: 0, booked: 0, follow_ups: 0 }, due_now: 0, total: 0 };
    const ready = st.due_now > 0 ? st.due_now : S.queue.length;
    $('n-due').textContent = ready + (S.queue.length >= 25 && st.due_now < 25 ? '+' : '');
    $('stats').innerHTML = [
      ['Calls<span class="sm-hide"> today</span>', st.today.calls, ''], ['Reached', st.today.contacted, ''], ['Booked', st.today.booked, st.today.booked ? 'hot' : ''],
      ['Due now', st.due_now, st.due_now ? 'hot' : ''], ['Total leads', st.total, 'hide-sm']
    ].map(([k, v, c]) => '<div class="stat ' + c + '"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>').join('');
  }

  function renderLeadCard() {
    const l = S.current, box = $('leadcard');
    if (!l) {
      box.innerHTML = '<div class="card empty"><b>Queue is clear.</b>No leads are due and nothing new is waiting.<br>Add leads or import a CSV under <a href="#leads" data-view="leads">Leads</a>.</div>';
      return;
    }
    const cf = S.settings.fields.filter(f => f.in_queue && custVal(l, f));
    const reason = isDue(l) ? '<span class="pill due">Due ' + esc(fmtDT(l.next_at)) + '</span>' : (l.call_count ? '<span class="pill">' + l.call_count + ' prior call' + (l.call_count > 1 ? 's' : '') + '</span>' : '<span class="pill">Never called</span>');
    const meta = [];
    if (l.town || l.state) meta.push(esc([l.town, l.state].filter(Boolean).join(', ')));
    if (l.category) meta.push(esc(l.category));
    if (l.reviews != null) meta.push(l.reviews + ' reviews');
    if (l.website) meta.push('<a href="' + esc(/^https?:/i.test(l.website) ? l.website : 'http://' + l.website) + '" target="_blank" rel="noopener">' + esc(l.website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')) + ' ↗</a>');
    if (l.email) meta.push('<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>');
    const phone = fmtPhone(l);
    box.innerHTML =
      '<div class="card lead-card">' +
        '<div class="top"><div>' + pill(l.stage) + ' ' + reason + '</div><button class="btn btn-ghost btn-sm" id="edit-current">Edit</button></div>' +
        '<div class="biz">' + esc(l.business || '(no business name)') + '</div>' +
        (l.owner ? '<div class="owner">' + esc(l.owner) + '</div>' : '') +
        (meta.length ? '<div class="meta">' + meta.join('<span>·</span>') + '</div>' : '') +
        (phone
          ? '<a class="callbtn" id="callbtn" href="' + esc(telHref(l)) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.7a2 2 0 0 1 1.7 2z"/></svg>' + esc(phone) + '</a>'
          : '<div class="callbtn nophone">No phone number on this lead</div>') +
        '<div class="callrow">' +
          (phone ? '<button class="btn btn-sm" id="copyphone">Copy number</button>' : '') +
          '<button class="btn btn-sm" id="skip">Skip for now<span class="kbd">S</span></button>' +
          (S.settings.booking_url ? '<a class="btn btn-sm" href="' + esc(S.settings.booking_url) + '" target="_blank" rel="noopener">Booking page ↗</a>' : '') +
        '</div>' +
        (cf.length ? '<div class="kv">' + cf.map(f => '<div class="k">' + esc(f.label) + '</div><div>' + esc(custVal(l, f)) + '</div>').join('') + '</div>' : '') +
        (l.notes ? '<div class="kv"><div class="k">Notes</div><div style="white-space:pre-wrap">' + esc(l.notes) + '</div></div>' : '') +
        '<div class="notebox"><label class="f" for="callnote">Call note (saved with the outcome)</label><textarea id="callnote" placeholder="Who you spoke to, objections, what they said…"></textarea></div>' +
        '<div class="outcomes">' + OUTCOME_UI.map((o, i) => '<button class="oc ' + o.cls + '" data-outcome="' + o.key + '">' + o.label + '<small>' + o.sub + '<span class="kbd">' + (i + 1) + '</span></small></button>').join('') + '</div>' +
        '<div class="hist" id="hist"><h3>Call history</h3><div class="mono muted">Loading…</div></div>' +
      '</div>';
    $('edit-current').onclick = () => openLead(l.id);
    $('skip').onclick = skipCurrent;
    if ($('copyphone')) $('copyphone').onclick = () => copy(phone);
    box.querySelectorAll('[data-outcome]').forEach(b => { b.onclick = () => chooseOutcome(b.dataset.outcome); });
    loadHistory(l.id);
  }

  async function loadHistory(id) {
    if (S.historyFor === id && S.history) return paintHistory(id);
    try {
      const r = await api('lead', { query: { id } });
      S.history = r.calls; S.historyFor = id;
    } catch (e) { S.history = []; S.historyFor = id; }
    paintHistory(id);
  }
  function paintHistory(id) {
    const h = $('hist'); if (!h || !S.current || S.current.id !== id) return;
    if (!S.history.length) { h.innerHTML = '<h3>Call history</h3><div class="mono muted">No calls logged yet.</div>'; return; }
    h.innerHTML = '<h3>Call history</h3>' + S.history.map(c =>
      '<div class="it"><div class="when">' + esc(fmtDT(c.at)) + '</div><div><b>' + esc(outcomeLabel(c.outcome)) + '</b> <span class="mono muted">' + esc(cap(c.by_user)) + '</span>' +
      (c.next_at ? ' <span class="mono muted">→ ' + esc(fmtDT(c.next_at)) + '</span>' : '') + (c.booked_at ? ' <span class="mono muted">booked ' + esc(fmtDT(c.booked_at)) + '</span>' : '') + '</div>' +
      (c.note ? '<div class="note">' + esc(c.note) + '</div>' : '') + '</div>').join('');
  }

  function renderUpNext() {
    const rest = S.queue.filter(l => !S.current || l.id !== S.current.id).slice(0, 10);
    $('upnext-count').textContent = S.queue.length ? (S.queue.length - (S.current ? 1 : 0)) + ' queued' : '';
    $('upnext').innerHTML = rest.length ? rest.map(l =>
      '<div class="it" data-id="' + l.id + '"><div><b>' + esc(l.business || l.owner || fmtPhone(l)) + '</b><div class="sub">' +
      esc([l.town, l.category].filter(Boolean).join(' · ')) + '</div></div>' + (isDue(l) ? '<span class="pill due">due</span>' : pill(l.stage)) + '</div>').join('')
      : '<div class="mono muted">Nothing else queued.</div>';
    $('upnext').querySelectorAll('.it').forEach(it => { it.onclick = () => { makeCurrent(it.dataset.id); }; });
  }
  function renderByUser() {
    const bu = (S.stats && S.stats.today.by_user) || {};
    const names = Object.keys(bu);
    $('byuser').innerHTML = names.length ? names.map(n => '<div class="k">' + esc(cap(n)) + '</div><div>' + bu[n].calls + ' calls · ' + bu[n].contacted + ' reached · ' + bu[n].booked + ' booked</div>').join('')
      : '<div class="mono muted" style="grid-column:1/-1">No calls yet today.</div>';
  }
  function makeCurrent(id) {
    const i = S.queue.findIndex(l => l.id === id); if (i < 0) return;
    const [l] = S.queue.splice(i, 1); S.queue.unshift(l); S.current = l; renderLeadCard(); renderUpNext();
  }

  async function refreshQueueAndStats() {
    try {
      const [q, st] = await Promise.all([api('queue', { query: { limit: 25 } }), api('stats')]);
      const curId = S.current && S.current.id;
      S.queue = q.queue; S.stats = st.stats;
      if (curId && !S.queue.some(l => l.id === curId)) S.current = S.queue[0] || null;
      else if (curId) S.current = S.queue.find(l => l.id === curId);
      else S.current = S.queue[0] || null;
      if (S.view === 'dial') renderDial();
    } catch (e) { /* keep what we have */ }
  }

  function advance() {
    S.queue = S.queue.filter(l => !S.current || l.id !== S.current.id);
    S.current = S.queue[0] || null; S.history = []; S.historyFor = null;
    renderLeadCard(); renderUpNext();
    if (S.queue.length < 5) refreshQueueAndStats(); else api('stats').then(r => { S.stats = r.stats; renderStats(); renderByUser(); }).catch(() => {});
  }

  function chooseOutcome(key) {
    if (!S.current) return;
    const note = ($('callnote') && $('callnote').value.trim()) || '';
    if (key === 'follow_up') return openFollowUp(S.current, note, (iso, n) => submitOutcome(S.current, key, { note: n, next_at: iso }));
    if (key === 'booked') return openBooked(S.current, note, (iso, n) => submitOutcome(S.current, key, { note: n, booked_at: iso }));
    submitOutcome(S.current, key, { note });
  }

  async function submitOutcome(lead, key, extra, fromDrawer) {
    if (S.busy) return; S.busy = true;
    try {
      const r = await api('call', { body: Object.assign({ lead_id: lead.id, outcome: key }, extra) });
      const l = r.lead;
      let msg = outcomeLabel(key) + ' logged';
      if (key === 'no_answer' || key === 'voicemail') msg += ' · back ' + fmtDT(l.next_at);
      if (key === 'follow_up') msg += ' · ' + fmtDT(l.next_at);
      if (key === 'booked') msg += ' · ' + fmtDT(l.booked_at);
      toast(msg);
      if (fromDrawer) { closeSheet(); if (S.view === 'leads') loadLeads(); refreshQueueAndStats(); }
      else if (S.current && S.current.id === lead.id) advance();
      else refreshQueueAndStats();
    } catch (e) { toast('Could not save: ' + e.message, true); }
    finally { S.busy = false; }
  }

  async function skipCurrent() {
    if (!S.current) return;
    try { await api('skip', { body: { lead_id: S.current.id, hours: 24 } }); toast('Skipped · back tomorrow'); advance(); }
    catch (e) { toast('Could not skip: ' + e.message, true); }
  }

  function copy(text) {
    const done = () => toast('Copied ' + text);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) {} t.remove(); }
  }

  // ------------------------------------------------------------ sheets
  function openSheet(html, wide) {
    const root = $('sheet-root');
    root.innerHTML = '<div class="sheet-bg" id="sheet-bg"><div class="sheet' + (wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    $('sheet-bg').addEventListener('mousedown', (e) => { if (e.target.id === 'sheet-bg') closeSheet(); });
    root.querySelectorAll('[data-close]').forEach(b => { b.onclick = closeSheet; });
    const first = root.querySelector('input,select,textarea,button'); if (first) setTimeout(() => first.focus(), 30);
  }
  function closeSheet() { $('sheet-root').innerHTML = ''; }

  function timeChips(id) {
    const opts = [
      ['In 1 hour', new Date(Date.now() + 3600000)], ['Tomorrow 9am', at(9, 1)], ['Tomorrow 2pm', at(14, 1)],
      ['In 3 days', at(9, 3)], ['Next Mon', nextWeekday(1, 9)], ['Next week', at(9, 7)]
    ];
    return '<div class="chips">' + opts.map(([l, d]) => '<button type="button" class="chip" data-set="' + id + '" data-val="' + toLocalInput(d.toISOString()) + '">' + l + '</button>').join('') + '</div>';
  }
  function wireChips() {
    document.querySelectorAll('[data-set]').forEach(c => { c.onclick = () => { $(c.dataset.set).value = c.dataset.val; document.querySelectorAll('[data-set="' + c.dataset.set + '"]').forEach(x => x.classList.toggle('on', x === c)); }; });
  }
  function openFollowUp(lead, note, done) {
    openSheet('<h2>Follow-up with ' + esc(lead.business || lead.owner || 'this lead') + '</h2><div class="sub">When should they come back up in the queue?</div>' +
      timeChips('fu-at') + '<div class="field"><label class="f" for="fu-at">Date &amp; time</label><input type="datetime-local" id="fu-at" value="' + toLocalInput(at(9, 1).toISOString()) + '"></div>' +
      '<div class="field"><label class="f" for="fu-note">Note</label><textarea id="fu-note">' + esc(note) + '</textarea></div>' +
      '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="fu-save">Save follow-up</button></div>');
    wireChips();
    $('fu-save').onclick = () => { const iso = fromLocalInput($('fu-at').value), n = $('fu-note').value.trim(); if (!iso) return toast('Pick a date and time', true); closeSheet(); done(iso, n); };
  }
  function openBooked(lead, note, done) {
    openSheet('<h2>Booked · ' + esc(lead.business || lead.owner || 'this lead') + '</h2><div class="sub">When is the call? ' +
      (S.settings.booking_url ? '<a href="' + esc(S.settings.booking_url) + '" target="_blank" rel="noopener">Open the booking page ↗</a> to put it on the calendar.' : '') + '</div>' +
      timeChips('bk-at') + '<div class="field"><label class="f" for="bk-at">Appointment date &amp; time</label><input type="datetime-local" id="bk-at" value="' + toLocalInput(at(9, 1).toISOString()) + '"></div>' +
      '<div class="field"><label class="f" for="bk-note">Note</label><textarea id="bk-note" placeholder="What they want looked at, who\'s joining…">' + esc(note) + '</textarea></div>' +
      '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="bk-save">Mark booked</button></div>');
    wireChips();
    $('bk-save').onclick = () => { const iso = fromLocalInput($('bk-at').value), n = $('bk-note').value.trim(); if (!iso) return toast('Pick a date and time', true); closeSheet(); done(iso, n); };
  }

  // ------------------------------------------------------------ lead form / drawer
  function leadFormHtml(l) {
    l = l || {};
    const f = (id, label, type, val, attrs) => '<div class="field"><label class="f" for="lf-' + id + '">' + label + '</label><input type="' + type + '" id="lf-' + id + '" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '></div>';
    let h = '<div class="grid2">' +
      f('business', 'Business', 'text', l.business) + f('owner', 'Owner / contact', 'text', l.owner) +
      f('phone', 'Phone', 'tel', l.phone_display || (l.phone ? fmtPhone(l) : '')) + f('email', 'Email', 'email', l.email) +
      f('town', 'Town', 'text', l.town) + f('state', 'State', 'text', l.state) +
      f('category', 'Category', 'text', l.category) + f('website', 'Website', 'url', l.website) +
      f('reviews', 'Google reviews', 'number', l.reviews) +
      '<div class="field"><label class="f" for="lf-stage">Stage</label><select id="lf-stage">' + S.settings.stages.map(s => '<option value="' + s.key + '"' + ((l.stage || 'new') === s.key ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('') + '</select></div>' +
      f('next_at', 'Next call (queue)', 'datetime-local', l.next_at ? toLocalInput(l.next_at) : '') +
      f('booked_at', 'Booked for', 'datetime-local', l.booked_at ? toLocalInput(l.booked_at) : '');
    S.settings.fields.forEach(fd => {
      const v = l.custom ? l.custom[fd.key] : undefined;
      if (fd.type === 'select') h += '<div class="field"><label class="f" for="lf-c-' + fd.key + '">' + esc(fd.label) + '</label><select id="lf-c-' + fd.key + '"><option value="">—</option>' + fd.options.map(o => '<option' + (v === o ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></div>';
      else if (fd.type === 'checkbox') h += '<div class="field"><label class="f">' + esc(fd.label) + '</label><label class="inl" style="font-size:14px"><input type="checkbox" id="lf-c-' + fd.key + '"' + (v ? ' checked' : '') + '> Yes</label></div>';
      else h += f('c-' + fd.key, esc(fd.label), fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : fd.type === 'url' ? 'url' : 'text', v);
    });
    h += '</div><div class="field"><label class="f" for="lf-notes">Notes</label><textarea id="lf-notes">' + esc(l.notes) + '</textarea></div>';
    return h;
  }
  function readLeadForm() {
    const g = (id) => $('lf-' + id) ? $('lf-' + id).value : '';
    const out = { business: g('business'), owner: g('owner'), phone: g('phone'), email: g('email'), town: g('town'), state: g('state'),
      category: g('category'), website: g('website'), reviews: g('reviews'), stage: g('stage'), notes: g('notes'),
      next_at: g('next_at') ? fromLocalInput(g('next_at')) : null, booked_at: g('booked_at') ? fromLocalInput(g('booked_at')) : null, custom: {} };
    S.settings.fields.forEach(fd => { const el = $('lf-c-' + fd.key); if (!el) return; out.custom[fd.key] = fd.type === 'checkbox' ? el.checked : el.value; });
    return out;
  }

  function openAddLead() {
    openSheet('<h2>New lead</h2><div class="sub">Business or phone is enough to start.</div>' + leadFormHtml(null) +
      '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="lf-save">Add lead</button></div>', true);
    $('lf-save').onclick = async () => {
      const lead = readLeadForm();
      if (!lead.business && !lead.phone) return toast('Give it a business name or a phone number', true);
      try { await api('lead_create', { body: { lead } }); toast('Lead added'); closeSheet(); loadLeads(); refreshQueueAndStats(); }
      catch (e) { toast(e.data && e.data.error === 'duplicate_phone' ? 'That phone number is already on ' + (e.data.existing.business || 'another lead') : 'Could not add: ' + e.message, true); }
    };
  }

  async function openLead(id) {
    let r; try { r = await api('lead', { query: { id } }); } catch (e) { return toast('Could not load lead', true); }
    const l = r.lead;
    openSheet('<div class="drawer"><div class="head"><div>' + pill(l.stage) + (isDue(l) ? ' <span class="pill due">due</span>' : '') + '<h2>' + esc(l.business || l.owner || fmtPhone(l)) + '</h2>' +
      '<div class="mono muted">' + (l.phone ? '<a class="tel" href="' + esc(telHref(l)) + '" style="color:var(--amber);text-decoration:none">' + esc(fmtPhone(l)) + '</a> · ' : '') + l.call_count + ' calls · last ' + esc(fmtAgo(l.last_called_at)) + '</div></div>' +
      '<button class="btn btn-ghost btn-sm" data-close>Close</button></div>' +
      '<div class="quick">' + OUTCOME_UI.map(o => '<button class="btn btn-sm ' + (o.cls === 'hot' ? 'btn-primary' : o.cls === 'bad' ? 'btn-danger' : '') + '" data-doutcome="' + o.key + '">' + o.label + '</button>').join('') + '</div>' +
      leadFormHtml(l) +
      '<div class="actions"><button class="btn btn-danger left" id="lf-del">Delete</button><button class="btn" id="lf-dial">Dial this lead</button><button class="btn btn-primary" id="lf-save">Save changes</button></div>' +
      '<div class="hist"><h3>Call history</h3>' + (r.calls.length ? r.calls.map(c => '<div class="it"><div class="when">' + esc(fmtDT(c.at)) + '</div><div><b>' + esc(outcomeLabel(c.outcome)) + '</b> <span class="mono muted">' + esc(cap(c.by_user)) + '</span></div>' + (c.note ? '<div class="note">' + esc(c.note) + '</div>' : '') + '</div>').join('') : '<div class="mono muted">No calls logged yet.</div>') + '</div></div>', true);
    document.querySelectorAll('[data-doutcome]').forEach(b => {
      b.onclick = () => {
        const key = b.dataset.doutcome, note = $('lf-notes') ? '' : '';
        if (key === 'follow_up') return openFollowUp(l, note, (iso, n) => submitOutcome(l, key, { note: n, next_at: iso }, true));
        if (key === 'booked') return openBooked(l, note, (iso, n) => submitOutcome(l, key, { note: n, booked_at: iso }, true));
        submitOutcome(l, key, { note }, true);
      };
    });
    $('lf-save').onclick = async () => {
      try { const u = await api('lead_update', { body: { id: l.id, patch: readLeadForm() } }); toast('Saved'); closeSheet();
        if (S.current && S.current.id === l.id) { S.current = u.lead; S.queue = S.queue.map(x => x.id === l.id ? u.lead : x); }
        if (S.view === 'leads') loadLeads(); if (S.view === 'dial') renderDial(); refreshQueueAndStats(); }
      catch (e) { toast('Could not save: ' + e.message, true); }
    };
    $('lf-dial').onclick = () => { closeSheet(); if (!S.queue.some(x => x.id === l.id)) S.queue.unshift(l); makeCurrent(l.id); showView('dial'); };
    $('lf-del').onclick = () => {
      if ($('lf-del').dataset.armed) {
        api('lead_delete', { body: { id: l.id } }).then(() => { toast('Deleted'); closeSheet(); if (S.view === 'leads') loadLeads(); refreshQueueAndStats(); }).catch(e => toast('Could not delete: ' + e.message, true));
      } else { $('lf-del').dataset.armed = '1'; $('lf-del').textContent = 'Really delete? Click again'; }
    };
  }

  // ------------------------------------------------------------ LEADS table
  function visibleCols() {
    const custom = S.settings.fields.map(f => f.key);
    return S.settings.columns.filter(c => BUILTIN_COLS.some(b => b[0] === c) || custom.includes(c));
  }
  function colLabel(c) { const b = BUILTIN_COLS.find(x => x[0] === c); if (b) return b[1]; const f = S.settings.fields.find(x => x.key === c); return f ? f.label : c; }
  function cell(l, c) {
    switch (c) {
      case 'business': return '<td class="biz">' + esc(l.business || '—') + '</td>';
      case 'phone': return '<td class="phone">' + (l.phone ? '<a class="tel" href="' + esc(telHref(l)) + '" onclick="event.stopPropagation()">' + esc(fmtPhone(l)) + '</a>' : '') + '</td>';
      case 'stage': return '<td class="stage">' + pill(l.stage) + (isDue(l) ? ' <span class="pill due">due</span>' : '') + '</td>';
      case 'next_at': return '<td class="next_at mono">' + esc(l.next_at ? fmtDT(l.next_at) : '') + '</td>';
      case 'last_called_at': return '<td class="mono">' + esc(fmtAgo(l.last_called_at)) + '</td>';
      case 'booked_at': case 'created_at': return '<td class="mono">' + esc(l[c] ? fmtDT(l[c]) : '') + '</td>';
      case 'call_count': case 'reviews': return '<td class="num">' + (l[c] == null ? '' : l[c]) + '</td>';
      case 'last_outcome': return '<td>' + esc(l.last_outcome ? outcomeLabel(l.last_outcome) : '') + '</td>';
      case 'website': return '<td>' + (l.website ? '<a href="' + esc(/^https?:/i.test(l.website) ? l.website : 'http://' + l.website) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + esc(l.website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')) + '</a>' : '') + '</td>';
      case 'owner': case 'town': return '<td class="' + c + '">' + esc(l[c]) + '</td>';
      default: { const f = S.settings.fields.find(x => x.key === c); if (f) return '<td>' + esc(custVal(l, f)) + '</td>'; return '<td>' + esc(l[c] == null ? '' : l[c]) + '</td>'; }
    }
  }
  const SORTABLE = ['business', 'owner', 'town', 'category', 'stage', 'next_at', 'last_called_at', 'call_count', 'created_at', 'updated_at', 'reviews', 'booked_at'];
  async function loadLeads() {
    const L = S.leads;
    try {
      const r = await api('leads', { query: { q: L.q, stage: L.stage, due: L.due ? '1' : '', sort: L.sort, dir: L.dir, limit: L.limit, offset: L.offset } });
      L.rows = r.leads; L.total = r.total || 0;
    } catch (e) { toast('Could not load leads: ' + e.message, true); return; }
    renderTable();
  }
  function renderTable() {
    const L = S.leads, cols = visibleCols(), t = $('leadtable');
    t.querySelector('thead').innerHTML = '<tr>' + cols.map(c => '<th data-col="' + c + '" class="' + (L.sort === c ? 'on' : '') + '">' + esc(colLabel(c)) + (L.sort === c ? (L.dir === 'asc' ? ' ↑' : ' ↓') : '') + '</th>').join('') + '</tr>';
    t.querySelector('tbody').innerHTML = L.rows.length ? L.rows.map(l => '<tr data-id="' + l.id + '">' + cols.map(c => cell(l, c)).join('') + '</tr>').join('')
      : '<tr><td colspan="' + cols.length + '"><div class="empty"><b>No leads here.</b>' + (L.q || L.stage || L.due ? 'Try clearing the search or filters.' : 'Add one or import a CSV.') + '</div></td></tr>';
    t.querySelectorAll('th').forEach(th => { th.onclick = () => { const c = th.dataset.col; if (!SORTABLE.includes(c)) return; if (L.sort === c) L.dir = L.dir === 'asc' ? 'desc' : 'asc'; else { L.sort = c; L.dir = c === 'business' || c === 'owner' || c === 'town' ? 'asc' : 'desc'; } L.offset = 0; loadLeads(); }; });
    t.querySelectorAll('tbody tr[data-id]').forEach(tr => { tr.onclick = () => openLead(tr.dataset.id); });
    const from = L.total ? L.offset + 1 : 0, to = Math.min(L.total, L.offset + L.rows.length);
    $('pager').innerHTML = '<span>' + from + '–' + to + ' of ' + L.total + '</span><span class="row">' +
      '<button class="btn btn-sm btn-ghost" id="pg-prev" ' + (L.offset === 0 ? 'disabled' : '') + '>← Prev</button><button class="btn btn-sm btn-ghost" id="pg-next" ' + (to >= L.total ? 'disabled' : '') + '>Next →</button></span>';
    $('pg-prev').onclick = () => { L.offset = Math.max(0, L.offset - L.limit); loadLeads(); };
    $('pg-next').onclick = () => { L.offset += L.limit; loadLeads(); };
  }
  function renderStageChips() {
    const counts = (S.stats && S.stats.stages) || {};
    const all = Object.values(counts).reduce((a, b) => a + b, 0);
    $('stagechips').innerHTML = '<button class="chip ' + (!S.leads.stage ? 'on' : '') + '" data-stage="">All <b>' + all + '</b></button>' +
      S.settings.stages.map(s => '<button class="chip ' + (S.leads.stage === s.key ? 'on' : '') + '" data-stage="' + s.key + '">' + esc(s.label) + ' <b>' + (counts[s.key] || 0) + '</b></button>').join('');
    $('stagechips').querySelectorAll('.chip').forEach(c => { c.onclick = () => { S.leads.stage = c.dataset.stage; S.leads.offset = 0; renderStageChips(); loadLeads(); }; });
    $('btn-due').classList.toggle('btn-primary', S.leads.due);
  }

  async function exportCsv() {
    try {
      const r = await api('export', { raw: true });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'leads-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast('Export failed: ' + e.message, true); }
  }

  // ------------------------------------------------------------ CSV import
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    const clean = rows.filter(r => r.some(c => c.trim() !== ''));
    if (!clean.length) return { headers: [], rows: [] };
    const headers = clean[0].map(h => h.trim());
    return { headers, rows: clean.slice(1).map(r => { const o = {}; headers.forEach((h, i) => { o[h] = (r[i] || '').trim(); }); return o; }) };
  }
  const GUESS = [
    ['business', /^(business|company|name|business[ _-]?name|company[ _-]?name|biz)$/i], ['owner', /owner|contact|first[ _-]?name|person|decision/i],
    ['phone', /phone|mobile|cell|tel/i], ['email', /e-?mail/i], ['town', /town|city/i], ['state', /^state$|province/i],
    ['category', /category|type|industry|vertical|trade/i], ['website', /web|site|url|domain/i], ['reviews', /review|rating[ _-]?count/i], ['notes', /note|comment|remark/i]
  ];
  function openImport() {
    openSheet('<h2>Import leads from CSV</h2><div class="sub">Export from Google Maps scrapers, Sheets, Excel… anything with a header row. Leads with a phone number already in the CRM are skipped.</div>' +
      '<div class="dropzone" id="drop">Drop a .csv here or click to choose<input type="file" id="csvfile" accept=".csv,text/csv" hidden></div><div id="import-body"></div>', true);
    const drop = $('drop'), file = $('csvfile');
    drop.onclick = () => file.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
    file.onchange = () => { if (file.files[0]) readFile(file.files[0]); };
    function readFile(f) { const rd = new FileReader(); rd.onload = () => showMapping(parseCSV(String(rd.result))); rd.readAsText(f); }
  }
  function showMapping(parsed) {
    if (!parsed.headers.length) return toast('That file looks empty', true);
    const targets = [['', 'Skip'], ['business', 'Business'], ['owner', 'Owner / contact'], ['phone', 'Phone'], ['email', 'Email'], ['town', 'Town'], ['state', 'State'],
      ['category', 'Category'], ['website', 'Website'], ['reviews', 'Reviews'], ['notes', 'Notes']].concat(S.settings.fields.map(f => ['c:' + f.key, f.label + ' (column)'])).concat([['new', '＋ New column']]);
    const used = new Set();
    const guess = (h) => { for (const [k, re] of GUESS) if (re.test(h) && !used.has(k)) { used.add(k); return k; } const f = S.settings.fields.find(x => x.label.toLowerCase() === h.toLowerCase() || x.key === h.toLowerCase()); return f ? 'c:' + f.key : ''; };
    $('drop').hidden = true;
    $('import-body').innerHTML = '<p class="mono muted" style="margin:14px 0 6px">' + parsed.rows.length + ' rows · map each file column:</p>' +
      parsed.headers.map((h, i) => { const g = guess(h); return '<div class="maprow"><div><div class="h">' + esc(h) + '</div><div class="ex">' + esc(parsed.rows.slice(0, 2).map(r => r[h]).filter(Boolean).join(' · ') || '(empty)') + '</div></div><select data-h="' + i + '">' + targets.map(([v, l]) => '<option value="' + v + '"' + (v === g ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></div>'; }).join('') +
      '<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="do-import">Import ' + parsed.rows.length + ' leads</button></div>';
    document.querySelectorAll('[data-close]').forEach(b => { b.onclick = closeSheet; });
    $('do-import').onclick = async () => {
      const map = {}; document.querySelectorAll('select[data-h]').forEach(s => { map[parsed.headers[+s.dataset.h]] = s.value; });
      if (!Object.values(map).some(v => v === 'business' || v === 'phone')) return toast('Map at least Business or Phone', true);
      const new_fields = [];
      Object.keys(map).forEach(h => { if (map[h] === 'new') { const key = h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); if (key) { new_fields.push({ key, label: h, type: 'text' }); map[h] = 'c:' + key; } else map[h] = ''; } });
      const rows = parsed.rows.map(r => { const o = { custom: {} }; Object.keys(map).forEach(h => { const t = map[h]; if (!t) return; if (t.startsWith('c:')) o.custom[t.slice(2)] = r[h]; else o[t] = r[h]; }); return o; });
      $('do-import').disabled = true; $('do-import').textContent = 'Importing…';
      try {
        let inserted = 0, dupes = 0, empty = 0, settings = null;
        for (let i = 0; i < rows.length; i += 500) {
          const r = await api('import', { body: { rows: rows.slice(i, i + 500), new_fields: i === 0 ? new_fields : [], source: 'csv' } });
          inserted += r.inserted; dupes += r.skipped_dupes; empty += r.skipped_empty; settings = r.settings;
        }
        if (settings) S.settings = settings;
        toast('Imported ' + inserted + (dupes ? ' · ' + dupes + ' already in CRM' : '') + (empty ? ' · ' + empty + ' blank' : ''));
        closeSheet(); loadLeads(); refreshQueueAndStats();
      } catch (e) { toast('Import failed: ' + e.message, true); $('do-import').disabled = false; $('do-import').textContent = 'Retry import'; }
    };
  }

  // ------------------------------------------------------------ ACTIVITY
  async function loadActivity() {
    try { const r = await api('activity', { query: { limit: 200 } }); S.activity = r.calls; } catch (e) { toast('Could not load activity', true); return; }
    const users = Array.from(new Set(S.activity.map(c => c.by_user).filter(Boolean)));
    $('act-user').innerHTML = '<option value="">Everyone</option>' + users.map(u => '<option value="' + esc(u) + '"' + (S.actUser === u ? ' selected' : '') + '>' + esc(cap(u)) + '</option>').join('');
    renderActivity();
  }
  function renderActivity() {
    const list = S.activity.filter(c => !S.actUser || c.by_user === S.actUser);
    if (!list.length) { $('activity').innerHTML = '<div class="empty"><b>No calls logged yet.</b>Outcomes logged from the Dial screen show up here.</div>'; return; }
    let h = '', lastDay = '';
    list.forEach(c => {
      const d = new Date(c.at), day = d.toDateString();
      if (day !== lastDay) { lastDay = day; h += '<div class="day">' + esc(fmtDT(c.at).replace(/ \d.*$/, '')) + '</div>'; }
      const l = c.lead || {};
      h += '<div class="act" data-id="' + esc(l.id || '') + '"><div class="t">' + esc(d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '</div><div><b>' + esc(l.business || l.owner || 'Deleted lead') + '</b> — ' + esc(outcomeLabel(c.outcome)) +
        (c.next_at ? ' <span class="mono muted">→ ' + esc(fmtDT(c.next_at)) + '</span>' : '') + (c.booked_at ? ' <span class="mono muted">for ' + esc(fmtDT(c.booked_at)) + '</span>' : '') + '<span class="by">' + esc(cap(c.by_user)) + '</span></div>' +
        (c.note ? '<div class="note">' + esc(c.note) + '</div>' : '') + '</div>';
    });
    $('activity').innerHTML = h;
    $('activity').querySelectorAll('.act[data-id]').forEach(a => { a.onclick = () => { if (a.dataset.id) openLead(a.dataset.id); }; });
  }

  // ------------------------------------------------------------ SETTINGS
  function renderSettings() {
    if (!S.draft) S.draft = JSON.parse(JSON.stringify(S.settings));
    const D = S.draft, counts = (S.stats && S.stats.stages) || {};
    const colors = ['stone', 'blue', 'gold', 'green', 'oxblood', 'grey', 'red'];
    $('stages-list').innerHTML = D.stages.map((s, i) =>
      '<div class="it c-' + s.color + '"><div class="row" style="gap:6px"><span class="swatch"></span><input type="text" value="' + esc(s.label) + '" data-stage-label="' + i + '" class="grow" style="max-width:200px">' +
      '<select data-stage-color="' + i + '">' + colors.map(c => '<option value="' + c + '"' + (c === s.color ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
      '<label class="inl"><input type="checkbox" data-stage-term="' + i + '"' + (D.terminal_stages.includes(s.key) ? ' checked' : '') + '> done</label><span class="sub">' + (counts[s.key] || 0) + ' leads</span></div>' +
      '<div class="ctl"><button data-stage-up="' + i + '" ' + (i === 0 ? 'disabled' : '') + ' title="Move up">↑</button><button data-stage-down="' + i + '" ' + (i === D.stages.length - 1 ? 'disabled' : '') + ' title="Move down">↓</button><button class="del" data-stage-del="' + i + '" ' + (counts[s.key] ? 'disabled title="Move its leads to another stage first"' : 'title="Remove"') + '>×</button></div></div>').join('');
    $('fields-list').innerHTML = D.fields.length ? D.fields.map((f, i) =>
      '<div class="it"><div class="row" style="gap:6px"><input type="text" value="' + esc(f.label) + '" data-field-label="' + i + '" class="grow" style="max-width:200px"><span class="sub">' + f.type + '</span>' +
      (f.type === 'select' ? '<input type="text" value="' + esc(f.options.join(', ')) + '" data-field-opts="' + i + '" placeholder="options, comma separated" class="grow" style="max-width:240px">' : '') +
      '<label class="inl"><input type="checkbox" data-field-queue="' + i + '"' + (f.in_queue ? ' checked' : '') + '> show on dial card</label></div>' +
      '<div class="ctl"><button class="del" data-field-del="' + i + '" title="Remove column (data stays on the leads)">×</button></div></div>').join('')
      : '<div class="mono muted">No custom columns yet.</div>';
    $('retry-na').value = D.retry_days.no_answer; $('retry-vm').value = D.retry_days.voicemail; $('booking-url').value = D.booking_url || '';
    const allCols = BUILTIN_COLS.map(b => b[0]).concat(D.fields.map(f => f.key));
    $('columns-pick').innerHTML = allCols.map(c => '<button type="button" class="chip ' + (D.columns.includes(c) ? 'on' : '') + '" data-col-toggle="' + c + '">' + esc(colLabelFrom(D, c)) + '</button>').join('');
    wireSettings();
  }
  function colLabelFrom(D, c) { const b = BUILTIN_COLS.find(x => x[0] === c); if (b) return b[1]; const f = D.fields.find(x => x.key === c); return f ? f.label : c; }
  function wireSettings() {
    const D = S.draft, q = (sel) => document.querySelectorAll(sel);
    q('[data-stage-label]').forEach(e => { e.oninput = () => { D.stages[+e.dataset.stageLabel].label = e.value; }; });
    q('[data-stage-color]').forEach(e => { e.onchange = () => { D.stages[+e.dataset.stageColor].color = e.value; renderSettings(); }; });
    q('[data-stage-term]').forEach(e => { e.onchange = () => { const k = D.stages[+e.dataset.stageTerm].key; D.terminal_stages = D.terminal_stages.filter(x => x !== k); if (e.checked) D.terminal_stages.push(k); }; });
    q('[data-stage-up]').forEach(e => { e.onclick = () => { const i = +e.dataset.stageUp; [D.stages[i - 1], D.stages[i]] = [D.stages[i], D.stages[i - 1]]; renderSettings(); }; });
    q('[data-stage-down]').forEach(e => { e.onclick = () => { const i = +e.dataset.stageDown; [D.stages[i + 1], D.stages[i]] = [D.stages[i], D.stages[i + 1]]; renderSettings(); }; });
    q('[data-stage-del]').forEach(e => { e.onclick = () => { const k = D.stages[+e.dataset.stageDel].key; D.stages.splice(+e.dataset.stageDel, 1); D.terminal_stages = D.terminal_stages.filter(x => x !== k); renderSettings(); }; });
    q('[data-field-label]').forEach(e => { e.oninput = () => { D.fields[+e.dataset.fieldLabel].label = e.value; }; });
    q('[data-field-opts]').forEach(e => { e.oninput = () => { D.fields[+e.dataset.fieldOpts].options = e.value.split(',').map(s => s.trim()).filter(Boolean); }; });
    q('[data-field-queue]').forEach(e => { e.onchange = () => { D.fields[+e.dataset.fieldQueue].in_queue = e.checked; }; });
    q('[data-field-del]').forEach(e => { e.onclick = () => { const k = D.fields[+e.dataset.fieldDel].key; D.fields.splice(+e.dataset.fieldDel, 1); D.columns = D.columns.filter(c => c !== k); renderSettings(); }; });
    q('[data-col-toggle]').forEach(e => { e.onclick = () => { const c = e.dataset.colToggle; if (D.columns.includes(c)) D.columns = D.columns.filter(x => x !== c); else D.columns.push(c); renderSettings(); }; });
  }
  function addStage() {
    const label = $('stage-new').value.trim(); if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    if (!key || S.draft.stages.some(s => s.key === key)) return toast('That stage already exists', true);
    S.draft.stages.push({ key, label, color: 'stone' }); $('stage-new').value = ''; renderSettings();
  }
  function addField() {
    const label = $('field-new').value.trim(), type = $('field-type').value; if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    if (!key || S.draft.fields.some(f => f.key === key) || BUILTIN_COLS.some(b => b[0] === key)) return toast('A column with that name already exists', true);
    S.draft.fields.push({ key, label, type, options: [], in_queue: false }); S.draft.columns.push(key); $('field-new').value = ''; renderSettings();
  }
  async function saveSettings() {
    const D = S.draft; D.retry_days = { no_answer: +$('retry-na').value || 1, voicemail: +$('retry-vm').value || 2 }; D.booking_url = $('booking-url').value.trim();
    try { const r = await api('settings_save', { body: { settings: D } }); S.settings = r.settings; S.draft = null; $('settings-msg').textContent = 'Saved'; setTimeout(() => { $('settings-msg').textContent = ''; }, 2000); renderSettings(); }
    catch (e) { toast('Could not save settings: ' + e.message, true); }
  }

  // ------------------------------------------------------------ wiring
  document.querySelectorAll('.tab').forEach(t => { t.onclick = () => showView(t.dataset.view); });
  document.addEventListener('click', (e) => { const a = e.target.closest('a[data-view]'); if (a) { e.preventDefault(); showView(a.dataset.view); } });
  $('unlock').onclick = () => { const t = $('token').value.trim(); if (!t) { $('gateMsg').textContent = 'Enter your PIN.'; return; } signIn(t); };
  $('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('unlock').click(); });
  $('logout').onclick = () => signOut('Signed out.');
  let qt; $('q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { S.leads.q = $('q').value.trim(); S.leads.offset = 0; loadLeads(); }, 250); });
  $('btn-due').onclick = () => { S.leads.due = !S.leads.due; S.leads.offset = 0; renderStageChips(); loadLeads(); };
  $('btn-add').onclick = openAddLead; $('btn-import').onclick = openImport; $('btn-export').onclick = exportCsv;
  $('act-user').onchange = () => { S.actUser = $('act-user').value; renderActivity(); };
  $('stage-add').onclick = addStage; $('field-add').onclick = addField; $('settings-save').onclick = saveSettings;
  $('stage-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') addStage(); });
  $('field-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') addField(); });
  window.addEventListener('hashchange', () => { if (S.user) showView(location.hash.replace('#', '')); });
  document.addEventListener('keydown', (e) => {
    if (S.view !== 'dial' || !S.current || $('sheet-root').firstChild) return;
    const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key >= '1' && e.key <= '7') { e.preventDefault(); chooseOutcome(OUTCOME_UI[+e.key - 1].key); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); skipCurrent(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('callnote').focus(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('sheet-root').firstChild) closeSheet(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && S.view === 'dial') refreshQueueAndStats(); });

  let saved = ''; try { saved = localStorage.getItem('crm_token') || ''; } catch (e) {}
  if (saved) signIn(saved);
})();
