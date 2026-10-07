import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

// Actual migration and helper, isolated PostgreSQL, synthetic Auth and mail only.
const db = new PGlite();
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = { userId: id(99), email: 'owner@example.com', fullName: null };
const user = (n = 1) => ({ id: id(n), email: `person${n}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z', identities: [{ provider: 'google' }], user_metadata: { full_name: 'Request Person' } });

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.identities(user_id uuid,provider text);
    create function auth.role() returns text language sql as 'select current_setting(''request.jwt.claim.role'',true)';
    grant usage on schema auth to anon,authenticated,service_role;`);
  await db.exec(readFileSync(new URL('../supabase/migrations/202610070002_access_requests.sql', import.meta.url), 'utf8'));
  for (let n = 1; n <= 30; n++) {
    await db.query('insert into auth.users values($1,$2,now())', [id(n), `person${n}@example.com`]);
    await db.query("insert into auth.identities values($1,'google')", [id(n)]);
  }
});
beforeEach(async () => {
  await db.exec('reset role; truncate public.remy_access_requests');
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
});
after(async () => { await db.close(); });

function load(relative: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(compiled, { exports, URL, Request, Response, AbortSignal, Date, require: (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, ...globals });
  return exports;
}

function fixture(options: { configured?: boolean; result?: 'ok' | 'failure' | 'network'; finishError?: boolean } = {}) {
  const env: Record<string, string> = options.configured === false ? {} : { RESEND_API_KEY: 'synthetic-key-only', ACCESS_REQUEST_FROM_EMAIL: 'sender@example.com', ACCESS_REQUEST_TO_EMAIL: 'notifications@example.com' };
  const calls = { mail: [] as { headers: Record<string, string>; payload: any }[], queries: [] as { fields: string; userId?: string }[], rpcs: [] as string[] };
  let result = options.result || 'ok';
  const config = { isAllowedEmail: (email: string | undefined) => email?.trim().toLowerCase() === owner.email, allowedEmail: () => owner.email, appOrigin: () => 'https://remy.example.com', assertSameOrigin(request: Request) { if (request.headers.get('origin') !== 'https://remy.example.com') throw Object.assign(new Error('Wrong origin'), { status: 403 }); } };
  const admin = {
    async rpc(name: string, values: Record<string, unknown>) {
      calls.rpcs.push(name);
      if (options.finishError && name === 'remy_finish_access_notification') return { data: null, error: new Error('synthetic-private-db-error') };
      const signatures: Record<string, string[]> = {
        remy_queue_access_request: ['p_user', 'p_email', 'p_name'],
        remy_claim_access_notification: ['p_user', 'p_token', 'p_payload'],
        remy_finish_access_notification: ['p_user', 'p_token', 'p_message_id', 'p_reason'],
      };
      assert.ok(name in signatures);
      const params = signatures[name].map(key => key === 'p_payload' ? JSON.stringify(values[key]) : values[key]);
      try { const rows = await db.query<{ value: unknown }>(`select public.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) as value`, params); return { data: rows.rows[0].value, error: null }; }
      catch { return { data: null, error: new Error('synthetic-private-db-error') }; }
    },
    from(table: string) {
      assert.equal(table, 'remy_access_requests', 'Access workflow never queries journal or tokens');
      let fields = '', userId: string | undefined;
      const builder = {
        select(value: string) { fields = value; return builder; },
        eq(column: string, value: string) { assert.equal(column, 'user_id'); userId = value; return builder; },
        order() { return builder; },
        async maybeSingle() {
          calls.queries.push({ fields, userId });
          const rows = await db.query<{ row: unknown }>(`select row_to_json(t) as row from (select ${fields} from remy_access_requests where user_id=$1) t`, [userId]);
          return { data: rows.rows[0]?.row || null, error: null };
        },
        async range(start: number, end: number) {
          calls.queries.push({ fields });
          const rows = await db.query<{ row: unknown }>(`select row_to_json(t) as row from (select ${fields} from remy_access_requests order by requested_at desc,user_id limit $1 offset $2) t`, [end - start + 1, start]);
          const count = await db.query<{ n: number }>('select count(*)::int as n from remy_access_requests');
          return { data: rows.rows.map(row => row.row), count: count.rows[0].n, error: null };
        },
      };
      return builder;
    },
  };
  const helper = load('../lib/access-requests.ts', { 'server-only': {}, 'node:crypto': { randomUUID }, '@/lib/supabase/admin': { createAdminClient: () => admin }, '@/lib/supabase/config': config }, {
    process: { env },
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, 'https://api.resend.com/emails');
      assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
      calls.mail.push({ headers: init.headers as Record<string, string>, payload: JSON.parse(String(init.body)) });
      if (result === 'network') throw new Error('synthetic-private-network-error');
      if (result === 'failure') return Response.json({ message: 'synthetic-private-provider-error' }, { status: 403 });
      return Response.json({ id: id(90) });
    },
  });
  return { helper, calls, config, env, setResult(value: 'ok' | 'failure' | 'network') { result = value; } };
}

