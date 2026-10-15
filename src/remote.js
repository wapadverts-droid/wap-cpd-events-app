/* Shared-database connection for the website.
 *  - createAuth: staff sign-in with email and password (Supabase Auth).
 *  - createRemoteStore: sends changes to the server program and receives the data
 *    this visitor is allowed to see.
 *
 * How a change is sent: the website's existing action code runs as before, but the
 * rules-engine functions it calls are recorded (and also tried locally, so form
 * errors appear instantly). The recorded calls are then sent to the server, which
 * runs them again on the real shared data inside a locked transaction. The server's
 * answer is what counts. */
(function (root) {
  'use strict';
  const RuleErr = (code, message) => { const e = new Error(message); e.code = code; e.name = 'RuleError'; return e; };

  // Rules-engine functions that change data (others are read-only helpers).
  const MUTATORS = ['createBooking', 'updateDetails', 'cancelBooking', 'makeOffer', 'respondToOffer', 'confirmLate', 'allocateContingencyFor',
    'releaseUnused', 'reinstate', 'recordArrival', 'undoArrival', 'confirmCompletion', 'recordEarlyDeparture', 'reviewEarlyDeparture',
    'undoCompletion', 'flagException', 'resolveException', 'resolveDuplicate', 'resolveHpcna', 'markDetailsChecked', 'submitFeedback',
    'recordPaperFeedback', 'addPaperResponse', 'releaseCertificate', 'releaseAllReady', 'correctCertificate', 'prepareMessage',
    'setMessageStatus', 'updateEvent', 'updateApproval', 'updateSignatory', 'addStaff', 'setStaffActive', 'setLogo', 'resetPin', 'login', 'logout'];

  function createAuth(cfg, storage) {
    const KEY = 'wapcpd:auth';
    let s = null, refreshing = null;
    try { s = JSON.parse(storage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    function save(x) { s = x; try { if (x) storage.setItem(KEY, JSON.stringify(x)); else storage.removeItem(KEY); } catch (e) { /* ignore */ } }
    async function tokenReq(grant, body) {
      let r;
      try {
        r = await fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=' + grant, {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey }, body: JSON.stringify(body)
        });
      } catch (e) { throw RuleErr('network', 'Could not reach the sign-in service. Check your internet connection and try again.'); }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (grant === 'password') {
          const bad = d.error_code === 'invalid_credentials' || d.error === 'invalid_grant' || r.status === 400;
          throw RuleErr('auth', bad ? 'Wrong email or password.' : (d.msg || d.error_description || d.message || 'Sign-in failed.'));
        }
        throw RuleErr('signed_out', 'Your sign-in has expired. Please sign in again.');
      }
      save({ access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000, email: (d.user && d.user.email) || body.email || (s && s.email) || '' });
    }
    return {
      email: () => (s ? s.email : null),
      signedIn: () => !!s,
      async signIn(email, password) { await tokenReq('password', { email: String(email || '').trim(), password: String(password || '') }); },
      async accessToken() {
        if (!s) return null;
        if (Date.now() > s.exp - 60000) {
          if (!refreshing) refreshing = tokenReq('refresh_token', { refresh_token: s.refresh }).catch(() => save(null)).finally(() => { refreshing = null; });
          await refreshing;
        }
        return s ? s.access : null;
      },
      async signOut() {
        const t = s && s.access; save(null);
        if (t) { try { await fetch(cfg.supabaseUrl + '/auth/v1/logout', { method: 'POST', headers: { apikey: cfg.supabaseKey, Authorization: 'Bearer ' + t } }); } catch (e) { /* ignore */ } }
      },
      clear() { save(null); }
    };
  }

  function createRemoteStore(o) {
    const { cfg, auth, C, getToken, onView } = o;
    const url = cfg.supabaseUrl + '/functions/v1/' + (cfg.functionName || 'cpd');
    async function post(body) {
      const token = getToken();
      body.token = token;
      const headers = { 'Content-Type': 'application/json', apikey: cfg.supabaseKey };
      const at = await auth.accessToken();
      if (at) headers.Authorization = 'Bearer ' + at;
      let r, data;
      try { r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
      catch (e) { throw RuleErr('network', 'Could not reach the server. Check your internet connection and try again.'); }
      try { data = await r.json(); } catch (e) { throw RuleErr('server', 'The server is not responding properly. Please try again in a moment.'); }
      if (data && data.error && data.error.code === 'signed_out') auth.clear();
      if (!data || !data.ok) {
        const er = (data && data.error) || {};
        const e = RuleErr(er.code || 'server', er.message || 'The server had a problem. Please try again.');
        if (er.errors) e.errors = er.errors;
        throw e;
      }
      if (data.view) onView(data.view, token);
      return data;
    }
    return {
      remote: true, key: null,
      async refresh() { return (await post({ op: 'view' })).view; },
      async transact(fn, current) {
        if (!current) throw RuleErr('loading', 'Still loading. Please try again in a moment.');
        const draft = JSON.parse(JSON.stringify(current));
        const calls = [], locals = [], saved = {};
        for (const name of MUTATORS) {
          const orig = C[name];
          if (typeof orig !== 'function') continue;
          saved[name] = orig;
          C[name] = function (st, ctx, ...args) {
            const copy = JSON.parse(JSON.stringify(args, (k, v) => (v === undefined ? null : v)));
            const r = orig.call(this, st, ctx, ...args); // try locally first: same rules, instant errors
            calls.push({ fn: name, args: copy });
            locals.push(r);
            return r;
          };
        }
        let ret;
        try { ret = fn(draft); } finally { for (const k of Object.keys(saved)) C[k] = saved[k]; }
        if (!calls.length) return { result: ret, state: current };
        const d = await post({ op: 'act', calls });
        const result = (locals.length && ret === locals[locals.length - 1]) ? d.results[d.results.length - 1] : ret;
        return { result, state: d.view };
      }
    };
  }

  root.CPDRemote = { createAuth, createRemoteStore, MUTATORS };
})(window);
