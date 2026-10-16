/* WAP CPD Event App — user interface. All rule decisions go through CPD (core.js). */
(function () {
  'use strict';
  const C = window.CPD, Seed = window.CPDSeed, Pdf = window.CPDPdf;
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- storage (falls back to memory when browser storage is blocked) ----------
  const mem = new Map();
  const memStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const STORAGE = (function () {
    try { const s = window.localStorage; s.setItem('__t', '1'); s.removeItem('__t'); return s; } catch (e) { return memStorage; }
  })();
  const PERSISTENT = STORAGE !== memStorage;
  const pget = (k, d) => { try { const v = STORAGE.getItem('wapcpd:pref:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const pset = (k, v) => { try { STORAGE.setItem('wapcpd:pref:' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  let SESS;
  try { SESS = window.sessionStorage; SESS.setItem('__t', '1'); SESS.removeItem('__t'); } catch (e) { SESS = memStorage; }

  const CFG = window.WAPCPD_CONFIG || null;
  const REMOTE_OK = !!(CFG && CFG.supabaseUrl && CFG.supabaseKey && window.CPDRemote);
  const AUTH = REMOTE_OK ? window.CPDRemote.createAuth(CFG, STORAGE) : null;
  function initialMode() { const m = pget('mode', REMOTE_OK ? 'shared' : 'demo'); return m === 'shared' ? (REMOTE_OK ? 'shared' : 'demo') : (m === 'live' ? 'live' : 'demo'); }
  const A = {
    mode: initialMode(), skew: 0, viewTok: null, loadError: null, loading: false,
    store: null, state: null, session: null, clock: null,
    ui: { q: '', status: 'all', prog: 'all', flag: 'all', sort: 'name', ciMode: 'arrival', ciQ: '', auditQ: '', msgStatus: 'all', msgType: 'all', lastResult: null },
    forms: {}, modal: null, afterLogin: null, flash: null
  };
  const rnd = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };

  // ---------- clock (demo data can run on a simulated clock) ----------
  const clockKey = () => 'wapcpd:clock:' + A.mode;
  function loadClock() { try { A.clock = A.mode === 'demo' ? JSON.parse(STORAGE.getItem(clockKey()) || 'null') : null; } catch (e) { A.clock = null; } }
  function setClock(ms) { A.clock = ms == null ? null : { at: ms, setAt: Date.now() }; try { STORAGE.setItem(clockKey(), JSON.stringify(A.clock)); } catch (e) { /* ignore */ } }
  const isRemote = () => A.mode === 'shared';
  const now = () => isRemote() ? Date.now() + A.skew : (A.mode === 'demo' && A.clock && A.clock.at) ? A.clock.at + (Date.now() - A.clock.setAt) : Date.now();
  const ctx = () => ({ now: now(), rand: rnd });

  // ---------- data set ----------
  function currentToken() {
    const h = decodeURIComponent(location.hash.slice(1) || '');
    if (/^[mf]-/.test(h)) return { kind: 'booking', value: h.slice(2) };
    if (/^c-/.test(h)) return { kind: 'cert', value: h.slice(2) };
    return null;
  }
  function onView(v, tok) {
    A.state = v; A.skew = (v.now || Date.now()) - Date.now(); A.viewTok = JSON.stringify(tok || null); A.loadError = null;
    A.session = v.sessions && v.sessions.remote ? 'remote' : null;
  }
  async function refresh() {
    if (!isRemote()) return;
    A.loading = true;
    try { await A.store.refresh(); } catch (e) { A.loadError = e; if (e.code === 'signed_out') { A.session = null; toast(e.message, 'bad'); } }
    finally { A.loading = false; }
  }
  function openStore() {
    if (isRemote()) {
      A.store = window.CPDRemote.createRemoteStore({ cfg: CFG, auth: AUTH, C, getToken: currentToken, onView });
      A.state = null; A.session = null; A.clock = null;
      refresh().then(() => render());
      return;
    }
    A.store = window.CPDStore.createStore({ storage: STORAGE, key: 'wapcpd:data:' + A.mode, locks: (navigator.locks || null) });
    A.state = A.store.read();
    loadClock();
    if (!A.state) {
      if (A.mode === 'demo') loadScenario('fresh');
      else { A.state = C.createState('live'); A.state.createdAt = Date.now(); A.store.write(A.state); }
    }
    try { A.session = SESS.getItem('wapcpd:session:' + A.mode) || null; } catch (e) { A.session = null; }
    if (A.session && !C.staffFor(A.state, actor())) A.session = null;
  }
  function loadScenario(sc) {
    const st = Seed.seed(sc);
    A.store.write(st); A.state = st;
    setClock(st.clock.at);
    setSession(null);
  }
  function setSession(s) { A.session = s; try { if (s) SESS.setItem('wapcpd:session:' + A.mode, s); else SESS.removeItem('wapcpd:session:' + A.mode); } catch (e) { /* ignore */ } }
  const actor = () => ({ session: A.session });
  const me = () => C.staffFor(A.state, actor());
  const can = p => C.can(A.state, actor(), p);
  const S = () => A.state, E = () => A.state.event, T = () => C.times(A.state.event);
  const isDemoData = () => isRemote() ? !!(A.state && A.state.mode === 'demo') : A.mode === 'demo';
  const pubSummary = () => (S().summary && S().viewKind !== 'staff') ? S().summary : C.publicSummary(S(), now());
  const tz = () => E().timezone;
  const F = ms => C.fmt(ms, tz());
  const FT = ms => C.fmtTime(ms, tz());
  const FD = ms => C.fmt(ms, tz(), { weekday: 'short', day: 'numeric', month: 'short' });

  async function run(fn, okMsg, opts) {
    opts = opts || {};
    try {
      const r = await A.store.transact(st => { const c = ctx(); C.processExpiries(st, c); return fn(st, c); }, A.state);
      A.state = r.state;
      if (opts.form) delete A.forms[opts.form];
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r.result) : okMsg, 'ok');
      if (opts.close !== false && A.modal && !opts.keepModal) closeModal();
      if (opts.then) opts.then(r.result);
      if (opts.render !== false) render();
      return { ok: true, result: r.result };
    } catch (e) {
      if (e && e.code) {
        if (opts.form && (e.errors || ['already_booked', 'spam', 'rsvp_closed'].includes(e.code))) { A.forms[opts.form] = Object.assign(A.forms[opts.form] || {}, { errors: e.errors || {}, message: e.message }); A.modal ? renderModal() : render(); focusError(); }
        else if (A.modal && opts.modalError !== false) { A.modal.error = e.message; renderModal(); }
        else toast(e.message, 'bad');
        return { ok: false, error: e };
      }
      console.error(e);
      toast('Something went wrong: ' + (e && e.message), 'bad');
      return { ok: false, error: e };
    }
  }
  function focusError() { setTimeout(() => { const el = document.querySelector('.invalid input, .invalid select, .invalid textarea, .form-errors'); if (el) { el.scrollIntoView({ block: 'center' }); if (el.focus) el.focus(); } }, 30); }

  // ---------- small UI helpers ----------
  function toast(msg, kind) {
    const box = $('#toasts'); if (!box) return;
    const d = document.createElement('div'); d.className = 'toast ' + (kind || ''); d.textContent = msg; d.setAttribute('role', 'status');
    while (box.children.length >= 3) box.firstChild.remove();
    d.addEventListener('click', () => d.remove());
    box.appendChild(d); setTimeout(() => d.remove(), kind === 'bad' ? 7000 : 3800);
  }
  function copy(text) {
    const done = () => toast('Copied', 'ok');
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Select the text and copy it manually.', 'bad'); } ta.remove(); };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }
  let dlPromise = null;
  function downloadsCap() {
    if (!dlPromise) dlPromise = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
    return dlPromise;
  }
  async function saveFile(name, data) {
    const cap = await downloadsCap();
    if (cap) {
      try { await cap.save({ filename: name, data }); toast('Saved: ' + name, 'ok'); }
      catch (e) { if (e && e.code === 'declined') toast('Save cancelled.'); else toast('The file could not be saved here (' + ((e && (e.message || e.code)) || 'unavailable') + ').', 'bad'); }
      return;
    }
    if (!window.claude) { // a copy opened outside the claude.ai viewer
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    toast('Saving files is not available in this view. Open the app in claude.ai and allow downloads.', 'bad');
  }
  const pdfSave = (doc, name) => saveFile(name, doc.output('arraybuffer'));
  function csv(rows) { return '﻿' + rows.map(r => r.map(v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n'); }
  function qrImg(text, cls) {
    try { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return `<img class="${cls || 'qr'}" alt="QR code" src="${q.createDataURL(6, 2)}">`; }
    catch (e) { return `<div class="${cls || 'qr'} empty small">QR code unavailable</div>`; }
  }
  const base = () => location.href.split('#')[0];
  function links(b) {
    const cert = C.currentCert(S(), b);
    return { manage: base() + '#m-' + b.token, feedback: base() + '#f-' + b.token, certificate: cert ? base() + '#c-' + cert.token : '' };
  }
  const logo = () => E().logo || window.WAP_LOGO || '';
  const contactsHtml = sep => C.contactsOf(E()).map(c => [c.phone ? `<span class="mono" style="white-space:nowrap">${esc(c.phone)}</span>` : '', c.email ? `<span class="mono">${esc(c.email)}</span>` : ''].filter(Boolean).join(' · ')).join(sep || ', or ');
  const emailOn = () => !!(isRemote() && A.state && A.state.integration && A.state.integration.email);
  const presenterPhoto = () => { const p = E().presenterPhoto; return p === 'none' ? '' : (p || window.WAP_PRESENTER || ''); };
  const nameOf = b => esc(b.firstName + ' ' + b.lastName);
  const profOf = b => esc(b.profession === 'Other' ? (b.professionOther || 'Other') : b.profession);
  function go(h) { if (location.hash.slice(1) === h) render(); else location.hash = h; }
  const isStaffView = () => /^s-|^staff$/.test(location.hash.slice(1));

  // ---------- status pills ----------
  function pBooking(b) {
    const cls = { confirmed: 'p-ok', waitlisted: 'p-warn', offered: 'p-info', cancelled: 'p-none', declined: 'p-none', expired: 'p-none', released: 'p-bad' }[b.status];
    return `<span class="pill ${cls}">${C.STATUS_LABEL[b.status]}${b.pool === 'contingency' && b.status === 'confirmed' ? ' · contingency' : ''}</span>`;
  }
  const pArr = b => b.arrival ? `<span class="pill p-ok">Arrived ${FT(b.arrival.at)}</span>` : `<span class="pill p-none">Not arrived</span>`;
  function pComp(b) {
    if (!b.completion) return `<span class="pill p-none">Not completed</span>`;
    return { confirmed: `<span class="pill p-ok">Completed</span>`, 'early-pending': `<span class="pill p-warn">Early departure – review</span>`,
      'early-approved': `<span class="pill p-ok">Completed (early, approved)</span>`, 'early-rejected': `<span class="pill p-bad">Not accepted</span>` }[b.completion.status];
  }
  const pFb = b => b.feedback ? `<span class="pill p-ok">Feedback ${b.feedback.method}</span>` : `<span class="pill p-bad">No feedback</span>`;
  function pCert(b) {
    const cs = C.certStatus(S(), b);
    const cls = { released: 'p-ok', ready: 'p-info', blocked: 'p-bad', na: 'p-none' }[cs.key];
    return `<span class="pill ${cls}" title="${esc(cs.blockers.map(x => x.label).join(' '))}">Certificate: ${cs.label}${cs.key === 'blocked' ? ' (' + cs.blockers.length + ')' : ''}</span>`;
  }
  function flagPills(b) {
    const out = [];
    if (b.flags.duplicate && !b.flags.duplicate.resolved) out.push(`<span class="pill p-warn">Possible duplicate</span>`);
    if (b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved) out.push(`<span class="pill p-warn">HPCNA no. review</span>`);
    const ex = b.exceptions.filter(x => !x.resolved).length; if (ex) out.push(`<span class="pill p-warn">${ex} exception${ex > 1 ? 's' : ''}</span>`);
    if (b.source !== 'online') out.push(`<span class="pill p-none">${esc(sourceLabel(b.source))}</span>`);
    return out.join(' ');
  }
  const sourceLabel = s => ({ online: 'Online RSVP', 'staff-phone': 'Staff: phone', 'staff-walkin': 'Staff: walk-in', 'paper-form': 'Staff: paper form', 'staff-email': 'Staff: email', 'staff-desk': 'Staff' }[s] || s);

  // ---------- shell ----------
  function topbar() {
    const s = me();
    const staff = isStaffView();
    return `<header class="topbar"><div class="topbar-in">
      <a class="brand" href="#home"><img src="${logo()}" alt="WAP Medical Supplies logo"><div><b>WAP CPD Events</b><span>${esc(E().provider)} · ${esc(E().providerNumber)}</span></div></a>
      <div class="top-actions">
        ${isRemote() ? (S().dataset === 'live' ? '' : '<span class="chip chip-test">TEST DATABASE</span>') : `<span class="chip ${A.mode === 'demo' ? 'chip-demo' : 'chip-live'}">${A.mode === 'demo' ? 'PRACTICE · this device' : 'REAL DATA · this browser'}</span>`}
        ${staff ? `<a class="btn btn-s btn-ghost" href="#home">Attendee view</a>` : `<a class="btn btn-s btn-ghost" href="#${s ? 's-dash' : 'staff'}">${s ? 'Staff dashboard' : 'Staff sign-in'}</a>`}
        ${s && staff ? `<button class="btn btn-s btn-ghost" data-act="logout">Sign out</button>` : ''}
      </div></div></header>`;
  }
  function modebar() {
    if (isRemote()) {
      if (S().dataset === 'live') return '';
      return `<div class="modebar test" role="note"><span><b>Test version with shared database.</b> Use made-up attendee details only. Test data will be cleared before real bookings open.</span>
        <button class="btn btn-s" data-act="demo-panel">Practice mode</button></div>`;
    }
    if (A.mode === 'demo') {
      const sim = A.clock && A.clock.at;
      return `<div class="modebar demo" role="note"><span>${S().scenario === 'fresh' ? '<b>Practice mode.</b> Bookings are saved on this device only and do not reach the organisers.' : '<b>Practice mode · fictional attendees.</b><span class="mb-long"> Saved on this device only, not in the shared database.</span>'}</span>
        <span>${sim ? 'Simulated time' : 'Real time'}: <b class="tnum">${F(now())}</b></span>
        <button class="btn btn-s" data-act="demo-panel">Demo controls</button></div>`;
    }
    return `<div class="modebar live" role="note"><span><b>Real data mode.</b> Saved only in this browser on this device. It is not shared with other staff devices — do not run a live event on this prototype.</span>
      <button class="btn btn-s" data-act="demo-panel">Switch data set</button></div>`;
  }
  function footer() {
    return `<footer class="foot">${esc(E().provider)} · CPD provider ${esc(E().providerNumber)}<br>Questions: ${contactsHtml()}<br>
      ${isRemote() ? '' : 'Practice mode: data stays on this device. '}Messages are prepared, not sent automatically. Certificates are not valid until HPCNA approval details are entered and the administrator releases them.${PERSISTENT || isRemote() ? '' : '<br><b>Browser storage is blocked: changes will be lost when you close this page.</b>'}</footer>`;
  }

  function loadingPage() {
    const err = A.loadError;
    return `<main class="wrap" id="main"><div class="narrow panel stack-s" style="margin-top:40px">${err
      ? `<h1>Cannot load the event</h1><p>${esc(err.message)}</p><div class="row"><button class="btn btn-primary" data-act="retry">Try again</button><button class="btn" data-act="mode" data-mode="demo">Use practice mode instead</button></div>
         <p class="small muted">Practice mode works without the shared database, with data kept on this device only.</p>`
      : '<p>Loading WAP CPD Events…</p>'}</div></main>`;
  }
  function needsFetch() {
    if (!isRemote() || !A.state) return false;
    if (A.state.viewKind === 'staff') return false;
    return JSON.stringify(currentToken()) !== A.viewTok;
  }
  function render() {
    const app0 = $('#app');
    if (isRemote() && !A.state) { app0.innerHTML = loadingPage(); return; }
    if (needsFetch()) {
      if (!A.loading) refresh().then(() => render());
      app0.innerHTML = topbar() + modebar() + loadingPage() + footer();
      return;
    }
    let v;
    try { v = view(); } catch (e) { console.error(e); v = { html: `<div class="panel"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>` }; }
    const app = $('#app');
    app.innerHTML = topbar() + modebar() + `<main class="wrap" id="main">${v.html}</main>` + footer();
    if (v.after) v.after();
    document.title = v.title ? v.title + ' · WAP CPD Events' : 'WAP CPD Events';
  }

  function view() {
    const h = decodeURIComponent(location.hash.slice(1) || 'home');
    if (h === 'home' || h === '') return vHome();
    if (h === 'rsvp') return vRsvp();
    if (h.startsWith('m-')) return vManage(h.slice(2));
    if (h.startsWith('f-')) return vFeedback(h.slice(2));
    if (h.startsWith('c-')) return vCertPublic(h.slice(2));
    if (h === 'staff' || h.startsWith('s-')) {
      if (!me()) { if (h !== 'staff') A.afterLogin = h; return vLogin(); }
      if (h === 'staff') { history.replaceState(null, '', '#s-dash'); return staffFrame('dash', vDash()); }
      const map = { 's-dash': vDash, 's-people': vPeople, 's-checkin': vCheckin, 's-waitlist': vWaitlist, 's-register': vRegister, 's-certs': vCerts,
        's-feedback': vFeedbackStaff, 's-messages': vMessages, 's-paper': vPaper, 's-data': vData, 's-settings': vSettings };
      if (h.startsWith('s-p-')) return staffFrame('people', vPerson(h.slice(4)));
      const key = h.slice(2);
      const fn = map[h] || vDash;
      return staffFrame(key, fn());
    }
    return vHome();
  }

  function staffFrame(active, inner) {
    const st = C.stats(S()), s = me();
    const items = [['dash', 'Dashboard'], ['people', 'Attendees'], ['checkin', 'Check-in & completion'], ['waitlist', 'Waiting list & places', st.waitlisted + st.pendingOffers],
      ['register', 'Register attendee'], ['certs', 'Certificates'], ['feedback', 'Feedback'], ['messages', 'Messages'], ['paper', 'Paper forms & PDFs'], ['data', 'Exports & audit'],
      ['settings', 'Settings']];
    const nav = items.filter(i => i[0] !== 'settings' || can('settings.edit')).map(i => `<a href="#s-${i[0]}" class="${active === i[0] ? 'on' : ''}">${i[1]}${i[2] ? `<span class="count" style="background:var(--warn-bg);color:var(--warn)">${i[2]}</span>` : ''}${i[0] === 'dash' && st.exceptions ? `<span class="count">${st.exceptions}</span>` : ''}</a>`).join('');
    return { title: inner.title, after: inner.after, html: `<div class="staff-layout"><nav class="sidenav" aria-label="Staff sections">${nav}
      <div class="who">Signed in as <b>${esc(s.name)}</b><br><span class="muted">${C.ROLES[s.role]}</span></div></nav><div class="stack" style="min-width:0">${inner.html}</div></div>` };
  }

  // ---------- PUBLIC: home ----------
  function vHome() {
    const e = E(), t = T(), n = now(), ps = pubSummary();
    let status;
    if (ps.status === 'open') status = `<div class="eyebrow">Advance booking</div><div><span class="big tnum">${ps.publicFree}</span> <span class="muted">of ${ps.publicCap} places left</span></div>
      <div class="meter ${ps.publicFree < 6 ? 'full' : ''}"><i style="width:${(100 * (ps.publicCap - ps.publicFree) / ps.publicCap).toFixed(1)}%"></i></div>
      <a class="btn btn-primary btn-xl" href="#rsvp">RSVP to secure your place</a>`;
    else if (ps.status === 'waitlist') status = `<div class="eyebrow">Advance booking</div><h2>All advance places are taken</h2><p>Join the waiting list. If a place becomes free, we will send you an offer with a time limit to accept.</p><a class="btn btn-primary btn-xl" href="#rsvp">Join the waiting list</a>`;
    else status = `<div class="eyebrow">Advance booking</div><h2>Online RSVPs are closed</h2><p>Online RSVPs closed on ${F(t.rsvpClose)}. If you still want to attend, please contact us: ${contactsHtml()}. Staff can register you if a place remains.</p>`;
    const prog = e.programme.map(p => `<tr><td>${esc(p.start)}–${esc(p.end)}</td><td>${esc(p.label)}</td></tr>`).join('');
    return { title: e.topic, html: `<div class="stack home">
      <section class="hero">
        <div>
          <div class="eyebrow">CPD activity · ${esc(e.provider)}</div>
          <h1>${esc(e.topic)}</h1>
          <p class="sub">${esc(e.subtitle)}</p>
        </div>
        <div class="status-card">${status}<p class="small">${esc(e.publicWording)}</p>${ps.open ? `<p class="small muted">Online RSVPs close ${F(t.rsvpClose)} (Namibia time).</p>` : ''}</div>
        <div class="panel">
          <h2>Event details</h2>
          <dl class="facts">
            <dt>Date</dt><dd>${esc(C.fmtDate(t.eventStart, tz()))}, ${esc(e.programme[0].start)}–${esc(e.programme[e.programme.length - 1].end)}</dd>
            <dt>Venue</dt><dd>${esc(e.venue)}, ${esc(e.venueAddress)}</dd>
            <dt>Presenter</dt><dd>${presenterPhoto() ? `<span class="presenter"><img class="presenter-photo" src="${esc(presenterPhoto())}" alt="Photo of ${esc(e.presenter)}" width="64" height="64"><span>${esc(e.presenter)}, ${esc(e.presenterTitle)}</span></span>` : `${esc(e.presenter)}, ${esc(e.presenterTitle)}`}</dd>
            <dt>For</dt><dd>${esc(e.audience)}</dd>
            <dt>Cost</dt><dd>${esc(e.fee)}</dd>
            <dt>Provider</dt><dd>${esc(e.provider)} · accredited provider ${esc(e.providerNumber)}</dd>
          </dl>
        </div>
      </section>
      <div class="grid2">
        <section class="panel"><h2>Programme</h2><table class="prog">${prog}</table></section>
        <section class="panel"><h2>About this session</h2><p>${esc(e.about || C.defaultEvent().about)}</p>
          <p class="small muted" style="margin-top:8px">Certificates are issued after confirmed completion of the session and a completed evaluation: <b>NO FEEDBACK, NO CERTIFICATE.</b> CPD points are subject to HPCNA approval of the activity.</p></section>
      </div>
      <section class="panel"><h2>Questions?</h2><p>${contactsHtml()}</p>
        <p class="small muted" style="margin-top:6px">Already booked? Open the private link in your confirmation message to view, change or cancel your booking.</p></section>
    </div>` };
  }

  // ---------- attendee form ----------
  function attendeeFields(fs, opts) {
    opts = opts || {};
    const v = Object.assign({ hpcnaStatus: 'provided', channel: 'whatsapp', consentEvent: false, consentMarketing: false }, fs.values || {}), er = fs.errors || {};
    const f = (name, label, input, hint) => `<div class="field ${er[name] ? 'invalid' : ''}"><label for="${opts.p || 'a'}-${name}">${label}</label>${hint ? `<span class="hint">${hint}</span>` : ''}${input}${er[name] ? `<span class="err">${esc(er[name])}</span>` : ''}</div>`;
    const id = n => `${opts.p || 'a'}-${n}`;
    const noReg = v.hpcnaStatus !== 'provided';
    return `${fs.message ? `<div class="form-errors" role="alert">${esc(fs.message)}</div>` : ''}
      <div class="two">${f('firstName', 'First name', `<input type="text" id="${id('firstName')}" name="firstName" autocomplete="given-name" value="${esc(v.firstName)}">`)}
      ${f('lastName', 'Last name', `<input type="text" id="${id('lastName')}" name="lastName" autocomplete="family-name" value="${esc(v.lastName)}">`)}</div>
      <div class="two">${f('profession', 'Profession', `<select id="${id('profession')}" name="profession"><option value="">Choose…</option>${C.PROFESSIONS.map(p => `<option ${v.profession === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`)}
      ${f('professionOther', 'If other, which profession?', `<input type="text" id="${id('professionOther')}" name="professionOther" value="${esc(v.professionOther)}">`)}</div>
      ${f('hpcna', 'HPCNA registration number', `<input type="text" id="${id('hpcna')}" name="hpcna" value="${esc(v.hpcna)}" ${noReg ? 'disabled' : ''} autocapitalize="characters">`, 'This appears on your certificate.')}
      <div class="field"><span class="lbl">No number to give?</span>
        <select id="${id('hpcnaStatus')}" name="hpcnaStatus" data-change="hpcna-toggle">
          <option value="provided" ${v.hpcnaStatus === 'provided' ? 'selected' : ''}>I have entered my registration number</option>
          <option value="unavailable" ${v.hpcnaStatus === 'unavailable' ? 'selected' : ''}>My number is not available right now</option>
          <option value="not-applicable" ${v.hpcnaStatus === 'not-applicable' ? 'selected' : ''}>Not applicable to me</option></select>
        <span class="hint">If you choose either option, staff will review your record before any certificate is issued.</span></div>
      <div class="two">${f('phone', 'Mobile number', `<input type="tel" id="${id('phone')}" name="phone" autocomplete="tel" inputmode="tel" placeholder="081 123 4567" value="${esc(v.phone)}">`)}
      ${f('email', opts.staff ? 'Email address' : 'Email address (required)', `<input type="email" id="${id('email')}" name="email" autocomplete="email" value="${esc(v.email)}">`, opts.staff ? '' : 'Your booking confirmation is emailed to you.')}</div>
      ${opts.staff ? `<label class="check"><input type="checkbox" id="${id('noEmail')}" name="noEmail" ${v.noEmail ? 'checked' : ''}><span>No email: paper or walk-in registration (the attendee has no email address)</span></label>` : ''}
      ${er.contact ? `<div class="err" role="alert" style="color:var(--bad);font-weight:700">${esc(er.contact)}</div>` : (opts.staff ? '<p class="hint muted small" style="margin-top:-10px">Give at least one: a mobile number or an email address.</p>' : '')}
      <div class="field ${er.channel ? 'invalid' : ''}"><span class="lbl">How should we contact you?</span><div class="choice-row">
        ${Object.entries(C.CHANNELS).map(([k, l]) => `<label class="choice"><input type="radio" name="channel" id="${id('ch-' + k)}" value="${k}" ${v.channel === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div>${er.channel ? `<span class="err">${esc(er.channel)}</span>` : ''}</div>
      <div class="field ${er.consentEvent ? 'invalid' : ''}"><label class="check"><input type="checkbox" id="${id('consentEvent')}" name="consentEvent" ${v.consentEvent ? 'checked' : ''}>
        <span>${opts.staff ? 'The attendee agreed to receive messages about this CPD event (booking, reminders, evaluation and certificate).' : 'I agree to receive messages about this CPD event: booking confirmation, reminders, the evaluation and my certificate. <b>(Required)</b>'}</span></label>
        ${er.consentEvent ? `<span class="err">${esc(er.consentEvent)}</span>` : ''}</div>
      <label class="check"><input type="checkbox" id="${id('consentMarketing')}" name="consentMarketing" ${v.consentMarketing ? 'checked' : ''}>
        <span>${opts.staff ? 'Optional: the attendee wants news about future WAP Medical Supplies events and offers.' : `Optional: send me news about future ${esc(E().provider)} events and offers. You can say no and still attend.`}</span></label>`;
  }
  function readAttendee(form) {
    const fd = new FormData(form), g = k => (fd.get(k) || '').toString();
    return { firstName: g('firstName'), lastName: g('lastName'), profession: g('profession'), professionOther: g('professionOther'), hpcnaStatus: g('hpcnaStatus') || 'provided',
      hpcna: g('hpcna'), phone: g('phone'), email: g('email'), channel: g('channel'), consentEvent: fd.get('consentEvent') === 'on', consentMarketing: fd.get('consentMarketing') === 'on', website: g('website'), noEmail: fd.get('noEmail') === 'on' };
  }

  function vRsvp() {
    const ps = pubSummary(), t = T();
    if (!ps.open) return { title: 'RSVP', html: `<div class="narrow panel stack"><h1>Online RSVPs are closed</h1><p>Online RSVPs closed on ${F(t.rsvpClose)}. Please contact us: ${contactsHtml()}. Staff can still register you if a place remains.</p><a class="btn" href="#home">Back to event details</a></div>` };
    const fs = A.forms.rsvp || {};
    return { title: 'RSVP', html: `<div class="narrow stack">
      <div><a href="#home" class="small">← Event details</a><h1 style="margin-top:6px">${ps.status === 'open' ? 'RSVP' : 'Join the waiting list'}</h1>
      <p class="muted" style="margin-top:6px">${esc(E().topic)} · ${esc(C.fmtDate(t.eventStart, tz()))} · ${esc(E().venueShort)}</p></div>
      ${ps.status === 'open' ? `<div class="alert ok"><div><b>${ps.publicFree} of ${ps.publicCap} places left.</b> ${esc(E().publicWording)}</div></div>` : `<div class="alert warn"><div><b>All advance-booking places are taken.</b> You will join the waiting list in the order you apply.</div></div>`}
      <form class="panel form" data-form="rsvp" novalidate><div class="hp" aria-hidden="true"><label for="a-website">Leave this field empty</label><input type="text" id="a-website" name="website" tabindex="-1" autocomplete="off"></div>${attendeeFields(fs)}
        <button class="btn btn-primary btn-xl" type="submit">${ps.status === 'open' ? 'Book my place' : 'Join the waiting list'}</button>
        <p class="small muted">We use your details to manage this event and issue your certificate. Your feedback answers are stored separately from your name.</p>
      </form></div>`, after: () => { const el = document.getElementById('a-firstName'); if (el && !fs.errors) el.focus({ preventScroll: true }); } };
  }

  // ---------- PUBLIC: manage booking ----------
  function tracker(b) {
    const cs = C.certStatus(S(), b);
    const step = (ok, label, sub, state) => `<div class="s ${state || (ok ? 'done' : '')}"><b>${ok ? '✓ ' : ''}${label}</b>${sub}</div>`;
    const comp = b.completion;
    return `<div class="track">
      ${step(b.status === 'confirmed', 'Booked', b.status === 'confirmed' ? 'Place confirmed' : C.STATUS_LABEL[b.status], b.status === 'confirmed' ? 'done' : 'wait')}
      ${step(!!b.arrival, 'Arrived', b.arrival ? FT(b.arrival.at) : 'Give your name at the desk')}
      ${step(C.completed(b), 'Completed', comp ? ({ confirmed: 'Confirmed ' + FT(comp.at), 'early-pending': 'Under review', 'early-approved': 'Approved', 'early-rejected': 'Not accepted' }[comp.status]) : 'Confirmed at end of Q&A', comp && comp.status === 'early-pending' ? 'wait' : (comp && comp.status === 'early-rejected' ? 'bad' : ''))}
      ${step(!!b.feedback, 'Evaluation', b.feedback ? 'Received' : 'Required for certificate', b.feedback ? 'done' : (C.completed(b) ? 'bad' : ''))}
      ${step(cs.key === 'released', 'Certificate', cs.key === 'released' ? 'Ready to download' : 'After checks and release')}
    </div>`;
  }
  function vManage(token) {
    const b = C.bookingByToken(S(), token);
    if (!b) return { title: 'Booking', html: `<div class="narrow panel stack"><h1>Booking not found</h1><p>${isRemote() ? 'This booking link is not valid. Please check that you opened the full link from your confirmation message, or contact us: ' + contactsHtml() + '.' : 'This link is not valid on this device. In practice mode, booking links only work on the device where the booking was made.'}</p><a class="btn" href="#home">Event details</a></div>` };
    const e = E(), t = T(), n = now(), cert = C.currentCert(S(), b), locked = !!cert;
    const isNew = A.flash === b.token; A.flash = null;
    let banner = '';
    if (b.status === 'confirmed') banner = `<div class="alert ok"><div><b>Your place is confirmed.</b> Give your name at the registration desk from ${esc(e.programme[0].start)}.${b.pool === 'contingency' ? ' (Place allocated by the organiser.)' : ''}${isNew && emailOn() && b.email ? `<br>A confirmation email with this page’s link is on its way to <b>${esc(b.email)}</b>. Please also check your spam folder.` : ''}</div></div>`;
    else if (b.status === 'waitlisted') { const pos = S().waitlistPos || (C.waitlist(S()).findIndex(x => x.id === b.id) + 1); banner = `<div class="alert warn"><div><b>${isNew ? 'You are on the waiting list.' : 'Waiting list'} — position ${pos}.</b> If a place becomes free, you will receive an offer with a time limit to accept.</div></div>`; }
    else if (b.status === 'offered') banner = `<div class="alert info"><div><b>A place is available for you.</b> Accept by <b>${F(b.offer.expiresAt)}</b> (Namibia time), or the place goes to the next person.</div>
        <div class="row"><button class="btn btn-ok" data-act="pub-accept" data-token="${esc(token)}">Accept the place</button><button class="btn" data-act="pub-decline" data-token="${esc(token)}">Decline</button></div></div>`;
    else banner = `<div class="alert bad"><div><b>${C.STATUS_LABEL[b.status]}.</b> ${b.status === 'released' ? 'Your place was released because you had not arrived after the presentation started. Please speak to the registration desk.' : 'This booking is no longer active. If this is a mistake, please contact us (details below).'}</div></div>`;
    const fbOpen = n >= t.feedbackOpen && n <= t.feedbackClose;
    const lk = links(b);
    return { title: 'My booking', html: `<div class="narrow stack">
      <div><div class="eyebrow">My booking</div><h1>${nameOf(b)}</h1><p class="muted">${esc(e.topic)} · ${esc(C.fmtDate(t.eventStart, tz()))}</p></div>
      ${banner}
      ${b.status === 'confirmed' ? `<section class="panel ticket ticket-small"><div class="stack-s"><span class="eyebrow">Booking reference</span><span class="ref">${esc(b.ref)}</span>
        <p class="small muted">Optional: show this QR code at the desk to speed up check-in. Your name is enough.</p></div>${qrImg(C.qrPayload(b), 'qr qr-small')}</section>` : `<section class="panel"><span class="eyebrow">Reference</span> <span class="ref">${esc(b.ref)}</span></section>`}
      ${b.status === 'confirmed' ? `<section class="panel stack-s"><h2>Your progress</h2>${tracker(b)}
        ${!b.feedback && b.status === 'confirmed' ? (fbOpen ? `<a class="btn btn-primary btn-xl" href="#f-${esc(token)}">Complete the evaluation</a>` : `<p class="small muted">The evaluation opens at ${F(t.feedbackOpen)}. NO FEEDBACK, NO CERTIFICATE.</p>`) : ''}
        ${cert ? `<a class="btn btn-ok btn-xl" href="#c-${esc(cert.token)}">View and download my certificate</a>` : ''}</section>` : ''}
      <section class="panel stack-s"><h2>Event</h2><dl class="kv"><dt>When</dt><dd>${esc(C.fmtDate(t.eventStart, tz()))}, ${esc(e.programme[0].start)}–${esc(e.programme[e.programme.length - 1].end)}</dd><dt>Where</dt><dd>${esc(e.venue)}, ${esc(e.venueAddress)}</dd><dt>Presenter</dt><dd>${esc(e.presenter)}</dd></dl></section>
      <section class="panel stack-s"><div class="row-between"><h2>Your details</h2>${!locked && ['confirmed', 'waitlisted', 'offered'].includes(b.status) ? `<button class="btn btn-s" data-act="pub-edit" data-token="${esc(token)}">Correct my details</button>` : ''}</div>
        <dl class="kv"><dt>Name</dt><dd>${nameOf(b)}</dd><dt>Profession</dt><dd>${profOf(b)}</dd><dt>HPCNA no.</dt><dd>${b.hpcna ? esc(b.hpcna) : '<span class="muted">Not given — staff will review</span>'}</dd>
        <dt>Mobile</dt><dd>${esc(b.phone) || '—'}</dd><dt>Email</dt><dd>${esc(b.email) || '—'}</dd><dt>Contact by</dt><dd>${C.CHANNELS[b.channel]}</dd><dt>Future news</dt><dd>${b.consentMarketing ? 'Yes' : 'No'}</dd></dl>
        ${locked ? '<p class="small muted">Your certificate has been issued, so details are locked. Please contact us for a correction (details below).</p>' : '<p class="small muted">Please make sure your name and registration number are correct. They appear on your certificate.</p>'}</section>
      <section class="panel stack-s"><h2>This link</h2><p class="small">This is your private booking link. Keep it safe and do not share it.</p>
        <div class="linkbox"><code>${esc(lk.manage)}</code><button class="btn btn-s" data-act="copy" data-text="${esc(lk.manage)}">Copy</button></div>
        ${['confirmed', 'waitlisted', 'offered'].includes(b.status) && !b.arrival && n < t.eventStart ? `<div><button class="btn btn-danger" data-act="pub-cancel" data-token="${esc(token)}">Cancel my booking</button></div>` : ''}</section>
      <p class="small muted">Questions: ${contactsHtml()}</p>
    </div>` };
  }

  // ---------- feedback form ----------
  function feedbackFields(fs) {
    const v = fs.values || { ratings: {}, choices: {}, topics: [] }, er = fs.errors || {};
    const SV = C.SURVEY;
    const ratingRow = r => `<div class="field ${er[r.key] ? 'invalid' : ''}"><span class="lbl">${esc(r.label)}</span><div class="choice-row" role="radiogroup" aria-label="${esc(r.label)}">
      ${[1, 2, 3, 4, 5].map(i => `<label class="choice"><input type="radio" id="fb-${r.key}-${i}" name="r_${r.key}" value="${i}" ${String(v.ratings[r.key]) === String(i) ? 'checked' : ''}><span>${i}</span></label>`).join('')}
      </div>${er[r.key] ? `<span class="err">${esc(er[r.key])}</span>` : ''}</div>`;
    const choiceRow = c => `<div class="field ${er[c.key] ? 'invalid' : ''}"><span class="lbl">${esc(c.label)}</span><div class="choice-row">
      ${c.options.map(o => `<label class="choice"><input type="radio" id="fb-${c.key}-${o}" name="c_${c.key}" value="${o}" ${v.choices[c.key] === o ? 'checked' : ''}><span>${o}</span></label>`).join('')}
      </div>${er[c.key] ? `<span class="err">${esc(er[c.key])}</span>` : ''}</div>`;
    return `${fs.message ? `<div class="form-errors" role="alert">${esc(fs.message)}</div>` : ''}
      <h3>1. Rate the following <span class="muted small">(1 = Poor, 5 = Excellent)</span></h3>${SV.ratings.map(ratingRow).join('')}
      <h3>2. Knowledge &amp; Impact</h3>${SV.choices.filter(c => c.section === 'Knowledge & Impact').map(choiceRow).join('')}
      <h3>3. Compliance</h3>${SV.choices.filter(c => c.section === 'Compliance').map(choiceRow).join('')}
      <h3>4. Feedback &amp; Improvement</h3><div class="field"><label for="fb-improve">What can be improved? <span class="muted small">(optional)</span></label><span class="hint">${esc(SV.improveHint)}</span><textarea id="fb-improve" name="improve">${esc(v.improve)}</textarea></div>
      <h3>5. Future CPD Needs</h3><div class="stack-s">${SV.topics.map((t, i) => `<label class="check"><input type="checkbox" id="fb-t${i}" name="topics" value="${esc(t)}" ${(v.topics || []).includes(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}
      <div class="field"><label for="fb-other">Other topic</label><input type="text" id="fb-other" name="topicOther" value="${esc(v.topicOther)}"></div></div>`;
  }
  function readFeedback(form) {
    const fd = new FormData(form), out = { ratings: {}, choices: {}, topics: fd.getAll('topics'), improve: fd.get('improve') || '', topicOther: fd.get('topicOther') || '' };
    for (const r of C.SURVEY.ratings) if (fd.get('r_' + r.key)) out.ratings[r.key] = Number(fd.get('r_' + r.key));
    for (const c of C.SURVEY.choices) if (fd.get('c_' + c.key)) out.choices[c.key] = fd.get('c_' + c.key);
    return out;
  }
  function vFeedback(token) {
    const b = C.bookingByToken(S(), token), t = T(), n = now();
    if (!b) return { title: 'Evaluation', html: `<div class="narrow panel"><h1>Link not valid</h1><p>This evaluation link is not valid${isRemote() ? '' : ' on this device'}.</p></div>` };
    const head = `<div><div class="eyebrow">CPD Evaluation Survey</div><h1>${esc(E().topic)}</h1><p class="muted">${esc(E().provider)} – Clinical Update · ${esc(C.fmtDate(t.eventStart, tz()))}</p></div>`;
    if (b.feedback) return { title: 'Evaluation', html: `<div class="narrow stack">${head}<div class="alert ok"><div><b>Thank you, ${esc(b.firstName)}. Your evaluation has been received.</b> Your certificate will be available after the remaining checks and release by the administrator.</div></div><a class="btn" href="#m-${esc(token)}">Back to my booking</a></div>` };
    if (b.status !== 'confirmed') return { title: 'Evaluation', html: `<div class="narrow stack">${head}<div class="alert bad"><div>The evaluation is for booked attendees.</div></div></div>` };
    if (n < t.feedbackOpen) return { title: 'Evaluation', html: `<div class="narrow stack">${head}<div class="alert info"><div>The evaluation opens at <b>${F(t.feedbackOpen)}</b>, after the presentation.</div></div><a class="btn" href="#m-${esc(token)}">Back to my booking</a></div>` };
    if (n > t.feedbackClose) return { title: 'Evaluation', html: `<div class="narrow stack">${head}<div class="alert bad"><div>The online evaluation has closed. Please contact us: ${contactsHtml()}.</div></div></div>` };
    const fs = A.forms.fb || {};
    return { title: 'Evaluation', html: `<div class="narrow stack">${head}
      <div class="alert warn"><div><b>NO FEEDBACK, NO CERTIFICATE.</b> Your answers are stored without your name. We only record that you have submitted.</div></div>
      <form class="panel form" data-form="fb" data-token="${esc(token)}" novalidate>${feedbackFields(fs)}<button class="btn btn-primary btn-xl" type="submit">Submit evaluation</button></form></div>` };
  }

  // ---------- certificate preview ----------
  function certSheet(b, cert) {
    const e = E(), approval = cert ? cert.approval : e.approval;
    const sample = !C.approvalComplete({ approval });
    const snap = cert ? cert.snapshot : { firstName: b.firstName, lastName: b.lastName, hpcna: b.hpcna || (b.hpcnaStatus === 'provided' ? '' : 'Not provided') };
    const demo = isDemoData();
    const wm = sample ? 'SAMPLE — NOT VALID FOR CPD' : (!cert ? 'PREVIEW — NOT ISSUED' : '');
    const dateStr = C.fmt(T().eventStart, tz(), { day: 'numeric', month: 'long', year: 'numeric' });
    const blank = s => esc(s) || '______________';
    return `<div class="cert-sheet" role="img" aria-label="Certificate preview for ${nameOf(snap)}"><div class="frame">
      <div class="c1">${esc(e.provider).toUpperCase()}</div><div class="c2">CERTIFICATE OF ATTENDANCE</div>
      <div class="c3">${sample ? 'SAMPLE — NOT VALID FOR CPD' : (!cert ? 'PREVIEW — NOT ISSUED' : '')}</div>
      <div class="c4">This certifies that</div><div class="nm">${esc(snap.firstName + ' ' + snap.lastName)}</div><div class="c4" style="margin-top:0.3cqw">Participant name</div>
      <div class="c4">HPCNA registration number: ${blank(snap.hpcna)}</div><div class="c4">attended the CPD activity</div>
      <div class="tp">${esc(e.topic)}</div><div class="c4" style="margin-top:0">${esc(dateStr)} | ${esc(e.venueShort)}</div>
      <div class="c4">Provider accreditation number: ${esc(e.providerNumber)}</div>
      <div class="c4" style="margin-top:0">Activity accreditation number: ${blank(approval.activityNumber)}</div>
      <div class="c4" style="margin-top:0">Approved CEUs: ${blank(approval.ceus)} &nbsp; Level: ${blank(approval.level)}</div>
      ${sample ? '<div style="font-size:1cqw;margin-top:0.6cqw">Activity number, CEUs and level to be completed following HPCNA approval.</div>' : ''}
      </div>
      <div class="sigs"><div>${e.signatory && e.signatory.image && cert ? `<img src="${esc(e.signatory.image)}" alt="Signature" style="position:absolute;bottom:110%;left:5%;max-height:4cqw">` : ''}Authorised provider signature${e.signatory && e.signatory.name ? `<br>${esc(e.signatory.name)}${e.signatory.title ? ', ' + esc(e.signatory.title) : ''}` : ''}</div>
        <div>${cert ? `<span class="dt">${esc(C.fmt(cert.issuedAt, tz(), { day: 'numeric', month: 'long', year: 'numeric' }))}</span>` : ''}Date of issue</div></div>
      <div class="no">${cert ? `Certificate no. ${esc(cert.number)}${cert.version > 1 ? ' (version ' + cert.version + ')' : ''} · Verification code ${esc(cert.verify)} · Booking ${esc(cert.ref)}` : `Booking ${esc(b.ref)} · not an issued certificate`}</div>
      ${wm ? `<div class="wm"><span>${wm}</span></div>` : ''}${demo ? '<div class="wm demo"><span>FICTIONAL DEMO — NOT VALID</span></div>' : ''}
    </div>`;
  }
  function vCertPublic(token) {
    const r = C.certByToken(S(), token);
    if (!r) return { title: 'Certificate', html: `<div class="narrow panel"><h1>Certificate link not valid</h1><p>This link is not valid${isRemote() ? '' : ' on this device'}. Please use the latest link sent to you, or contact us: ${contactsHtml()}.</p></div>` };
    if (r.cert.status !== 'current') return { title: 'Certificate', html: `<div class="narrow panel stack"><h1>This certificate was replaced</h1><p>A corrected version was issued on ${F(r.cert.supersededAt)}. Please use the newest link sent to you, or open your booking link.</p></div>` };
    return { title: 'Certificate', html: `<div class="stack" style="max-width:980px;margin:0 auto">
      <div><div class="eyebrow">Certificate of attendance</div><h1>${esc(r.cert.snapshot.firstName + ' ' + r.cert.snapshot.lastName)}</h1>
      <p class="muted">Certificate no. <span class="mono">${esc(r.cert.number)}</span>${r.cert.version > 1 ? ' · version ' + r.cert.version : ''} · issued ${F(r.cert.issuedAt)}</p></div>
      ${certSheet(r.booking, r.cert)}
      <div class="row"><button class="btn btn-primary btn-xl" data-act="cert-pdf" data-cert="${esc(r.cert.id)}">Download PDF</button></div>
      <p class="small muted">Keep this private link safe. ${isDemoData() ? 'This is test data and the certificate is marked not valid.' : ''}</p></div>` };
  }
  function certPdf(b, cert) {
    const doc = Pdf.certificate(S(), { booking: b, cert, demo: isDemoData() });
    const name = `${(cert ? cert.number : 'PREVIEW-' + b.ref)}_${b.lastName}_${b.firstName}`.replace(/[^A-Za-z0-9_-]+/g, '-') + '.pdf';
    return pdfSave(doc, name);
  }

  // ---------- STAFF: login ----------
  function vLoginShared() {
    const fs = A.forms.login || {};
    const notStaff = AUTH.signedIn() && S().signedInNotStaff;
    if (notStaff) return { title: 'Staff sign-in', html: `<div class="narrow stack" style="max-width:520px"><div><div class="eyebrow">Staff area</div><h1>Not on the staff list</h1></div>
      <div class="panel stack-s"><p>You are signed in as <b>${esc(AUTH.email())}</b>, but this email is not on the WAP staff list. Ask the administrator to add it in Settings.</p>
      <div><button class="btn" data-act="logout">Sign out</button></div></div></div>` };
    return { title: 'Staff sign-in', html: `<div class="narrow stack" style="max-width:520px"><div><div class="eyebrow">Staff area</div><h1>Sign in</h1></div>
      <form class="panel form" data-form="login" novalidate>${fs.message ? `<div class="form-errors" role="alert">${esc(fs.message)}</div>` : ''}
        <div class="field"><label for="lg-email">Email</label><input type="email" id="lg-email" name="email" autocomplete="username" value="${esc(fs.email || '')}"></div>
        <div class="field"><label for="lg-pw">Password</label><input type="password" id="lg-pw" name="password" autocomplete="current-password"></div>
        <button class="btn btn-primary btn-xl" type="submit">Sign in</button>
        <p class="small muted">Staff accounts are set up by the administrator. Forgotten your password? Ask the administrator to reset it.</p>
      </form></div>`, after: () => { const p = document.getElementById(fs.email ? 'lg-pw' : 'lg-email'); if (p) p.focus({ preventScroll: true }); } };
  }
  function vLogin() {
    if (isRemote()) return vLoginShared();
    const st = S();
    const active = st.staff.filter(s => s.active);
    if (!active.some(s => s.role === 'admin')) {
      const fs = A.forms.setup || {};
      return { title: 'First-time setup', html: `<div class="narrow stack"><h1>Set up the administrator</h1>
        <p class="muted">This real-data set has no staff accounts yet. Create the administrator account first. The PIN protects this browser only; it is not a secure login.</p>
        <form class="panel form" data-form="setup">${fs.message ? `<div class="form-errors">${esc(fs.message)}</div>` : ''}
          <div class="field"><label for="su-name">Administrator name</label><input type="text" id="su-name" name="name" value=""></div>
          <div class="field"><label for="su-pin">Choose a PIN (4–8 digits)</label><input type="password" id="su-pin" name="pin" inputmode="numeric" autocomplete="new-password"></div>
          <button class="btn btn-primary btn-xl" type="submit">Create administrator</button></form></div>` };
    }
    return { title: 'Staff sign-in', html: `<div class="narrow stack" style="max-width:520px"><div><div class="eyebrow">Staff area</div><h1>Sign in</h1></div>
      <form class="panel form" data-form="login">
        <div class="field"><label for="lg-staff">Your name</label><select id="lg-staff" name="staff">${active.map(s => `<option value="${s.id}">${esc(s.name)} — ${C.ROLES[s.role]}</option>`).join('')}</select></div>
        <div class="field"><label for="lg-pin">PIN</label><input type="password" id="lg-pin" name="pin" inputmode="numeric" autocomplete="current-password"></div>
        <button class="btn btn-primary btn-xl" type="submit">Sign in</button>
        ${A.mode === 'demo' ? '<div class="alert info"><div><b>Demo PINs:</b> Demo Administrator <span class="mono">1111</span> · Demo Reception (PA) <span class="mono">2222</span>. Try both to see how permissions differ.</div></div>' : ''}
        <p class="small muted">This PIN sign-in only separates roles inside this prototype. It is not real authentication; a live system needs proper accounts on a server.</p>
      </form></div>`, after: () => { const p = document.getElementById('lg-pin'); if (p) p.focus({ preventScroll: true }); } };
  }
  async function pinHash(pin) {
    const data = new TextEncoder().encode('wapcpd:' + pin);
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
    }
    return sha256hex(data);
  }
  function sha256hex(bytes) { // fallback for pages without crypto.subtle
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
    m.set(bytes); m[l] = 0x80; const dv = new DataView(m.buffer); dv.setUint32(n - 4, l * 8);
    const w = new Uint32Array(64), r = (x, s) => (x >>> s) | (x << (32 - s));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  // ---------- STAFF: dashboard ----------
  function phaseText() {
    const t = T(), n = now(), e = E();
    if (n < t.rsvpClose) return { k: 'info', txt: `Online RSVPs are open. They close ${F(t.rsvpClose)}.` };
    if (n < t.arrival) return { k: 'warn', txt: `Online RSVPs closed. Staff can still register attendees while places remain. Registration opens ${FT(t.arrival)} on ${FD(t.arrival)}.` };
    if (n <= t.eventEnd) {
      const at = hm => Date.parse(`${e.date}T${hm}:00${e.utcOffset}`);
      const seg = e.programme.find(p => n >= at(p.start) && n < at(p.end));
      return { k: 'ok', txt: seg ? `Event in progress — now: ${seg.label} (${seg.start}–${seg.end}).` : 'Event in progress.' };
    }
    return { k: 'info', txt: `The event has ended. Complete paper entries, evaluations and certificate checks.` };
  }
  function vDash() {
    const st = C.stats(S()), e = E(), t = T(), n = now(), s = me();
    const ph = phaseText();
    const tile = (label, val, cap, note) => `<div class="tile"><span class="eyebrow">${label}</span><span class="v">${val}${cap != null ? `<small> / ${cap}</small>` : ''}</span>
      ${cap ? `<div class="meter ${val >= cap ? 'full' : ''}"><i style="width:${Math.min(100, 100 * val / cap).toFixed(1)}%"></i></div>` : ''}${note ? `<span class="small muted">${note}</span>` : ''}</div>`;
    const alerts = [];
    const B = S().bookings;
    const early = B.filter(b => b.completion && b.completion.status === 'early-pending');
    const dups = B.filter(b => ['confirmed', 'waitlisted', 'offered'].includes(b.status) && b.flags.duplicate && !b.flags.duplicate.resolved);
    const hp = B.filter(b => ['confirmed', 'waitlisted', 'offered'].includes(b.status) && b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved);
    const exc = B.filter(b => b.exceptions.some(x => !x.resolved && x.type !== 'early-departure'));
    const alertRow = (k, html, actionHtml) => `<div class="alert ${k}"><div>${html}</div>${actionHtml || ''}</div>`;
    const peopleBtn = (flag, label) => `<button class="btn btn-s" data-act="filter-people" data-flag="${flag}">${label}</button>`;
    if (early.length) alerts.push(alertRow('bad', `<b>${early.length} early departure${early.length > 1 ? 's' : ''}</b> waiting for administrator review.`, peopleBtn('early', 'Review')));
    if (dups.length) alerts.push(alertRow('warn', `<b>${dups.length} possible duplicate booking${dups.length > 1 ? 's' : ''}</b> to review (administrator).`, peopleBtn('duplicate', 'Show')));
    if (hp.length) alerts.push(alertRow('warn', `<b>${hp.length} missing HPCNA number${hp.length > 1 ? 's' : ''}</b> to review (administrator).`, peopleBtn('hpcna', 'Show')));
    if (exc.length) alerts.push(alertRow('warn', `<b>${exc.length} attendee${exc.length > 1 ? 's' : ''} with open exceptions</b> flagged for administrator review.`, peopleBtn('exception', 'Show')));
    const offers = B.filter(b => b.status === 'offered').sort((a, b) => a.offer.expiresAt - b.offer.expiresAt);
    if (offers.length) alerts.push(alertRow('info', `<b>${offers.length} pending offer${offers.length > 1 ? 's' : ''}</b> holding places. Next expiry: ${F(offers[0].offer.expiresAt)}.`, `<a class="btn btn-s" href="#s-waitlist">Open</a>`));
    const w = C.offerWindow(S(), n);
    if (st.waitlisted && st.publicFree) alerts.push(alertRow('warn', `<b>${st.publicFree} place${st.publicFree > 1 ? 's' : ''} free and ${st.waitlisted} waiting.</b> ${w.ok ? 'Make the next waiting-list offer.' : 'Too late for normal offers — confirm late cases at the desk.'}`, `<a class="btn btn-s" href="#s-waitlist">Waiting list</a>`));
    if (n >= t.presentationStart && n <= t.eventEnd && st.noShows) alerts.push(alertRow('info', `<b>${st.noShows} booked attendee${st.noShows > 1 ? 's have' : ' has'} not arrived.</b> The presentation has started, so the administrator may release unused places${st.waitlisted ? ` for the ${st.waitlisted} waiting` : ''}.`, `<a class="btn btn-s" href="#s-waitlist">Release places</a>`));
    const compNoFb = B.filter(b => b.status === 'confirmed' && C.completed(b) && !b.feedback).length;
    if (compNoFb) alerts.push(alertRow('warn', `<b>${compNoFb} completed attendee${compNoFb > 1 ? 's have' : ' has'} no evaluation recorded.</b> NO FEEDBACK, NO CERTIFICATE.`, `<a class="btn btn-s" href="#s-feedback">Follow up</a>`));
    if (!C.approvalComplete(e)) alerts.push(alertRow('info', `<b>HPCNA approval details not entered.</b> All certificate previews show “SAMPLE — NOT VALID FOR CPD”.`, can('approval.edit') ? `<a class="btn btn-s" href="#s-certs">Enter details</a>` : ''));
    if (st.certs.ready) alerts.push(alertRow('ok', `<b>${st.certs.ready} certificate${st.certs.ready > 1 ? 's' : ''} ready for release.</b>`, `<a class="btn btn-s" href="#s-certs">Certificates</a>`));
    if (!PERSISTENT) alerts.push(alertRow('bad', '<b>Browser storage is blocked.</b> Changes are kept only until this page closes.'));
    // blocker summary
    const counts = {};
    for (const b of B.filter(x => x.status === 'confirmed')) for (const bl of C.certStatus(S(), b).blockers) counts[bl.code] = (counts[bl.code] || 0) + 1;
    const blkLabels = { no_arrival: 'No arrival', no_completion: 'Completion not confirmed', early_pending: 'Early departure in review', early_rejected: 'Attendance not accepted', no_feedback: 'No feedback', duplicate: 'Duplicate review', hpcna: 'HPCNA number review', details: 'Details not checked', exception: 'Open exception', approval: 'Approval details missing' };
    const blkRows = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="bar"><span style="width:190px;flex:none">${blkLabels[k] || k}</span><div class="meter"><i style="width:${(100 * v / Math.max(1, st.booked)).toFixed(1)}%;background:var(--bad)"></i></div><span class="tnum" style="width:30px;text-align:right">${v}</span></div>`).join('');
    const fstep = (label, v, of) => `<div class="step"><span class="small muted">${label}</span><b>${v}</b><span class="small muted">${of != null && of ? Math.round(100 * v / of) + '%' : ''}</span></div>`;
    return { title: 'Dashboard', html: `
      <div class="page-head"><div><div class="eyebrow">${esc(e.title)}</div><h1>Dashboard</h1><p>${esc(C.fmtDate(t.eventStart, tz()))} · ${esc(e.venueShort)}</p></div>
        <div class="row"><a class="btn btn-primary" href="#s-checkin">Check-in</a><a class="btn" href="#s-register">Register attendee</a></div></div>
      <div class="alert ${ph.k}"><div>${esc(ph.txt)}</div></div>
      <div class="tiles">
        ${tile('Advance-booking places', st.publicUsed, st.publicCap, st.pendingOffers ? `${st.publicConfirmed} booked + ${st.pendingOffers} offer pending` : `${st.publicFree} free`)}
        ${tile('Contingency places', st.contingencyUsed, st.contingencyCap, 'Administrator allocation only')}
        ${tile('Total places held', st.total, st.maxCap, `${st.totalFree} left of maximum`)}
        ${tile('Waiting list', st.waitlisted, null, st.pendingOffers ? `${st.pendingOffers} offer(s) pending` : 'No pending offers')}
      </div>
      <section class="panel"><h2>Attendance and certificate progress</h2>
        <div class="funnel">${fstep('Booked', st.booked)}${fstep('Arrived', st.arrived, st.booked)}${fstep('Completed', st.completed, st.booked)}${fstep('Feedback recorded', st.feedback, st.booked)}${fstep('Certificates released', st.certs.released, st.booked)}</div>
        <p class="small muted" style="margin-top:8px">Certificates: ${st.certs.released} released · ${st.certs.ready} ready · ${st.certs.blocked} blocked. Arrival alone does not confirm completion.</p></section>
      <div class="grid2">
        <section class="panel"><h2>Needs attention</h2><div class="alerts">${alerts.join('') || '<div class="empty">Nothing needs attention right now.</div>'}</div></section>
        <section class="panel"><h2>What blocks certificates</h2><p class="small muted" style="margin-bottom:10px">Booked attendees affected by each condition. One person can have several.</p>
          <div class="stack-s">${blkRows || '<div class="empty">No blockers.</div>'}</div></section>
      </div>
      <p class="small muted">Signed in as ${esc(s.name)} (${C.ROLES[s.role]}). ${s.role === 'pa' ? 'Administrator-only actions are hidden and also refused by the rules.' : ''}</p>` };
  }

  // ---------- STAFF: attendees ----------
  function filterPeople() {
    const u = A.ui, q = u.q.trim().toLowerCase();
    let list = S().bookings.slice();
    if (q) list = list.filter(b => [b.firstName + ' ' + b.lastName, b.lastName + ' ' + b.firstName, b.ref, b.phone, b.phoneIntl, b.email, b.hpcna].join(' ').toLowerCase().includes(q));
    if (u.status !== 'all') list = list.filter(b => u.status === 'inactive' ? ['cancelled', 'declined', 'expired', 'released'].includes(b.status) : b.status === u.status);
    const cs = b => C.certStatus(S(), b).key;
    const P = { 'not-arrived': b => b.status === 'confirmed' && !b.arrival, arrived: b => b.arrival && !b.completion, completed: b => C.completed(b),
      'no-feedback': b => b.status === 'confirmed' && C.completed(b) && !b.feedback, ready: b => cs(b) === 'ready', blocked: b => cs(b) === 'blocked', released: b => cs(b) === 'released' };
    if (u.prog !== 'all') list = list.filter(P[u.prog]);
    const Fl = { duplicate: b => b.flags.duplicate && !b.flags.duplicate.resolved, hpcna: b => b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved,
      exception: b => b.exceptions.some(x => !x.resolved && x.type !== 'early-departure'), early: b => b.completion && b.completion.status === 'early-pending',
      contingency: b => b.pool === 'contingency', staff: b => b.source !== 'online', marketing: b => b.consentMarketing, unchecked: b => b.status === 'confirmed' && !b.detailsChecked };
    if (u.flag !== 'all') list = list.filter(Fl[u.flag]);
    list.sort(u.sort === 'booked' ? (a, b) => a.seq - b.seq : (a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
    return list;
  }
  function chips(group, opts) { return `<div class="chips" role="group">${opts.map(([v, l]) => `<button class="chipbtn ${A.ui[group] === v ? 'on' : ''}" data-act="chip" data-group="${group}" data-val="${v}">${l}</button>`).join('')}</div>`; }
  function vPeople() {
    const list = filterPeople();
    const rows = list.map(b => `<tr class="click" data-act="open-person" data-id="${b.id}"><td><b>${nameOf(b)}</b><div class="small muted">${profOf(b)}</div></td><td class="mono small">${esc(b.ref)}</td>
      <td>${pBooking(b)}</td><td>${b.status === 'confirmed' ? pArr(b) : ''}</td><td>${b.status === 'confirmed' ? pComp(b) : ''}</td><td>${b.status === 'confirmed' ? pFb(b) : ''}</td><td>${b.status === 'confirmed' ? pCert(b) : ''}</td><td>${flagPills(b)}</td></tr>`).join('');
    const cards = list.map(b => `<button class="card" data-act="open-person" data-id="${b.id}"><div class="row-between"><b>${nameOf(b)}</b><span class="mono small">${esc(b.ref)}</span></div>
      <div class="row">${pBooking(b)} ${b.status === 'confirmed' ? pArr(b) + pComp(b) + pFb(b) + pCert(b) : ''} ${flagPills(b)}</div></button>`).join('');
    return { title: 'Attendees', html: `<div class="page-head"><div><h1>Attendees</h1><p>${list.length} shown of ${S().bookings.length} records.</p></div><a class="btn btn-primary" href="#s-register">Register attendee</a></div>
      <div class="filters">
        <input type="search" id="pp-q" placeholder="Search name, reference, phone, email or HPCNA number" value="${esc(A.ui.q)}" data-input="people-q" aria-label="Search attendees">
        ${chips('status', [['all', 'All'], ['confirmed', 'Booked'], ['waitlisted', 'Waiting'], ['offered', 'Offer pending'], ['inactive', 'Cancelled / released']])}
        ${chips('prog', [['all', 'Any progress'], ['not-arrived', 'Not arrived'], ['arrived', 'Arrived, not completed'], ['completed', 'Completed'], ['no-feedback', 'Completed, no feedback'], ['blocked', 'Certificate blocked'], ['ready', 'Ready'], ['released', 'Released']])}
        ${chips('flag', [['all', 'Any flag'], ['early', 'Early departure'], ['duplicate', 'Duplicate'], ['hpcna', 'HPCNA review'], ['exception', 'Exception'], ['unchecked', 'Details unchecked'], ['contingency', 'Contingency'], ['staff', 'Staff-registered'], ['marketing', 'Marketing consent']])}
        <div class="row small"><span class="muted">Sort:</span>${chips('sort', [['name', 'Last name'], ['booked', 'Booking order']])}</div>
      </div>
      <div id="people-results">${list.length ? `<div class="tbl-wrap resp"><table class="tbl"><thead><tr><th>Name</th><th>Ref</th><th>Booking</th><th>Arrival</th><th>Completion</th><th>Feedback</th><th>Certificate</th><th>Flags</th></tr></thead><tbody>${rows}</tbody></table></div><div class="cards">${cards}</div>` : '<div class="empty">No attendees match these filters.</div>'}</div>`,
      after: () => { const el = document.getElementById('pp-q'); if (el && A.ui.qFocus) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); A.ui.qFocus = false; } } };
  }

  // ---------- STAFF: person ----------
  function vPerson(id) {
    const b = S().bookings.find(x => x.id === id);
    if (!b) return { html: `<div class="panel">Booking not found. <a href="#s-people">Back to attendees</a></div>` };
    const n = now(), t = T(), cs = C.certStatus(S(), b), cert = cs.cert, lk = links(b);
    const btn = (act, label, cls, extra) => `<button class="btn ${cls || ''}" data-act="${act}" data-id="${b.id}" ${extra || ''}>${label}</button>`;
    const acts = [];
    const q = C.waitlist(S());
    const w = C.offerWindow(S(), n);
    if (b.status === 'waitlisted') {
      if (can('waitlist.offer') && q[0] && q[0].id === b.id && w.ok) acts.push(btn('offer', 'Make waiting-list offer', 'btn-primary'));
      if (can('waitlist.offerOutOfOrder') && q[0] && q[0].id !== b.id && w.ok) acts.push(btn('offer-ooo', 'Offer out of queue order…'));
    }
    if (b.status === 'offered' && can('waitlist.recordResponse')) { acts.push(btn('offer-accept', 'Record: accepted', 'btn-ok')); acts.push(btn('offer-decline', 'Record: declined')); }
    if (['waitlisted', 'expired', 'released'].includes(b.status) && can('waitlist.confirmLate') && (!w.ok || me().role === 'admin') && n <= t.eventEnd) acts.push(btn('confirm-late', b.status === 'released' ? 'Confirm place again (late case)' : 'Confirm place directly (late case)'));
    if (b.status === 'released' && can('booking.reinstate')) acts.push(btn('reinstate', 'Reinstate released booking'));
    if (['waitlisted', 'expired', 'released', 'declined'].includes(b.status) && can('contingency.allocate')) acts.push(btn('contingency', 'Allocate contingency place…'));
    if (b.status === 'confirmed' && !b.arrival && can('attendance.arrive')) acts.push(btn('arrive', 'Record arrival', 'btn-primary'));
    if (b.status === 'confirmed' && b.arrival && !b.completion && can('attendance.complete')) {
      acts.push(btn('complete', 'Completion: signed register', 'btn-ok', 'data-method="register"'));
      acts.push(btn('complete', 'Completion: QR check-out', 'btn-ok', 'data-method="qr-checkout"'));
      acts.push(btn('early', 'Record early departure…'));
    }
    if (b.completion && b.completion.status === 'early-pending' && can('exception.review')) { acts.push(btn('early-review', 'Review early departure…', 'btn-primary')); }
    if (b.arrival && !b.completion && can('attendance.undoArrival')) acts.push(btn('undo-arrival', 'Undo arrival…', 'btn-ghost'));
    if (b.completion && can('attendance.undoCompletion') && !cert) acts.push(btn('undo-completion', 'Undo completion…', 'btn-ghost'));
    if (b.status === 'confirmed' && !b.feedback && can('feedback.paper')) { acts.push(btn('paper-fb', 'Paper evaluation received…')); }
    if (b.status === 'confirmed' && !b.detailsChecked && can('details.check')) acts.push(btn('details-checked', 'Mark details checked'));
    if (b.flags.duplicate && !b.flags.duplicate.resolved && can('duplicate.resolve')) acts.push(btn('dup-resolve', 'Resolve duplicate…', 'btn-primary'));
    if (b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved && can('hpcna.resolve')) acts.push(btn('hpcna-resolve', 'Resolve HPCNA number…', 'btn-primary'));
    if (can('exception.flag')) acts.push(btn('flag', 'Flag exception for administrator…'));
    if (['confirmed', 'waitlisted', 'offered'].includes(b.status) && !b.arrival && can('booking.cancel')) acts.push(btn('cancel', 'Cancel booking…', 'btn-danger'));
    const certActs = [];
    if (b.status === 'confirmed') certActs.push(btn('cert-preview', cert ? 'View certificate' : 'Preview certificate'));
    if (cs.key === 'ready' && can('cert.release')) certActs.push(btn('cert-release', 'Release certificate', 'btn-ok'));
    if (cert && can('cert.print')) certActs.push(`<button class="btn" data-act="cert-pdf" data-cert="${cert.id}">Download / print PDF</button>`);
    if (cert && can('cert.resend')) certActs.push(btn('cert-resend', 'Prepare resend'));
    if (cert && can('cert.correct')) certActs.push(btn('cert-correct', 'Correct and reissue…'));
    const openEx = b.exceptions.filter(x => !x.resolved && x.type !== 'early-departure');
    const hist = S().audit.filter(a => a.ref === b.ref).sort((x, y) => y.at - x.at);
    const msgs = S().messages.filter(m => m.bookingId === b.id).sort((x, y) => y.createdAt - x.createdAt);
    const certs = S().certificates.filter(c => c.bookingId === b.id).sort((x, y) => y.version - x.version);
    return { title: b.firstName + ' ' + b.lastName, html: `
      <div><a href="#s-people" class="small">← Attendees</a></div>
      <div class="page-head"><div><div class="eyebrow mono">${esc(b.ref)}</div><h1>${nameOf(b)}</h1><p>${profOf(b)} · ${esc(sourceLabel(b.source))} · ${F(b.createdAt)}</p></div></div>
      <div class="row">${pBooking(b)} ${b.status === 'confirmed' ? pArr(b) + ' ' + pComp(b) + ' ' + pFb(b) + ' ' + pCert(b) : ''} ${flagPills(b)}</div>
      ${b.status === 'offered' ? `<div class="alert info"><div>Offer made ${F(b.offer.at)} by ${esc(b.offer.by)} · expires <b>${F(b.offer.expiresAt)}</b>${b.offer.capped ? ' (capped at event start)' : ''}.</div></div>` : ''}
      ${b.pool === 'contingency' ? `<div class="alert info"><div><b>Contingency place.</b> Reason: ${esc(b.contingencyReason)}</div></div>` : ''}
      ${b.flags.duplicate && !b.flags.duplicate.resolved ? `<div class="alert warn"><div><b>Possible duplicate</b> of ${b.flags.duplicate.matches.map(m => `<a href="#s-p-${m.id}">${esc(m.ref)} ${esc(m.name)}</a> (${esc(m.reasons.join(', '))})`).join('; ')}.</div></div>` : ''}
      ${b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved ? `<div class="alert warn"><div><b>HPCNA number ${b.flags.hpcnaReview.reason === 'unavailable' ? 'not available' : 'marked not applicable'}.</b> Administrator review is needed before a certificate can be issued.</div></div>` : ''}
      ${openEx.map(x => `<div class="alert warn"><div><b>Exception</b> (${esc(x.by)}, ${F(x.at)}): ${esc(x.note)}</div>${can('exception.review') ? `<button class="btn btn-s" data-act="ex-resolve" data-id="${b.id}" data-ex="${x.id}">Resolve…</button>` : ''}</div>`).join('')}
      ${b.completion && b.completion.status === 'early-pending' ? `<div class="alert bad"><div><b>Early departure</b> at ${FT(b.completion.leftAt)} recorded by ${esc(b.completion.by)}: ${esc(b.completion.note)}. Waiting for administrator review.</div></div>` : ''}
      <section class="panel stack-s"><h2>Actions</h2><div class="row">${acts.join('') || '<span class="muted">No actions available for this booking in its current state.</span>'}</div></section>
      <div class="grid2">
        <section class="panel stack-s"><h2>Certificate</h2>
          ${cert ? `<p><span class="pill p-ok">Released</span> <span class="mono">${esc(cert.number)}</span> v${cert.version} · ${F(cert.issuedAt)} by ${esc(cert.issuedBy)}</p>` : (b.status === 'confirmed' ? (cs.blockers.length ? `<p><b>Blocked by:</b></p><ul class="blk">${cs.blockers.map(x => `<li>${esc(x.label)} <span class="muted small">(${esc(x.who)})</span></li>`).join('')}</ul>` : '<p><span class="pill p-info">Ready to release</span> All conditions are met. The administrator can release it.</p>') : '<p class="muted">Only booked attendees can receive a certificate.</p>')}
          <div class="row">${certActs.join('')}</div>
          ${certs.length > 1 || (certs.length && certs[0].version > 1) ? `<h3 style="margin-top:8px">Issuance history</h3><ul class="small">${certs.map(c => `<li>v${c.version} · ${F(c.issuedAt)} · ${esc(c.issuedBy)} · ${c.status}${c.reason ? ' · ' + esc(c.reason) : ''}</li>`).join('')}</ul>` : ''}
        </section>
        <section class="panel stack-s"><div class="row-between"><h2>Details</h2>${can('booking.edit') && !cert && ['confirmed', 'waitlisted', 'offered', 'released'].includes(b.status) ? btn('edit', 'Edit details', 'btn-s') : ''}</div>
          <dl class="kv"><dt>HPCNA no.</dt><dd>${b.hpcna ? esc(b.hpcna) : `<span class="muted">${b.hpcnaStatus === 'unavailable' ? 'Not available' : 'Not applicable'}</span>`}</dd>
          <dt>Mobile</dt><dd class="mono">${esc(b.phone) || '—'}</dd><dt>Email</dt><dd>${esc(b.email) || '—'}</dd><dt>Contact by</dt><dd>${C.CHANNELS[b.channel]}</dd>
          <dt>Event messages</dt><dd>${b.consentEvent ? 'Agreed' : 'No'}</dd><dt>Marketing</dt><dd>${b.consentMarketing ? 'Opted in' : 'Not opted in'}</dd>
          <dt>Details checked</dt><dd>${b.detailsChecked ? `${F(b.detailsChecked.at)} · ${esc(b.detailsChecked.by)}` : '<span class="muted">Not yet</span>'}</dd>
          <dt>Arrival</dt><dd>${b.arrival ? `${F(b.arrival.at)} · ${esc(b.arrival.method)} · ${esc(b.arrival.by)}` : '—'}</dd>
          <dt>Completion</dt><dd>${b.completion ? (b.completion.status === 'confirmed' ? `${F(b.completion.at)} · ${b.completion.method === 'register' ? 'signed register' : 'QR check-out'} · ${esc(b.completion.by)}` : `${esc(b.completion.status)} · left ${FT(b.completion.leftAt)} · ${esc(b.completion.note)}${b.completion.reviewedBy ? ` · reviewed by ${esc(b.completion.reviewedBy)}: ${esc(b.completion.reviewNote)}` : ''}`) : '—'}</dd>
          <dt>Evaluation</dt><dd>${b.feedback ? `${F(b.feedback.at)} · ${b.feedback.method}${b.feedback.by ? ' · ' + esc(b.feedback.by) : ''}` : '—'}</dd></dl>
          ${b.corrections.length ? `<details><summary>Corrections (${b.corrections.length})</summary><ul class="small">${b.corrections.map(c => `<li>${F(c.at)} · ${esc(c.by)} · ${esc(c.field)}: “${esc(c.from)}” → “${esc(c.to)}”${c.reason ? ' · ' + esc(c.reason) : ''}</li>`).join('')}</ul></details>` : ''}
        </section>
      </div>
      <div class="grid2">
        <section class="panel stack-s"><h2>Links and QR</h2>${b.status === 'confirmed' ? `<div class="ticket">${qrImg(C.qrPayload(b))}<div class="stack-s"><span class="ref">${esc(b.ref)}</span><span class="small muted">Attendee QR for check-in and check-out.</span></div></div>` : ''}
          <span class="lbl">Booking-management link</span><div class="linkbox"><code>${esc(lk.manage)}</code><button class="btn btn-s" data-act="copy" data-text="${esc(lk.manage)}">Copy</button></div>
          <span class="lbl">Evaluation link</span><div class="linkbox"><code>${esc(lk.feedback)}</code><button class="btn btn-s" data-act="copy" data-text="${esc(lk.feedback)}">Copy</button></div>
          <p class="small muted">Links work only in this browser while the prototype stores data locally.</p></section>
        <section class="panel stack-s"><div class="row-between"><h2>Messages</h2>${can('message.prepare') ? `<div class="row"><select id="pm-type" aria-label="Message type"><option value="confirmation">Booking confirmation</option><option value="waitlist">Waiting-list notice</option><option value="offer">Offer</option><option value="reminder">Reminder</option><option value="feedback">Evaluation request</option>${cert && can('cert.resend') ? '<option value="certificate">Certificate link</option>' : ''}</select>${btn('prep-msg', 'Prepare', 'btn-s')}</div>` : ''}</div>
          ${msgs.length ? msgs.map(m => msgRow(m, b)).join('') : '<div class="empty">No messages prepared.</div>'}</section>
      </div>
      <section class="panel"><h2>History</h2>${hist.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${hist.map(a => `<tr><td class="small tnum" style="white-space:nowrap">${F(a.at)}</td><td class="small">${esc(a.who.name)}</td><td>${esc(a.action)}</td><td class="small">${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>` : (S().restricted ? '<div class="empty">The history is visible to the administrator.</div>' : '<div class="empty">No history.</div>')}</section>` };
  }
  function msgRow(m, b) {
    const pill = { prepared: 'p-info', 'manually-shared': 'p-ok', sent: 'p-ok', delivered: 'p-ok', queued: 'p-info', sending: 'p-info', failed: 'p-bad' }[m.status];
    return `<div class="alert" style="border-left-color:var(--line)"><div><b>${esc(m.type)}</b> · ${C.CHANNELS[m.channel]} · <span class="mono small">${esc(m.to || 'no address')}</span> · <span class="pill ${pill}">${C.MSG_STATUS[m.status]}</span><div class="small muted">${b ? '' : esc(m.ref) + ' · '}prepared ${F(m.createdAt)}</div></div>
      <button class="btn btn-s" data-act="msg-open" data-msg="${m.id}">Open</button></div>`;
  }

  // ---------- message modal ----------
  function openMessage(msgId) {
    const m = S().messages.find(x => x.id === msgId); const b = S().bookings.find(x => x.id === m.bookingId);
    const txt = C.messageText(S(), b, m.type, links(b));
    const full = (m.channel === 'email' ? 'Subject: ' + txt.subject + '\n\n' : '') + txt.body;
    const wa = b.phoneIntl ? `https://wa.me/${b.phoneIntl}?text=${encodeURIComponent(txt.body)}` : '';
    A.modal = { html: () => `<div class="modal-head"><div><div class="eyebrow">${esc(m.type)} · ${C.CHANNELS[m.channel]}</div><h2>Message to ${nameOf(b)}</h2></div><button class="btn btn-s" data-act="close-modal">Close</button></div>
      <dl class="kv"><dt>To</dt><dd class="mono">${esc(m.to || '— no address for this channel —')}</dd><dt>Status</dt><dd>${C.MSG_STATUS[m.status]}</dd></dl>
      ${m.channel === 'email' ? `<div class="msgtext"><b>Subject:</b> ${esc(txt.subject)}</div>` : ''}<div class="msgtext">${esc(txt.body)}</div>
      ${m.status === 'failed' ? `<div class="alert bad"><div><b>The automatic email was not sent.</b> ${esc(m.error || '')}</div></div>` : ''}
      <div class="row">${emailOn() && b.email && can('message.prepare') ? `<button class="btn btn-ok" data-act="msg-email" data-msg="${m.id}">${m.channel === 'email' ? 'Send email again' : 'Send by email now'}</button>` : ''}<button class="btn btn-primary" data-act="copy" data-text="${esc(full)}">Copy message</button>
        ${wa ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">Open in WhatsApp</a>` : ''}
        ${b.email ? `<a class="btn" href="mailto:${esc(b.email)}?subject=${encodeURIComponent(txt.subject)}&body=${encodeURIComponent(txt.body)}">Open email app</a>` : ''}</div>
      <p class="small muted">Opening WhatsApp or the email app does not send anything. After you have sent it yourself, mark it as manually shared.</p>
      ${A.modal && A.modal.error ? `<div class="form-errors">${esc(A.modal.error)}</div>` : ''}
      <div class="row">${can('message.status') ? `<button class="btn btn-ok" data-act="msg-status" data-msg="${m.id}" data-status="manually-shared" ${m.status !== 'prepared' ? 'disabled' : ''}>Mark manually shared</button>
        <button class="btn" data-act="msg-status" data-msg="${m.id}" data-status="sent" title="Needs live integration">Mark sent</button>
        <button class="btn" data-act="msg-status" data-msg="${m.id}" data-status="delivered" title="Needs live integration">Delivery confirmed</button>` : ''}</div>
      <p class="small muted">“Sent” and “Delivery confirmed” are only recorded by a connected WhatsApp or email service. They are refused in this prototype.</p>
      <details><summary class="small">History</summary><ul class="small">${m.history.map(h => `<li>${F(h.at)} · ${C.MSG_STATUS[h.status]} · ${esc(h.by)}</li>`).join('')}</ul></details>` };
    renderModal();
  }

  // ---------- modals ----------
  function renderModal() {
    const root = $('#modal-root');
    if (!A.modal) { root.innerHTML = ''; return; }
    const html = typeof A.modal.html === 'function' ? A.modal.html() : A.modal.html;
    root.innerHTML = `<div class="overlay" data-act="overlay"><div class="modal ${A.modal.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    const first = root.querySelector('input:not([type=hidden]), textarea, select');
    if (first && !A.modal.noFocus) setTimeout(() => first.focus({ preventScroll: true }), 20);
  }
  function closeModal() { A.modal = null; renderModal(); }
  /* Generic confirmation with optional note/time fields. */
  function ask(o) {
    A.modal = { html: () => `<form class="form" data-form="ask"><div class="modal-head"><h2>${esc(o.title)}</h2><button type="button" class="btn btn-s" data-act="close-modal">Close</button></div>
      ${o.body ? `<div>${o.body}</div>` : ''}
      ${(o.fields || []).map(f => f.type === 'select' ? `<div class="field"><label for="ask-${f.name}">${esc(f.label)}</label><select id="ask-${f.name}" name="${f.name}">${f.options.map(op => `<option value="${esc(op[0])}">${esc(op[1])}</option>`).join('')}</select></div>`
        : f.type === 'time' ? `<div class="field"><label for="ask-${f.name}">${esc(f.label)}</label>${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}<input type="time" id="ask-${f.name}" name="${f.name}" value="${esc(f.value || '')}"></div>`
        : `<div class="field"><label for="ask-${f.name}">${esc(f.label)}</label>${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}<${f.area ? 'textarea' : 'input type="text"'} id="ask-${f.name}" name="${f.name}" ${f.area ? '' : `value="${esc(f.value || '')}"`}>${f.area ? esc(f.value || '') + '</textarea>' : ''}</div>`).join('')}
      ${A.modal && A.modal.error ? `<div class="form-errors" role="alert">${esc(A.modal.error)}</div>` : ''}
      <div class="row"><button class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(o.ok || 'Confirm')}</button><button class="btn" type="button" data-act="close-modal">Cancel</button></div></form>`, onSubmit: o.onOk };
    renderModal();
  }
  const timeToMs = hhmm => hhmm ? Date.parse(`${E().date}T${hhmm}:00${E().utcOffset}`) : null;
  const needsTime = () => now() > T().eventEnd + C.HOUR;
  const timeField = (label) => needsTime() ? [{ name: 'time', type: 'time', label: label || 'Time from the paper record', hint: 'The event has ended, so enter the time written on the paper record.' }] : [];

  // ---------- STAFF: check-in ----------
  function ciResults() {
    const q = A.ui.ciQ.trim().toLowerCase(), mode = A.ui.ciMode;
    let list = S().bookings.filter(b => ['confirmed', 'released', 'waitlisted', 'offered'].includes(b.status));
    if (q) list = list.filter(b => [b.firstName + ' ' + b.lastName, b.lastName + ' ' + b.firstName, b.ref, b.phone, b.phoneIntl, b.hpcna].join(' ').toLowerCase().includes(q));
    else list = list.filter(b => b.status === 'confirmed' && (mode === 'arrival' ? !b.arrival : (b.arrival && !b.completion)));
    list.sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
    const shown = list.slice(0, 40);
    const r = shown.map(b => {
      let act = '';
      if (b.status !== 'confirmed') act = `<span class="small">${pBooking(b)} <a href="#s-p-${b.id}">Open record</a></span>`;
      else if (mode === 'arrival') act = b.arrival ? `<span class="pill p-ok">Arrived ${FT(b.arrival.at)}</span>` : `<button class="btn btn-primary btn-xl" data-act="arrive" data-id="${b.id}" data-method="search">Check in</button>`;
      else act = !b.arrival ? `<span class="pill p-warn">No arrival recorded</span> <button class="btn btn-s" data-act="arrive" data-id="${b.id}" data-method="search">Record arrival</button>`
        : b.completion ? pComp(b) : `<div class="row"><button class="btn btn-ok" data-act="complete" data-id="${b.id}" data-method="register">Signed register</button><button class="btn btn-s" data-act="complete" data-id="${b.id}" data-method="qr-checkout">QR check-out</button><button class="btn btn-s" data-act="early" data-id="${b.id}">Early departure</button></div>`;
      return `<div class="alert" style="border-left-color:${b.arrival ? 'var(--ok)' : 'var(--line)'}"><div><b style="font-size:1.1rem">${nameOf(b)}</b> <span class="mono small">${esc(b.ref)}</span><div class="small muted">${profOf(b)} ${flagPills(b)}</div></div>${act}</div>`;
    }).join('');
    return (r || `<div class="empty">${q ? 'No booking matches. Check the spelling, or register the person on the Register page.' : (mode === 'arrival' ? 'Everyone booked has arrived.' : 'Nobody is waiting for completion confirmation.')}</div>`) + (list.length > 40 ? `<p class="small muted">Showing 40 of ${list.length}. Type to narrow the list.</p>` : '');
  }
  function vCheckin() {
    const st = C.stats(S()), t = T(), n = now(), mode = A.ui.ciMode;
    const res = A.ui.lastResult;
    return { title: 'Check-in', html: `<div class="page-head"><div><h1>Check-in &amp; completion</h1><p>Arrived ${st.arrived} of ${st.booked} · completed ${st.completed} · registration from ${FT(t.arrival)}, completion from ${FT(t.qaEnd)}.</p></div></div>
      <div class="chips" role="tablist">${[['arrival', 'Arrival'], ['completion', 'Session completion']].map(([k, l]) => `<button class="chipbtn ${mode === k ? 'on' : ''}" style="min-height:48px;font-size:1rem" data-act="ci-mode" data-val="${k}">${l}</button>`).join('')}</div>
      ${mode === 'completion' && n < t.qaEnd ? `<div class="alert warn"><div>Completion is confirmed at the end of questions and answers (${FT(t.qaEnd)}). Anyone leaving earlier: record an early departure for administrator review.</div></div>` : ''}
      ${n < t.checkinOpen ? `<div class="alert info"><div>Check-in opens ${F(t.checkinOpen)}. You can search now, but recording starts then.</div></div>` : ''}
      ${res ? `<div class="alert ${res.ok ? 'ok' : 'bad'}" role="status"><div>${res.html}</div></div>` : ''}
      <section class="panel stack-s">
        <div class="row" style="align-items:stretch"><input type="search" id="ci-q" placeholder="Name, reference, phone or HPCNA number" value="${esc(A.ui.ciQ)}" data-input="ci-q" style="flex:1 1 260px;font-size:1.15rem;min-height:56px" aria-label="Find attendee">
          <label class="btn btn-s" for="qrfile" style="cursor:pointer;align-self:center">Scan QR (optional)</label><input type="file" id="qrfile" accept="image/*" capture="environment" data-change="qr-photo" hidden></div>
        <p class="small muted">${mode === 'completion' ? 'Completion is confirmed by the signed attendance register: tick everyone who signed, or confirm one person at a time below.' : 'Type the first letters of the surname (or the phone number), then tap Check in.'} Attendees may also show their QR code; “Scan QR” takes a photo of it.</p>
        ${mode === 'completion' ? `<div><button class="btn btn-primary" data-act="register-bulk">Enter signed register (tick several)</button></div>` : ''}
      </section>
      <div id="ci-results" class="stack-s">${ciResults()}</div>`, after: () => { const el = document.getElementById('ci-q'); if (el && A.ui.ciFocus !== false) el.focus({ preventScroll: true }); } };
  }
  async function readQrPhoto(file) {
    if (!window.jsQR) { toast('The QR reader did not load. Search by reference instead.', 'bad'); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      for (const max of [1000, 1600, 700]) {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height);
        const d = g.getImageData(0, 0, cv.width, cv.height);
        const code = window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
        if (code && code.data) return handleQr(code.data);
      }
      A.ui.lastResult = { ok: false, html: 'No QR code was found in the photo. Try again closer and in good light, or search by reference.' }; render();
    } catch (e) { toast('Could not read that image.', 'bad'); } finally { URL.revokeObjectURL(url); }
  }
  async function handleQr(data) {
    const b = C.parseQr(S(), data);
    if (!b) { A.ui.lastResult = { ok: false, html: 'This QR code is not a booking for this event (or it has been altered).' }; render(); return; }
    const mode = A.ui.ciMode;
    let r;
    if (mode === 'arrival') r = await run((st, c) => C.recordArrival(st, c, actor(), b.id, 'qr'), null, { render: false });
    else r = await run((st, c) => C.confirmCompletion(st, c, actor(), b.id, 'qr-checkout'), null, { render: false });
    A.ui.lastResult = r.ok ? { ok: true, html: `<b>${nameOf(b)}</b> (${esc(b.ref)}) — ${mode === 'arrival' ? 'arrival recorded' : 'completion confirmed by QR check-out'}.` } : { ok: false, html: `<b>${nameOf(b)}</b> (${esc(b.ref)}): ${esc(r.error.message)}` };
    render();
  }

  // ---------- STAFF: waiting list & places ----------
  function vWaitlist() {
    const st = C.stats(S()), n = now(), t = T(), w = C.offerWindow(S(), n), q = C.waitlist(S());
    const offers = S().bookings.filter(b => b.status === 'offered').sort((a, b) => a.offer.expiresAt - b.offer.expiresAt);
    const past = S().bookings.filter(b => ['expired', 'declined'].includes(b.status));
    const released = S().bookings.filter(b => b.status === 'released');
    const noShows = S().bookings.filter(b => b.status === 'confirmed' && !b.arrival);
    let offerState;
    if (!q.length) offerState = 'Nobody is waiting.';
    else if (!st.publicFree) offerState = 'No public place is free. A place frees when someone cancels, declines, lets an offer expire, or an unused booking is released.';
    else if (!w.ok) offerState = 'Too close to the event start for a normal offer. Confirm late cases at the desk instead.';
    else offerState = `Next offer gives ${w.hours} hours${w.cappedAtStart ? ', capped at event start' : ''}: until ${F(w.expiresAt)}.`;
    const canOffer = q.length && st.publicFree && w.ok && can('waitlist.offer');
    const relOpen = n >= t.presentationStart && n <= t.eventEnd;
    return { title: 'Waiting list', html: `<div class="page-head"><div><h1>Waiting list &amp; places</h1><p>${st.publicFree} public place(s) free · ${st.contingencyFree} contingency place(s) free · ${q.length} waiting · ${offers.length} offer(s) pending.</p></div></div>
      <section class="panel stack-s"><h2>Offer the next place</h2><p>${esc(offerState)}</p>
        <div class="row"><button class="btn btn-primary btn-xl" data-act="offer" ${canOffer ? '' : 'disabled'}>Offer next place${q[0] ? ' to ' + nameOf(q[0]) : ''}</button></div>
        <p class="small muted">Offers allow ${E().offerHours} hours to accept (${E().eventDayOfferHours} hours on the event day) and never run past the event start (${FT(t.eventStart)}). A pending offer holds the place until it is accepted, declined or expires.</p></section>
      <section class="panel"><h2>Queue</h2>${q.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Waiting since</th><th>Contact</th><th></th></tr></thead><tbody>${q.map((b, i) => `<tr><td class="tnum">${i + 1}</td><td><a href="#s-p-${b.id}"><b>${nameOf(b)}</b></a><div class="small muted">${profOf(b)} · ${esc(sourceLabel(b.source))}</div></td><td class="small">${F(b.waitlistedAt)}</td><td class="small">${C.CHANNELS[b.channel]}</td>
        <td><div class="row">${(!w.ok || me().role === 'admin') && st.publicFree && can('waitlist.confirmLate') && n <= t.eventEnd ? `<button class="btn btn-s" data-act="confirm-late" data-id="${b.id}">Confirm directly</button>` : ''}${can('contingency.allocate') && st.contingencyFree ? `<button class="btn btn-s" data-act="contingency" data-id="${b.id}">Contingency…</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">The waiting list is empty.</div>'}</section>
      <section class="panel"><h2>Pending offers</h2>${offers.length ? offers.map(b => `<div class="alert info"><div><a href="#s-p-${b.id}"><b>${nameOf(b)}</b></a> · offered ${F(b.offer.at)} · expires <b>${F(b.offer.expiresAt)}</b> (${Math.max(0, Math.round((b.offer.expiresAt - n) / 60000))} min left)</div>
        ${can('waitlist.recordResponse') ? `<div class="row"><button class="btn btn-s btn-ok" data-act="offer-accept" data-id="${b.id}">Accepted</button><button class="btn btn-s" data-act="offer-decline" data-id="${b.id}">Declined</button><button class="btn btn-s" data-act="prep-msg" data-id="${b.id}" data-type="offer">Prepare offer message</button></div>` : ''}</div>`).join('') : '<div class="empty">No pending offers.</div>'}</section>
      <section class="panel stack-s"><h2>Release unused bookings</h2>
        <p>After the presentation starts (${FT(t.presentationStart)}), the administrator may release places held by booked people who have not arrived. ${noShows.length} booked attendee(s) have not arrived.</p>
        ${!relOpen ? `<p class="small muted">${n < t.presentationStart ? 'Available from ' + F(t.presentationStart) + '.' : 'The event has ended.'}</p>` : ''}
        ${can('release.unused') ? `<div><button class="btn btn-primary" data-act="release-unused" ${relOpen && noShows.length ? '' : 'disabled'}>Choose bookings to release…</button></div>` : `<p class="small muted">Only the administrator can approve releasing bookings. Flag the situation if needed.</p>`}
        ${released.length ? `<h3>Released (${released.length})</h3><ul>${released.map(b => `<li><a href="#s-p-${b.id}">${nameOf(b)}</a> · ${F(b.released.at)} by ${esc(b.released.by)} ${can('booking.reinstate') ? `<button class="btn btn-s" data-act="reinstate" data-id="${b.id}">Reinstate</button>` : ''}</li>`).join('')}</ul>` : ''}</section>
      <section class="panel"><h2>Expired and declined offers</h2>${past.length ? `<ul>${past.map(b => `<li><a href="#s-p-${b.id}">${nameOf(b)}</a> · ${C.STATUS_LABEL[b.status]} ${b.offer ? '· offered ' + F(b.offer.at) : ''}</li>`).join('')}</ul>` : '<div class="empty">None.</div>'}</section>` };
  }

  // ---------- STAFF: register ----------
  function vRegister() {
    const fs = A.forms.reg || {}, st = C.stats(S()), n = now(), t = T();
    const v = fs.values || {};
    const res = A.ui.regResult;
    return { title: 'Register attendee', html: `<div class="page-head"><div><h1>Register an attendee</h1><p>For phone, walk-in, email and paper-form registrations. ${st.publicFree} public place(s) free, ${st.waitlisted} waiting, ${st.contingencyFree} contingency.</p></div></div>
      ${n >= t.rsvpClose ? `<div class="alert warn"><div>Online RSVPs are closed. Staff can still register people while places remain; when full, they join the waiting list.</div></div>` : ''}
      ${res ? `<div class="alert ok"><div><b>${esc(res.name)}</b> — ${esc(res.text)} Reference <span class="mono">${esc(res.ref)}</span>.</div><a class="btn btn-s" href="#s-p-${res.id}">Open record</a></div>` : ''}
      <form class="panel form" data-form="reg" novalidate>
        <div class="two"><div class="field"><label for="r-source">How did they register?</label><select id="r-source" name="source">${[['staff-phone', 'Phone call'], ['staff-walkin', 'Walk-in at the desk'], ['paper-form', 'Paper registration form'], ['staff-email', 'Email']].map(([k, l]) => `<option value="${k}" ${v.source === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${can('contingency.allocate') ? `<div class="field"><label for="r-pool">Place</label><select id="r-pool" name="pool"><option value="auto">Normal: advance place, or waiting list if full</option><option value="contingency" ${v.pool === 'contingency' ? 'selected' : ''}>Contingency place (administrator)</option></select></div>` : '<div></div>'}</div>
        ${can('contingency.allocate') ? `<div class="field"><label for="r-reason">Reason for contingency place</label><span class="hint">Required when using a contingency place.</span><input type="text" id="r-reason" name="reason" value="${esc(v.reason)}"></div>` : ''}
        ${attendeeFields(fs, { staff: true, p: 'r' })}
        <button class="btn btn-primary btn-xl" type="submit">Register</button>
        <p class="small muted">The rules check capacity again at the moment of saving, so two people registering at once cannot overbook.</p>
      </form>` };
  }

  // ---------- STAFF: certificates ----------
  function vCerts() {
    const e = E(), a = e.approval, list = S().bookings.filter(b => b.status === 'confirmed').sort((x, y) => (x.lastName + x.firstName).localeCompare(y.lastName + y.firstName));
    const st = C.stats(S());
    const admin = can('approval.edit');
    const rows = list.map(b => { const cs = C.certStatus(S(), b); return `<tr><td><a href="#s-p-${b.id}"><b>${nameOf(b)}</b></a><div class="small muted mono">${esc(b.ref)}</div></td><td>${pCert(b)}</td>
      <td class="small">${cs.key === 'blocked' ? cs.blockers.map(x => esc(x.label)).join('<br>') : (cs.cert ? `<span class="mono">${esc(cs.cert.number)}</span> v${cs.cert.version}` : '')}</td>
      <td><div class="row"><button class="btn btn-s" data-act="cert-preview" data-id="${b.id}">${cs.cert ? 'View' : 'Preview'}</button>${cs.key === 'ready' && can('cert.release') ? `<button class="btn btn-s btn-ok" data-act="cert-release" data-id="${b.id}">Release</button>` : ''}${cs.cert && can('cert.print') ? `<button class="btn btn-s" data-act="cert-pdf" data-cert="${cs.cert.id}">PDF</button>` : ''}</div></td></tr>`; }).join('');
    const fs = A.forms.appr || {};
    return { title: 'Certificates', html: `<div class="page-head"><div><h1>Certificates</h1><p>${st.certs.released} released · ${st.certs.ready} ready · ${st.certs.blocked} blocked.</p></div>
        ${can('cert.release') ? `<button class="btn btn-ok" data-act="release-all" ${st.certs.ready ? '' : 'disabled'}>Release all ready (${st.certs.ready})</button>` : ''}</div>
      <section class="panel stack-s"><h2>Release conditions</h2><ul class="blk">
        <li class="okk">Session completion confirmed (signed register or QR check-out; early departures approved by the administrator)</li>
        <li class="okk">Evaluation recorded — NO FEEDBACK, NO CERTIFICATE</li><li class="okk">Attendee details checked (duplicates and missing HPCNA numbers resolved)</li>
        <li class="${C.approvalComplete(e) ? 'okk' : ''}">HPCNA-approved activity number, CEUs and level entered ${C.approvalComplete(e) ? '' : '— <b>not yet</b>'}</li><li class="okk">Administrator authorises release</li></ul></section>
      <div class="grid2">
        <section class="panel stack-s"><h2>HPCNA approval details</h2>
          <p class="small">Enter these exactly as they appear on the HPCNA approval. Never estimate. Until all three are entered, every preview is marked “SAMPLE — NOT VALID FOR CPD”.</p>
          ${admin ? `<form class="form" data-form="appr">${fs.message ? `<div class="form-errors">${esc(fs.message)}</div>` : ''}
            <div class="field"><label for="ap-num">Activity accreditation number</label><input type="text" id="ap-num" name="activityNumber" value="${esc(a.activityNumber)}"></div>
            <div class="two"><div class="field"><label for="ap-ceu">Approved CEUs</label><input type="text" id="ap-ceu" name="ceus" value="${esc(a.ceus)}"></div><div class="field"><label for="ap-lvl">Level</label><input type="text" id="ap-lvl" name="level" value="${esc(a.level)}"></div></div>
            <div class="row"><button class="btn btn-primary" type="submit">Save approval details</button>${isDemoData() ? '<button class="btn" type="button" data-act="demo-approval">Fill test values</button>' : ''}</div>
            ${a.enteredBy ? `<p class="small muted">Last saved by ${esc(a.enteredBy)}, ${F(a.enteredAt)}.</p>` : ''}</form>`
            : `<dl class="kv"><dt>Activity no.</dt><dd>${esc(a.activityNumber) || '—'}</dd><dt>CEUs</dt><dd>${esc(a.ceus) || '—'}</dd><dt>Level</dt><dd>${esc(a.level) || '—'}</dd></dl><p class="small muted">Only the administrator enters approval details.</p>`}
        </section>
        <section class="panel stack-s"><h2>Signatory</h2>
          <p class="small">The template has an authorised provider signature line. Leave the image empty to sign printed copies by hand. Only upload a signature the signatory has authorised for this use.</p>
          ${admin ? `<form class="form" data-form="sig"><div class="field"><label for="sg-name">Name (printed under the line, optional)</label><input type="text" id="sg-name" name="name" value="${esc(e.signatory.name)}"></div>
            <div class="field"><label for="sg-title">Title (optional)</label><input type="text" id="sg-title" name="title" value="${esc(e.signatory.title)}"></div>
            <div class="field"><label for="sg-img">Authorised signature image (PNG, optional)</label><input type="file" id="sg-img" accept="image/png" data-change="sig-img">${e.signatory.image ? `<img src="${esc(e.signatory.image)}" alt="Current signature" style="max-height:60px;background:#fff;border-radius:6px;padding:4px"><button class="btn btn-s" type="button" data-act="sig-remove">Remove image</button>` : ''}</div>
            <button class="btn btn-primary" type="submit">Save signatory</button></form>` : `<p>${esc(e.signatory.name) || 'Not set'}</p>`}
        </section>
      </div>
      <section class="panel"><h2>Attendees</h2>${list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>Blocked by / certificate</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No booked attendees.</div>'}</section>` };
  }
  function openCertPreview(id) {
    const b = S().bookings.find(x => x.id === id); const cert = C.currentCert(S(), b); const cs = C.certStatus(S(), b);
    A.modal = { wide: true, noFocus: true, html: () => `<div class="modal-head"><div><div class="eyebrow">${cert ? 'Issued certificate' : 'Preview'}</div><h2>${nameOf(b)}</h2></div><button class="btn btn-s" data-act="close-modal">Close</button></div>
      ${!cert && cs.blockers.length ? `<div class="alert warn"><div><b>Not releasable yet.</b><ul class="blk" style="margin-top:6px">${cs.blockers.map(x => `<li>${esc(x.label)}</li>`).join('')}</ul></div></div>` : ''}
      ${certSheet(b, cert)}
      <div class="row">${cert ? (can('cert.print') ? `<button class="btn btn-primary" data-act="cert-pdf" data-cert="${cert.id}">Download / print PDF</button>` : '') : `<button class="btn" data-act="cert-preview-pdf" data-id="${b.id}">Download preview PDF</button>`}
      ${cs.key === 'ready' && can('cert.release') ? `<button class="btn btn-ok" data-act="cert-release" data-id="${b.id}">Release certificate</button>` : ''}</div>
      <p class="small muted">The layout follows the supplied certificate template. Printing: download the PDF and print it from your PDF viewer.</p>` };
    renderModal();
  }

  // ---------- STAFF: feedback ----------
  function vFeedbackStaff() {
    const B = S().bookings.filter(b => b.status === 'confirmed');
    const missing = B.filter(b => C.completed(b) && !b.feedback).sort((a, b) => a.lastName.localeCompare(b.lastName));
    const recorded = B.filter(b => b.feedback).length;
    let summary = '';
    if (can('feedback.summary')) {
      const sm = C.feedbackSummary(S(), actor());
      summary = `<section class="panel stack-s"><h2>Results summary <span class="small muted">(${sm.n} anonymous responses)</span></h2>
        ${sm.paperPending ? `<div class="alert warn"><div>${sm.paperPending} paper form(s) received but answers not entered yet.</div><button class="btn btn-s" data-act="paper-batch">Enter answers</button></div>` : ''}
        ${sm.n ? `<div class="grid2"><div class="stack-s">${Object.values(sm.ratings).map(r => `<div><div class="row-between"><span>${esc(r.label)}</span><b class="tnum">${r.avg.toFixed(2)} / 5</b></div><div class="meter"><i style="width:${(r.avg / 5 * 100).toFixed(1)}%"></i></div><span class="small muted tnum">1★ ${r.dist[0]} · 2★ ${r.dist[1]} · 3★ ${r.dist[2]} · 4★ ${r.dist[3]} · 5★ ${r.dist[4]}</span></div>`).join('')}</div>
          <div class="stack-s">${Object.values(sm.choices).map(c => `<div><b>${esc(c.label)}</b><div class="small tnum">${Object.entries(c.counts).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}</div></div>`).join('')}
          <div><b>Future topics</b><div class="small tnum">${Object.entries(sm.topics).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}</div>${sm.other.length ? `<div class="small">Other: ${sm.other.map(esc).join('; ')}</div>` : ''}</div></div></div>
          ${sm.improve.length ? `<details><summary>Improvement comments (${sm.improve.length})</summary><ul>${sm.improve.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}` : '<div class="empty">No responses yet.</div>'}
        <p class="small muted">Responses are stored without names, booking references or exact times, so individual answers cannot be linked to an attendee here.</p></section>`;
    }
    return { title: 'Feedback', html: `<div class="page-head"><div><h1>Feedback</h1><p>${recorded} evaluation(s) recorded for ${B.length} booked attendees. NO FEEDBACK, NO CERTIFICATE.</p></div>
        <div class="row"><button class="btn" data-act="paper-batch">Enter anonymous paper answers</button></div></div>
      <section class="panel stack-s"><h2>Completed, no evaluation yet (${missing.length})</h2>
        <p class="small">Record a paper form as received, or prepare a reminder with the attendee's evaluation link. Only submission status is shown, never answers.</p>
        ${missing.length ? missing.map(b => `<div class="alert warn"><div><a href="#s-p-${b.id}"><b>${nameOf(b)}</b></a> <span class="mono small">${esc(b.ref)}</span> · ${C.CHANNELS[b.channel]}</div><div class="row">
          ${can('feedback.paper') ? `<button class="btn btn-s" data-act="paper-fb" data-id="${b.id}">Paper form received…</button>` : ''}${can('message.prepare') ? `<button class="btn btn-s" data-act="prep-msg" data-id="${b.id}" data-type="feedback">Prepare reminder</button>` : ''}</div></div>`).join('') : '<div class="empty">Everyone who completed the session has an evaluation recorded.</div>'}
      </section>${summary}` };
  }
  function openPaperFeedback(id) {
    const b = id ? S().bookings.find(x => x.id === id) : null;
    A.forms.pfb = A.forms.pfb || {};
    A.modal = { html: () => `<form class="form" data-form="pfb" data-id="${b ? b.id : ''}"><div class="modal-head"><div><div class="eyebrow">${b ? 'Paper evaluation for ' + nameOf(b) : 'Anonymous paper answers'}</div><h2>${b ? 'Record paper evaluation' : 'Enter paper answers'}</h2></div><button type="button" class="btn btn-s" data-act="close-modal">Close</button></div>
      ${b ? `<label class="check"><input type="checkbox" name="withAnswers" id="pfb-with" data-change="pfb-toggle" ${A.forms.pfb.withAnswers ? 'checked' : ''}><span>Also enter the answers now. Leave unticked to only record that the form was received; enter the answers later as an anonymous batch after separating the receipt slips.</span></label>` : '<p class="small">Use this after separating the receipt slips, so answers are entered without names.</p>'}
      ${!b || A.forms.pfb.withAnswers ? feedbackFields(A.forms.pfb) : ''}
      ${A.modal && A.modal.error ? `<div class="form-errors">${esc(A.modal.error)}</div>` : ''}
      <div class="row"><button class="btn btn-primary" type="submit">${b ? 'Record evaluation received' : 'Save answers'}</button><button type="button" class="btn" data-act="close-modal">Cancel</button></div></form>` };
    renderModal();
  }

  // ---------- STAFF: messages ----------
  function vMessages() {
    const u = A.ui;
    let list = S().messages.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (u.msgStatus !== 'all') list = list.filter(m => m.status === u.msgStatus);
    if (u.msgType !== 'all') list = list.filter(m => m.type === u.msgType);
    const counts = {}; for (const m of S().messages) counts[m.status] = (counts[m.status] || 0) + 1;
    const shown = list.slice(0, 80);
    return { title: 'Messages', html: `<div class="page-head"><div><h1>Messages</h1><p>${S().messages.length} prepared messages. ${counts.prepared || 0} still to share.</p></div></div>
      ${emailOn() ? `<div class="alert info"><div><b>Emails are sent automatically</b> for booking confirmations, the waiting list and place offers (from the WAP Gmail account, up to 100 a day). Their status shows below: “Sent”, or “Email not sent” with the reason — open it to send again. WhatsApp messages are still prepared for you to send yourself; mark them “Manually shared” afterwards.</div></div>`
        : `<div class="alert info"><div><b>Nothing is sent automatically${isRemote() ? ' yet' : ''}.</b> Messages are prepared with the attendee's private links. Copy them or open WhatsApp/email, send them yourself, then mark them “Manually shared”.${isRemote() ? ' Automatic email starts once the Google email script is connected.' : ''}</div></div>`}
      ${can('message.prepare') ? `<section class="panel stack-s"><h2>Prepare in bulk</h2><div class="row">
        <button class="btn" data-act="bulk-msg" data-type="reminder">Reminders to everyone booked</button>
        <button class="btn" data-act="bulk-msg" data-type="feedback">Evaluation requests (completed, no feedback)</button>
        ${can('cert.resend') ? '<button class="btn" data-act="bulk-msg" data-type="certificate">Certificate links (released)</button>' : ''}</div></section>` : ''}
      <div class="filters">${chips('msgStatus', [['all', 'All statuses'], ['prepared', 'Prepared'], ['manually-shared', 'Manually shared'], ['sent', 'Sent'], ['delivered', 'Delivery confirmed']])}
        ${chips('msgType', [['all', 'All types'], ['confirmation', 'Confirmation'], ['waitlist', 'Waiting list'], ['offer', 'Offer'], ['reminder', 'Reminder'], ['feedback', 'Evaluation'], ['certificate', 'Certificate']])}</div>
      <div class="stack-s">${shown.map(m => { const b = S().bookings.find(x => x.id === m.bookingId); return msgRow(m).replace('<div><b>', `<div><a href="#s-p-${b.id}">${nameOf(b)}</a> · <b>`); }).join('') || '<div class="empty">No messages match.</div>'}</div>
      ${list.length > 80 ? `<p class="small muted">Showing 80 of ${list.length}.</p>` : ''}` };
  }

  // ---------- STAFF: paper & PDFs ----------
  function vPaper() {
    return { title: 'Paper forms', html: `<div class="page-head"><div><h1>Paper forms &amp; PDFs</h1><p>Backups for people without devices, and for the desk if a device fails. Download, then print from your PDF viewer.</p></div></div>
      <div class="grid2">
        <section class="panel stack-s"><h2>Attendance register</h2><p class="small">Follows the supplied WAP CPD Attendance Register. Attendees sign on completion of the educational activity.</p>
          <div class="row"><button class="btn btn-primary" data-act="pdf-register" data-kind="prefilled">Pre-filled with booked attendees</button><button class="btn" data-act="pdf-register" data-kind="blank">Blank (${E().maxCap} rows)</button></div></section>
        <section class="panel stack-s"><h2>Evaluation survey</h2><p class="small">Follows the supplied CPD Evaluation Survey, with a tear-off receipt slip so reception can record submission without linking the answers to a name.</p>
          <div><button class="btn btn-primary" data-act="pdf-survey">Download evaluation form</button></div></section>
        <section class="panel stack-s"><h2>Registration form</h2><p class="small">For walk-ins or attendees without a phone. Includes both consent boxes and an office-use section.</p>
          <div><button class="btn btn-primary" data-act="pdf-regform">Download registration form</button></div></section>
        <section class="panel stack-s"><h2>Desk check-in list</h2><p class="small">Alphabetical list of booked attendees with references and tick boxes for arrival and completion.</p>
          <div><button class="btn btn-primary" data-act="pdf-checkin">Download check-in list</button></div></section>
      </div>
      <section class="panel stack-s"><h2>Entering paper records afterwards</h2><ol class="stack-s">
        <li><b>Registration forms:</b> Register attendee → choose “Paper registration form”, type the details, and write the booking reference in the office-use box. Capacity is checked when you save; if the event is full the person joins the waiting list.</li>
        <li><b>Arrivals and completion from the register or check-in list:</b> Check-in &amp; completion → find the person → record arrival and completion. After the event the app asks for the time written on the paper. Use “Enter signed register” to tick several people at once.</li>
        <li><b>Early departures:</b> record them with the time they left and the reason. The administrator then reviews them.</li>
        <li><b>Evaluation forms:</b> first record each receipt slip against the attendee (“Paper form received”). Separate the slips, then enter the answer sheets as an anonymous batch in Feedback.</li>
        <li><b>Keep the paper originals.</b> The signed register is the attendance record the CPD Form 3 commits to submitting within one month of the activity.</li></ol></section>` };
  }

  // ---------- STAFF: exports & audit ----------
  function vData() {
    const q = A.ui.auditQ.trim().toLowerCase();
    let audit = can('audit.view') ? S().audit.slice().sort((a, b) => b.at - a.at || b.id - a.id) : [];
    if (q) audit = audit.filter(a => [a.action, a.ref, a.detail, a.who.name].join(' ').toLowerCase().includes(q));
    return { title: 'Exports & audit', html: `<div class="page-head"><div><h1>Exports &amp; audit</h1><p>CSV files open in Excel. Exports contain personal data: store them securely.</p></div></div>
      <section class="panel stack-s"><h2>Exports</h2><div class="row">
        ${can('export.register') ? '<button class="btn" data-act="export" data-kind="register">Attendance register (CSV)</button>' : ''}
        ${can('export.full') ? `<button class="btn" data-act="export" data-kind="attendees">All attendee records (CSV)</button><button class="btn" data-act="export" data-kind="certs">Certificate issuance (CSV)</button>
          <button class="btn" data-act="export" data-kind="messages">Messages (CSV)</button><button class="btn" data-act="export" data-kind="feedback">Anonymous evaluation answers (CSV)</button><button class="btn" data-act="export" data-kind="audit">Audit history (CSV)</button>
          <button class="btn" data-act="export" data-kind="marketing">Marketing opt-ins (CSV)</button>` : ''}</div>
        ${can('export.full') ? '' : '<p class="small muted">Full exports are administrator-only.</p>'}</section>
      ${can('data.restore') && isRemote() ? `<section class="panel stack-s"><h2>Backup</h2><p class="small">Download a copy of all shared data. The server also keeps an automatic snapshot every hour.</p>
        <div class="row"><button class="btn" data-act="export" data-kind="backup">Download backup (JSON)</button></div></section>` : ''}
      ${can('data.restore') && !isRemote() ? `<section class="panel stack-s"><h2>Backup and restore</h2><p class="small">A backup file holds this whole data set (${A.mode === 'demo' ? 'demo' : 'real'} data). Restoring replaces what is in this browser.</p>
        <div class="row"><button class="btn" data-act="export" data-kind="backup">Download backup (JSON)</button><label class="btn" for="restore-file" style="cursor:pointer">Restore from backup…</label><input type="file" id="restore-file" accept="application/json,.json" data-change="restore" hidden></div></section>` : ''}
      ${can('audit.view') ? `<section class="panel stack-s"><h2>Audit history</h2><input type="search" id="au-q" placeholder="Search actions, references, staff" value="${esc(A.ui.auditQ)}" data-input="audit-q" aria-label="Search audit">
        <div id="audit-results">${auditTable(audit)}</div></section>` : '<section class="panel"><p class="muted">The audit history is visible to the administrator.</p></section>'}`,
      after: () => { const el = document.getElementById('au-q'); if (el && A.ui.auFocus) { el.focus(); A.ui.auFocus = false; } } };
  }
  function auditTable(audit) {
    return audit.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Ref</th><th>Detail</th></tr></thead><tbody>${audit.slice(0, 300).map(a => `<tr><td class="small tnum" style="white-space:nowrap">${F(a.at)}</td><td class="small">${esc(a.who.name)}${a.who.role ? `<div class="muted">${C.ROLES[a.who.role]}</div>` : ''}</td><td>${esc(a.action)}</td><td class="mono small">${esc(a.ref)}</td><td class="small">${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>${audit.length > 300 ? `<p class="small muted">Showing 300 of ${audit.length}. Export for the full history.</p>` : ''}` : '<div class="empty">No entries.</div>';
  }
  function doExport(kind) {
    const st = S(), stamp = C.localDate(now(), tz());
    const prof = b => b.profession === 'Other' ? b.professionOther : b.profession;
    const time = ms => ms ? C.fmt(ms, tz(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    const conf = st.bookings.filter(b => b.status === 'confirmed').sort((a, b) => a.lastName.localeCompare(b.lastName));
    let rows, name;
    switch (kind) {
      case 'register':
        rows = [['No.', 'Ref', 'Profession', 'HPCNA registration no', 'First name', 'Last name', 'Telephone', 'Email', 'Arrived', 'Completion', 'Completion method', 'Recorded by', 'Evaluation']];
        conf.forEach((b, i) => rows.push([i + 1, b.ref, prof(b), b.hpcna, b.firstName, b.lastName, b.phone, b.email, time(b.arrival && b.arrival.at), b.completion ? b.completion.status : '', b.completion ? (b.completion.method || '') : '', b.completion ? b.completion.by : '', b.feedback ? b.feedback.method : '']));
        name = `attendance-register-${stamp}.csv`; break;
      case 'attendees':
        rows = [['Ref', 'Status', 'Place type', 'Contingency reason', 'Source', 'Created', 'First name', 'Last name', 'Profession', 'HPCNA status', 'HPCNA no', 'Phone', 'Email', 'Channel', 'Event consent', 'Marketing consent', 'Duplicate flag', 'Details checked', 'Arrived', 'Completion', 'Evaluation', 'Certificate', 'Blocked by']];
        st.bookings.forEach(b => { const cs = C.certStatus(st, b); rows.push([b.ref, C.STATUS_LABEL[b.status], b.pool, b.contingencyReason, sourceLabel(b.source), time(b.createdAt), b.firstName, b.lastName, prof(b), b.hpcnaStatus, b.hpcna, b.phone, b.email, b.channel, b.consentEvent ? 'yes' : 'no', b.consentMarketing ? 'yes' : 'no',
          b.flags.duplicate ? (b.flags.duplicate.resolved ? 'resolved' : 'open') : '', b.detailsChecked ? 'yes' : 'no', time(b.arrival && b.arrival.at), b.completion ? b.completion.status : '', b.feedback ? b.feedback.method : '', cs.label, cs.blockers.map(x => x.label).join(' | ')]); });
        name = `attendees-${stamp}.csv`; break;
      case 'certs':
        rows = [['Certificate no', 'Version', 'Status', 'Ref', 'Name on certificate', 'HPCNA no', 'Issued', 'Issued by', 'Reason', 'Activity no', 'CEUs', 'Level', 'Verification code']];
        st.certificates.forEach(c => rows.push([c.number, c.version, c.status, c.ref, c.snapshot.firstName + ' ' + c.snapshot.lastName, c.snapshot.hpcna, time(c.issuedAt), c.issuedBy, c.reason, c.approval.activityNumber, c.approval.ceus, c.approval.level, c.verify]));
        name = `certificates-${stamp}.csv`; break;
      case 'messages':
        rows = [['Ref', 'Type', 'Channel', 'To', 'Status', 'Prepared', 'Last change']];
        st.messages.forEach(m => rows.push([m.ref, m.type, m.channel, m.to, C.MSG_STATUS[m.status], time(m.createdAt), time(m.history[m.history.length - 1].at)]));
        name = `messages-${stamp}.csv`; break;
      case 'feedback':
        rows = [['Method', 'Day'].concat(C.SURVEY.ratings.map(r => r.label), C.SURVEY.choices.map(c => c.label), ['Improvements', 'Future topics', 'Other topic'])];
        st.responses.forEach(r => rows.push([r.method, r.day].concat(C.SURVEY.ratings.map(x => r.answers.ratings[x.key]), C.SURVEY.choices.map(x => r.answers.choices[x.key]), [r.answers.improve, r.answers.topics.join('; '), r.answers.topicOther])));
        name = `evaluation-answers-anonymous-${stamp}.csv`; break;
      case 'audit':
        rows = [['When', 'Who', 'Role', 'Action', 'Ref', 'Detail']];
        st.audit.slice().sort((a, b) => a.at - b.at).forEach(a => rows.push([time(a.at), a.who.name, a.who.role ? C.ROLES[a.who.role] : '', a.action, a.ref, a.detail]));
        name = `audit-${stamp}.csv`; break;
      case 'marketing':
        rows = [['First name', 'Last name', 'Profession', 'Phone', 'Email', 'Preferred channel']];
        st.bookings.filter(b => b.consentMarketing && b.status !== 'cancelled').forEach(b => rows.push([b.firstName, b.lastName, prof(b), b.phone, b.email, b.channel]));
        name = `marketing-opt-ins-${stamp}.csv`; break;
      case 'backup': {
        const copy = JSON.parse(JSON.stringify(st)); copy.sessions = {};
        return saveFile(`wap-cpd-${A.mode}-backup-${stamp}.json`, JSON.stringify(copy, null, 1));
      }
    }
    return saveFile(name, csv(rows));
  }

  // ---------- STAFF: settings ----------
  function vSettings() {
    if (!can('settings.edit')) return { html: '<div class="panel">Only the administrator can change settings.</div>' };
    const e = E(), fs = A.forms.ev || {};
    const val = (k, v) => esc(fs.values && fs.values[k] != null ? fs.values[k] : v);
    const inp = (k, label, v, type, hint) => `<div class="field"><label for="ev-${k}">${label}</label>${hint ? `<span class="hint">${hint}</span>` : ''}<input type="${type || 'text'}" id="ev-${k}" name="${k}" value="${val(k, v)}"></div>`;
    const rc = e.rsvpClose.slice(0, 16);
    return { title: 'Settings', html: `<div class="page-head"><div><h1>Settings</h1><p>Event details are configurable so the app can be reused for future events.</p></div></div>
      <form class="panel form" data-form="ev">${fs.message ? `<div class="form-errors">${esc(fs.message)}</div>` : ''}
        <h2>Event</h2>
        <div class="two">${inp('topic', 'Topic', e.topic)}${inp('title', 'Activity name', e.title)}</div>${inp('subtitle', 'Subtitle', e.subtitle)}
        <div class="two">${inp('date', 'Date', e.date, 'date')}${inp('refPrefix', 'Booking reference prefix', e.refPrefix, 'text', '2–8 capitals/numbers, e.g. RHI26')}</div>
        <div class="two">${inp('venue', 'Venue', e.venue)}${inp('venueAddress', 'Venue address', e.venueAddress)}</div>${inp('venueShort', 'Venue (short, for certificates)', e.venueShort)}
        <div class="two">${inp('presenter', 'Presenter', e.presenter)}${inp('presenterTitle', 'Presenter title', e.presenterTitle)}</div>${inp('presenterSpecialty', 'Presenter specialty (attendance register)', e.presenterSpecialty || '')}
        <div class="two">${inp('audience', 'Audience', e.audience)}${inp('fee', 'Cost', e.fee)}</div>
        <div class="two">${inp('provider', 'Provider', e.provider)}${inp('providerNumber', 'Provider number', e.providerNumber)}</div>
        <h3>Contact details shown to attendees</h3>${[0, 1].map(i => { const c = C.contactsOf(e)[i] || {}; return `<div class="two">${inp('cphone' + i, `Contact ${i + 1}: phone`, c.phone || '')}${inp('cemail' + i, `Contact ${i + 1}: email`, c.email || '')}</div>`; }).join('')}
        <h2>Programme</h2><p class="small muted">Arrival, welcome (event start), presentation, Q&amp;A end (completion opens) and evaluation drive the rules.</p>
        ${e.programme.map((p, i) => `<div class="two"><div class="field"><label for="pg-l${i}">${esc(p.key)}</label><input type="text" id="pg-l${i}" name="pl${i}" value="${esc(p.label)}"></div><div class="two"><div class="field"><label for="pg-s${i}">Start</label><input type="time" id="pg-s${i}" name="ps${i}" value="${esc(p.start)}"></div><div class="field"><label for="pg-e${i}">End</label><input type="time" id="pg-e${i}" name="pe${i}" value="${esc(p.end)}"></div></div></div>`).join('')}
        <h2>Places and deadlines</h2>
        <div class="two">${inp('publicCap', 'Advance-booking places', e.publicCap, 'number')}${inp('contingencyCap', 'Contingency places', e.contingencyCap, 'number')}</div>
        <div class="two">${inp('maxCap', 'Maximum attendance', e.maxCap, 'number')}${inp('rsvpClose', 'Online RSVPs close (Namibia time)', rc, 'datetime-local')}</div>
        <div class="two">${inp('offerHours', 'Offer time limit (hours)', e.offerHours, 'number')}${inp('eventDayOfferHours', 'Offer time limit on event day (hours)', e.eventDayOfferHours, 'number')}</div>
        <div class="two">${inp('minOfferMinutes', 'Minimum offer window (minutes)', e.minOfferMinutes, 'number', 'Shorter windows become desk-handled late cases.')}${inp('feedbackOpensTime', 'Online evaluation opens', e.feedbackOpensTime, 'time')}</div>
        <div class="field"><label for="ev-about">About this session (landing page)</label><textarea id="ev-about" name="about">${val('about', e.about || C.defaultEvent().about)}</textarea></div>
        <div class="field"><label for="ev-publicWording">Public booking wording</label><textarea id="ev-publicWording" name="publicWording">${val('publicWording', e.publicWording)}</textarea></div>
        <button class="btn btn-primary btn-xl" type="submit">Save event settings</button>
      </form>
      <section class="panel stack-s"><h2>Logo</h2><div class="row"><img src="${logo()}" alt="Current logo" style="width:90px;background:#fff;border-radius:8px;padding:4px"><label class="btn" for="logo-file" style="cursor:pointer">Replace logo…</label><input type="file" id="logo-file" accept="image/png,image/jpeg" data-change="logo" hidden>${e.logo ? '<button class="btn" data-act="logo-reset">Use supplied logo</button>' : ''}</div></section>
      ${isRemote() ? `<section class="panel stack-s"><h2>Practice mode</h2><p class="small muted">Rehearse with fictional attendees and a simulated clock, saved on this device only. It does not touch the real bookings.</p><div><button class="btn" data-act="mode" data-mode="demo">Open practice mode on this device</button></div></section>` : ''}
      <section class="panel stack-s"><h2>Presenter photo</h2><p class="small muted">Shown next to the presenter on the event page. Use a photo the presenter has agreed to.</p><div class="row">${presenterPhoto() ? `<img src="${esc(presenterPhoto())}" alt="Current presenter photo" class="presenter-photo">` : '<span class="muted">No photo shown.</span>'}<label class="btn" for="presenter-file" style="cursor:pointer">Replace photo…</label><input type="file" id="presenter-file" accept="image/png,image/jpeg" data-change="presenter-photo" hidden>${e.presenterPhoto ? '<button class="btn" data-act="presenter-reset">Use supplied photo</button>' : ''}${e.presenterPhoto !== 'none' ? '<button class="btn" data-act="presenter-remove">Show no photo</button>' : ''}</div></section>
      <section class="panel stack-s"><h2>Staff access</h2>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${S().staff.map(s => `<tr><td>${esc(s.name)}${s.email ? `<div class="small muted">${esc(s.email)}</div>` : ''}</td><td>${C.ROLES[s.role]}</td><td>${s.active ? '<span class="pill p-ok">Active</span>' : '<span class="pill p-none">Deactivated</span>'}</td>
          <td><div class="row"><button class="btn btn-s" data-act="staff-toggle" data-id="${s.id}">${s.active ? 'Deactivate' : 'Reactivate'}</button>${isRemote() ? '' : `<button class="btn btn-s" data-act="staff-pin" data-id="${s.id}">Reset PIN…</button>`}</div></td></tr>`).join('')}</tbody></table></div>
        <form class="form" data-form="staff"><h3>Add staff member</h3><div class="two"><div class="field"><label for="st-name">Name</label><input type="text" id="st-name" name="name"></div>
          <div class="field"><label for="st-role">Role</label><select id="st-role" name="role"><option value="pa">PA / Reception</option><option value="admin">Administrator</option></select></div></div>
          ${isRemote() ? '<div class="field"><label for="st-email">Email (their sign-in)</label><input type="email" id="st-email" name="email" autocomplete="off"></div>' : '<div class="field"><label for="st-pin">PIN (4–8 digits)</label><input type="password" id="st-pin" name="pin" inputmode="numeric" autocomplete="new-password"></div>'}
          <div><button class="btn btn-primary" type="submit">Add staff member</button></div></form>
        <p class="small muted">${isRemote() ? 'Adding someone here gives their email a role. They also need a login: in Supabase, open Authentication → Users → Add user, and create the same email with a password. Deactivating someone here removes their access immediately.' : 'Practice mode: PINs only separate roles on this device.'}</p></section>` };
  }

  // ---------- demo controls ----------
  function openDemoPanel() {
    const ev = E(), d = ev.date;
    const presets = [['2026-10-05T10:00', 'Mon 5 Oct, 10:00 (bookings open)'], [`${d}T09:00`, 'Event day 09:00 (2-hour offers)'], [`${d}T11:58`, 'Event day 11:58 (2 min before RSVPs close)'],
      [`${d}T12:01`, 'Event day 12:01 (RSVPs closed)'], [`${d}T17:45`, 'Event day 17:45 (registration desk)'], [`${d}T18:06`, 'Event day 18:06 (release unused allowed)'],
      [`${d}T19:00`, 'Event day 19:00 (before end of Q&A)'], [`${d}T19:31`, 'Event day 19:31 (completion & evaluation)'], ['2026-10-24T10:00', 'Next day 10:00 (paper entry)']];
    if (isRemote()) {
      A.modal = { html: () => `<div class="modal-head"><div><div class="eyebrow">Test version</div><h2>Practice mode</h2></div><button class="btn btn-s" data-act="close-modal">Close</button></div>
        <p>You are using the <b>shared test database</b>. Everything you do here is seen by other staff.</p>
        <p>Practice mode uses fictional attendees and a simulated clock, saved on this device only. Use it to rehearse event night without affecting the shared data.</p>
        <div class="row"><button class="btn btn-primary" data-act="mode" data-mode="demo">Switch to practice mode</button></div>` };
      return renderModal();
    }
    A.modal = { html: () => `<div class="modal-head"><div><div class="eyebrow">Prototype</div><h2>${A.mode === 'demo' ? 'Practice controls' : 'Data set'}</h2></div><button class="btn btn-s" data-act="close-modal">Close</button></div>
      ${A.mode === 'demo' ? `<section class="stack-s"><h3>Load a scenario (replaces current demo data)</h3><div class="row">
        <button class="btn btn-primary" data-act="scenario" data-sc="fresh">Fresh start · real time, no bookings</button>
        <button class="btn" data-act="scenario" data-sc="booking">Booking phase · 12 Oct (2 places left)</button>
        <button class="btn" data-act="scenario" data-sc="event">Event night · 23 Oct 19:40 (full workflow)</button></div>
        <p class="small muted">Event night includes waiting-list offers that expired and were declined, contingency places with reasons, a paper-form and walk-in registration, two walk-ins on the waiting list, no-shows, early departures, a duplicate, a missing HPCNA number, paper and online evaluations, and certificates blocked for different reasons.</p></section>
      <section class="stack-s"><h3>Simulated time</h3><p class="small">Current: <b>${F(now())}</b>. Time keeps running from the point you set.</p>
        <div class="row">${presets.map(([v, l]) => `<button class="btn btn-s" data-act="clock" data-at="${v}">${l}</button>`).join('')}</div>
        <form class="row" data-form="clock"><input type="datetime-local" id="clk" name="at" style="max-width:260px" aria-label="Custom time"><button class="btn btn-s" type="submit">Set custom time</button><button class="btn btn-s" type="button" data-act="clock" data-at="real">Use real time</button></form></section>
      <section class="stack-s"><h3>Demo staff PINs</h3><p>Demo Administrator <span class="mono">1111</span> · Demo Reception (PA) <span class="mono">2222</span></p></section>` : ''}
      <section class="stack-s"><h3>Data set</h3><p class="small">${REMOTE_OK ? 'Leave practice mode to use the shared test database that all staff see.' : 'Practice data is kept on this device only.'}</p>
        <div class="row">${REMOTE_OK ? '<button class="btn btn-primary" data-act="mode" data-mode="shared">Back to the shared test database</button>' : ''}
        ${A.mode === 'live' ? '<button class="btn" data-act="mode" data-mode="demo">Practice data (fictional)</button>' : ''}</div></section>` };
    renderModal();
  }

  // ---------- event handlers ----------
  const byId = id => S().bookings.find(x => x.id === id);
  const ACT = {
    'logout': async () => {
      if (isRemote()) { await AUTH.signOut(); A.session = null; A.state = null; go('home'); await refresh(); render(); return; }
      A.store.transact(st => C.logout(st, ctx(), A.session)).catch(() => { }); setSession(null); go('home'); },
    'retry': async () => { A.loadError = null; render(); await refresh(); render(); },
    'demo-panel': openDemoPanel,
    'close-modal': closeModal,
    'overlay': (el, ev) => { if (ev.target === el) closeModal(); },
    'copy': el => copy(el.dataset.text),
    'scenario': el => { loadScenario(el.dataset.sc); closeModal(); toast('Scenario loaded', 'ok'); go(el.dataset.sc === 'event' ? 'staff' : 'home'); },
    'clock': el => { const v = el.dataset.at; if (v === 'real') setClock(null); else setClock(Date.parse(v + ':00' + E().utcOffset)); closeModal(); expirySweep(); render(); toast('Time set: ' + F(now()), 'ok'); },
    'mode': el => { const m = el.dataset.mode; if (m === A.mode) return closeModal(); A.mode = m; pset('mode', m); openStore(); closeModal(); go(m === 'live' ? 'staff' : 'home'); render(); },
    'chip': el => { A.ui[el.dataset.group] = el.dataset.val; render(); },
    'filter-people': el => { Object.assign(A.ui, { q: '', status: 'all', prog: 'all', flag: el.dataset.flag }); go('s-people'); },
    'open-person': el => go('s-p-' + el.dataset.id),
    'ci-mode': el => { A.ui.ciMode = el.dataset.val; A.ui.lastResult = null; render(); },
    // public
    'pub-accept': el => run((st, c) => C.respondToOffer(st, c, null, null, true, { token: el.dataset.token }), 'Place accepted. See you there.'),
    'pub-decline': el => ask({ title: 'Decline this place?', body: 'The place will go to the next person on the waiting list.', ok: 'Decline the place', danger: true, onOk: () => run((st, c) => C.respondToOffer(st, c, null, null, false, { token: el.dataset.token }), 'Offer declined.') }),
    'pub-cancel': el => ask({ title: 'Cancel your booking?', body: 'Your place will be released for someone on the waiting list. This cannot be undone online.', ok: 'Cancel my booking', danger: true, fields: [{ name: 'reason', label: 'Reason (optional)' }],
      onOk: f => run((st, c) => C.cancelBooking(st, c, null, null, { token: el.dataset.token, reason: f.reason }), 'Booking cancelled.') }),
    'pub-edit': el => { const b = C.bookingByToken(S(), el.dataset.token); A.forms.pedit = { values: Object.assign({}, b) }; openEdit(b, el.dataset.token); },
    // staff booking actions
    'offer': el => run((st, c) => C.makeOffer(st, c, actor(), el.dataset.id || null), b => `Offer made to ${b.firstName} ${b.lastName}. A message is prepared in Messages.`),
    'offer-ooo': el => ask({ title: 'Offer out of queue order', body: 'Record why this person is offered a place ahead of the people before them.', fields: [{ name: 'reason', label: 'Reason' }], onOk: f => run((st, c) => C.makeOffer(st, c, actor(), el.dataset.id, { reason: f.reason }), 'Offer made.') }),
    'offer-accept': el => run((st, c) => C.respondToOffer(st, c, actor(), el.dataset.id, true), 'Recorded: place accepted.'),
    'offer-decline': el => run((st, c) => C.respondToOffer(st, c, actor(), el.dataset.id, false), 'Recorded: offer declined.'),
    'confirm-late': el => ask({ title: 'Confirm place directly', body: 'Use this for late cases when a normal offer is not possible, for example on the event evening. Capacity is checked when you confirm.', fields: [{ name: 'reason', label: 'Note', value: 'Confirmed at the desk' }], onOk: f => run((st, c) => C.confirmLate(st, c, actor(), el.dataset.id, f.reason), 'Place confirmed.') }),
    'reinstate': el => run((st, c) => C.reinstate(st, c, actor(), el.dataset.id), 'Booking reinstated.'),
    'contingency': el => ask({ title: 'Allocate a contingency place', body: `${C.capacity(S()).contingencyFree} contingency place(s) left. The reason is recorded in the audit history.`, fields: [{ name: 'reason', label: 'Reason', area: true }], onOk: f => run((st, c) => C.allocateContingencyFor(st, c, actor(), el.dataset.id, f.reason), 'Contingency place allocated.') }),
    'arrive': el => { const id = el.dataset.id, m = el.dataset.method || 'search'; if (needsTime()) return ask({ title: 'Record arrival from paper', fields: timeField('Arrival time'), onOk: f => run((st, c) => C.recordArrival(st, c, actor(), id, 'paper-register', timeToMs(f.time)), 'Arrival recorded.') });
      run((st, c) => C.recordArrival(st, c, actor(), id, m), b => `${b.firstName} ${b.lastName} checked in.`, { then: b => { A.ui.lastResult = { ok: true, html: `<b>${nameOf(b)}</b> checked in at ${FT(b.arrival.at)}.` }; A.ui.ciQ = ''; } }); },
    'complete': el => { const id = el.dataset.id, m = el.dataset.method; if (needsTime()) return ask({ title: 'Record completion from paper', fields: timeField('Time signed / checked out'), onOk: f => run((st, c) => C.confirmCompletion(st, c, actor(), id, m, timeToMs(f.time)), 'Completion recorded.') });
      run((st, c) => C.confirmCompletion(st, c, actor(), id, m), b => `Completion confirmed for ${b.firstName} ${b.lastName}.`, { then: b => { A.ui.lastResult = { ok: true, html: `<b>${nameOf(b)}</b> — completion confirmed (${m === 'register' ? 'signed register' : 'QR check-out'}).` }; A.ui.ciQ = ''; } }); },
    'early': el => ask({ title: 'Record early departure', body: 'Leaving before the end of Q&A needs administrator review before any certificate.', fields: [{ name: 'time', type: 'time', label: 'Time they left', value: C.fmtTime(Math.min(now(), T().qaEnd - 60000), tz()) }, { name: 'note', label: 'Reason or note', area: true }],
      onOk: f => run((st, c) => C.recordEarlyDeparture(st, c, actor(), el.dataset.id, timeToMs(f.time), f.note), 'Early departure flagged for review.') }),
    'early-review': el => { const b = byId(el.dataset.id); ask({ title: 'Review early departure', body: `${nameOf(b)} left at ${FT(b.completion.leftAt)}. Note: ${esc(b.completion.note)}`, fields: [{ name: 'decision', type: 'select', label: 'Decision', options: [['approve', 'Accept as completed'], ['reject', 'Do not accept']] }, { name: 'note', label: 'Reason for decision', area: true }],
      onOk: f => run((st, c) => C.reviewEarlyDeparture(st, c, actor(), b.id, f.decision === 'approve', f.note), 'Decision recorded.') }); },
    'undo-arrival': el => ask({ title: 'Undo arrival', fields: [{ name: 'reason', label: 'Reason' }], onOk: f => run((st, c) => C.undoArrival(st, c, actor(), el.dataset.id, f.reason), 'Arrival removed.') }),
    'undo-completion': el => ask({ title: 'Undo completion', fields: [{ name: 'reason', label: 'Reason' }], onOk: f => run((st, c) => C.undoCompletion(st, c, actor(), el.dataset.id, f.reason), 'Completion removed.') }),
    'paper-fb': el => { A.forms.pfb = {}; openPaperFeedback(el.dataset.id); },
    'paper-batch': () => { A.forms.pfb = {}; openPaperFeedback(null); },
    'details-checked': el => run((st, c) => C.markDetailsChecked(st, c, actor(), el.dataset.id), 'Details marked as checked.'),
    'dup-resolve': el => ask({ title: 'Resolve possible duplicate', fields: [{ name: 'decision', type: 'select', label: 'Decision', options: [['not-duplicate', 'Not a duplicate — keep this booking'], ['cancel', 'Duplicate — cancel this booking']] }, { name: 'note', label: 'Note' }],
      onOk: f => run((st, c) => C.resolveDuplicate(st, c, actor(), el.dataset.id, f.decision, f.note), 'Duplicate review recorded.') }),
    'hpcna-resolve': el => ask({ title: 'Resolve HPCNA registration number', body: 'Enter the verified number, or leave it empty and record why no number applies.', fields: [{ name: 'number', label: 'HPCNA registration number' }, { name: 'note', label: 'Note' }],
      onOk: f => run((st, c) => C.resolveHpcna(st, c, actor(), el.dataset.id, f.number, f.note), 'Registration review resolved.') }),
    'flag': el => ask({ title: 'Flag an exception for the administrator', fields: [{ name: 'note', label: 'What needs review?', area: true }], onOk: f => run((st, c) => C.flagException(st, c, actor(), el.dataset.id, f.note), 'Flagged for administrator review.') }),
    'ex-resolve': el => ask({ title: 'Resolve exception', fields: [{ name: 'note', label: 'Resolution', area: true }], onOk: f => run((st, c) => C.resolveException(st, c, actor(), el.dataset.id, el.dataset.ex, f.note), 'Exception resolved.') }),
    'cancel': el => ask({ title: 'Cancel this booking?', body: 'The place returns to the pool for the waiting list.', danger: true, ok: 'Cancel booking', fields: [{ name: 'reason', label: 'Reason' }], onOk: f => run((st, c) => C.cancelBooking(st, c, actor(), el.dataset.id, { reason: f.reason }), 'Booking cancelled.') }),
    'edit': el => { const b = byId(el.dataset.id); A.forms.pedit = { values: Object.assign({}, b) }; openEdit(b, null); },
    'prep-msg': el => { const id = el.dataset.id, type = el.dataset.type || (document.getElementById('pm-type') || {}).value; run((st, c) => C.prepareMessage(st, c, actor(), id, type), 'Message prepared.', { then: m => setTimeout(() => openMessage(m.id), 0) }); },
    'msg-open': el => openMessage(el.dataset.msg),
    'msg-email': el => run((st, c) => C.queueEmailResend(st, c, actor(), el.dataset.msg), m => `Email to ${m.to} is being sent.`, { then: () => setTimeout(() => refresh().then(render), 4000) }),
    'msg-status': el => run((st, c) => C.setMessageStatus(st, c, actor(), el.dataset.msg, el.dataset.status), 'Status updated.', { keepModal: true, then: m => setTimeout(() => openMessage(m.id), 0) }),
    'bulk-msg': el => { const type = el.dataset.type; run((st, c) => { let list = st.bookings.filter(b => b.status === 'confirmed'); if (type === 'feedback') list = list.filter(b => C.completed(b) && !b.feedback); if (type === 'certificate') list = list.filter(b => C.currentCert(st, b));
      if (!list.length) throw new C.RuleError('none', 'Nobody matches for this message.'); list.forEach(b => C.prepareMessage(st, c, actor(), b.id, type)); return list.length; }, k => `${k} message(s) prepared.`); },
    // certificates
    'cert-preview': el => openCertPreview(el.dataset.id),
    'cert-preview-pdf': el => certPdf(byId(el.dataset.id), null),
    'cert-pdf': el => { const cert = S().certificates.find(c => c.id === el.dataset.cert); certPdf(byId(cert.bookingId), cert); },
    'cert-release': el => ask({ title: 'Release certificate?', body: 'This authorises the certificate. Details are then locked and changes need a controlled correction.', ok: 'Release', onOk: () => run((st, c) => C.releaseCertificate(st, c, actor(), el.dataset.id), cert => `Certificate ${cert.number} released. A message with the private link is prepared.`) }),
    'release-all': () => ask({ title: `Release all ready certificates?`, body: `${C.stats(S()).certs.ready} certificate(s) meet every condition.`, ok: 'Release all', onOk: () => run((st, c) => C.releaseAllReady(st, c, actor()), k => `${k} certificate(s) released.`) }),
    'cert-resend': el => run((st, c) => C.prepareMessage(st, c, actor(), el.dataset.id, 'certificate'), 'Certificate message prepared.', { then: m => setTimeout(() => openMessage(m.id), 0) }),
    'cert-correct': el => { const b = byId(el.dataset.id); ask({ title: 'Correct and reissue certificate', body: 'The current version is kept in the history as superseded, and its link stops working.', fields: [{ name: 'firstName', label: 'First name', value: b.firstName }, { name: 'lastName', label: 'Last name', value: b.lastName }, { name: 'hpcna', label: 'HPCNA registration number', value: b.hpcna }, { name: 'reason', label: 'Reason for correction', area: true }],
      onOk: f => run((st, c) => C.correctCertificate(st, c, actor(), b.id, { firstName: f.firstName, lastName: f.lastName, hpcna: f.hpcna, reissueOnly: true }, f.reason), cert => `Reissued as version ${cert.version}.`) }); },
    'demo-approval': () => run((st, c) => C.updateApproval(st, c, actor(), { activityNumber: 'DEMO-ONLY-0000', ceus: 'DEMO', level: 'DEMO' }), 'Fictional demo values entered. Certificates still carry the demo watermark.'),
    'sig-remove': () => run((st, c) => C.updateSignatory(st, c, actor(), { name: E().signatory.name, title: E().signatory.title, image: null }), 'Signature image removed.'),
    // waitlist release
    'release-unused': () => {
      const list = S().bookings.filter(b => b.status === 'confirmed' && !b.arrival).sort((a, b) => a.lastName.localeCompare(b.lastName));
      A.modal = { html: () => `<form class="form" data-form="release"><div class="modal-head"><h2>Release unused bookings</h2><button type="button" class="btn btn-s" data-act="close-modal">Close</button></div>
        <p>Tick the bookings to release. Released places become free for the waiting list or walk-ins. A released booking can be reinstated while a place is free.</p>
        <div class="stack-s">${list.map(b => `<label class="check"><input type="checkbox" name="ids" value="${b.id}" checked><span><b>${nameOf(b)}</b> <span class="mono small">${esc(b.ref)}</span> · ${b.pool}</span></label>`).join('')}</div>
        ${A.modal && A.modal.error ? `<div class="form-errors">${esc(A.modal.error)}</div>` : ''}<div class="row"><button class="btn btn-primary" type="submit">Release ticked bookings</button></div></form>` };
      renderModal();
    },
    'register-bulk': () => {
      const list = S().bookings.filter(b => b.status === 'confirmed' && b.arrival && !b.completion).sort((a, b) => a.lastName.localeCompare(b.lastName));
      A.modal = { html: () => `<form class="form" data-form="bulkreg"><div class="modal-head"><h2>Enter signed register</h2><button type="button" class="btn btn-s" data-act="close-modal">Close</button></div>
        <p>Tick everyone who signed the register on completion. Each is recorded as “signed register” by you.</p>
        ${needsTime() ? `<div class="field"><label for="br-time">Time of signing (from the event)</label><input type="time" id="br-time" name="time" value="${esc(C.fmtTime(T().qaEnd, tz()))}"></div>` : ''}
        <div class="stack-s">${list.map(b => `<label class="check"><input type="checkbox" name="ids" value="${b.id}"><span><b>${nameOf(b)}</b> <span class="mono small">${esc(b.ref)}</span></span></label>`).join('') || '<div class="empty">Nobody is waiting for completion.</div>'}</div>
        ${A.modal && A.modal.error ? `<div class="form-errors">${esc(A.modal.error)}</div>` : ''}<div class="row"><button class="btn btn-ok" type="submit">Confirm completion for ticked</button></div></form>` };
      renderModal();
    },
    // paper PDFs
    'pdf-register': el => { const rows = el.dataset.kind === 'prefilled' ? S().bookings.filter(b => b.status === 'confirmed').sort((a, b) => a.lastName.localeCompare(b.lastName)) : null; pdfSave(Pdf.register(S(), rows), `attendance-register-${el.dataset.kind}.pdf`); },
    'pdf-survey': () => pdfSave(Pdf.survey(S()), 'evaluation-survey.pdf'),
    'pdf-regform': () => pdfSave(Pdf.registrationForm(S()), 'registration-form.pdf'),
    'pdf-checkin': () => pdfSave(Pdf.checkinList(S(), S().bookings.filter(b => b.status === 'confirmed').sort((a, b) => a.lastName.localeCompare(b.lastName))), 'desk-checkin-list.pdf'),
    'export': el => doExport(el.dataset.kind),
    'presenter-reset': () => run((st, c) => C.setPresenterPhoto(st, c, actor(), null), 'Supplied presenter photo restored.'),
    'presenter-remove': () => run((st, c) => C.setPresenterPhoto(st, c, actor(), 'none'), 'Presenter photo hidden.'),
    'logo-reset': () => run((st, c) => C.setLogo(st, c, actor(), null), 'Supplied logo restored.'),
    'staff-toggle': el => { const s = S().staff.find(x => x.id === el.dataset.id); run((st, c) => C.setStaffActive(st, c, actor(), s.id, !s.active), 'Staff access updated.'); },
    'staff-pin': el => ask({ title: 'Reset PIN', fields: [{ name: 'pin', label: 'New PIN (4–8 digits)' }], onOk: async f => { if (!/^\d{4,8}$/.test(f.pin)) { A.modal.error = 'Use 4 to 8 digits.'; return renderModal(); } const h = await pinHash(f.pin); run((st, c) => C.resetPin(st, c, actor(), el.dataset.id, h), 'PIN reset.'); } })
  };

  function openEdit(b, token) {
    A.modal = { html: () => `<form class="form" data-form="pedit" data-id="${b.id}" data-token="${esc(token || '')}" novalidate><div class="modal-head"><h2>${token ? 'Correct my details' : 'Edit details'}</h2><button type="button" class="btn btn-s" data-act="close-modal">Close</button></div>
      ${attendeeFields(Object.assign({}, A.forms.pedit, { values: Object.assign({}, A.forms.pedit.values, { consentEvent: true }) }), { p: 'e', staff: !token })}
      ${!token ? '<div class="field"><label for="e-reason">Reason for change (recorded)</label><input type="text" id="e-reason" name="reason"></div>' : ''}
      ${A.modal && A.modal.error ? `<div class="form-errors">${esc(A.modal.error)}</div>` : ''}
      <div class="row"><button class="btn btn-primary" type="submit">Save changes</button><button type="button" class="btn" data-act="close-modal">Cancel</button></div></form>` };
    renderModal();
  }

  const FORMS = {
    rsvp: (form) => { const v = readAttendee(form); A.forms.rsvp = { values: v };
      run((st, c) => C.createBooking(st, c, null, v, { channel: 'public' }), null, { form: 'rsvp', render: false, then: b => { A.flash = b.token; go('m-' + b.token); } }); },
    fb: (form) => { const v = readFeedback(form); A.forms.fb = { values: v }; run((st, c) => C.submitFeedback(st, c, form.dataset.token, v), 'Thank you. Your evaluation has been received.', { form: 'fb' }); },
    login: async (form) => { const fd = new FormData(form);
      if (isRemote()) {
        const email = String(fd.get('email') || '').trim();
        try { await AUTH.signIn(email, fd.get('password')); }
        catch (e) { A.forms.login = { email, message: e.message }; return render(); }
        delete A.forms.login; A.state = null; render(); await refresh();
        if (me()) { const t = A.afterLogin || 's-dash'; A.afterLogin = null; go(t); }
        render(); return;
      } const h = await pinHash(fd.get('pin') || ''); const sid = fd.get('staff');
      const r = await run((st, c) => C.login(st, c, sid, h), null, { render: false });
      if (r.ok) { setSession(r.result); const t = A.afterLogin || 's-dash'; A.afterLogin = null; go(t); render(); } },
    setup: async (form) => { const fd = new FormData(form); const pin = String(fd.get('pin') || ''); if (!/^\d{4,8}$/.test(pin)) { A.forms.setup = { message: 'Use a PIN of 4 to 8 digits.' }; return render(); }
      const h = await pinHash(pin); const r = await run((st, c) => { const s = C.addStaff(st, c, null, { name: fd.get('name'), role: 'admin', pinHash: h }); return C.login(st, c, s.id, h); }, 'Administrator created.', { render: false });
      if (r.ok) { setSession(r.result); go('s-dash'); render(); } else { A.forms.setup = { message: r.error.message }; render(); } },
    reg: (form) => { const fd = new FormData(form); const v = readAttendee(form); const src = fd.get('source'), pool = fd.get('pool') || 'auto', reason = fd.get('reason') || '';
      A.forms.reg = { values: Object.assign({}, v, { source: src, pool, reason }) };
      run((st, c) => C.createBooking(st, c, actor(), v, { channel: 'staff', source: src, pool, reason }), b => `${b.firstName} ${b.lastName}: ${b.status === 'confirmed' ? 'place booked' : 'added to the waiting list'}.`,
        { form: 'reg', then: b => { A.ui.regResult = { id: b.id, ref: b.ref, name: b.firstName + ' ' + b.lastName, text: b.status === 'confirmed' ? (b.pool === 'contingency' ? 'contingency place booked.' : 'place booked.') : 'event is full, added to the waiting list.' }; window.scrollTo(0, 0); } }); },
    pedit: (form) => { const v = readAttendee(form); const token = form.dataset.token || null; const reason = (new FormData(form).get('reason')) || '';
      A.forms.pedit = { values: Object.assign({}, A.forms.pedit.values, v) };
      run((st, c) => C.updateDetails(st, c, token ? null : actor(), form.dataset.id, v, { token, reason }), 'Details saved.', { form: 'pedit' }); },
    pfb: (form) => { const id = form.dataset.id || null; const fd = new FormData(form); const withAnswers = !id || fd.get('withAnswers') === 'on';
      const ans = withAnswers ? readFeedback(form) : null; A.forms.pfb = { values: ans || undefined, withAnswers };
      run((st, c) => id ? C.recordPaperFeedback(st, c, actor(), id, ans) : C.addPaperResponse(st, c, actor(), ans), id ? 'Paper evaluation recorded.' : 'Anonymous answers saved.', { form: 'pfb' }); },
    ask: (form) => { const fd = new FormData(form), o = {}; for (const [k, v] of fd.entries()) o[k] = v; if (A.modal && A.modal.onSubmit) A.modal.onSubmit(o); },
    appr: (form) => { const fd = new FormData(form); run((st, c) => C.updateApproval(st, c, actor(), { activityNumber: fd.get('activityNumber'), ceus: fd.get('ceus'), level: fd.get('level') }), 'Approval details saved.'); },
    sig: (form) => { const fd = new FormData(form); run((st, c) => C.updateSignatory(st, c, actor(), { name: fd.get('name'), title: fd.get('title') }), 'Signatory saved.'); },
    release: (form) => { const ids = new FormData(form).getAll('ids'); run((st, c) => C.releaseUnused(st, c, actor(), ids), k => `${k} booking(s) released.`); },
    bulkreg: (form) => { const fd = new FormData(form); const ids = fd.getAll('ids'); const tm = timeToMs(fd.get('time'));
      if (!ids.length) { A.modal.error = 'Tick at least one person.'; return renderModal(); }
      run((st, c) => { ids.forEach(id => C.confirmCompletion(st, c, actor(), id, 'register', tm == null ? undefined : tm)); return ids.length; }, k => `Completion confirmed for ${k} attendee(s).`); },
    clock: (form) => { const v = new FormData(form).get('at'); if (!v) return; setClock(Date.parse(v + ':00' + E().utcOffset)); closeModal(); expirySweep(); render(); },
    ev: (form) => { const fd = new FormData(form), e = E(), g = k => (fd.get(k) || '').toString().trim();
      const ch = {}; ['topic', 'title', 'subtitle', 'date', 'refPrefix', 'venue', 'venueAddress', 'venueShort', 'presenter', 'presenterTitle', 'presenterSpecialty', 'audience', 'fee', 'provider', 'providerNumber', 'publicWording', 'about', 'feedbackOpensTime'].forEach(k => ch[k] = g(k));
      ch.contacts = [0, 1].map(i => ({ phone: g('cphone' + i), email: g('cemail' + i) })).filter(c => c.phone || c.email);
      ['publicCap', 'contingencyCap', 'maxCap', 'offerHours', 'eventDayOfferHours', 'minOfferMinutes'].forEach(k => ch[k] = Number(g(k)));
      ch.rsvpClose = g('rsvpClose') + ':00' + e.utcOffset;
      ch.programme = e.programme.map((p, i) => ({ key: p.key, label: g('pl' + i), start: g('ps' + i), end: g('pe' + i) }));
      run((st, c) => C.updateEvent(st, c, actor(), ch), 'Event settings saved.'); },
    staff: async (form) => { const fd = new FormData(form);
      if (isRemote()) return run((st, c) => C.addStaff(st, c, actor(), { name: fd.get('name'), role: fd.get('role'), email: fd.get('email') || '' }), 'Staff member added. Remember to create their login in Supabase.'); const pin = String(fd.get('pin') || ''); if (!/^\d{4,8}$/.test(pin)) return toast('Use a PIN of 4 to 8 digits.', 'bad');
      const h = await pinHash(pin); run((st, c) => C.addStaff(st, c, actor(), { name: fd.get('name'), role: fd.get('role'), pinHash: h }), 'Staff member added.'); }
  };

  const CHANGE = {
    'hpcna-toggle': el => { const form = el.form; const inp = form.querySelector('[name=hpcna]'); if (inp) { inp.disabled = el.value !== 'provided'; if (inp.disabled) inp.value = ''; } },
    'qr-photo': el => { if (el.files && el.files[0]) readQrPhoto(el.files[0]); el.value = ''; },
    'pfb-toggle': el => { A.forms.pfb = Object.assign(A.forms.pfb || {}, { withAnswers: el.checked }); renderModal(); },
    'sig-img': el => readImage(el, 300000, dataUrl => run((st, c) => C.updateSignatory(st, c, actor(), { name: E().signatory.name, title: E().signatory.title, image: dataUrl }), 'Signature image saved.')),
    'presenter-photo': el => readImage(el, 600000, dataUrl => run((st, c) => C.setPresenterPhoto(st, c, actor(), dataUrl), 'Presenter photo replaced.')),
    'logo': el => readImage(el, 600000, dataUrl => run((st, c) => C.setLogo(st, c, actor(), dataUrl), 'Logo replaced.')),
    'restore': el => { const f = el.files && el.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const data = JSON.parse(r.result); if (!data || !Array.isArray(data.bookings) || !data.event) throw new Error('Not a backup file'); if (data.mode !== A.mode) throw new Error(`This is a ${data.mode} backup; switch to that data set first.`);
      ask({ title: 'Restore backup?', body: `This replaces all ${A.mode} data in this browser with the backup (${data.bookings.length} bookings).`, danger: true, ok: 'Replace with backup', onOk: () => { if (!can('data.restore')) return toast('Administrator only.', 'bad'); data.sessions = {}; data.rev = (S().rev || 0) + 1; A.store.write(data); A.state = data; setSession(null); closeModal(); toast('Backup restored. Please sign in again.', 'ok'); go('staff'); } });
    } catch (e) { toast('Restore failed: ' + e.message, 'bad'); } }; r.readAsText(f); el.value = ''; }
  };
  function readImage(el, maxBytes, cb) { const f = el.files && el.files[0]; if (!f) return; if (f.size > maxBytes) { toast(`Image too large (max ${Math.round(maxBytes / 1000)} KB).`, 'bad'); return; } const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(f); el.value = ''; }

  let inputTimer = null;
  function onInput(e) {
    const t = e.target.dataset && e.target.dataset.input; if (!t) return;
    if (t === 'people-q') { A.ui.q = e.target.value; clearTimeout(inputTimer); inputTimer = setTimeout(() => { const box = $('#people-results'); if (box) { const tmp = document.createElement('div'); tmp.innerHTML = vPeople().html; const nb = tmp.querySelector('#people-results'); box.innerHTML = nb.innerHTML; const head = document.querySelector('.page-head p'); const nh = tmp.querySelector('.page-head p'); if (head && nh) head.textContent = nh.textContent; } }, 120); }
    if (t === 'ci-q') { A.ui.ciQ = e.target.value; A.ui.lastResult = null; const box = $('#ci-results'); if (box) box.innerHTML = ciResults(); }
    if (t === 'audit-q') { A.ui.auditQ = e.target.value; clearTimeout(inputTimer); inputTimer = setTimeout(() => { const box = $('#audit-results'); if (box) { const q = A.ui.auditQ.trim().toLowerCase(); box.innerHTML = auditTable(S().audit.slice().sort((a, b) => b.at - a.at || b.id - a.id).filter(a => !q || [a.action, a.ref, a.detail, a.who.name].join(' ').toLowerCase().includes(q))); } }, 150); }
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = ACT[el.dataset.act]; if (!fn) return;
    if (el.tagName === 'A' && el.getAttribute('href') && !el.getAttribute('href').startsWith('#')) return; // external link
    if (el.dataset.act !== 'overlay') e.preventDefault();
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    fn(el, e);
  });
  document.addEventListener('submit', e => {
    const form = e.target.closest('form[data-form]'); if (!form) return;
    e.preventDefault();
    if (A.modal) A.modal.error = null;
    const fn = FORMS[form.dataset.form]; if (fn) fn(form);
  });
  document.addEventListener('change', e => { const t = e.target.dataset && e.target.dataset.change; if (t && CHANGE[t]) CHANGE[t](e.target); });
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && A.modal) closeModal(); });
  window.addEventListener('hashchange', () => { A.ui.lastResult = null; A.ui.regResult = null; window.scrollTo(0, 0); render(); });

  // keep in step with other tabs and with offer expiry
  function editing() { const a = document.activeElement; return !!(A.modal || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'search')); }
  async function expirySweep() {
    if (isRemote()) return false;
    const n = now();
    if (S().bookings.some(b => b.status === 'offered' && n >= b.offer.expiresAt)) {
      try { const r = await A.store.transact(st => C.processExpiries(st, ctx())); A.state = r.state; return true; } catch (e) { return false; }
    }
    return false;
  }
  window.addEventListener('storage', e => {
    if (A.store && A.store.key && e.key === A.store.key) { A.state = A.store.read() || A.state; if (A.session && !me()) setSession(null); if (!editing()) render(); }
    if (e.key === clockKey()) { loadClock(); if (!editing()) render(); }
  });
  let lastRemote = Date.now();
  setInterval(async () => {
    if (isRemote()) {
      // staff screens refresh every 20 seconds, public pages every minute
      const staffView = A.state && A.state.viewKind === 'staff';
      if (!A.state || editing() || document.visibilityState === 'hidden' || A.loading) return;
      if (!staffView && Date.now() - lastRemote < 58000) return;
      lastRemote = Date.now();
      await refresh();
      if (editing()) return;
      const y = window.scrollY; render(); window.scrollTo(0, y);
      return;
    }
    const changed = await expirySweep();
    const h = location.hash.slice(1);
    if (editing()) return;
    if (changed || /^(s-dash|s-waitlist|m-|home|$)/.test(h)) {
      const y = window.scrollY; render(); window.scrollTo(0, y);
    }
  }, 20000);

  // ---------- start ----------
  openStore();
  if (!isRemote()) expirySweep().then(() => render());
  render();
  downloadsCap();
  window.__wapcpd = { A, run, ctx, now, refresh };
})();
