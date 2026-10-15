// Supabase Edge Function entry point. build.py copies this file to
// supabase/functions/cpd/index.ts and the shared code to supabase/functions/_shared/.
import postgres from 'npm:postgres@3.4.4';
import '../_shared/core.js';
import { createHandler } from '../_shared/handler.js';
import { INITIAL_STAFF } from '../_shared/staff.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const FALLBACK_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { max: 4, prepare: false, idle_timeout: 20, onnotice: () => {} });

// A staff sign-in is checked with Supabase Auth, which returns the account's email.
async function getUserEmail(accessToken: string, apikey: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: apikey || FALLBACK_KEY }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return typeof u?.email === 'string' ? u.email : null;
}

const handler = createHandler({
  sql,
  // deno-lint-ignore no-explicit-any
  CPD: (globalThis as any).CPD,
  getUserEmail,
  dataset: Deno.env.get('CPD_DATASET') === 'live' ? 'live' : 'test',
  initialStaff: INITIAL_STAFF
});

Deno.serve(handler);
