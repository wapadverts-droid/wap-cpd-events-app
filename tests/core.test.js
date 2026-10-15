const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const CPD = require('../src/core.js');
const { seed, PIN } = require('../src/seed.js');
const { createStore } = require('../src/store.js');

const at = (d, hm) => Date.parse(`${d}T${hm}:00+02:00`);
const hash = p => crypto.createHash('sha256').update('wapcpd:' + p).digest('hex');
let n = 0;
function person(extra) {
  n++;
  return Object.assign({ firstName: 'Test' + n, lastName: 'Person' + n, profession: 'Pharmacist', hpcnaStatus: 'provided', hpcna: 'T-' + n,
    phone: '081 400 ' + String(1000 + n).slice(-4), email: `t${n}@example.com`, channel: 'whatsapp', consentEvent: true }, extra || {});
}
function fresh() {
  const state = CPD.createState('demo');
  const ctx = { now: at('2026-10-01', '09:00'), rand: CPD.prng(5) };
  CPD.addStaff(state, ctx, null, { name: 'Admin', role: 'admin', pinHash: hash('1111') });
  const admin = { session: CPD.login(state, ctx, state.staff[0].id, hash('1111')) };
  CPD.addStaff(state, ctx, admin, { name: 'PA', role: 'pa', pinHash: hash('2222') });
  const pa = { session: CPD.login(state, ctx, state.staff[1].id, hash('2222')) };
  return { state, ctx, admin, pa };
}
const throwsCode = (fn, code) => assert.throws(fn, e => { assert.equal(e.code, code, e.message); return true; });
function fill(s, k) { for (let i = 0; i < k; i++) CPD.createBooking(s.state, s.ctx, null, person(), {}); }

test('capacity: 50 public places, then waiting list; never above 60', () => {
  const s = fresh();
  fill(s, 50);
  assert.equal(CPD.capacity(s.state).publicUsed, 50);
  const w = CPD.createBooking(s.state, s.ctx, null, person(), {});
  assert.equal(w.status, 'waitlisted');
  for (let i = 0; i < 10; i++) CPD.createBooking(s.state, s.ctx, s.admin, person(), { channel: 'staff', pool: 'contingency', reason: 'Invited guest ' + i });
  throwsCode(() => CPD.createBooking(s.state, s.ctx, s.admin, person(), { channel: 'staff', pool: 'contingency', reason: 'One too many' }), 'contingency_full');
  const c = CPD.capacity(s.state);
  assert.equal(c.total, 60); assert.equal(c.contingencyUsed, 10);
});

test('contingency needs administrator and a reason', () => {
  const s = fresh();
  throwsCode(() => CPD.createBooking(s.state, s.ctx, s.pa, person(), { channel: 'staff', pool: 'contingency', reason: 'Friend of presenter' }), 'perm');
  throwsCode(() => CPD.createBooking(s.state, s.ctx, s.admin, person(), { channel: 'staff', pool: 'contingency', reason: '' }), 'reason');
  const b = CPD.createBooking(s.state, s.ctx, s.admin, person(), { channel: 'staff', pool: 'contingency', reason: 'Invited district officer' });
  assert.equal(b.pool, 'contingency'); assert.equal(b.contingencyReason, 'Invited district officer');
});

test('RSVP deadline: public closes 23 Oct 12:00 Namibia time; staff can still register', () => {
  const s = fresh();
  s.ctx.now = at('2026-10-23', '11:59');
  CPD.createBooking(s.state, s.ctx, null, person(), {});
  s.ctx.now = at('2026-10-23', '12:00');
  throwsCode(() => CPD.createBooking(s.state, s.ctx, null, person(), {}), 'rsvp_closed');
  assert.equal(CPD.publicSummary(s.state, s.ctx.now).status, 'closed');
  const b = CPD.createBooking(s.state, s.ctx, s.pa, person(), { channel: 'staff', source: 'staff-walkin' });
  assert.equal(b.status, 'confirmed');
  // 10:00 UTC is 12:00 in Windhoek
  assert.equal(CPD.times(s.state.event).rsvpClose, Date.parse('2026-10-23T10:00:00Z'));
});

