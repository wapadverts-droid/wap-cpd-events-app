/* WAP CPD Event App — rules engine.
 * Pure functions over a plain state object. Every staff action resolves the
 * signed-in staff member from the state (session -> staff record -> role), so
 * permissions are enforced here, not only by hiding buttons.
 * All mutating functions throw RuleError on refusal; callers run them on a
 * copy of the state and only save when they succeed (all-or-nothing).
 */
(function (root) {
  'use strict';

  const SCHEMA = 1;
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  class RuleError extends Error {
    constructor(code, message) { super(message); this.code = code; this.name = 'RuleError'; }
  }
  const fail = (code, msg) => { throw new RuleError(code, msg); };

  // ---------- reference data ----------
  const PROFESSIONS = [
    'Medical doctor', 'Pharmacist', "Pharmacist's assistant", 'Registered nurse',
    'Enrolled nurse', 'Allied health professional', 'Other'
  ];
  const CHANNELS = { whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS' };
  const ROLES = { admin: 'Administrator', pa: 'PA / Reception' };

  const PERMS = {
    'register.routine': ['admin', 'pa'],
    'register.postEvent': ['admin'],
    'booking.edit': ['admin', 'pa'],
    'booking.cancel': ['admin', 'pa'],
    'booking.reinstate': ['admin', 'pa'],
    'waitlist.offer': ['admin', 'pa'],
    'waitlist.offerOutOfOrder': ['admin'],
    'waitlist.recordResponse': ['admin', 'pa'],
    'waitlist.confirmLate': ['admin', 'pa'],
    'contingency.allocate': ['admin'],
    'attendance.arrive': ['admin', 'pa'],
    'attendance.undoArrival': ['admin', 'pa'],
    'attendance.complete': ['admin', 'pa'],
    'attendance.early': ['admin', 'pa'],
    'attendance.undoCompletion': ['admin'],
    'exception.flag': ['admin', 'pa'],
    'exception.review': ['admin'],
    'details.check': ['admin', 'pa'],
    'duplicate.resolve': ['admin'],
    'hpcna.resolve': ['admin'],
    'feedback.paper': ['admin', 'pa'],
    'feedback.summary': ['admin'],
    'message.prepare': ['admin', 'pa'],
    'message.status': ['admin', 'pa'],
    'cert.preview': ['admin', 'pa'],
    'cert.release': ['admin'],
    'cert.correct': ['admin'],
    'cert.resend': ['admin'],
    'cert.print': ['admin'],
    'release.unused': ['admin'],
    'settings.edit': ['admin'],
    'approval.edit': ['admin'],
    'staff.manage': ['admin'],
    'audit.view': ['admin'],
    'export.register': ['admin', 'pa'],
    'export.full': ['admin'],
    'data.restore': ['admin']
  };

  // Evaluation survey — follows the supplied "CPD Evaluation Survey" template.
  const SURVEY = {
    ratings: [
      { key: 'relevance', label: 'Relevance to your practice' },
      { key: 'quality', label: 'Quality of presentation' },
      { key: 'usefulness', label: 'Practical usefulness' },
      { key: 'overall', label: 'Overall session' }
    ],
    choices: [
      { key: 'understanding', section: 'Knowledge & Impact', label: 'Did this improve your understanding?', options: ['Yes', 'No'] },
      { key: 'apply', section: 'Knowledge & Impact', label: 'Can you apply this in practice?', options: ['Yes', 'Partly', 'No'] },
      { key: 'bias', section: 'Compliance', label: 'Was the session free from commercial bias?', options: ['Yes', 'No'] }
    ],
    improveHint: 'e.g. content depth, time allocation, presentation style, venue, interaction',
    topics: ['HIV / Infectious Diseases', 'Chronic Diseases (e.g. Hypertension, Diabetes)', 'Ethics']
  };

  const STATUS_LABEL = {
    confirmed: 'Booked', waitlisted: 'Waiting list', offered: 'Offer pending',
    cancelled: 'Cancelled', declined: 'Offer declined', expired: 'Offer expired', released: 'Place released'
  };

  function contactsOf(event) {
    const list = (event && Array.isArray(event.contacts) && event.contacts.length) ? event.contacts : defaultEvent().contacts;
    return list.filter(c => c && (clean(c.phone) || clean(c.email)));
  }
  const contactText = event => contactsOf(event).map(c => [clean(c.phone), clean(c.email)].filter(Boolean).join(' · ')).join(', or ');
  function defaultEvent() {
    return {
      title: 'Clinical Update on Rhinosinusitis',
      topic: 'Rhinosinusitis',
      subtitle: 'Recognition, Assessment, Management and Referral',
      date: '2026-10-23',
      timezone: 'Africa/Windhoek',
      utcOffset: '+02:00',
      venue: 'Epikaizo Guest House',
      venueAddress: 'Erf 1140, Outapi',
      venueShort: 'Epikaizo Guest House, Outapi',
      presenter: 'Dr Buhlebenkosi Jacqueline Hlomani',
      presenterTitle: 'Specialist Otorhinolaryngologist',
      presenterSpecialty: 'Otorhinolaryngology',
      presenterPhoto: null, // null = supplied photo, 'none' = no photo, or an uploaded image
      audience: 'Doctors, pharmacists, nurses and allied health professionals',
      fee: 'Free',
      provider: 'WAP Medical Supplies',
      providerNumber: 'ORG01637',
      organiser: 'WAP Medical Supplies',
      // contact details shown to attendees (no personal names)
      contacts: [
        { phone: '+264 81 220 9167', email: 'Executive@rcempiremedical.com' },
        { phone: '+264 81 695 1252', email: 'marketing@wappharm.com' }
      ],
      phone: '+264 81 220 9167',
      emails: ['Executive@rcempiremedical.com', 'marketing@wappharm.com'],
      about: 'This session gives practical information on rhinosinusitis: how to recognise it, how it is assessed and managed, and when to refer patients to a specialist.',
      objectives: [
        'Distinguish acute and chronic rhinosinusitis and recognise common presentations.',
        'Describe assessment and management options, including appropriate medicine use.',
        'Recognise warning signs and identify when specialist referral is needed.',
        'Apply the learning to patient counselling and clinical practice.'
      ],
      programme: [
        { key: 'arrival', start: '17:30', end: '18:00', label: 'Arrival and registration' },
        { key: 'welcome', start: '18:00', end: '18:05', label: 'Welcome' },
        { key: 'presentation', start: '18:05', end: '19:05', label: 'Presentation' },
        { key: 'qa', start: '19:05', end: '19:30', label: 'Questions and answers' },
        { key: 'evaluation', start: '19:30', end: '19:45', label: 'Evaluation' },
        { key: 'dinner', start: '19:45', end: '20:30', label: 'Dinner, socialising and closing' }
      ],
      publicCap: 50,
      contingencyCap: 10,
      maxCap: 60,
      rsvpClose: '2026-10-23T12:00:00+02:00',
      offerHours: 24,
      eventDayOfferHours: 2,
      minOfferMinutes: 30,
      feedbackOpensTime: '19:05',
      feedbackCloseDays: 7,
      refPrefix: 'RHI26',
      publicWording: 'Limited to 50 advance-booking places. Places are reserved on a first-come, first-served basis. Please RSVP to secure your place.',
      approval: { activityNumber: '', ceus: '', level: '', enteredBy: null, enteredAt: null },
      signatory: { name: '', title: '', image: null }
    };
  }

  function createState(mode) {
    return {
      schema: SCHEMA,
      mode: mode === 'live' ? 'live' : 'demo',
      rev: 0,
      createdAt: null,
      event: defaultEvent(),
      staff: [],
      sessions: {},
      bookings: [],
      responses: [],
      messages: [],
      certificates: [],
      audit: [],
      counters: { cert: 0, msg: 0, audit: 0, booking: 0, exception: 0 },
      integration: { live: false },
      clock: { simulated: false, at: null, setAt: null },
      scenario: null
    };
  }

  // ---------- time ----------
  function tAt(event, hhmm, date) { return Date.parse(`${date || event.date}T${hhmm}:00${event.utcOffset}`); }
  function prog(event, key) { return (event.programme || []).find(p => p.key === key); }
  function times(event) {
    const g = (k, f) => { const p = prog(event, k); return p ? tAt(event, p[f]) : null; };
    const arrival = g('arrival', 'start');
    const eventEnd = g('dinner', 'end') || g('evaluation', 'end');
    return {
      arrival,
      eventStart: g('welcome', 'start') || arrival,
      presentationStart: g('presentation', 'start'),
      qaEnd: g('qa', 'end'),
      evaluationStart: g('evaluation', 'start'),
      eventEnd,
      rsvpClose: Date.parse(event.rsvpClose),
      checkinOpen: arrival - HOUR,
      feedbackOpen: tAt(event, event.feedbackOpensTime || '19:05'),
      feedbackClose: tAt(event, '23:59') + (event.feedbackCloseDays || 7) * DAY,
      backfillUntil: tAt(event, '23:59') + 30 * DAY
    };
  }
  function localDate(ms, tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  }
  function fmt(ms, tz, opts) {
    if (ms == null || isNaN(ms)) return '—';
    const o = Object.assign({ timeZone: tz || 'Africa/Windhoek' }, opts || { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    return new Intl.DateTimeFormat('en-GB', o).format(new Date(ms));
  }
  const fmtTime = (ms, tz) => fmt(ms, tz, { hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtDate = (ms, tz) => fmt(ms, tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const isEventDay = (state, now) => localDate(now, state.event.timezone) === state.event.date;

  // ---------- helpers ----------
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  function randStr(ctx, n, alphabet) {
    let s = '';
    for (let i = 0; i < n; i++) s += alphabet[Math.floor(ctx.rand() * alphabet.length)];
    return s;
  }
  const clean = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
  const digits = v => (v || '').replace(/\D/g, '');

  function normPhone(raw) {
    const r = clean(raw);
    if (!r) return { ok: true, empty: true, intl: '' };
    const d = digits(r);
    if (r.startsWith('+') || r.startsWith('00')) {
      const dd = r.startsWith('00') ? d.slice(2) : d;
      if (dd.length >= 10 && dd.length <= 15) return { ok: true, intl: dd };
      return { ok: false };
    }
    if (d.startsWith('264') && d.length === 12) return { ok: true, intl: d };
    if (d.startsWith('0') && d.length === 10) return { ok: true, intl: '264' + d.slice(1) };
    return { ok: false };
  }
  const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  const fullName = b => `${b.firstName} ${b.lastName}`;
  const HOLDS = ['confirmed', 'offered'];
  const LIVE_STATUSES = ['confirmed', 'offered', 'waitlisted'];

  function audit(state, ctx, who, action, ref, detail) {
    state.counters.audit++;
    state.audit.push({ id: state.counters.audit, at: ctx.now, who, action, ref: ref || '', detail: detail || '' });
  }
  const whoStaff = s => ({ kind: 'staff', id: s.id, name: s.name, role: s.role });
  const WHO_ATTENDEE = { kind: 'attendee', name: 'Attendee (own link)' };
  const WHO_SYSTEM = { kind: 'system', name: 'System' };

  function findBooking(state, id) {
    const b = state.bookings.find(x => x.id === id || x.ref === id);
    if (!b) fail('not_found', 'Booking not found.');
    return b;
  }
  function bookingByToken(state, token) {
    if (!token || typeof token !== 'string' || token.length < 16) return null;
    return state.bookings.find(b => b.token === token) || null;
  }

  // ---------- authentication & permissions ----------
  function login(state, ctx, staffId, pinHash) {
    const s = state.staff.find(x => x.id === staffId);
    if (!s || !s.active) fail('auth', 'Wrong name or PIN.');
    if (s.lockUntil && ctx.now < s.lockUntil) fail('locked', 'Too many wrong PINs. Try again in a few minutes.');
    if (s.pinHash !== pinHash) {
      s.failed = (s.failed || 0) + 1;
      if (s.failed >= 5) { s.lockUntil = ctx.now + 5 * MIN; s.failed = 0; }
      fail('auth', 'Wrong name or PIN.');
    }
    s.failed = 0; s.lockUntil = null;
    const token = randStr(ctx, 24, ALNUM);
    state.sessions[token] = { staffId: s.id, at: ctx.now };
    audit(state, ctx, whoStaff(s), 'Signed in', '', '');
    return token;
  }
  function logout(state, ctx, session) { delete state.sessions[session]; }
  function staffFor(state, actor) {
    if (!actor || !actor.session) return null;
    const sess = state.sessions[actor.session];
    if (!sess) return null;
    const s = state.staff.find(x => x.id === sess.staffId);
    return s && s.active ? s : null;
  }
  function can(state, actor, perm) {
    const s = staffFor(state, actor);
    return !!(s && PERMS[perm] && PERMS[perm].includes(s.role));
  }
  function need(state, actor, perm) {
    const s = staffFor(state, actor);
    if (!s) fail('auth', 'Please sign in as staff to do this.');
    if (!PERMS[perm]) fail('perm', 'Unknown action.');
    if (!PERMS[perm].includes(s.role)) fail('perm', `Only ${PERMS[perm].map(r => ROLES[r]).join(' or ')} can do this.`);
    return s;
  }

  // ---------- capacity ----------
  function capacity(state) {
    const e = state.event;
    let pubConf = 0, pubOffer = 0, cont = 0, wait = 0;
    for (const b of state.bookings) {
      if (b.pool === 'public' && b.status === 'confirmed') pubConf++;
      if (b.pool === 'public' && b.status === 'offered') pubOffer++;
      if (b.pool === 'contingency' && b.status === 'confirmed') cont++;
      if (b.status === 'waitlisted') wait++;
    }
    const publicUsed = pubConf + pubOffer, total = publicUsed + cont;
    return {
      publicCap: e.publicCap, contingencyCap: e.contingencyCap, maxCap: e.maxCap,
      publicConfirmed: pubConf, pendingOffers: pubOffer, publicUsed,
      publicFree: Math.max(0, Math.min(e.publicCap - publicUsed, e.maxCap - total)),
      contingencyUsed: cont,
      contingencyFree: Math.max(0, Math.min(e.contingencyCap - cont, e.maxCap - total)),
      total, totalFree: Math.max(0, e.maxCap - total), waitlisted: wait
    };
  }
  function checkInvariants(state) {
    const c = capacity(state);
    if (c.publicUsed > c.publicCap || c.contingencyUsed > c.contingencyCap || c.total > c.maxCap)
      fail('overbook', 'This would overbook the event. Nothing was saved.');
  }
  function waitlist(state) {
    return state.bookings.filter(b => b.status === 'waitlisted')
      .sort((a, b) => (a.waitlistedAt - b.waitlistedAt) || (a.seq - b.seq));
  }
  function publicSummary(state, now) {
    const t = times(state.event), c = capacity(state);
    const open = now < t.rsvpClose;
    let status = 'closed';
    if (open) status = (c.publicFree > 0 && c.waitlisted === 0) ? 'open' : 'waitlist';
    return { status, open, rsvpClose: t.rsvpClose, publicFree: (status === 'open') ? c.publicFree : 0, publicCap: c.publicCap };
  }

  // ---------- validation & duplicates ----------
  function validateAttendee(input, opts) {
    const errors = {};
    const v = {
      firstName: clean(input.firstName), lastName: clean(input.lastName),
      profession: clean(input.profession), professionOther: clean(input.professionOther),
      hpcnaStatus: input.hpcnaStatus || 'provided', hpcna: clean(input.hpcna).toUpperCase(),
      phone: clean(input.phone), email: clean(input.email).toLowerCase(),
      channel: input.channel || '', consentEvent: !!input.consentEvent, consentMarketing: !!input.consentMarketing
    };
    if (!v.firstName) errors.firstName = 'Enter a first name.';
    else if (v.firstName.length > 60) errors.firstName = 'First name is too long.';
    if (!v.lastName) errors.lastName = 'Enter a last name.';
    else if (v.lastName.length > 60) errors.lastName = 'Last name is too long.';
    if (!PROFESSIONS.includes(v.profession)) errors.profession = 'Choose a profession.';
    else if (v.profession === 'Other' && !v.professionOther) errors.professionOther = 'Tell us your profession.';
    if (v.profession !== 'Other') v.professionOther = '';
    if (!['provided', 'unavailable', 'not-applicable'].includes(v.hpcnaStatus)) v.hpcnaStatus = 'provided';
    if (v.hpcnaStatus === 'provided') {
      if (!v.hpcna) errors.hpcna = 'Enter your HPCNA registration number, or tick that it is not available.';
      else if (v.hpcna.length > 30) errors.hpcna = 'Registration number is too long.';
    } else v.hpcna = '';
    const p = normPhone(v.phone);
    const phoneOk = p.ok && !p.empty;
    if (!p.ok) errors.phone = 'Enter a valid mobile number, for example 081 123 4567 or +264 81 123 4567.';
    v.phoneIntl = phoneOk ? p.intl : '';
    const mailOk = !!v.email && emailOk(v.email);
    if (v.email && !mailOk) errors.email = 'Enter a valid email address.';
    else if (!v.email && opts && opts.requireEmail) errors.email = (opts.staff ? 'Enter the attendee’s email address, or tick “No email”.' : 'Enter your email address. Your booking confirmation is emailed to you.');
    if (!phoneOk && !mailOk && !errors.phone && !errors.email) errors.contact = 'Enter at least one way to reach you: a mobile number or an email address.';
    if (!CHANNELS[v.channel]) errors.channel = 'Choose how we should contact you.';
    else if ((v.channel === 'whatsapp' || v.channel === 'sms') && !phoneOk && !errors.phone) errors.channel = `${CHANNELS[v.channel]} needs a mobile number.`;
    else if (v.channel === 'email' && !mailOk && !errors.email) errors.channel = 'Email needs an email address.';
    if (!v.consentEvent) errors.consentEvent = (opts && opts.staff) ? 'Confirm the attendee agreed to event messages.' : 'Please agree to receive messages about this event.';
    return { ok: Object.keys(errors).length === 0, errors, value: v };
  }

  function findDuplicates(state, v, excludeId) {
    const out = [];
    const nm = (v.firstName + ' ' + v.lastName).toLowerCase();
    const ph = v.phoneIntl ? v.phoneIntl.slice(-9) : '';
    for (const b of state.bookings) {
      if (b.id === excludeId || !LIVE_STATUSES.concat(['released']).includes(b.status)) continue;
      const reasons = [];
      if (v.email && b.email && b.email === v.email) reasons.push('same email');
      if (ph && b.phoneIntl && b.phoneIntl.slice(-9) === ph) reasons.push('same phone');
      if (v.hpcna && b.hpcna && b.hpcna === v.hpcna) reasons.push('same HPCNA number');
      if (fullName(b).toLowerCase() === nm) reasons.push('same name');
      if (reasons.length) out.push({ id: b.id, ref: b.ref, name: fullName(b), reasons });
    }
    return out;
  }

  function newRef(state, ctx) {
    let ref;
    do { ref = `${state.event.refPrefix}-${randStr(ctx, 4, ALPHA)}`; } while (state.bookings.some(b => b.ref === ref));
    return ref;
  }

  // ---------- bookings ----------
  /* opts: { channel: 'public'|'staff', pool: 'auto'|'contingency', reason, source } */
  function createBooking(state, ctx, actor, input, opts) {
    opts = opts || {};
    const isStaff = opts.channel === 'staff';
    const now = ctx.now, t = times(state.event);
    let staff = null;
    if (isStaff) {
      staff = need(state, actor, 'register.routine');
      if (opts.pool === 'contingency') {
        need(state, actor, 'contingency.allocate');
        if (clean(opts.reason).length < 5) fail('reason', 'Record a reason for using a contingency place (at least a few words).');
      }
      if (now > t.eventEnd) {
        if (!can(state, actor, 'register.postEvent')) fail('closed', 'Only an administrator can add attendees after the event.');
        if (clean(opts.reason).length < 5) fail('reason', 'Record why this attendee is being added after the event.');
      }
    } else {
      if (now >= t.rsvpClose || now > t.eventEnd) fail('rsvp_closed', `Online RSVPs closed at ${fmt(t.rsvpClose, state.event.timezone)}. Please contact us: ${contactText(state.event)}.`);
    }
    if (!isStaff && input && clean(input.website)) fail('spam', 'Your RSVP could not be accepted. Please try again, or contact us.');
    const val = validateAttendee(input, { staff: isStaff, requireEmail: !isStaff || !(input && input.noEmail) });
    if (!val.ok) { const e = new RuleError('invalid', 'Please check the highlighted fields.'); e.errors = val.errors; throw e; }
    const v = val.value;
    if (!isStaff && v.email) {
      // one online booking per email address: the existing booking's link is sent again instead
      const existing = state.bookings.find(x => LIVE_STATUSES.includes(x.status) && x.email === v.email);
      if (existing) { const e = new RuleError('already_booked', 'You already have a booking with this email address.'); e.bookingId = existing.id; throw e; }
    }
    const dups = findDuplicates(state, v, null);
    const c = capacity(state);
    let status, pool;
    if (opts.pool === 'contingency') {
      if (c.contingencyFree <= 0) fail('contingency_full', 'No contingency places are left (maximum attendance reached).');
      status = 'confirmed'; pool = 'contingency';
    } else if (c.publicFree > 0 && c.waitlisted === 0) {
      status = 'confirmed'; pool = 'public';
    } else {
      status = 'waitlisted'; pool = 'public';
    }
    if (now > t.eventEnd && status !== 'confirmed') fail('capacity', 'No advance place is available. Select a contingency place if one remains.');
    state.counters.booking++;
    const b = Object.assign({}, v, {
      id: 'b' + state.counters.booking + randStr(ctx, 4, ALPHA),
      seq: state.counters.booking,
      ref: newRef(state, ctx),
      token: randStr(ctx, 26, ALNUM),
      createdAt: now,
      postEventReason: now > t.eventEnd ? clean(opts.reason) : '',
      source: isStaff ? (opts.source || 'staff-desk') : 'online',
      createdBy: staff ? staff.name : 'Online RSVP',
      status, pool,
      waitlistedAt: status === 'waitlisted' ? now : null,
      contingencyReason: pool === 'contingency' ? clean(opts.reason) : '',
      offer: null, offerHistory: [],
      flags: {
        duplicate: dups.length ? { matches: dups, resolved: null } : null,
        hpcnaReview: v.hpcnaStatus !== 'provided' ? { reason: v.hpcnaStatus, resolved: null } : null
      },
      detailsChecked: null, arrival: null, completion: null, feedback: null,
      released: null, cancelled: null, exceptions: [], corrections: []
    });
    state.bookings.push(b);
    checkInvariants(state);
    const who = staff ? whoStaff(staff) : WHO_ATTENDEE;
    audit(state, ctx, who, pool === 'contingency' ? 'Contingency place allocated' : (status === 'waitlisted' ? 'Added to waiting list' : 'Booking created'),
      b.ref, `${fullName(b)} · ${b.source}${pool === 'contingency' ? ' · Reason: ' + b.contingencyReason : ''}${dups.length ? ' · Possible duplicate of ' + dups.map(d => d.ref).join(', ') : ''}`);
    if (now > t.eventEnd) {
      audit(state, ctx, who, 'Post-event attendee added', b.ref, `${fullName(b)} · Reason: ${b.postEventReason}`);
    } else {
      prepareMessage(state, ctx, null, b.id, status === 'waitlisted' ? 'waitlist' : 'confirmation');
    }
    return b;
  }

  function isLocked(state, b) { return state.certificates.some(c => c.bookingId === b.id && c.status === 'current'); }

  const EDITABLE = ['firstName', 'lastName', 'profession', 'professionOther', 'hpcnaStatus', 'hpcna', 'phone', 'email', 'channel', 'consentMarketing'];
  function updateDetails(state, ctx, actor, id, changes, opts) {
    opts = opts || {};
    let who;
    const b = opts.token ? bookingByToken(state, opts.token) : findBooking(state, id);
    if (!b) fail('not_found', 'Booking not found.');
    if (opts.token) {
      if (b.token !== opts.token) fail('perm', 'This link does not match the booking.');
      who = WHO_ATTENDEE;
    } else who = whoStaff(need(state, actor, 'booking.edit'));
    if (isLocked(state, b)) fail('cert_issued', 'A certificate has been issued. Ask the administrator for a controlled certificate correction.');
    if (['cancelled', 'declined', 'expired'].includes(b.status)) fail('inactive', 'This booking is no longer active.');
    const merged = Object.assign({}, b, changes, { consentEvent: true });
    const val = validateAttendee(merged, { staff: who.kind === 'staff', requireEmail: who.kind !== 'staff' });
    if (!val.ok) { const e = new RuleError('invalid', 'Please check the highlighted fields.'); e.errors = val.errors; throw e; }
    const v = val.value, diffs = [];
    for (const k of EDITABLE.concat(['phoneIntl'])) {
      if (String(b[k] ?? '') !== String(v[k] ?? '')) { if (k !== 'phoneIntl') diffs.push({ field: k, from: b[k], to: v[k] }); b[k] = v[k]; }
    }
    if (!diffs.length) return b;
    const identity = diffs.some(d => ['firstName', 'lastName', 'hpcna', 'hpcnaStatus', 'profession', 'professionOther'].includes(d.field));
    if (identity && b.detailsChecked) b.detailsChecked = null;
    if (diffs.some(d => d.field === 'hpcnaStatus' || d.field === 'hpcna')) {
      b.flags.hpcnaReview = v.hpcnaStatus !== 'provided' ? { reason: v.hpcnaStatus, resolved: null } : null;
    }
    const dups = findDuplicates(state, v, b.id);
    if (dups.length && !(b.flags.duplicate && b.flags.duplicate.resolved)) b.flags.duplicate = { matches: dups, resolved: null };
    else if (!dups.length && b.flags.duplicate && !b.flags.duplicate.resolved) b.flags.duplicate = null;
    for (const d of diffs) b.corrections.push(Object.assign({ at: ctx.now, by: who.name, reason: clean(opts.reason) }, d));
    audit(state, ctx, who, 'Details corrected', b.ref, diffs.map(d => `${d.field}: "${d.from ?? ''}" → "${d.to ?? ''}"`).join('; '));
    return b;
  }

  function cancelBooking(state, ctx, actor, id, opts) {
    opts = opts || {};
    let who;
    const b = opts.token ? bookingByToken(state, opts.token) : findBooking(state, id);
    if (!b) fail('not_found', 'Booking not found.');
    const t = times(state.event);
    if (opts.token) {
      who = WHO_ATTENDEE;
      if (ctx.now >= t.eventStart) fail('too_late', 'The event has started. Please speak to the registration desk.');
    } else who = whoStaff(need(state, actor, 'booking.cancel'));
    if (!LIVE_STATUSES.includes(b.status)) fail('inactive', 'This booking is not active.');
    if (b.arrival) fail('arrived', 'This attendee has already arrived. Record an early departure instead.');
    const prev = b.status;
    b.status = 'cancelled';
    b.cancelled = { at: ctx.now, by: who.name, reason: clean(opts.reason), from: prev };
    if (b.offer) b.offer.outcome = 'cancelled';
    audit(state, ctx, who, 'Booking cancelled', b.ref, `${fullName(b)} · was ${STATUS_LABEL[prev]}${opts.reason ? ' · ' + clean(opts.reason) : ''}`);
    return b;
  }

  // ---------- waiting list & offers ----------
  function offerWindow(state, now) {
    const t = times(state.event), e = state.event;
    const hours = isEventDay(state, now) ? e.eventDayOfferHours : e.offerHours;
    const expiresAt = Math.min(now + hours * HOUR, t.eventStart);
    const okWindow = expiresAt - now >= e.minOfferMinutes * MIN;
    return { hours, expiresAt, ok: okWindow && now < t.eventStart, cappedAtStart: expiresAt === t.eventStart };
  }

  function makeOffer(state, ctx, actor, id, opts) {
    opts = opts || {};
    const s = need(state, actor, 'waitlist.offer');
    processExpiries(state, ctx);
    const q = waitlist(state);
    if (!q.length) fail('empty', 'Nobody is on the waiting list.');
    const b = id ? findBooking(state, id) : q[0];
    if (b.status !== 'waitlisted') fail('state', 'Only people on the waiting list can receive an offer.');
    if (b.id !== q[0].id) {
      need(state, actor, 'waitlist.offerOutOfOrder');
      if (clean(opts.reason).length < 5) fail('reason', 'Record why this person is offered a place ahead of the queue.');
    }
    const c = capacity(state);
    if (c.publicFree <= 0) fail('no_place', 'No public place is free. A place frees up when someone cancels, declines or lets an offer expire.');
    const w = offerWindow(state, ctx.now);
    if (!w.ok) fail('too_late', 'There is not enough time before the event starts for a normal offer. Handle this late case at the desk: confirm the place directly if it is still free.');
    b.status = 'offered';
    b.offer = { at: ctx.now, expiresAt: w.expiresAt, by: s.name, hours: w.hours, capped: w.cappedAtStart, outcome: null };
    b.offerHistory.push(Object.assign({}, b.offer));
    checkInvariants(state);
    audit(state, ctx, whoStaff(s), 'Waiting-list offer made', b.ref, `${fullName(b)} · expires ${fmt(w.expiresAt, state.event.timezone)}${opts.reason ? ' · Out of order: ' + clean(opts.reason) : ''}`);
    prepareMessage(state, ctx, null, b.id, 'offer');
    return b;
  }

  function respondToOffer(state, ctx, actor, id, accept, opts) {
    opts = opts || {};
    let who;
    const b = opts.token ? bookingByToken(state, opts.token) : findBooking(state, id);
    if (!b) fail('not_found', 'Booking not found.');
    who = opts.token ? WHO_ATTENDEE : whoStaff(need(state, actor, 'waitlist.recordResponse'));
    if (b.status !== 'offered') fail('state', 'There is no open offer on this booking.');
    if (ctx.now >= b.offer.expiresAt) {
      expireOffer(state, ctx, b);
      fail('offer_expired', `Sorry, this offer has expired and the place has been released. Please contact us: ${contactText(state.event)}.`);
    }
    b.offer.outcome = accept ? 'accepted' : 'declined';
    b.offer.respondedAt = ctx.now;
    const h = b.offerHistory[b.offerHistory.length - 1]; if (h) Object.assign(h, { outcome: b.offer.outcome, respondedAt: ctx.now });
    b.status = accept ? 'confirmed' : 'declined';
    audit(state, ctx, who, accept ? 'Offer accepted' : 'Offer declined', b.ref, fullName(b));
    if (accept) prepareMessage(state, ctx, null, b.id, 'confirmation');
    return b;
  }

  function expireOffer(state, ctx, b) {
    b.status = 'expired';
    b.offer.outcome = 'expired';
    const h = b.offerHistory[b.offerHistory.length - 1]; if (h) h.outcome = 'expired';
    audit(state, ctx, WHO_SYSTEM, 'Offer expired', b.ref, `${fullName(b)} · place returned`);
  }
  function processExpiries(state, ctx) {
    let n = 0;
    for (const b of state.bookings) if (b.status === 'offered' && ctx.now >= b.offer.expiresAt) { expireOffer(state, ctx, b); n++; }
    return n;
  }

  /* Late case: a normal offer is no longer possible, staff confirm a free place directly. */
  function confirmLate(state, ctx, actor, id, reason) {
    const s = need(state, actor, 'waitlist.confirmLate');
    const b = findBooking(state, id);
    if (!['waitlisted', 'expired', 'released'].includes(b.status)) fail('state', 'Only waiting-list, expired-offer or released bookings can be confirmed this way.');
    const w = offerWindow(state, ctx.now);
    if (w.ok && s.role !== 'admin') fail('use_offer', 'There is still time for a normal offer. Use "Offer next place" so the waiting-list order is respected.');
    if (s.role === 'admin' && w.ok && clean(reason).length < 5) fail('reason', 'Record why the normal offer process is being skipped.');
    if (ctx.now > times(state.event).eventEnd) fail('closed', 'The event has ended.');
    const c = capacity(state);
    if (c.publicFree <= 0) fail('no_place', 'No public place is free. The administrator can allocate a contingency place instead.');
    const prev = b.status;
    b.status = 'confirmed'; b.pool = 'public';
    b.released = null;
    checkInvariants(state);
    audit(state, ctx, whoStaff(s), 'Late place confirmed at desk', b.ref, `${fullName(b)} · was ${STATUS_LABEL[prev]}${reason ? ' · ' + clean(reason) : ''}`);
    return b;
  }

  function allocateContingencyFor(state, ctx, actor, id, reason) {
    const s = need(state, actor, 'contingency.allocate');
    const b = findBooking(state, id);
    if (!['waitlisted', 'expired', 'released', 'declined'].includes(b.status)) fail('state', 'This person already has a place or an open offer.');
    if (clean(reason).length < 5) fail('reason', 'Record a reason for using a contingency place.');
    if (capacity(state).contingencyFree <= 0) fail('contingency_full', 'No contingency places are left (maximum attendance reached).');
    const prev = b.status;
    b.status = 'confirmed'; b.pool = 'contingency'; b.contingencyReason = clean(reason); b.released = null;
    checkInvariants(state);
    audit(state, ctx, whoStaff(s), 'Contingency place allocated', b.ref, `${fullName(b)} · was ${STATUS_LABEL[prev]} · Reason: ${clean(reason)}`);
    prepareMessage(state, ctx, null, b.id, 'confirmation');
    return b;
  }

  /* After the presentation starts, the administrator may release places held by people who have not arrived. */
  function releaseUnused(state, ctx, actor, ids) {
    const s = need(state, actor, 'release.unused');
    const t = times(state.event);
    if (ctx.now < t.presentationStart) fail('too_early', `Unused bookings can only be released after the presentation starts (${fmtTime(t.presentationStart, state.event.timezone)}).`);
    if (ctx.now > t.eventEnd) fail('closed', 'The event has ended.');
    const targets = state.bookings.filter(b => b.status === 'confirmed' && !b.arrival && (!ids || ids.includes(b.id)));
    if (!targets.length) fail('none', 'There are no unused bookings to release.');
    for (const b of targets) { b.status = 'released'; b.released = { at: ctx.now, by: s.name, from: b.pool }; }
    audit(state, ctx, whoStaff(s), 'Unused bookings released', '', `${targets.length} place(s): ${targets.map(b => b.ref).join(', ')}`);
    return targets.length;
  }
  function reinstate(state, ctx, actor, id) {
    const s = need(state, actor, 'booking.reinstate');
    const b = findBooking(state, id);
    if (b.status !== 'released') fail('state', 'Only released bookings can be reinstated.');
    const c = capacity(state);
    const pool = b.released && b.released.from === 'contingency' ? 'contingency' : 'public';
    if ((pool === 'public' ? c.publicFree : c.contingencyFree) <= 0) fail('no_place', 'That place has been taken. There is no free place to reinstate this booking.');
    b.status = 'confirmed'; b.pool = pool; b.released = null;
    checkInvariants(state);
    audit(state, ctx, whoStaff(s), 'Released booking reinstated', b.ref, fullName(b));
    return b;
  }

  // ---------- attendance ----------
  function parseQr(state, payload) {
    const m = /^WAPCPD:([A-Z0-9]+-[A-Z0-9]{4}):([A-Za-z0-9]{6})$/.exec(clean(payload));
    if (!m) return null;
    const b = state.bookings.find(x => x.ref === m[1]);
    if (!b || b.token.slice(0, 6) !== m[2]) return null;
    return b;
  }
  const qrPayload = b => `WAPCPD:${b.ref}:${b.token.slice(0, 6)}`;

  function attendanceTime(state, ctx, occurredAt, kind) {
    const t = times(state.event), now = ctx.now;
    if (now < t.checkinOpen) fail('not_event_time', `Attendance can be recorded from ${fmt(t.checkinOpen, state.event.timezone)}.`);
    if (now > t.backfillUntil) fail('closed', 'The period for entering attendance records has closed.');
    let at = now;
    if (occurredAt != null) {
      at = occurredAt;
      if (at > now) fail('future', 'The time cannot be in the future.');
      if (at < t.checkinOpen || at > t.eventEnd + HOUR) fail('range', 'The time must be during the event.');
    } else if (now > t.eventEnd + HOUR) {
      fail('needs_time', 'After the event, enter the time from the paper record.');
    }
    return at;
  }

  function recordArrival(state, ctx, actor, id, method, occurredAt) {
    const s = need(state, actor, 'attendance.arrive');
    const b = findBooking(state, id);
    if (b.status !== 'confirmed') fail('state', b.status === 'released' ? 'This place was released. Reinstate it first if a place is free.' : `Cannot check in: booking is "${STATUS_LABEL[b.status]}".`);
    if (b.arrival) fail('already', `Already checked in at ${fmtTime(b.arrival.at, state.event.timezone)}.`);
    const at = attendanceTime(state, ctx, occurredAt);
    b.arrival = { at, recordedAt: ctx.now, by: s.name, method: method || 'search' };
    audit(state, ctx, whoStaff(s), 'Arrival recorded', b.ref, `${fullName(b)} · ${b.arrival.method}${occurredAt != null ? ' · from paper, time ' + fmtTime(at, state.event.timezone) : ''}`);
    return b;
  }
  function undoArrival(state, ctx, actor, id, reason) {
    const s = need(state, actor, 'attendance.undoArrival');
    const b = findBooking(state, id);
    if (!b.arrival) fail('state', 'No arrival is recorded.');
    if (b.completion) fail('state', 'Completion is recorded. The administrator must undo completion first.');
    b.arrival = null;
    audit(state, ctx, whoStaff(s), 'Arrival undone', b.ref, `${fullName(b)}${reason ? ' · ' + clean(reason) : ''}`);
    return b;
  }

  function confirmCompletion(state, ctx, actor, id, method, occurredAt) {
    const s = need(state, actor, 'attendance.complete');
    const b = findBooking(state, id);
    const t = times(state.event), tz = state.event.timezone;
    if (!['register', 'qr-checkout'].includes(method)) fail('method', 'Choose how completion was confirmed: signed register or QR check-out.');
    if (b.status !== 'confirmed') fail('state', 'Only booked attendees can complete the session.');
    if (!b.arrival) fail('no_arrival', 'Record the arrival first. Completion is confirmed for people who attended.');
    if (b.completion && b.completion.status === 'early-pending') fail('pending_review', 'An early departure is waiting for administrator review.');
    if (b.completion && ['confirmed', 'early-approved'].includes(b.completion.status)) fail('already', 'Completion is already recorded.');
    if (b.completion && b.completion.status === 'early-rejected') fail('rejected', 'The administrator did not accept this attendance after an early departure.');
    const at = attendanceTime(state, ctx, occurredAt);
    if (at < t.qaEnd) fail('too_early', `Completion is confirmed at the end of questions and answers (${fmtTime(t.qaEnd, tz)}). If the attendee is leaving now, record an early departure.`);
    b.completion = { status: 'confirmed', method, at, recordedAt: ctx.now, by: s.name };
    audit(state, ctx, whoStaff(s), 'Session completion confirmed', b.ref, `${fullName(b)} · ${method === 'register' ? 'signed register' : 'QR check-out'} · ${fmtTime(at, tz)}`);
    return b;
  }

  function addException(state, ctx, who, b, type, note) {
    state.counters.exception++;
    const ex = { id: 'x' + state.counters.exception, type, note: clean(note), at: ctx.now, by: who.name, resolved: null };
    b.exceptions.push(ex);
    return ex;
  }

  function recordEarlyDeparture(state, ctx, actor, id, leftAt, note) {
    const s = need(state, actor, 'attendance.early');
    const b = findBooking(state, id);
    const t = times(state.event);
    if (!b.arrival) fail('no_arrival', 'Record the arrival first.');
    if (b.completion) fail('already', 'Completion or a departure is already recorded.');
    const at = leftAt != null ? leftAt : ctx.now;
    if (at >= t.qaEnd) fail('not_early', 'This is after the end of Q&A. Confirm completion instead.');
    if (at < b.arrival.at) fail('range', 'The departure time is before the arrival time.');
    if (at > ctx.now) fail('future', 'The time cannot be in the future.');
    if (clean(note).length < 3) fail('reason', 'Add a short note (for example, the reason given for leaving).');
    b.completion = { status: 'early-pending', leftAt: at, note: clean(note), recordedAt: ctx.now, by: s.name };
    addException(state, ctx, whoStaff(s), b, 'early-departure', `Left at ${fmtTime(at, state.event.timezone)}: ${clean(note)}`);
    audit(state, ctx, whoStaff(s), 'Early departure flagged', b.ref, `${fullName(b)} · left ${fmtTime(at, state.event.timezone)} · ${clean(note)}`);
    return b;
  }

  function reviewEarlyDeparture(state, ctx, actor, id, approve, note) {
    const s = need(state, actor, 'exception.review');
    const b = findBooking(state, id);
    if (!b.completion || b.completion.status !== 'early-pending') fail('state', 'There is no early departure waiting for review.');
    if (clean(note).length < 3) fail('reason', 'Add a short note explaining the decision.');
    b.completion.status = approve ? 'early-approved' : 'early-rejected';
    Object.assign(b.completion, { reviewedBy: s.name, reviewedAt: ctx.now, reviewNote: clean(note), method: approve ? 'early-approved' : null });
    for (const ex of b.exceptions) if (ex.type === 'early-departure' && !ex.resolved) ex.resolved = { at: ctx.now, by: s.name, note: (approve ? 'Approved: ' : 'Not approved: ') + clean(note) };
    audit(state, ctx, whoStaff(s), approve ? 'Early departure approved' : 'Early departure not approved', b.ref, `${fullName(b)} · ${clean(note)}`);
    return b;
  }

  function undoCompletion(state, ctx, actor, id, reason) {
    const s = need(state, actor, 'attendance.undoCompletion');
    const b = findBooking(state, id);
    if (!b.completion) fail('state', 'No completion is recorded.');
    if (isLocked(state, b)) fail('cert_issued', 'A certificate has been issued for this attendee.');
    if (clean(reason).length < 3) fail('reason', 'Add a reason.');
    b.completion = null;
    for (const ex of b.exceptions) if (ex.type === 'early-departure' && !ex.resolved) ex.resolved = { at: ctx.now, by: s.name, note: 'Withdrawn: ' + clean(reason) };
    audit(state, ctx, whoStaff(s), 'Completion undone', b.ref, `${fullName(b)} · ${clean(reason)}`);
    return b;
  }
  const completed = b => !!(b.completion && ['confirmed', 'early-approved'].includes(b.completion.status));

  // ---------- exceptions & checks ----------
  function flagException(state, ctx, actor, id, note) {
    const s = need(state, actor, 'exception.flag');
    const b = findBooking(state, id);
    if (clean(note).length < 3) fail('reason', 'Describe the issue in a few words.');
    const ex = addException(state, ctx, whoStaff(s), b, 'other', note);
    audit(state, ctx, whoStaff(s), 'Exception flagged for review', b.ref, `${fullName(b)} · ${clean(note)}`);
    return ex;
  }
  function resolveException(state, ctx, actor, id, exId, note) {
    const s = need(state, actor, 'exception.review');
    const b = findBooking(state, id);
    const ex = b.exceptions.find(x => x.id === exId);
    if (!ex) fail('not_found', 'Exception not found.');
    if (ex.type === 'early-departure') fail('use_review', 'Use the early-departure review to decide this one.');
    if (ex.resolved) fail('already', 'Already resolved.');
    if (clean(note).length < 3) fail('reason', 'Add a short resolution note.');
    ex.resolved = { at: ctx.now, by: s.name, note: clean(note) };
    audit(state, ctx, whoStaff(s), 'Exception resolved', b.ref, `${fullName(b)} · ${clean(note)}`);
    return ex;
  }
  function resolveDuplicate(state, ctx, actor, id, decision, note) {
    const s = need(state, actor, 'duplicate.resolve');
    const b = findBooking(state, id);
    if (!b.flags.duplicate || b.flags.duplicate.resolved) fail('state', 'There is no open duplicate flag.');
    if (clean(note).length < 3) fail('reason', 'Add a short note.');
    if (decision === 'cancel') {
      if (b.arrival) fail('arrived', 'This booking has an arrival recorded. Review it before cancelling.');
      if (LIVE_STATUSES.includes(b.status)) { b.cancelled = { at: ctx.now, by: s.name, reason: 'Duplicate: ' + clean(note), from: b.status }; b.status = 'cancelled'; }
    } else if (decision !== 'not-duplicate') fail('decision', 'Choose a decision.');
    b.flags.duplicate.resolved = { at: ctx.now, by: s.name, decision, note: clean(note) };
    audit(state, ctx, whoStaff(s), decision === 'cancel' ? 'Duplicate booking cancelled' : 'Marked as not a duplicate', b.ref, `${fullName(b)} · ${clean(note)}`);
    return b;
  }
  function resolveHpcna(state, ctx, actor, id, number, note) {
    const s = need(state, actor, 'hpcna.resolve');
    const b = findBooking(state, id);
    if (!b.flags.hpcnaReview || b.flags.hpcnaReview.resolved) fail('state', 'There is no open registration-number review.');
    if (isLocked(state, b)) fail('cert_issued', 'A certificate has been issued. Use a certificate correction.');
    const n = clean(number).toUpperCase();
    if (!n && clean(note).length < 3) fail('reason', 'Enter the registration number, or add a note confirming why none applies.');
    if (n) { b.corrections.push({ at: ctx.now, by: s.name, field: 'hpcna', from: b.hpcna, to: n, reason: 'Registration review' }); b.hpcna = n; b.hpcnaStatus = 'provided'; }
    b.flags.hpcnaReview.resolved = { at: ctx.now, by: s.name, number: n, note: clean(note) };
    if (b.detailsChecked) b.detailsChecked = null;
    audit(state, ctx, whoStaff(s), 'Registration-number review resolved', b.ref, `${fullName(b)} · ${n ? 'Number recorded: ' + n : 'No number: ' + clean(note)}`);
    return b;
  }
  function markDetailsChecked(state, ctx, actor, id) {
    const s = need(state, actor, 'details.check');
    const b = findBooking(state, id);
    if (b.flags.duplicate && !b.flags.duplicate.resolved) fail('dup_open', 'Resolve the possible duplicate first (administrator).');
    if (b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved) fail('hpcna_open', 'The missing registration number needs administrator review first.');
    b.detailsChecked = { at: ctx.now, by: s.name };
    audit(state, ctx, whoStaff(s), 'Details checked', b.ref, `${fullName(b)} · ${b.hpcna || 'no HPCNA number'}`);
    return b;
  }

  // ---------- feedback ----------
  function validateFeedback(a) {
    const errors = {};
    a = a || {};
    const out = { ratings: {}, choices: {}, improve: clean(a.improve).slice(0, 1500), topics: [], topicOther: clean(a.topicOther).slice(0, 200) };
    for (const r of SURVEY.ratings) {
      const n = Number(a.ratings && a.ratings[r.key]);
      if (!(n >= 1 && n <= 5 && Number.isInteger(n))) errors[r.key] = 'Choose a rating from 1 to 5.'; else out.ratings[r.key] = n;
    }
    for (const c of SURVEY.choices) {
      const v = a.choices && a.choices[c.key];
      if (!c.options.includes(v)) errors[c.key] = 'Choose an answer.'; else out.choices[c.key] = v;
    }
    if (Array.isArray(a.topics)) out.topics = a.topics.filter(x => SURVEY.topics.includes(x));
    return { ok: !Object.keys(errors).length, errors, value: out };
  }
  function storeResponse(state, ctx, method, answers) {
    // Anonymous: no booking id, time rounded to the hour, inserted at a random position.
    const r = { id: randStr(ctx, 10, ALNUM), method, day: localDate(ctx.now, state.event.timezone), answers };
    const pos = Math.floor(ctx.rand() * (state.responses.length + 1));
    state.responses.splice(pos, 0, r);
  }
  function submitFeedback(state, ctx, token, answers) {
    const b = bookingByToken(state, token);
    if (!b) fail('not_found', 'This feedback link is not valid.');
    if (b.status !== 'confirmed') fail('state', 'Feedback is for booked attendees.');
    const t = times(state.event);
    if (ctx.now < t.feedbackOpen) fail('not_open', `The evaluation opens at ${fmt(t.feedbackOpen, state.event.timezone)}.`);
    if (ctx.now > t.feedbackClose) fail('closed', `The online evaluation has closed. Please contact us: ${contactText(state.event)}.`);
    if (b.feedback) fail('already', 'Thank you. Your evaluation has already been received.');
    const val = validateFeedback(answers);
    if (!val.ok) { const e = new RuleError('invalid', 'Please answer the required questions.'); e.errors = val.errors; throw e; }
    storeResponse(state, ctx, 'online', val.value);
    b.feedback = { at: ctx.now, method: 'online' };
    audit(state, ctx, WHO_ATTENDEE, 'Evaluation submitted online', b.ref, fullName(b));
    return b;
  }
  function recordPaperFeedback(state, ctx, actor, id, answers) {
    const s = need(state, actor, 'feedback.paper');
    const b = findBooking(state, id);
    if (b.status !== 'confirmed') fail('state', 'Feedback is for booked attendees.');
    if (b.feedback) fail('already', 'An evaluation is already recorded for this attendee.');
    if (ctx.now < times(state.event).feedbackOpen) fail('not_open', 'Evaluations are recorded after the session.');
    let entered = false;
    if (answers) {
      const val = validateFeedback(answers);
      if (!val.ok) { const e = new RuleError('invalid', 'Please complete the required answers from the paper form.'); e.errors = val.errors; throw e; }
      storeResponse(state, ctx, 'paper', val.value); entered = true;
    }
    b.feedback = { at: ctx.now, method: 'paper', by: s.name, answersEntered: entered };
    audit(state, ctx, whoStaff(s), 'Paper evaluation received', b.ref, `${fullName(b)}${entered ? ' · answers entered' : ' · answers to be entered later (anonymous batch)'}`);
    return b;
  }
  function addPaperResponse(state, ctx, actor, answers) {
    const s = need(state, actor, 'feedback.paper');
    const val = validateFeedback(answers);
    if (!val.ok) { const e = new RuleError('invalid', 'Please complete the required answers from the paper form.'); e.errors = val.errors; throw e; }
    storeResponse(state, ctx, 'paper', val.value);
    audit(state, ctx, whoStaff(s), 'Anonymous paper evaluation entered', '', '');
  }
  function feedbackSummary(state, actor) {
    need(state, actor, 'feedback.summary');
    const R = state.responses, n = R.length;
    const ratings = {}, choices = {}, topics = {};
    for (const r of SURVEY.ratings) {
      const dist = [0, 0, 0, 0, 0]; let sum = 0;
      for (const x of R) { const v = x.answers.ratings[r.key]; if (v) { dist[v - 1]++; sum += v; } }
      ratings[r.key] = { label: r.label, avg: n ? sum / n : 0, dist };
    }
    for (const c of SURVEY.choices) {
      const counts = {}; c.options.forEach(o => counts[o] = 0);
      for (const x of R) counts[x.answers.choices[c.key]]++;
      choices[c.key] = { label: c.label, counts };
    }
    for (const t of SURVEY.topics) topics[t] = 0;
    const other = [], improve = [];
    for (const x of R) { x.answers.topics.forEach(t => topics[t]++); if (x.answers.topicOther) other.push(x.answers.topicOther); if (x.answers.improve) improve.push(x.answers.improve); }
    const recorded = state.bookings.filter(b => b.feedback).length;
    const paperPending = state.bookings.filter(b => b.feedback && b.feedback.method === 'paper' && !b.feedback.answersEntered).length;
    return { n, ratings, choices, topics, other, improve, recorded, paperPending };
  }

  // ---------- certificates ----------
  function approvalComplete(event) {
    const a = event.approval || {};
    return !!(clean(a.activityNumber) && clean(a.ceus) && clean(a.level));
  }
  function currentCert(state, b) { return state.certificates.find(c => c.bookingId === b.id && c.status === 'current') || null; }

  function blockers(state, b) {
    const out = [];
    const add = (code, label, who) => out.push({ code, label, who });
    if (b.status !== 'confirmed') { add('not_booked', `Booking is "${STATUS_LABEL[b.status]}".`, 'staff'); return out; }
    if (!b.arrival) add('no_arrival', 'No arrival recorded.', 'reception');
    if (!b.completion) add('no_completion', 'Session completion not confirmed (signed register or QR check-out).', 'reception');
    else if (b.completion.status === 'early-pending') add('early_pending', 'Early departure is waiting for administrator review.', 'admin');
    else if (b.completion.status === 'early-rejected') add('early_rejected', 'Attendance was not accepted after an early departure.', 'admin');
    if (!b.feedback) add('no_feedback', 'No evaluation recorded. NO FEEDBACK, NO CERTIFICATE.', 'attendee');
    if (b.flags.duplicate && !b.flags.duplicate.resolved) add('duplicate', 'Possible duplicate booking needs review.', 'admin');
    if (b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved) add('hpcna', 'Missing HPCNA registration number needs review.', 'admin');
    if (!b.detailsChecked) add('details', 'Attendee details not yet checked.', 'reception');
    const open = b.exceptions.filter(x => !x.resolved && x.type !== 'early-departure');
    if (open.length) add('exception', `${open.length} open exception(s) need administrator review.`, 'admin');
    if (!approvalComplete(state.event)) add('approval', 'HPCNA-approved activity number, CEUs and level not entered yet.', 'admin');
    return out;
  }
  function certStatus(state, b) {
    const cur = currentCert(state, b);
    if (cur) return { key: 'released', label: cur.version > 1 ? `Released (v${cur.version})` : 'Released', cert: cur, blockers: [] };
    const bl = blockers(state, b);
    if (b.status !== 'confirmed') return { key: 'na', label: '—', blockers: bl };
    return bl.length ? { key: 'blocked', label: 'Blocked', blockers: bl } : { key: 'ready', label: 'Ready to release', blockers: [] };
  }
  function snapshotFor(b) {
    return {
      firstName: b.firstName, lastName: b.lastName, profession: b.profession === 'Other' ? b.professionOther : b.profession,
      hpcna: b.hpcna || 'Not applicable'
    };
  }
  function issue(state, ctx, s, b, number, version, reason) {
    const cert = {
      id: 'c' + (state.certificates.length + 1) + randStr(ctx, 4, ALPHA),
      bookingId: b.id, ref: b.ref, number, version,
      token: randStr(ctx, 26, ALNUM),
      verify: randStr(ctx, 8, ALPHA),
      status: 'current', issuedAt: ctx.now, issuedBy: s.name, reason: reason || '',
      snapshot: snapshotFor(b),
      approval: Object.assign({}, state.event.approval),
      demo: state.mode === 'demo'
    };
    state.certificates.push(cert);
    return cert;
  }
  function releaseCertificate(state, ctx, actor, id) {
    const s = need(state, actor, 'cert.release');
    const b = findBooking(state, id);
    if (currentCert(state, b)) fail('already', 'A certificate has already been released. Use resend or correction.');
    const bl = blockers(state, b);
    if (bl.length) fail('blocked', 'Certificate cannot be released yet: ' + bl.map(x => x.label).join(' '));
    state.counters.cert++;
    const number = `${state.event.providerNumber}-${state.event.refPrefix}-${String(state.counters.cert).padStart(4, '0')}`;
    const cert = issue(state, ctx, s, b, number, 1, 'First issue');
    audit(state, ctx, whoStaff(s), 'Certificate released', b.ref, `${fullName(b)} · ${number}`);
    prepareMessage(state, ctx, null, b.id, 'certificate');
    return cert;
  }
  function releaseAllReady(state, ctx, actor) {
    need(state, actor, 'cert.release');
    let n = 0;
    for (const b of state.bookings) if (certStatus(state, b).key === 'ready') { releaseCertificate(state, ctx, actor, b.id); n++; }
    if (!n) fail('none', 'No certificates are ready to release.');
    return n;
  }
  function correctCertificate(state, ctx, actor, id, changes, reason) {
    const s = need(state, actor, 'cert.correct');
    const b = findBooking(state, id);
    const cur = currentCert(state, b);
    if (!cur) fail('state', 'No released certificate to correct.');
    if (clean(reason).length < 5) fail('reason', 'Record the reason for the correction.');
    const fields = ['firstName', 'lastName', 'hpcna'];
    const diffs = [];
    for (const f of fields) if (changes[f] != null) {
      const v = f === 'hpcna' ? clean(changes[f]).toUpperCase() : clean(changes[f]);
      if (!v && f !== 'hpcna') fail('invalid', 'Name fields cannot be empty.');
      if (v !== b[f]) { diffs.push({ field: f, from: b[f], to: v }); b[f] = v; }
    }
    if (diffs.some(d => d.field === 'hpcna')) b.hpcnaStatus = b.hpcna ? 'provided' : b.hpcnaStatus;
    if (!diffs.length && !changes.reissueOnly) fail('nochange', 'Nothing has changed. Change a detail, or reissue without changes.');
    for (const d of diffs) b.corrections.push(Object.assign({ at: ctx.now, by: s.name, reason: clean(reason) }, d));
    cur.status = 'superseded'; cur.supersededAt = ctx.now; cur.supersededReason = clean(reason);
    const cert = issue(state, ctx, s, b, cur.number, cur.version + 1, clean(reason));
    audit(state, ctx, whoStaff(s), 'Certificate corrected and reissued', b.ref, `${fullName(b)} · ${cur.number} v${cert.version} · ${clean(reason)}${diffs.length ? ' · ' + diffs.map(d => `${d.field}: "${d.from}" → "${d.to}"`).join('; ') : ''}`);
    prepareMessage(state, ctx, null, b.id, 'certificate');
    return cert;
  }
  function certByToken(state, token) {
    if (!token || token.length < 16) return null;
    const cert = state.certificates.find(c => c.token === token);
    if (!cert) return null;
    return { cert, booking: state.bookings.find(b => b.id === cert.bookingId) };
  }

  // ---------- messages ----------
  function messageText(state, b, type, links) {
    const e = state.event, tz = e.timezone, t = times(e);
    const name = b.firstName;
    const when = `${fmtDate(t.eventStart, tz)}, ${e.programme[0].start}–${prog(e, 'dinner') ? prog(e, 'dinner').end : ''}`;
    const where = `${e.venue}, ${e.venueAddress}`;
    const sign = `\n\n${e.provider} CPD team\n` + contactsOf(e).map(c => [clean(c.phone), clean(c.email)].filter(Boolean).join(' · ')).join('\n');
    const L = links || {};
    switch (type) {
      case 'confirmation':
        return { subject: `Booking confirmed: ${e.topic} CPD, ${fmtDate(t.eventStart, tz)}`,
          body: `Dear ${name},\n\nYour place is confirmed for the CPD activity "${e.topic}".\n\nBooking reference: ${b.ref}\nDate: ${when}\nVenue: ${where}\nArrival and registration from ${e.programme[0].start}.\n\nGive your name at the registration desk. View or change your booking here:\n${L.manage || ''}\n\nTo receive your certificate, attend the full session and complete the evaluation. CPD points are subject to HPCNA approval of the activity.${sign}` };
      case 'waitlist':
        return { subject: `Waiting list: ${e.topic} CPD`,
          body: `Dear ${name},\n\nAll advance-booking places are taken, so you are on the waiting list (reference ${b.ref}). If a place becomes free we will send you an offer with a time limit to accept.\n\nManage your booking:\n${L.manage || ''}${sign}` };
      case 'offer':
        return { subject: `A place is available: ${e.topic} CPD — please respond`,
          body: `Dear ${name},\n\nA place is now available for "${e.topic}" on ${when}.\n\nPlease accept or decline by ${b.offer ? fmt(b.offer.expiresAt, tz) : ''} (Namibia time). After that the place goes to the next person.\n\nRespond here:\n${L.manage || ''}${sign}` };
      case 'reminder':
        return { subject: `Reminder: ${e.topic} CPD on ${fmtDate(t.eventStart, tz)}`,
          body: `Dear ${name},\n\nA reminder that "${e.topic}" takes place on ${when} at ${where}. Registration opens at ${e.programme[0].start}.\n\nYour reference: ${b.ref}. Can no longer attend? Please cancel so someone on the waiting list can take your place:\n${L.manage || ''}${sign}` };
      case 'feedback':
        return { subject: `Evaluation: ${e.topic} CPD`,
          body: `Dear ${name},\n\nThank you for attending. Please complete the short evaluation now:\n${L.feedback || ''}\n\nYour certificate is issued once you have attended the full session and completed the evaluation.${sign}` };
      case 'certificate':
        return { subject: `Your CPD certificate: ${e.topic}`,
          body: `Dear ${name},\n\nYour certificate of attendance for "${e.topic}" is ready. Download it from your private link:\n${L.certificate || ''}\n\nPlease keep this link private.${sign}` };
      default:
        return { subject: e.topic, body: '' };
    }
  }
  function prepareMessage(state, ctx, actor, id, type, links) {
    let who = WHO_SYSTEM;
    if (actor) {
      const s = need(state, actor, type === 'certificate' ? 'cert.resend' : 'message.prepare');
      who = whoStaff(s);
    }
    const b = findBooking(state, id);
    if (type === 'certificate' && !currentCert(state, b)) fail('state', 'No released certificate to send.');
    const channel = b.channel;
    const to = channel === 'email' ? b.email : (b.phoneIntl ? '+' + b.phoneIntl : '');
    state.counters.msg++;
    const m = { id: 'm' + state.counters.msg, bookingId: b.id, ref: b.ref, type, channel, to, createdAt: ctx.now,
      status: 'prepared', history: [{ status: 'prepared', at: ctx.now, by: who.name }] };
    state.messages.push(m);
    if (actor) audit(state, ctx, who, 'Message prepared', b.ref, `${type} · ${CHANNELS[channel]}`);
    // automatic emails: confirmation, waiting list and offer go out by email when sending is connected
    if (!actor && state.integration && state.integration.email && ['confirmation', 'waitlist', 'offer'].includes(type) && b.email) queueEmail(state, ctx, b, type, who.name);
    return m;
  }
  function queueEmail(state, ctx, b, type, by) {
    state.counters.msg++;
    const m = { id: 'm' + state.counters.msg, bookingId: b.id, ref: b.ref, type, channel: 'email', to: b.email, createdAt: ctx.now, auto: true,
      status: 'queued', history: [{ status: 'queued', at: ctx.now, by }] };
    state.messages.push(m);
    return m;
  }
  /* Staff: send a message (again) by automatic email. */
  function queueEmailResend(state, ctx, actor, msgId) {
    const s = need(state, actor, 'message.prepare');
    if (!(state.integration && state.integration.email)) fail('no_integration', 'Automatic email is not connected.');
    const m0 = state.messages.find(x => x.id === msgId);
    if (!m0) fail('not_found', 'Message not found.');
    const b = findBooking(state, m0.bookingId);
    if (!b.email) fail('no_email', 'This attendee has no email address. Add one in their details first.');
    if (m0.type === 'certificate' && !currentCert(state, b)) fail('state', 'No released certificate to send.');
    const m = queueEmail(state, ctx, b, m0.type, s.name);
    audit(state, ctx, whoStaff(s), 'Email queued', b.ref, `${m0.type} → ${b.email}`);
    return m;
  }
  /* Server: after "you already have a booking", send that booking's link to its own email (at most every 10 minutes). */
  function queueLinkResend(state, ctx, bookingId) {
    const b = state.bookings.find(x => x.id === bookingId);
    if (!b || !b.email || !(state.integration && state.integration.email)) return null;
    if (b.lastLinkResend && ctx.now - b.lastLinkResend < 10 * MIN) return null;
    b.lastLinkResend = ctx.now;
    return queueEmail(state, ctx, b, b.status === 'waitlisted' ? 'waitlist' : (b.status === 'offered' ? 'offer' : 'confirmation'), 'System (repeat booking attempt)');
  }
  /* Server: claim queued emails for sending (prevents two servers sending the same email). */
  function claimEmails(state, ctx, max) {
    const out = [];
    for (const m of state.messages) {
      if (out.length >= (max || 20)) break;
      if (m.channel !== 'email') continue;
      if (m.status === 'queued' || (m.status === 'sending' && ctx.now - (m.claimedAt || 0) > 2 * MIN)) { m.status = 'sending'; m.claimedAt = ctx.now; out.push(m.id); }
    }
    return out;
  }
  function markEmailResult(state, ctx, msgId, ok, error) {
    const m = state.messages.find(x => x.id === msgId);
    if (!m) return null;
    m.status = ok ? 'sent' : 'failed';
    if (!ok) m.error = String(error || 'unknown error').slice(0, 200);
    m.history.push({ status: m.status, at: ctx.now, by: 'Email (automatic)' + (ok ? '' : ': ' + m.error) });
    return m;
  }
  const MSG_STATUS = { prepared: 'Prepared', 'manually-shared': 'Manually shared', queued: 'Email waiting to send', sending: 'Email sending', sent: 'Sent', failed: 'Email not sent', delivered: 'Delivery confirmed' };
  function setMessageStatus(state, ctx, actor, msgId, status) {
    const s = need(state, actor, 'message.status');
    const m = state.messages.find(x => x.id === msgId);
    if (!m) fail('not_found', 'Message not found.');
    if (!MSG_STATUS[status] || ['queued', 'sending', 'failed'].includes(status)) fail('invalid', 'Unknown status.');
    if ((status === 'sent' || status === 'delivered') && !state.integration.live)
      fail('no_integration', 'Live sending is not connected in this prototype, so "Sent" and "Delivery confirmed" cannot be recorded. Use "Manually shared" after you send it yourself.');
    m.status = status;
    m.history.push({ status, at: ctx.now, by: s.name });
    audit(state, ctx, whoStaff(s), 'Message status changed', m.ref, `${m.type} → ${MSG_STATUS[status]}`);
    return m;
  }

  // ---------- settings & staff ----------
  const EVENT_FIELDS = ['title', 'topic', 'subtitle', 'date', 'venue', 'venueAddress', 'venueShort', 'presenter', 'presenterTitle', 'presenterSpecialty', 'audience', 'fee',
    'provider', 'providerNumber', 'organiser', 'phone', 'emails', 'contacts', 'publicCap', 'contingencyCap', 'maxCap', 'rsvpClose', 'offerHours',
    'eventDayOfferHours', 'minOfferMinutes', 'feedbackOpensTime', 'feedbackCloseDays', 'refPrefix', 'publicWording', 'about', 'programme', 'objectives'];
  function updateEvent(state, ctx, actor, changes) {
    const s = need(state, actor, 'settings.edit');
    const next = Object.assign({}, state.event);
    const diffs = [];
    for (const k of EVENT_FIELDS) if (changes[k] !== undefined && JSON.stringify(changes[k]) !== JSON.stringify(state.event[k])) { next[k] = changes[k]; diffs.push(k); }
    if (!diffs.length) return state.event;
    for (const k of ['publicCap', 'contingencyCap', 'maxCap', 'offerHours', 'eventDayOfferHours', 'minOfferMinutes', 'feedbackCloseDays']) {
      next[k] = Number(next[k]);
      if (!Number.isFinite(next[k]) || next[k] < 0) fail('invalid', `${k} must be a number of zero or more.`);
    }
    if (next.publicCap + next.contingencyCap < next.maxCap) fail('invalid', 'Public plus contingency places must cover the maximum attendance.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next.date)) fail('invalid', 'Date must be YYYY-MM-DD.');
    if (isNaN(Date.parse(next.rsvpClose))) fail('invalid', 'RSVP closing time is not valid.');
    if (!/^[A-Z0-9]{2,8}$/.test(next.refPrefix)) fail('invalid', 'Reference prefix: 2–8 capital letters or numbers.');
    if (!Array.isArray(next.contacts) || !next.contacts.some(c => c && (clean(c.phone) || clean(c.email)))) fail('invalid', 'Enter at least one contact phone number or email.');
    next.contacts = next.contacts.map(c => ({ phone: clean(c && c.phone), email: clean(c && c.email) })).filter(c => c.phone || c.email);
    for (const c of next.contacts) if (c.email && !emailOk(c.email)) fail('invalid', `Contact email "${c.email}" is not valid.`);
    for (const p of next.programme) if (!/^\d{2}:\d{2}$/.test(p.start) || !/^\d{2}:\d{2}$/.test(p.end)) fail('invalid', 'Programme times must be HH:MM.');
    const prev = state.event;
    state.event = next;
    try { checkInvariants(state); } catch (e) { state.event = prev; fail('overbook', 'The new capacity is lower than the places already held. Nothing was saved.'); }
    audit(state, ctx, whoStaff(s), 'Event settings changed', '', diffs.join(', '));
    return state.event;
  }
  function updateApproval(state, ctx, actor, a) {
    const s = need(state, actor, 'approval.edit');
    if (state.certificates.some(c => c.status === 'current')) fail('certs_issued', 'Certificates have already been released with the current approval details. Changing them requires reissuing those certificates.');
    const next = { activityNumber: clean(a.activityNumber), ceus: clean(a.ceus), level: clean(a.level), enteredBy: s.name, enteredAt: ctx.now };
    state.event.approval = next;
    audit(state, ctx, whoStaff(s), 'Approval details updated', '', `Activity: ${next.activityNumber || '—'} · CEUs: ${next.ceus || '—'} · Level: ${next.level || '—'}`);
    return next;
  }
  function updateSignatory(state, ctx, actor, sig) {
    const s = need(state, actor, 'settings.edit');
    state.event.signatory = { name: clean(sig.name), title: clean(sig.title), image: sig.image === undefined ? state.event.signatory.image : sig.image };
    audit(state, ctx, whoStaff(s), 'Certificate signatory updated', '', `${state.event.signatory.name || '—'}${state.event.signatory.image ? ' · signature image supplied' : ''}`);
  }
  function addStaff(state, ctx, actor, data) {
    const bootstrap = !state.staff.some(x => x.role === 'admin' && x.active);
    const s = bootstrap ? null : need(state, actor, 'staff.manage');
    if (bootstrap && data.role !== 'admin') fail('invalid', 'The first account must be an administrator.');
    const name = clean(data.name);
    if (name.length < 2) fail('invalid', 'Enter the staff member’s name.');
    if (!ROLES[data.role]) fail('invalid', 'Choose a role.');
    const email = clean(data.email).toLowerCase();
    if (data.email != null) {
      // shared-database version: staff sign in with email and password
      if (!emailOk(email)) fail('invalid', 'Enter the staff member’s email address.');
      if (state.staff.some(x => (x.email || '') === email)) fail('invalid', 'A staff member with this email already exists.');
    } else if (!/^[0-9a-f]{64}$/.test(data.pinHash || '')) fail('invalid', 'Set a PIN of at least 4 digits.');
    const rec = { id: 's' + (state.staff.length + 1) + randStr(ctx, 4, ALPHA), name, role: data.role, active: true, createdAt: ctx.now };
    if (data.email != null) rec.email = email; else rec.pinHash = data.pinHash;
    state.staff.push(rec);
    audit(state, ctx, s ? whoStaff(s) : { kind: 'system', name: 'First-time setup' }, 'Staff account added', '', `${name} · ${ROLES[data.role]}${rec.email ? ' · ' + rec.email : ''}`);
    return rec;
  }
  function setLogo(state, ctx, actor, dataUrl) {
    const s = need(state, actor, 'settings.edit');
    if (dataUrl == null) { delete state.event.logo; audit(state, ctx, whoStaff(s), 'Logo reset to supplied logo', '', ''); return null; }
    if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(dataUrl) || dataUrl.length > 900000) fail('invalid', 'Use a PNG or JPEG image under 600 KB.');
    state.event.logo = dataUrl;
    audit(state, ctx, whoStaff(s), 'Logo replaced', '', '');
    return null;
  }
  function setPresenterPhoto(state, ctx, actor, value) {
    const s = need(state, actor, 'settings.edit');
    if (value != null && value !== 'none' && (typeof value !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(value) || value.length > 900000)) fail('invalid', 'Use a PNG or JPEG image under 600 KB.');
    state.event.presenterPhoto = value == null ? null : value;
    audit(state, ctx, whoStaff(s), value == null ? 'Presenter photo reset to supplied photo' : (value === 'none' ? 'Presenter photo removed' : 'Presenter photo replaced'), '', '');
    return null;
  }
  function setStaffActive(state, ctx, actor, staffId, active) {
    const s = need(state, actor, 'staff.manage');
    const t = state.staff.find(x => x.id === staffId);
    if (!t) fail('not_found', 'Staff member not found.');
    if (!active && t.role === 'admin' && state.staff.filter(x => x.role === 'admin' && x.active).length <= 1) fail('last_admin', 'Keep at least one active administrator.');
    t.active = !!active;
    if (!active) for (const k of Object.keys(state.sessions)) if (state.sessions[k].staffId === t.id) delete state.sessions[k];
    audit(state, ctx, whoStaff(s), active ? 'Staff account reactivated' : 'Staff account deactivated', '', t.name);
  }
  function resetPin(state, ctx, actor, staffId, pinHash) {
    const s = need(state, actor, 'staff.manage');
    const t = state.staff.find(x => x.id === staffId);
    if (!t) fail('not_found', 'Staff member not found.');
    if (!/^[0-9a-f]{64}$/.test(pinHash || '')) fail('invalid', 'Set a PIN of at least 4 digits.');
    t.pinHash = pinHash; t.failed = 0; t.lockUntil = null;
    audit(state, ctx, whoStaff(s), 'Staff PIN reset', '', t.name);
  }

  // ---------- dashboard ----------
  function stats(state) {
    const c = capacity(state);
    const active = state.bookings.filter(b => b.status === 'confirmed');
    const certs = { released: 0, ready: 0, blocked: 0 };
    for (const b of active) certs[certStatus(state, b).key === 'released' ? 'released' : certStatus(state, b).key]++;
    const exceptions = state.bookings.reduce((n, b) => n + b.exceptions.filter(x => !x.resolved).length, 0)
      + state.bookings.filter(b => LIVE_STATUSES.includes(b.status) && ((b.flags.duplicate && !b.flags.duplicate.resolved) || (b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved))).length;
    return Object.assign(c, {
      booked: active.length,
      arrived: active.filter(b => b.arrival).length,
      completed: active.filter(completed).length,
      earlyPending: active.filter(b => b.completion && b.completion.status === 'early-pending').length,
      feedback: active.filter(b => b.feedback).length,
      certs, exceptions,
      released: state.bookings.filter(b => b.status === 'released').length,
      noShows: active.filter(b => !b.arrival).length
    });
  }

  // ---------- deterministic PRNG (demo seeding / tests) ----------
  function prng(seed) {
    let a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  const api = {
    SCHEMA, RuleError, PROFESSIONS, CHANNELS, ROLES, PERMS, SURVEY, STATUS_LABEL, MSG_STATUS,
    defaultEvent, contactsOf, contactText, createState, times, localDate, fmt, fmtTime, fmtDate, isEventDay, normPhone,
    login, logout, staffFor, can, need, capacity, checkInvariants, waitlist, publicSummary,
    validateAttendee, findDuplicates, createBooking, updateDetails, cancelBooking, isLocked,
    offerWindow, makeOffer, respondToOffer, processExpiries, confirmLate, allocateContingencyFor, releaseUnused, reinstate,
    parseQr, qrPayload, recordArrival, undoArrival, confirmCompletion, recordEarlyDeparture, reviewEarlyDeparture, undoCompletion, completed,
    flagException, resolveException, resolveDuplicate, resolveHpcna, markDetailsChecked,
    validateFeedback, submitFeedback, recordPaperFeedback, addPaperResponse, feedbackSummary,
    approvalComplete, blockers, certStatus, currentCert, releaseCertificate, releaseAllReady, correctCertificate, certByToken,
    messageText, prepareMessage, setMessageStatus, queueEmailResend, queueLinkResend, claimEmails, markEmailResult,
    updateEvent, updateApproval, updateSignatory, addStaff, setStaffActive, resetPin, setLogo, setPresenterPhoto,
    stats, bookingByToken, findBooking, fullName, prng, HOUR, MIN, DAY
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CPD = api;
})(typeof window !== 'undefined' ? window : globalThis);