async function row(n = 1) { return (await db.query<any>('select * from remy_access_requests where user_id=$1', [id(n)])).rows[0]; }
async function expireCooldown(n = 1) { await db.query("update remy_access_requests set next_attempt_at=now()-interval '1 second',last_attempt_at=now()-interval '2 minutes',lease_expires_at=null where user_id=$1", [id(n)]); }

test('verified identity is checked by helper and database; owner, forged, unconfirmed and non-Google inputs create nothing', async () => {
  const f = fixture();
  for (const person of [{ ...user(), email_confirmed_at: null }, { ...user(), identities: [{ provider: 'email' }] }, { ...user(), email: owner.email }, { ...user(), id: 'not-a-uuid' }, { ...user(), email: 'header\r\ninjection@example.com' }]) {
    await assert.rejects(f.helper.queueAccessRequest(person), (error: any) => error.status === 403);
  }
  assert.equal(f.calls.rpcs.length, 0);
  await assert.rejects(f.helper.queueAccessRequest({ ...user(), email: 'forged@example.com' }), (error: any) => error.status === 503 && !error.message.includes('private'));
  await db.query('update auth.users set email_confirmed_at=null where id=$1', [id(1)]);
  await assert.rejects(f.helper.queueAccessRequest(user()), (error: any) => error.status === 503);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [id(1)]);
  await db.query("update auth.identities set provider='email' where user_id=$1", [id(1)]);
  await assert.rejects(f.helper.queueAccessRequest(user()), (error: any) => error.status === 503);
  await db.query("update auth.identities set provider='google' where user_id=$1", [id(1)]);
  assert.equal(await row(), undefined); assert.equal(f.calls.mail.length, 0);
});

test('concurrent callback retries persist one immutable request and send only one initial notification', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 8 }, () => f.helper.queueAccessRequest(user())));
  const saved = await row();
  assert.equal(saved.attempts, 1); assert.equal(saved.notification_status, 'sent');
  assert.equal(f.calls.mail.length, 1);
  await f.helper.queueAccessRequest({ ...user(), user_metadata: { full_name: 'Changed name' } });
  assert.equal((await row()).display_name, 'Request Person'); assert.equal(f.calls.mail.length, 1);
  const outbound = f.calls.mail[0];
  assert.equal(outbound.headers['Idempotency-Key'], `remy-access/${id(1)}`);
  assert.deepEqual(outbound.payload.to, ['notifications@example.com']);
  assert.ok(!JSON.stringify(outbound.payload).includes(owner.email));
  assert.deepEqual(Object.keys(outbound.payload).sort(), ['from', 'subject', 'text', 'to']);
});

test('missing recipient never falls back to owner; delayed configuration sends the durable queued request', async () => {
  const f = fixture(); delete f.env.ACCESS_REQUEST_TO_EMAIL;
  assert.equal((await f.helper.queueAccessRequest(user())).notification, 'queued');
  assert.equal(f.calls.mail.length, 0); assert.equal((await row()).attempts, 0); assert.equal((await row()).first_attempt_at, null);
  const listed = await f.helper.listAccessRequests(owner);
  assert.equal(listed.emailConfigured, false); assert.equal(listed.requests[0].notification, 'queued');
  f.env.ACCESS_REQUEST_TO_EMAIL = 'notifications@example.com';
  assert.equal((await f.helper.retryAccessNotification(owner, id(1))).request.notification, 'sent');
  assert.equal(f.calls.mail.length, 1);
});