test('waiting list: offers in order, 24h normally, 2h on event day, never past event start', () => {
  const s = fresh();
  fill(s, 50);
  const w1 = CPD.createBooking(s.state, s.ctx, null, person(), {});
  const w2 = CPD.createBooking(s.state, s.ctx, null, person(), {});
  throwsCode(() => CPD.makeOffer(s.state, s.ctx, s.pa), 'no_place');
  CPD.cancelBooking(s.state, s.ctx, s.pa, s.state.bookings[0].id, {});
  // out-of-order offer: PA cannot, admin needs reason
  throwsCode(() => CPD.makeOffer(s.state, s.ctx, s.pa, w2.id), 'perm');
  throwsCode(() => CPD.makeOffer(s.state, s.ctx, s.admin, w2.id, {}), 'reason');
  s.ctx.now = at('2026-10-20', '10:00');
  const o = CPD.makeOffer(s.state, s.ctx, s.pa);
  assert.equal(o.id, w1.id);
  assert.equal(o.offer.expiresAt - s.ctx.now, 24 * CPD.HOUR);
  // pending offer holds the place
  assert.equal(CPD.capacity(s.state).publicFree, 0);
  const late = CPD.createBooking(s.state, s.ctx, null, person(), {});
  assert.equal(late.status, 'waitlisted');
  // expiry returns the place
  s.ctx.now = at('2026-10-21', '10:00');
  throwsCode(() => CPD.respondToOffer(s.state, s.ctx, null, null, true, { token: w1.token }), 'offer_expired');
  assert.equal(s.state.bookings.find(b => b.id === w1.id).status, 'expired');
  assert.equal(CPD.capacity(s.state).publicFree, 1);
  // offer made the day before is capped at event start
  s.ctx.now = at('2026-10-22', '20:00');
  const o2 = CPD.makeOffer(s.state, s.ctx, s.pa);
  assert.equal(o2.offer.expiresAt, at('2026-10-23', '18:00'));
  CPD.respondToOffer(s.state, s.ctx, null, null, false, { token: o2.token });
  // event day: 2 hours
  s.ctx.now = at('2026-10-23', '09:00');
  const o3 = CPD.makeOffer(s.state, s.ctx, s.pa);
  assert.equal(o3.offer.expiresAt - s.ctx.now, 2 * CPD.HOUR);
  CPD.respondToOffer(s.state, s.ctx, s.pa, o3.id, true);
  assert.equal(o3.status, 'confirmed');
});

test('late cases: no offers too close to start; desk confirms directly', () => {
  const s = fresh();
  fill(s, 50);
  const w = CPD.createBooking(s.state, s.ctx, null, person(), {});
  CPD.cancelBooking(s.state, s.ctx, s.pa, s.state.bookings[1].id, {});
  s.ctx.now = at('2026-10-23', '10:00');
  throwsCode(() => CPD.confirmLate(s.state, s.ctx, s.pa, w.id, ''), 'use_offer');
  s.ctx.now = at('2026-10-23', '17:40');
  throwsCode(() => CPD.makeOffer(s.state, s.ctx, s.pa), 'too_late');
  CPD.confirmLate(s.state, s.ctx, s.pa, w.id, 'At the desk');
  assert.equal(w.status, 'confirmed');
  assert.ok(CPD.capacity(s.state).publicUsed <= 50);
});

test('release unused bookings: admin only, only after 18:05', () => {
  const s = fresh();
  fill(s, 50);
  s.ctx.now = at('2026-10-23', '17:40');
  CPD.recordArrival(s.state, s.ctx, s.pa, s.state.bookings[0].id, 'qr');
  s.ctx.now = at('2026-10-23', '18:04');
  throwsCode(() => CPD.releaseUnused(s.state, s.ctx, s.admin), 'too_early');
  s.ctx.now = at('2026-10-23', '18:05');
  throwsCode(() => CPD.releaseUnused(s.state, s.ctx, s.pa), 'perm');
  const k = CPD.releaseUnused(s.state, s.ctx, s.admin, [s.state.bookings[1].id, s.state.bookings[2].id]);
  assert.equal(k, 2);
  assert.equal(CPD.capacity(s.state).publicFree, 2);
  CPD.reinstate(s.state, s.ctx, s.pa, s.state.bookings[1].id);
  assert.equal(CPD.capacity(s.state).publicFree, 1);
});

