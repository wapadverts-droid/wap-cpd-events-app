// Server tests: run the real server program against a local Postgres.
//   PGURL=postgres://postgres@localhost:54329/postgres WAPCPD_LIB=<dir>/node_modules node --test tests/server.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../server/handler.js';
import { INITIAL_STAFF } from '../server/staff.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CPD = require('../src/core.js');
const LIB = process.env.WAPCPD_LIB || path.join(here, '..', 'node_modules');
const postgres = createRequire(path.join(LIB, 'x.js'))('postgres');
const PGURL = process.env.PGURL || 'postgres://postgres@localhost:54329/postgres';
const sql = postgres(PGURL, { max: 20, onnotice: () => {} });

const at = (d, hm) => Date.parse(`${d}T${hm}:00+02:00`);
let clockNow = at('2026-10-16', '09:00');
const getUserEmail = async tok => (tok.startsWith('tok:') ? tok.slice(4) : null);
const ADMIN = 'tok:wapadverts@gmail.com', PA = 'tok:executive@rcempiremedical.com';

async function fresh() {
  await sql.unsafe('drop table if exists public.app_state, public.app_state_history');
  clockNow = at('2026-10-16', '09:00');
  return createHandler({ sql, CPD, getUserEmail, dataset: 'test', initialStaff: INITIAL_STAFF, clock: () => clockNow });
}
async function call(h, body, bearer) {
  const headers = { 'Content-Type': 'application/json', apikey: 'sb_publishable_test' };
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  const r = await h(new Request('http://x/functions/v1/cpd', { method: 'POST', headers, body: JSON.stringify(body) }));
  return Object.assign(await r.json(), { status: r.status });
}
const act = (h, calls, bearer, token) => call(h, { op: 'act', calls, token }, bearer);
const view = (h, bearer, token) => call(h, { op: 'view', token }, bearer);
let n = 0;
function person(extra) {
  n++;
  return Object.assign({ firstName: 'Test' + n, lastName: 'Person' + n, profession: 'Pharmacist', hpcnaStatus: 'provided', hpcna: 'T-' + n,
    phone: '081 400 ' + String(1000 + n).slice(-4), email: `t${n}@example.com`, channel: 'whatsapp', consentEvent: true }, extra || {});
}
const book = (h, p, bearer) => act(h, [{ fn: 'createBooking', args: [null, p || person(), { channel: 'public' }] }], bearer);
const ME = { session: 'remote' }; // what the website sends as "actor"; the server replaces it

test.after(() => sql.end());

test('first use creates the tables, staff list and an empty event; public view has no personal data', async () => {
  const h = await fresh();
  const v = await view(h);
  assert.equal(v.ok, true);
  assert.equal(v.view.summary.status, 'open');
  assert.equal(v.view.summary.publicFree, 50);
  assert.equal(v.view.staff.length, 0, 'no staff list in public view');
  assert.equal(v.view.bookings.length, 0);
  assert.equal(v.view.dataset, 'test');
  const admin = await view(h, ADMIN);
  assert.equal(admin.view.viewKind, 'staff');
  assert.deepEqual(admin.view.staff.map(s => [s.email, s.role]).sort(), [['executive@rcempiremedical.com', 'pa'], ['wapadverts@gmail.com', 'admin']]);
  assert.ok(admin.view.staff.every(s => !('pinHash' in s)));
  const priv = await sql`select has_table_privilege('anon', 'public.app_state', 'select') as a, has_table_privilege('authenticated', 'public.app_state', 'select') as b`;
  assert.deepEqual([priv[0].a, priv[0].b], [false, false], 'website key cannot read the table directly');
});

test('public RSVP: booking saved centrally, attendee sees only their own booking', async () => {
  const h = await fresh();
  const r1 = await book(h, person({ email: 'dup@example.com' }));
  assert.equal(r1.ok, true, JSON.stringify(r1.error));
  const b1 = r1.results[0];
  assert.equal(b1.status, 'confirmed');
  assert.equal(r1.view.viewKind, 'attendee');
  assert.equal(r1.view.bookings.length, 1);
  const r2 = await book(h, person({ email: 'dup@example.com' }));
  const b2 = r2.results[0];
  assert.deepEqual(b2.flags.duplicate.matches, [], 'other attendees are not revealed through duplicate flags');
  // another device sees the place taken
  const other = await view(h);
  assert.equal(other.view.summary.publicFree, 48);
  // private link
  const mine = await view(h, null, { kind: 'booking', value: b1.token });
  assert.equal(mine.view.bookings.length, 1);
  assert.equal(mine.view.bookings[0].ref, b1.ref);
  const bad = await view(h, null, { kind: 'booking', value: 'x'.repeat(26) });
  assert.equal(bad.view.bookings.length, 0);
  // staff see both, with the duplicate flag
  const pa = await view(h, PA);
  assert.equal(pa.view.bookings.length, 2);
  assert.equal(pa.view.bookings[1].flags.duplicate.matches[0].ref, b1.ref);
});