test('mail failure is honest, private errors are discarded and safe retries reuse the exact body/key after cooldown', async () => {
  const f = fixture({ result: 'network' });
  const initial = await f.helper.queueAccessRequest(user());
  assert.equal(initial.status, 'pending'); assert.equal(initial.notification, 'queued');
  assert.equal((await row()).notification_reason, 'delivery_unknown');
  await f.helper.retryAccessNotification(owner, id(1)); assert.equal(f.calls.mail.length, 1, 'Immediate retry is suppressed');
  await expireCooldown(); f.setResult('ok');
  const retried = await f.helper.retryAccessNotification(owner, id(1));
  assert.equal(retried.request.notification, 'sent'); assert.equal(f.calls.mail.length, 2);
  assert.deepEqual(f.calls.mail[0], f.calls.mail[1]);
  assert.ok(!JSON.stringify(retried).includes('synthetic-private'));
});

test('three failed attempts, expired idempotency windows and changed mail recipients stop retries for review', async () => {
  const f = fixture({ result: 'failure' });
  await f.helper.queueAccessRequest(user());
  for (let n = 0; n < 2; n++) { await expireCooldown(); await f.helper.retryAccessNotification(owner, id(1)); }
  await expireCooldown(); const exhausted = await f.helper.retryAccessNotification(owner, id(1));
  assert.equal(exhausted.request.notification, 'review'); assert.equal(f.calls.mail.length, 3);
  await f.helper.queueAccessRequest(user(2));
  await db.query("update remy_access_requests set first_attempt_at=now()-interval '23 hours 1 minute' where user_id=$1", [id(2)]);
  assert.equal((await f.helper.retryAccessNotification(owner, id(2))).request.reason, 'idempotency_expired');
  await f.helper.queueAccessRequest(user(3));
  f.env.ACCESS_REQUEST_TO_EMAIL = 'changed@example.com';
  assert.equal((await f.helper.retryAccessNotification(owner, id(3))).request.reason, 'configuration_changed');
  assert.equal(f.calls.mail.length, 5);
});

test('accepted mail with a failed status write keeps its lease; retries after the safe window never send again', async () => {
  const f = fixture({ finishError: true });
  assert.equal((await f.helper.queueAccessRequest(user())).notification, 'queued');
  await f.helper.queueAccessRequest(user()); assert.equal(f.calls.mail.length, 1);
  await db.query("update remy_access_requests set first_attempt_at=now()-interval '24 hours',lease_expires_at=now()-interval '1 second' where user_id=$1", [id(1)]);
  const result = await f.helper.retryAccessNotification(owner, id(1));
  assert.equal(result.request.notification, 'review'); assert.equal(f.calls.mail.length, 1);
});

test('global mail limits queue excess verified requests without dropping them', async () => {
  const f = fixture();
  for (let n = 1; n <= 4; n++) await f.helper.queueAccessRequest(user(n));
  assert.equal(f.calls.mail.length, 3); assert.equal((await row(4)).notification_reason, 'rate_limited');
  assert.equal((await row(4)).attempts, 0);
  const unconfigured = fixture({ configured: false });
  for (let n = 5; n <= 21; n++) await unconfigured.helper.queueAccessRequest(user(n));
  await db.query("update remy_access_requests set first_attempt_at=now()-interval '1 hour',last_attempt_at=now()-interval '1 hour' where user_id<>$1", [id(21)]);
  const result = await f.helper.retryAccessNotification(owner, id(21));
  assert.equal(result.request.reason, 'rate_limited'); assert.equal(f.calls.mail.length, 3);
});