test('permissions enforced in the rules, not just the screen', () => {
  const s = fresh();
  const b = CPD.createBooking(s.state, s.ctx, null, person(), {});
  throwsCode(() => CPD.updateApproval(s.state, s.ctx, s.pa, { activityNumber: 'X', ceus: '1', level: '1' }), 'perm');
  throwsCode(() => CPD.updateEvent(s.state, s.ctx, s.pa, { publicCap: 80 }), 'perm');
  throwsCode(() => CPD.addStaff(s.state, s.ctx, s.pa, { name: 'Sneaky', role: 'admin', pinHash: hash('9999') }), 'perm');
  throwsCode(() => CPD.releaseCertificate(s.state, s.ctx, s.pa, b.id), 'perm');
  throwsCode(() => CPD.recordArrival(s.state, s.ctx, null, b.id, 'qr'), 'auth');
  // a forged actor claiming to be admin without a session is refused
  throwsCode(() => CPD.updateApproval(s.state, s.ctx, { role: 'admin', session: 'forged-session' }, {}), 'auth');
  // deactivated staff lose access immediately
  CPD.setStaffActive(s.state, s.ctx, s.admin, s.state.staff[1].id, false);
  throwsCode(() => CPD.createBooking(s.state, s.ctx, s.pa, person(), { channel: 'staff' }), 'auth');
  throwsCode(() => CPD.setStaffActive(s.state, s.ctx, s.admin, s.state.staff[0].id, false), 'last_admin');
});

test('login: wrong PIN refused, lockout after 5 tries', () => {
  const s = fresh();
  for (let i = 0; i < 5; i++) throwsCode(() => CPD.login(s.state, s.ctx, s.state.staff[1].id, hash('0000')), 'auth');
  throwsCode(() => CPD.login(s.state, s.ctx, s.state.staff[1].id, hash('2222')), 'locked');
  s.ctx.now += 6 * CPD.MIN;
  assert.ok(CPD.login(s.state, s.ctx, s.state.staff[1].id, hash('2222')));
});

test('attendee validation: at least one contact; channel must match; consent required; HPCNA can be flagged', () => {
  const v = CPD.validateAttendee(person({ phone: '', email: '' }));
  assert.ok(v.errors.contact);
  assert.ok(CPD.validateAttendee(person({ phone: '', channel: 'whatsapp' })).errors.channel);
  assert.ok(CPD.validateAttendee(person({ consentEvent: false })).errors.consentEvent);
  assert.ok(CPD.validateAttendee(person({ phone: '12345' })).errors.phone);
  assert.ok(CPD.validateAttendee(person({ hpcna: '' })).errors.hpcna);
  const ok = CPD.validateAttendee(person({ hpcna: '', hpcnaStatus: 'unavailable', email: '', channel: 'sms' }));
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(CPD.normPhone('081 234 5678').intl, '264812345678');
  assert.equal(CPD.normPhone('+264 81 234 5678').intl, '264812345678');
  const s = fresh();
  const b = CPD.createBooking(s.state, s.ctx, null, person({ hpcna: '', hpcnaStatus: 'not-applicable' }), {});
  assert.ok(b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved);
  assert.equal(b.consentMarketing, false);
});

test('duplicates flagged for review, not silently merged', () => {
  const s = fresh();
  const a = CPD.createBooking(s.state, s.ctx, null, person({ email: 'same@example.com' }), {});
  const b = CPD.createBooking(s.state, s.ctx, null, person({ email: 'SAME@example.com' }), {});
  assert.equal(a.flags.duplicate, null);
  assert.equal(b.flags.duplicate.matches[0].ref, a.ref);
  throwsCode(() => CPD.markDetailsChecked(s.state, s.ctx, s.pa, b.id), 'dup_open');
  throwsCode(() => CPD.resolveDuplicate(s.state, s.ctx, s.pa, b.id, 'cancel', 'dup'), 'perm');
  CPD.resolveDuplicate(s.state, s.ctx, s.admin, b.id, 'cancel', 'Same person booked twice');
  assert.equal(b.status, 'cancelled');
});