test('anonymous visitors cannot run staff actions, even by pretending to be staff', async () => {
  const h = await fresh();
  const b = (await book(h)).results[0];
  for (const c of [
    { fn: 'recordArrival', args: [ME, b.id, 'qr'] },
    { fn: 'updateApproval', args: [ME, { activityNumber: 'X', ceus: '1', level: '1' }] },
    { fn: 'prepareMessage', args: [null, b.id, 'reminder'] },
    { fn: 'addStaff', args: [null, { name: 'Intruder', email: 'bad@example.com', role: 'admin' }] },
    { fn: 'cancelBooking', args: [ME, b.id, { reason: 'x' }] },
    { fn: 'login', args: ['s1', 'x'] },
    { fn: 'constructor', args: [] }
  ]) {
    const r = await act(h, [c]);
    assert.equal(r.ok, false, c.fn);
    assert.equal(r.error.code, 'auth', c.fn + ': ' + r.error.message);
  }
  const r = await act(h, [{ fn: 'recordArrival', args: [ME, b.id, 'qr'] }], 'tok:stranger@example.com');
  assert.equal(r.error.code, 'auth', 'a signed-in account that is not on the staff list is treated as public');
  const exp = await view(h, 'expired-token');
  assert.equal(exp.status, 401);
  assert.equal(exp.error.code, 'signed_out');
  const admin = await view(h, ADMIN);
  assert.equal(admin.view.staff.length, 2, 'no staff were added');
});

test('roles: PA cannot do administrator actions and does not receive audit or feedback answers', async () => {
  const h = await fresh();
  await book(h);
  const r = await act(h, [{ fn: 'updateApproval', args: [ME, { activityNumber: 'X', ceus: '1', level: '1' }] }], PA);
  assert.equal(r.error.code, 'perm');
  const r2 = await act(h, [{ fn: 'addStaff', args: [ME, { name: 'X', email: 'x@example.com', role: 'admin' }] }], PA);
  assert.equal(r2.error.code, 'perm');
  const pa = await view(h, PA);
  assert.equal(pa.view.audit.length, 0); assert.equal(pa.view.restricted, true);
  const admin = await view(h, ADMIN);
  assert.ok(admin.view.audit.length > 0);
  const ok = await act(h, [{ fn: 'addStaff', args: [ME, { name: 'New PA', email: 'New.PA@Example.com', role: 'pa' }] }], ADMIN);
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  const newPa = await view(h, 'tok:new.pa@example.com');
  assert.equal(newPa.view.viewKind, 'staff', 'email match is not case-sensitive');
  const audit = (await view(h, ADMIN)).view.audit;
  assert.equal(audit.at(-1).who.name, 'WAP Administrator', 'audit records the real signed-in staff member');
});

test('all or nothing: if one change in a request fails, nothing is saved', async () => {
  const h = await fresh();
  const b = (await book(h)).results[0];
  const before = (await sql`select rev from public.app_state`)[0].rev;
  const r = await act(h, [{ fn: 'flagException', args: [ME, b.id, 'First note'] }, { fn: 'flagException', args: [ME, b.id, ''] }], PA);
  assert.equal(r.ok, false); assert.equal(r.error.code, 'reason');
  assert.equal((await sql`select rev from public.app_state`)[0].rev, before);
  const v = await view(h, PA);
  assert.equal(v.view.bookings[0].exceptions.length, 0);
});

test('RSVP deadline and offer expiry use the server clock', async () => {
  const h = await fresh();
  for (let i = 0; i < 50; i++) await book(h);
  const w = (await book(h)).results[0];
  assert.equal(w.status, 'waitlisted');
  const pa = await view(h, PA);
  const first = pa.view.bookings[0];
  await act(h, [{ fn: 'cancelBooking', args: [ME, first.id, { reason: 'test' }] }, { fn: 'makeOffer', args: [ME, null] }], PA);
  let mine = await view(h, null, { kind: 'booking', value: w.token });
  assert.equal(mine.view.bookings[0].status, 'offered');
  clockNow += 25 * CPD.HOUR;
  mine = await view(h, null, { kind: 'booking', value: w.token });
  assert.equal(mine.view.bookings[0].status, 'expired', 'expired offer processed when viewed');
  clockNow = at('2026-10-23', '12:00');
  const late = await book(h);
  assert.equal(late.error.code, 'rsvp_closed');
  assert.equal((await view(h)).view.summary.status, 'closed');
});

