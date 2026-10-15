/* Fictional demo data. Every record is created through the real rules engine
 * with a simulated clock, so the demo states are ones the rules actually allow.
 * All names, numbers and emails are invented (example.com, DEMO- numbers). */
(function (root) {
  'use strict';
  const CPD = root.CPD || (typeof require !== 'undefined' ? require('./core.js') : null);
  const PIN = {
    admin: 'b8f6b52e8ebb1331f2b1fe8217f3a19fed55f35ac586217fc244dce1ff83edca', // 1111
    pa: '4f86d67ee8805b5300c9e5937b042a180d7daadc4ed80fc4aec0c1300cf56b85'     // 2222
  };
  const FIRST = ['Ndapewa', 'Tuyeni', 'Johannes', 'Selma', 'Petrus', 'Hilma', 'Aina', 'Kaarina', 'Elago', 'Ndeshi', 'Simon', 'Martha', 'Festus',
    'Loide', 'Paulus', 'Rauha', 'Tomas', 'Ester', 'Gideon', 'Ruusa', 'Kleopas', 'Saara', 'Immanuel', 'Lahja', 'Jonas', 'Hileni', 'Abner', 'Ottilie',
    'Silas', 'Victoria', 'Erastus', 'Naemi', 'David', 'Taimi', 'Matheus', 'Frieda', 'Benson', 'Monika', 'Eliaser', 'Penda'];
  const LAST = ['Demo-Shikongo', 'Demo-Amutenya', 'Demo-Haufiku', 'Demo-Iipumbu', 'Demo-Nangolo', 'Demo-Shilongo', 'Demo-Kapia', 'Demo-Mwandingi',
    'Demo-Ekandjo', 'Demo-Nghifitikeko', 'Demo-Hamutenya', 'Demo-Shipanga', 'Demo-Amadhila', 'Demo-Nashilundo', 'Demo-Kambonde', 'Demo-Uugwanga',
    'Demo-Kalenga', 'Demo-Shaanika', 'Demo-Nekwaya', 'Demo-Angula'];
  const PROF = ['Pharmacist', 'Pharmacist', 'Registered nurse', 'Registered nurse', 'Medical doctor', 'Medical doctor', "Pharmacist's assistant",
    'Enrolled nurse', 'Allied health professional'];
  const PCODE = { 'Pharmacist': 'PS', 'Registered nurse': 'NR', 'Medical doctor': 'MP', "Pharmacist's assistant": 'PA', 'Enrolled nurse': 'NE', 'Allied health professional': 'AH', 'Other': 'OT' };

  function at(date, hm) { return Date.parse(`${date}T${hm}:00+02:00`); }

  function makePeople(rand, n) {
    const used = new Set(), out = [];
    let i = 0;
    while (out.length < n) {
      const f = FIRST[Math.floor(rand() * FIRST.length)], l = LAST[Math.floor(rand() * LAST.length)];
      if (used.has(f + l)) continue;
      used.add(f + l); i++;
      const prof = PROF[Math.floor(rand() * PROF.length)];
      const ch = rand() < 0.65 ? 'whatsapp' : 'email';
      const hasEmail = ch === 'email' || rand() < 0.7;
      out.push({
        firstName: f, lastName: l, profession: prof, hpcnaStatus: 'provided',
        hpcna: `DEMO-${PCODE[prof]}-${String(1000 + i * 37).slice(-4)}`,
        phone: `081 555 ${String(1000 + i * 13).slice(-4)}`,
        email: hasEmail ? `${f.toLowerCase()}.${l.toLowerCase().replace('demo-', '')}@example.com` : '',
        channel: ch, consentEvent: true, consentMarketing: rand() < 0.4
      });
    }
    return out;
  }
  function answers(rand) {
    const r = () => [3, 4, 4, 5, 5, 5][Math.floor(rand() * 6)];
    const pick = a => a[Math.floor(rand() * a.length)];
    const improve = ['More time for questions.', 'Please share the slides afterwards.', 'More case examples from primary care.', '', '', 'The venue was a little warm.', ''];
    return {
      ratings: { relevance: r(), quality: r(), usefulness: r(), overall: r() },
      choices: { understanding: rand() < 0.93 ? 'Yes' : 'No', apply: pick(['Yes', 'Yes', 'Yes', 'Partly']), bias: rand() < 0.95 ? 'Yes' : 'No' },
      improve: pick(improve), topics: CPD.SURVEY.topics.filter(() => rand() < 0.4), topicOther: rand() < 0.15 ? 'Paediatric ENT emergencies' : ''
    };
  }

  function baseState(mode) {
    const s = CPD.createState(mode || 'demo');
    return s;
  }

  function seed(scenario) {
    const rand = CPD.prng(scenario === 'booking' ? 11 : 23);
    const state = baseState('demo');
    const ctx = { now: at('2026-09-30', '09:00'), rand };
    state.createdAt = ctx.now;
    CPD.addStaff(state, ctx, null, { name: 'Demo Administrator', role: 'admin', pinHash: PIN.admin });
    const adminS = { session: CPD.login(state, ctx, state.staff[0].id, PIN.admin) };
    CPD.addStaff(state, ctx, adminS, { name: 'Demo Reception (PA)', role: 'pa', pinHash: PIN.pa });
    const paS = { session: CPD.login(state, ctx, state.staff[1].id, PIN.pa) };
    const people = makePeople(rand, 62);
    let p = 0;
    const book = (when, extra, opts) => { ctx.now = when; return CPD.createBooking(state, ctx, opts && opts.channel === 'staff' ? (opts.actor || paS) : null, Object.assign({}, people[p++], extra || {}), opts); };
    const tok = b => b.token;

    if (scenario === 'booking') {
      // Booking phase: 12 October. 48 public places held, 2 left.
      for (let i = 0; i < 49; i++) {
        const day = 1 + Math.floor(i / 5);
        const when = at(`2026-10-${String(day).padStart(2, '0')}`, `${String(8 + (i % 5) * 2).padStart(2, '0')}:15`);
        let extra = {};
        if (i === 9) extra = { hpcnaStatus: 'unavailable', hpcna: '' };
        if (i === 30) extra = { email: people.slice(0, 20).find(x => x.email).email, channel: 'email', phone: '' }; // same email as an earlier booking
        book(when, extra);
      }
      ctx.now = at('2026-10-10', '14:00');
      CPD.cancelBooking(state, ctx, null, null, { token: tok(state.bookings[20]), reason: 'Clinic duty clash' });
      ctx.now = at('2026-10-11', '10:30');
      book(ctx.now, { profession: 'Medical doctor' }, { channel: 'staff', pool: 'contingency', reason: 'Invited district medical officer, approved by organiser', actor: adminS, source: 'staff-phone' });
      ctx.now = at('2026-10-12', '10:00');
      state.clock = { simulated: true, at: ctx.now, setAt: null };
      state.scenario = 'booking';
    } else {
      // Event night: Friday 23 October, 19:40.
      for (let i = 0; i < 50; i++) {
        const day = 1 + Math.floor(i / 3);
        const when = at(`2026-10-${String(day).padStart(2, '0')}`, `${String(7 + (i % 3) * 4).padStart(2, '0')}:20`);
        let extra = {};
        if (i === 12) extra = { hpcnaStatus: 'unavailable', hpcna: '' };
        if (i === 27) extra = { phone: people[5].phone };
        book(when, extra);
      }
      const W = [];
      for (let i = 0; i < 4; i++) W.push(book(at('2026-10-18', `1${i}:00`)));
      const B = state.bookings;
      // Cancellation -> offer W1 (lets it expire) -> offer W2 (accepts)
      ctx.now = at('2026-10-20', '09:00'); CPD.cancelBooking(state, ctx, null, null, { token: tok(B[7]), reason: 'Travelling' });
      ctx.now = at('2026-10-20', '10:00'); CPD.makeOffer(state, ctx, paS);
      ctx.now = at('2026-10-21', '11:00'); CPD.processExpiries(state, ctx); CPD.makeOffer(state, ctx, paS);
      ctx.now = at('2026-10-21', '15:10'); CPD.respondToOffer(state, ctx, null, null, true, { token: tok(W[1]) });
      // Second cancellation -> W3 declines -> W4 lets it expire on event day
      ctx.now = at('2026-10-22', '08:30'); CPD.cancelBooking(state, ctx, paS, B[15].id, { reason: 'Phoned to cancel' });
      ctx.now = at('2026-10-22', '09:00'); CPD.makeOffer(state, ctx, paS);
      ctx.now = at('2026-10-22', '11:40'); CPD.respondToOffer(state, ctx, paS, W[2].id, false);
      ctx.now = at('2026-10-22', '12:00'); CPD.makeOffer(state, ctx, paS);
      ctx.now = at('2026-10-22', '15:00');
      book(ctx.now, { profession: 'Pharmacist' }, { channel: 'staff', pool: 'contingency', reason: 'Regional pharmacist invited by organiser', actor: adminS, source: 'staff-phone' });
      // Event day
      ctx.now = at('2026-10-23', '09:00'); CPD.cancelBooking(state, ctx, null, null, { token: tok(B[33]), reason: 'Unwell' });
      ctx.now = at('2026-10-23', '12:05'); CPD.processExpiries(state, ctx);
      const paper = book(at('2026-10-23', '17:40'), { channel: 'sms', email: '' }, { channel: 'staff', source: 'paper-form' });
      const walk = book(at('2026-10-23', '17:45'), {}, { channel: 'staff', source: 'staff-walkin' });
      ctx.now = at('2026-10-23', '17:50');
      CPD.allocateContingencyFor(state, ctx, adminS, W[0].id, 'Arrived in person after offer expired; contingency approved');
      const attendees = state.bookings.filter(b => b.status === 'confirmed');
      const noShow = new Set([attendees[3].id, attendees[18].id, attendees[29].id, attendees[44].id]);
      let m = 0;
      for (const b of attendees) {
        if (noShow.has(b.id)) continue;
        let t = at('2026-10-23', '17:32') + (m++ % 40) * 60000;
        if (b === paper) t = at('2026-10-23', '17:41');
        if (b === walk) t = at('2026-10-23', '17:46');
        if (b === W[0]) t = at('2026-10-23', '17:51');
        ctx.now = t + 30000;
        CPD.recordArrival(state, ctx, m % 2 ? paS : adminS, b.id, m % 4 === 0 ? 'qr' : (b === paper ? 'paper-register' : 'search'));
      }
      // Two walk-ins after the event is full: they join the waiting list at the desk
      book(at('2026-10-23', '18:20'), {}, { channel: 'staff', source: 'staff-walkin' });
      book(at('2026-10-23', '18:24'), { email: '', channel: 'sms' }, { channel: 'staff', source: 'staff-walkin' });
      const arrived = state.bookings.filter(b => b.arrival);
      // Early departures
      const e1 = arrived[6], e2 = arrived[17];
      ctx.now = at('2026-10-23', '18:52'); CPD.recordEarlyDeparture(state, ctx, paS, e1.id, at('2026-10-23', '18:50'), 'Called back to the hospital');
      ctx.now = at('2026-10-23', '19:02'); CPD.recordEarlyDeparture(state, ctx, paS, e2.id, at('2026-10-23', '19:00'), 'Left during Q&A, family emergency');
      ctx.now = at('2026-10-23', '19:12'); CPD.reviewEarlyDeparture(state, ctx, adminS, e2.id, true, 'Attended the full presentation; organiser accepts');
      // Completion at end of Q&A
      const notYet = new Set([arrived[10].id, arrived[25].id, arrived[39].id]);
      let k = 0;
      for (const b of arrived) {
        if (b === e1 || b === e2 || notYet.has(b.id)) continue;
        ctx.now = at('2026-10-23', '19:30') + (k % 8) * 60000 + 20000;
        CPD.confirmCompletion(state, ctx, k % 2 ? paS : adminS, b.id, k % 5 === 0 ? 'qr-checkout' : 'register');
        k++;
      }
      // Feedback
      const done = state.bookings.filter(b => CPD.completed(b));
      let f = 0;
      for (const b of done) {
        f++;
        if (f % 9 === 0) continue; // no feedback yet
        ctx.now = at('2026-10-23', '19:31') + (f % 9) * 60000;
        if (f % 7 === 0) CPD.recordPaperFeedback(state, ctx, paS, b.id, answers(rand));
        else if (f % 11 === 0) CPD.recordPaperFeedback(state, ctx, paS, b.id, null);
        else CPD.submitFeedback(state, ctx, b.token, answers(rand));
      }
      // Details checks
      ctx.now = at('2026-10-23', '19:39');
      let d = 0;
      for (const b of state.bookings.filter(x => x.status === 'confirmed')) {
        d++;
        if (d % 13 === 0) continue;
        if ((b.flags.duplicate && !b.flags.duplicate.resolved) || (b.flags.hpcnaReview && !b.flags.hpcnaReview.resolved)) continue;
        CPD.markDetailsChecked(state, ctx, paS, b.id);
      }
      CPD.flagException(state, ctx, paS, done[2].id, 'Name spelling on the signed register differs from the booking');
      // Some messages were shared by hand
      for (const msg of state.messages.slice(0, 30)) CPD.setMessageStatus(state, ctx, paS, msg.id, 'manually-shared');
      ctx.now = at('2026-10-23', '19:40');
      state.clock = { simulated: true, at: ctx.now, setAt: null };
      state.scenario = 'event';
    }
    state.sessions = {};
    return state;
  }

  const api = { seed, PIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CPDSeed = api;
})(typeof window !== 'undefined' ? window : globalThis);