test('attendance: arrival does not equal completion; completion only from 19:30; early departures need admin', () => {
  const s = fresh();
  const b = CPD.createBooking(s.state, s.ctx, null, person(), {});
  const c = CPD.createBooking(s.state, s.ctx, null, person(), {});
  throwsCode(() => CPD.recordArrival(s.state, s.ctx, s.pa, b.id, 'qr'), 'not_event_time');
  s.ctx.now = at('2026-10-23', '17:35');
  CPD.recordArrival(s.state, s.ctx, s.pa, b.id, 'qr');
  CPD.recordArrival(s.state, s.ctx, s.pa, c.id, 'search');
  throwsCode(() => CPD.recordArrival(s.state, s.ctx, s.pa, b.id, 'qr'), 'already');
  assert.ok(CPD.blockers(s.state, b).some(x => x.code === 'no_completion'));
  s.ctx.now = at('2026-10-23', '19:00');
  throwsCode(() => CPD.confirmCompletion(s.state, s.ctx, s.pa, b.id, 'register'), 'too_early');
  CPD.recordEarlyDeparture(s.state, s.ctx, s.pa, c.id, null, 'Emergency call');
  assert.ok(CPD.blockers(s.state, c).some(x => x.code === 'early_pending'));
  throwsCode(() => CPD.reviewEarlyDeparture(s.state, s.ctx, s.pa, c.id, true, 'ok'), 'perm');
  s.ctx.now = at('2026-10-23', '19:30');
  CPD.confirmCompletion(s.state, s.ctx, s.pa, b.id, 'qr-checkout');
  assert.equal(b.completion.method, 'qr-checkout'); assert.equal(b.completion.by, 'PA');
  CPD.reviewEarlyDeparture(s.state, s.ctx, s.admin, c.id, false, 'Missed most of the session');
  assert.ok(CPD.blockers(s.state, c).some(x => x.code === 'early_rejected'));
  // paper backfill next day needs a time
  s.ctx.now = at('2026-10-24', '10:00');
  throwsCode(() => CPD.createBooking(s.state, s.ctx, s.pa, person(), { channel: 'staff', source: 'paper-form' }), 'closed');
  const e = CPD.createBooking(s.state, { now: at('2026-10-23', '17:30'), rand: s.ctx.rand }, s.pa, person(), { channel: 'staff', source: 'paper-form' });
  throwsCode(() => CPD.recordArrival(s.state, s.ctx, s.pa, e.id, 'paper-register'), 'needs_time');
  CPD.recordArrival(s.state, s.ctx, s.pa, e.id, 'paper-register', at('2026-10-23', '17:45'));
  CPD.confirmCompletion(s.state, s.ctx, s.pa, e.id, 'register', at('2026-10-23', '19:32'));
  assert.ok(CPD.completed(e));
});

test('QR payload identifies a booking and rejects tampering', () => {
  const s = fresh();
  const b = CPD.createBooking(s.state, s.ctx, null, person(), {});
  assert.equal(CPD.parseQr(s.state, CPD.qrPayload(b)).id, b.id);
  assert.equal(CPD.parseQr(s.state, CPD.qrPayload(b).slice(0, -1) + 'x'), null);
});

test('feedback: mandatory, once only, anonymous storage', () => {
  const s = fresh();
  const b = CPD.createBooking(s.state, s.ctx, null, person(), {});
  const ans = { ratings: { relevance: 5, quality: 4, usefulness: 4, overall: 5 }, choices: { understanding: 'Yes', apply: 'Partly', bias: 'Yes' }, improve: 'More cases', topics: ['Ethics'] };
  throwsCode(() => CPD.submitFeedback(s.state, s.ctx, b.token, ans), 'not_open');
  s.ctx.now = at('2026-10-23', '19:31');
  throwsCode(() => CPD.submitFeedback(s.state, s.ctx, b.token, { ratings: {} }), 'invalid');
  CPD.submitFeedback(s.state, s.ctx, b.token, ans);
  throwsCode(() => CPD.submitFeedback(s.state, s.ctx, b.token, ans), 'already');
  assert.equal(s.state.responses.length, 1);
  const r = JSON.stringify(s.state.responses[0]);
  assert.ok(!r.includes(b.id) && !r.includes(b.ref) && !r.includes(b.email), 'response must not identify attendee');
  throwsCode(() => CPD.feedbackSummary(s.state, s.pa), 'perm');
  assert.equal(CPD.feedbackSummary(s.state, s.admin).ratings.relevance.avg, 5);
});

