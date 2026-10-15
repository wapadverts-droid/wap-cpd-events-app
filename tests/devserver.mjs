// Local stand-in for Supabase, used by tests/e2e_remote.py:
//  - /functions/v1/cpd   the real server program (server/handler.js) on a local Postgres
//  - /auth/v1/*          a fake sign-in service with fixed test passwords
// Usage: PGURL=... WAPCPD_LIB=<dir>/node_modules node tests/devserver.mjs <port>
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../server/handler.js';
import { INITIAL_STAFF } from '../server/staff.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CPD = require('../src/core.js');
const LIB = process.env.WAPCPD_LIB || path.join(here, '..', 'node_modules');
const postgres = createRequire(path.join(LIB, 'x.js'))('postgres');
const sql = postgres(process.env.PGURL || 'postgres://postgres@localhost:54329/postgres', { max: 10, onnotice: () => {} });

const PASSWORDS = { 'wapadverts@gmail.com': 'admin-pass', 'executive@rcempiremedical.com': 'pa-pass', 'stranger@example.com': 'x-pass' };
const handler = createHandler({ sql, CPD, dataset: 'test', initialStaff: INITIAL_STAFF, getUserEmail: async t => (t.startsWith('tok:') ? t.slice(4) : null) });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

function send(res, status, body) { res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, CORS)); res.end(JSON.stringify(body)); }

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString();
  const url = new URL(req.url, 'http://local');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (url.pathname === '/__reset') { await sql.unsafe('drop table if exists public.app_state, public.app_state_history'); return send(res, 200, { ok: true }); }
  if (url.pathname === '/auth/v1/token') {
    const d = JSON.parse(body || '{}');
    if (url.searchParams.get('grant_type') === 'password') {
      const email = String(d.email || '').toLowerCase();
      if (PASSWORDS[email] !== d.password) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, { access_token: 'tok:' + email, refresh_token: 'r:' + email, expires_in: 3600, token_type: 'bearer', user: { email } });
    }
    const email = String(d.refresh_token || '').slice(2);
    return send(res, 200, { access_token: 'tok:' + email, refresh_token: 'r:' + email, expires_in: 3600, token_type: 'bearer', user: { email } });
  }
  if (url.pathname === '/auth/v1/logout') { res.writeHead(204, CORS); return res.end(); }
  if (url.pathname === '/functions/v1/cpd') {
    const r = await handler(new Request('http://local' + req.url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? body : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
    return res.end(await r.text());
  }
  send(res, 404, { error: 'not found' });
}).listen(Number(process.argv[2] || 54400), '127.0.0.1', () => console.log('devserver ready'));