test('names are bounded plain text; metadata, tokens and other requesters never enter own status DTO', async () => {
  const f = fixture();
  await f.helper.queueAccessRequest({ ...user(), user_metadata: { full_name: 'X\r\n\u202e'.repeat(150), access_token: 'never-copy-me', health: 'never-copy-me' } });
  const saved = await row(); assert.ok(saved.display_name.length <= 120); assert.ok(!/[\r\n\u202e]/.test(saved.display_name));
  assert.ok(!JSON.stringify(f.calls.mail).includes('never-copy-me'));
  const status = await f.helper.ownAccessRequest(user());
  assert.deepEqual(Object.keys(status).sort(), ['notification', 'requestedAt', 'status']);
  assert.equal(await f.helper.ownAccessRequest(user(2)), null);
  assert.equal(f.calls.queries.at(-1)?.userId, id(2));
  assert.equal(f.calls.queries.at(-1)?.fields, 'requested_at,notification_status');
  await assert.rejects(f.helper.listAccessRequests({ ...owner, email: user().email }), (error: any) => error.status === 403);
  await assert.rejects(f.helper.retryAccessNotification({ ...owner, email: user().email }, id(1)), (error: any) => error.status === 403);
});

test('browser roles cannot read, write or invoke access-request RPCs even for their own UUID', async () => {
  const f = fixture({ configured: false }); await f.helper.queueAccessRequest(user());
  for (const role of ['anon', 'authenticated']) {
    await db.query("select set_config('request.jwt.claim.role',$1,false)", [role]); await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from remy_access_requests'), /permission denied/);
    await assert.rejects(db.query('delete from remy_access_requests where user_id=$1', [id(1)]), /permission denied/);
    await assert.rejects(db.query('select remy_queue_access_request($1,$2,null)', [id(1), user().email]), /permission denied/);
    await assert.rejects(db.query("select remy_claim_access_notification($1,$2,'{}')", [id(1), randomUUID()]), /permission denied/);
    await assert.rejects(db.query("select remy_finish_access_notification($1,$2,null,'delivery_failed')", [id(1), randomUUID()]), /permission denied/);
    await db.exec('reset role');
  }
});

test('owner API verifies session and same origin before list/retry or reading the request body', async () => {
  const f = fixture({ configured: false }); await f.helper.queueAccessRequest(user());
  function routes(identity: ReturnType<typeof user> | null) {
    const http = load('../lib/http.ts', { '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: identity }, error: null }) } }) }, '@/lib/supabase/config': f.config });
    return load('../app/api/access-requests/route.ts', { '@/lib/http': http, '@/lib/access-requests': f.helper });
  }
  const request = new Request('https://remy.example.com/api/access-requests');
  assert.equal((await routes(null).GET(request)).status, 401);
  assert.equal((await routes(user()).GET(request)).status, 403);
  const ownerRoutes = routes({ ...user(), id: owner.userId, email: owner.email });
  const response = await ownerRoutes.GET(request); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).requests.length, 1);
  for (const origin of ['https://attacker.invalid', null]) {
    const response = await ownerRoutes.POST(new Request(request.url, { method: 'POST', headers: origin ? { origin } : {}, body: 'invalid-json' }));
    assert.equal(response.status, 403);
  }
  assert.equal(f.calls.mail.length, 0);
});

test('pending page authenticates, redirects owner distinctly and renders only the current requester status', async () => {
  const f = fixture({ configured: false }); await f.helper.queueAccessRequest(user());
  const redirect = (location: string) => { throw Object.assign(new Error('redirect'), { location }); };
  async function page(identity: ReturnType<typeof user> | null) {
    const loaded = load('../app/access-pending/page.tsx', {
      'react/jsx-runtime': jsx, 'next/link': { default: (props: any) => jsx.jsx('a', props) }, 'next/navigation': { redirect },
      '@/components/brand': { Brand: () => jsx.jsx('span', { children: 'Remy Mux' }) }, './sign-out': { default: () => jsx.jsx('button', { children: 'Sign out' }) },
      '@/lib/access-requests': f.helper, '@/lib/supabase/config': f.config,
      '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: identity }, error: null }) } }) },
    });
    return loaded.default();
  }
  await assert.rejects(page(null), (error: any) => error.location === '/login');
  await assert.rejects(page({ ...user(), email: owner.email }), (error: any) => error.location === '/access-requests');
  const html = renderToStaticMarkup(await page(user()));
  assert.match(html, /Your request is saved/); assert.match(html, /notification is still pending/); assert.match(html, /Sign out/);
  assert.ok(!html.includes(owner.email)); assert.ok(!html.includes('notifications@example.com'));
  assert.match(renderToStaticMarkup(await page(user(2))), /No request found yet/);
});