test('certificate: all five conditions, admin release, sample before approval, controlled correction', () => {
  const s = fresh();
  const b = CPD.createBooking(s.state, s.ctx, null, person(), {});
  const codes = () => CPD.blockers(s.state, b).map(x => x.code);
  assert.deepEqual(codes().sort(), ['approval', 'details', 'no_arrival', 'no_completion', 'no_feedback'].sort());
  s.ctx.now = at('2026-10-23', '17:40'); CPD.recordArrival(s.state, s.ctx, s.pa, b.id, 'qr');
  s.ctx.now = at('2026-10-23', '19:31'); CPD.confirmCompletion(s.state, s.ctx, s.pa, b.id, 'register');
  CPD.markDetailsChecked(s.state, s.ctx, s.pa, b.id);
  assert.deepEqual(codes().sort(), ['approval', 'no_feedback']);
  CPD.recordPaperFeedback(s.state, s.ctx, s.pa, b.id, null);
  assert.deepEqual(codes(), ['approval']);
  throwsCode(() => CPD.releaseCertificate(s.state, s.ctx, s.admin, b.id), 'blocked');
  CPD.updateApproval(s.state, s.ctx, s.admin, { activityNumber: 'TEST-123', ceus: '2', level: '1' });
  assert.equal(CPD.certStatus(s.state, b).key, 'ready');
  throwsCode(() => CPD.releaseCertificate(s.state, s.ctx, s.pa, b.id), 'perm');
  const cert = CPD.releaseCertificate(s.state, s.ctx, s.admin, b.id);
  assert.match(cert.number, /^ORG01637-RHI26-0001$/);
  throwsCode(() => CPD.releaseCertificate(s.state, s.ctx, s.admin, b.id), 'already');
  // details locked after issuance
  throwsCode(() => CPD.updateDetails(s.state, s.ctx, s.pa, b.id, { firstName: 'X' }), 'cert_issued');
  throwsCode(() => CPD.updateApproval(s.state, s.ctx, s.admin, { activityNumber: 'Y', ceus: '3', level: '1' }), 'certs_issued');
  const v2 = CPD.correctCertificate(s.state, s.ctx, s.admin, b.id, { firstName: 'Corrected' }, 'Spelling fixed per attendee');
  assert.equal(v2.version, 2); assert.equal(v2.number, cert.number);
  assert.equal(s.state.certificates.find(c => c.id === cert.id).status, 'superseded');
  assert.equal(CPD.certByToken(s.state, cert.token).cert.status, 'superseded');
  assert.equal(b.corrections.at(-1).to, 'Corrected');
});

test('messages: prepared and manually shared only; no fake sending', () => {
  const s = fresh();
  const b = CPD.createBooking(s.state, s.ctx, null, person(), {});
  const m = s.state.messages.find(x => x.bookingId === b.id);
  assert.equal(m.status, 'prepared');
  throwsCode(() => CPD.setMessageStatus(s.state, s.ctx, s.pa, m.id, 'sent'), 'no_integration');
  throwsCode(() => CPD.setMessageStatus(s.state, s.ctx, s.pa, m.id, 'delivered'), 'no_integration');
  CPD.setMessageStatus(s.state, s.ctx, s.pa, m.id, 'manually-shared');
  assert.equal(m.status, 'manually-shared');
});

