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

// Automatic email: sent through the organiser's Google Apps Script (Gmail).
// Secrets (Supabase → Edge Functions → Secrets): EMAIL_SCRIPT_URL and EMAIL_SCRIPT_KEY.
const EMAIL_URL = Deno.env.get('EMAIL_SCRIPT_URL') ?? '';
const EMAIL_KEY = Deno.env.get('EMAIL_SCRIPT_KEY') ?? '';
async function sendEmail(msg: { to: string; subject: string; body: string }) {
  const r = await fetch(EMAIL_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key: EMAIL_KEY, to: msg.to, subject: msg.subject, body: msg.body }), redirect: 'follow'
  });
  const text = await r.text();
  try { const d = JSON.parse(text); return { ok: !!d.ok, error: d.error || null }; }
  catch { return { ok: false, error: `Unexpected reply from the email script (HTTP ${r.status})` }; }
}

// WhatsApp Cloud API. Secrets stay on Supabase, never in website code.
// Approved utility template body: Dear {{1}}, your certificate for {{2}} is ready. Download: {{3}}
const WA_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN') ?? '';
const WA_PHONE = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
const WA_TEMPLATE = Deno.env.get('WHATSAPP_CERTIFICATE_TEMPLATE') ?? '';
const WA_VERSION = Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? '';
const WA_LANGUAGE = Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en_US';
async function sendWhatsApp(msg: {to: string; name: string; topic: string; url: string}) {
  try {
    const r = await fetch(`https://graph.facebook.com/${WA_VERSION}/${WA_PHONE}/messages`, {
      method: 'POST', signal: AbortSignal.timeout(18000),
      headers: {Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({messaging_product: 'whatsapp', to: msg.to.replace(/\D/g, ''), type: 'template', template: {
        name: WA_TEMPLATE, language: {code: WA_LANGUAGE}, components: [{type: 'body', parameters: [msg.name, msg.topic, msg.url].map(text => ({type: 'text', text}))}]
      }})
    });
    const data = await r.json();
    return {ok: r.ok && !!data.messages?.[0]?.id, id: data.messages?.[0]?.id, unknown: r.status >= 500, error: data.error?.message || (r.ok ? 'No message identifier returned' : `HTTP ${r.status}`)};
  } catch { return {ok: false, unknown: true, error: 'WhatsApp response uncertain; review before retrying.'}; }
}

const handler = createHandler({
  sql,
  // deno-lint-ignore no-explicit-any
  CPD: (globalThis as any).CPD,
  getUserEmail,
  sendWhatsApp: WA_TOKEN && WA_PHONE && WA_TEMPLATE && /^v[0-9]+\.[0-9]+$/.test(WA_VERSION) ? sendWhatsApp : undefined,
  // LIVE since 16 Oct 2026. Set the CPD_DATASET secret to 'test' to use the archived test record.
  dataset: Deno.env.get('CPD_DATASET') === 'test' ? 'test' : 'live',
  initialStaff: INITIAL_STAFF,
  sendEmail: EMAIL_URL && EMAIL_KEY ? sendEmail : undefined,
  siteUrl: 'https://wapadverts-droid.github.io/wap-cpd-events-app/',
  // deno-lint-ignore no-explicit-any
  background: (p: Promise<unknown>) => (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(p) : p
});

Deno.serve(handler);