test('70 people booking at the same moment: exactly 50 places, 20 on the waiting list, nothing lost', async () => {
  const h = await fresh();
  await view(h);
  const rs = await Promise.all(Array.from({ length: 70 }, () => book(h)));
  assert.ok(rs.every(r => r.ok), JSON.stringify(rs.find(r => !r.ok)));
  const statuses = rs.map(r => r.results[0].status);
  assert.equal(statuses.filter(s => s === 'confirmed').length, 50);
  assert.equal(statuses.filter(s => s === 'waitlisted').length, 20);
  const admin = await view(h, ADMIN);
  assert.equal(admin.view.bookings.length, 70);
  const c = CPD.capacity(admin.view);
  assert.equal(c.publicUsed, 50);
  assert.equal(new Set(admin.view.bookings.map(b => b.ref)).size, 70, 'unique references');
  assert.equal((await sql`select rev from public.app_state`)[0].rev, 70, 'each booking saved exactly once');
});

test('history snapshot is kept (at most hourly) and feedback stays anonymous', async () => {
  const h = await fresh();
  const b = (await book(h)).results[0];
  await book(h);
  assert.equal((await sql`select count(*)::int as n from public.app_state_history`)[0].n, 1);
  clockNow = at('2026-10-23', '17:40');
  await act(h, [{ fn: 'recordArrival', args: [ME, b.id, 'qr'] }], PA);
  clockNow = at('2026-10-23', '19:31');
  await act(h, [{ fn: 'confirmCompletion', args: [ME, b.id, 'register'] }], PA);
  const ans = { ratings: { relevance: 5, quality: 4, usefulness: 4, overall: 5 }, choices: { understanding: 'Yes', apply: 'Yes', bias: 'Yes' }, improve: '', topics: [] };
  const f = await act(h, [{ fn: 'submitFeedback', args: [b.token, ans] }], null, { kind: 'booking', value: b.token });
  assert.equal(f.ok, true, JSON.stringify(f.error));
  const st = (await sql`select state from public.app_state`)[0].state;
  assert.equal(st.responses.length, 1);
  assert.ok(!JSON.stringify(st.responses).includes(b.id) && !JSON.stringify(st.responses).includes(b.ref));
  // certificate link view shows only that certificate
  await act(h, [{ fn: 'markDetailsChecked', args: [ME, b.id] }], PA);
  await act(h, [{ fn: 'updateApproval', args: [ME, { activityNumber: 'TEST', ceus: '1', level: '1' }] }, { fn: 'releaseCertificate', args: [ME, b.id] }], ADMIN);
  const certTok = (await view(h, ADMIN)).view.certificates[0].token;
  const cv = await view(h, null, { kind: 'cert', value: certTok });
  assert.equal(cv.view.certificates.length, 1);
  assert.equal(cv.view.bookings[0].id, b.id);
  assert.equal(cv.view.certificates[0].demo, true, 'test database certificates are marked as not valid');
});

test('going live: live data starts empty in its own record; test bookings stay archived and unseen', async () => {
  const testH = await fresh();
  await book(testH); await book(testH);
  const liveH = createHandler({ sql, CPD, getUserEmail, dataset: 'live', initialStaff: INITIAL_STAFF, clock: () => clockNow });
  const v = await view(liveH);
  assert.equal(v.view.dataset, 'live');
  assert.equal(v.view.mode, 'live', 'live certificates carry no test watermark');
  assert.equal(v.view.summary.publicFree, 50, 'live starts with all 50 places');
  const admin = await view(liveH, ADMIN);
  assert.equal(admin.view.bookings.length, 0);
  assert.equal(admin.view.staff.length, 2, 'same staff logins work on live');
  assert.ok(!/Tawanda|0814285408/.test(JSON.stringify(v.view.event)), 'no organiser name in live data');
  const rows = await sql`select id, jsonb_array_length(state->'bookings') as n from public.app_state order by id`;
  assert.deepEqual(rows.map(r => [r.id, r.n]), [['live', 0], ['main', 2]]);
  const r = await book(liveH);
  assert.equal(r.results[0].status, 'confirmed');
  assert.equal((await view(testH)).view.summary.publicFree, 48, 'test record unchanged');
});

test('spam protection: an RSVP with the hidden field filled in is refused and nothing is saved', async () => {
  const h = await fresh();
  const r = await book(h, person({ website: 'http://spam.example' }));
  assert.equal(r.ok, false); assert.equal(r.error.code, 'spam');
  assert.equal((await view(h)).view.summary.publicFree, 50);
  const ok = await book(h, person({ website: '' }));
  assert.equal(ok.ok, true);
  // staff registrations are not affected
  const s = await act(h, [{ fn: 'createBooking', args: [ME, person({ website: 'x' }), { channel: 'staff', source: 'staff-phone' }] }], PA);
  assert.equal(s.ok, true, JSON.stringify(s.error));
});