test('attendee can correct own details before issuance; cancellation frees place', () => {
  const s = fresh();
  const b = CPD.createBooking(s.state, s.ctx, null, person(), {});
  CPD.updateDetails(s.state, s.ctx, null, null, { lastName: 'Fixed' }, { token: b.token });
  assert.equal(b.lastName, 'Fixed');
  throwsCode(() => CPD.updateDetails(s.state, s.ctx, null, null, { lastName: 'X' }, { token: 'wrong-token-1234567890' }), 'not_found');
  CPD.cancelBooking(s.state, s.ctx, null, null, { token: b.token });
  assert.equal(CPD.capacity(s.state).publicUsed, 0);
});

test('settings cannot shrink capacity below places already held', () => {
  const s = fresh();
  fill(s, 30);
  throwsCode(() => CPD.updateEvent(s.state, s.ctx, s.admin, { publicCap: 20, maxCap: 30 }), 'overbook');
  assert.equal(s.state.event.publicCap, 50);
  CPD.updateEvent(s.state, s.ctx, s.admin, { venue: 'New venue' });
  assert.equal(s.state.event.venue, 'New venue');
});

test('audit history records important staff actions', () => {
  const s = fresh();
  const b = CPD.createBooking(s.state, s.ctx, s.admin, person(), { channel: 'staff', pool: 'contingency', reason: 'Invited guest' });
  const e = s.state.audit.find(a => a.ref === b.ref);
  assert.equal(e.who.name, 'Admin'); assert.match(e.detail, /Invited guest/);
});

test('demo scenarios build through the real rules and stay within capacity', () => {
  for (const sc of ['booking', 'event']) {
    const st = seed(sc);
    CPD.checkInvariants(st);
    const c = CPD.capacity(st);
    assert.ok(c.total <= 60);
    assert.ok(st.bookings.every(b => /^Demo-/.test(b.lastName)), 'demo names are marked');
    if (sc === 'event') {
      const stt = CPD.stats(st);
      assert.ok(stt.arrived > 40 && stt.completed > 30 && stt.feedback > 20, JSON.stringify(stt));
      assert.equal(stt.certs.ready, 0); // approval details missing -> everything blocked
      assert.ok(st.bookings.some(b => b.source === 'paper-form') && st.bookings.some(b => b.source === 'staff-walkin'));
      assert.ok(st.bookings.some(b => b.completion && b.completion.status === 'early-pending'));
      assert.ok(st.bookings.some(b => b.status === 'expired') && st.bookings.some(b => b.status === 'declined'));
    }
  }
});

test('simultaneous registrations never overbook (70 clients race for 50 places)', async () => {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  const rand = CPD.prng(99);
  const store = createStore({ storage, key: 'race', maxAttempts: 400, _testDelay: () => new Promise(r => setTimeout(r, Math.floor(rand() * 5))) });
  store.write(CPD.createState('demo'));
  const ctx = { now: at('2026-10-05', '10:00'), rand: CPD.prng(1) };
  const jobs = [];
  for (let i = 0; i < 70; i++) jobs.push(store.transact(st => CPD.createBooking(st, ctx, null, person(), {}).status));
  const results = await Promise.all(jobs.map(j => j.then(r => r.result)));
  const final = store.read();
  const c = CPD.capacity(final);
  assert.equal(final.bookings.length, 70, 'no lost writes');
  assert.equal(c.publicUsed, 50);
  assert.equal(results.filter(r => r === 'confirmed').length, 50);
  assert.equal(results.filter(r => r === 'waitlisted').length, 20);
});

test('persistence: data survives reload; failed rule saves nothing', async () => {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  const store = createStore({ storage, key: 'p' });
  store.write(seed('event'));
  const before = store.read().rev;
  const ctx = { now: at('2026-10-23', '19:40'), rand: Math.random };
  await assert.rejects(store.transact(st => CPD.createBooking(st, ctx, null, person(), {})), e => e.code === 'rsvp_closed');
  assert.equal(store.read().rev, before);
  const store2 = createStore({ storage, key: 'p' }); // "reload"
  assert.equal(store2.read().bookings.length, store.read().bookings.length);
  // demo and live keys are separate
  const live = createStore({ storage, key: 'live' });
  assert.equal(live.read(), null);
});
