import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { NextResponse } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as config from '../lib/supabase/config';
import LoginForm, { signInErrorMessage } from '../app/login/sign-in-form';

const origin = 'https://remy.example.com';
const project = 'https://synthetic.supabase.co';
const env = { APP_ORIGIN: origin, REMY_ALLOWED_EMAIL: 'owner@example.com', NEXT_PUBLIC_SUPABASE_URL: project, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_test_key' };
const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
Object.assign(process.env, env);
after(() => { for (const key of Object.keys(env)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });

function load(relative: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exported: Record<string, any> = {};
  runInNewContext(compiled, {
    exports: exported, URL, Response, Request, AbortSignal,
    require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`); return dependencies[name]; },
    ...globals,
  });
  return exported;
}

type User = { id: string; email: string; email_confirmed_at: string | null; identities?: { provider: string }[] };
function app(options: { availability?: string; user?: User | null; authUrl?: string; startError?: boolean; exchangeError?: boolean; exchangeThrows?: boolean; userError?: boolean; requestError?: boolean; notificationQueued?: boolean } = {}) {
  const calls = { starts: [] as any[], exchanges: [] as string[], verifications: [] as any[], users: 0, signouts: [] as any[], checks: 0, requests: [] as User[] };
  const auth = {
    async signInWithOAuth(input: unknown) { calls.starts.push(input); return { data: { url: options.authUrl ?? `${project}/auth/v1/authorize?provider=google` }, error: options.startError ? new Error('synthetic-private-provider-error') : null }; },
    async exchangeCodeForSession(code: string) { calls.exchanges.push(code); if (options.exchangeThrows) throw new Error('synthetic-private-provider-error'); return { error: options.exchangeError ? new Error('synthetic-private-provider-error') : null }; },
    async verifyOtp(input: unknown) { calls.verifications.push(input); return { error: options.exchangeError ? new Error('synthetic-private-provider-error') : null }; },
    async getUser() { calls.users++; return { data: { user: options.user === undefined ? { id: 'owner-id', email: 'owner@example.com', email_confirmed_at: '2026-01-01' } : options.user }, error: options.userError ? new Error('synthetic-private-provider-error') : null }; },
    async signOut(input: unknown) { calls.signouts.push(input); return { error: null }; },
  };
  const dependencies = {
    'next/server': { NextResponse },
    '@/lib/supabase/config': config,
    '@/lib/supabase/server': { async createClient() { return { auth }; } },
    '@/lib/supabase/providers': { async googleSignInAvailability() { calls.checks++; return options.availability ?? 'enabled'; } },
    '@/lib/access-requests': { async queueAccessRequest(user: User) { calls.requests.push(user); if (options.requestError) throw new Error('synthetic-private-database-error'); return { status: 'pending', notification: options.notificationQueued ? 'queued' : 'sent' }; } },
    '@/lib/http': { failure(error: { message: string; status?: number }) { return Response.json({ error: error.message }, { status: error.status ?? 400 }); } },
  };
  const start = load('../app/auth/google/route.ts', dependencies);
  const callback = load('../app/auth/callback/route.ts', dependencies);
  const http = load('../lib/http.ts', dependencies);
  return {
    calls,
    post: (request: Request = new Request(`${origin}/auth/google`, { method: 'POST', headers: { origin } })) => start.POST(request) as Promise<Response>,
    callback: (path: string) => callback.GET(new Request(`${origin}${path}`)) as Promise<Response>,
    authorize: () => http.authorize(new Request(`${origin}/api/journal`)) as Promise<unknown>,
  };
}

test('Google start rejects cross-origin and missing-origin requests before any provider operation', async () => {
  for (const requestOrigin of [undefined, 'https://attacker.invalid']) {
    const flow = app();
    const response = await flow.post(new Request(`${origin}/auth/google`, { method: 'POST', headers: requestOrigin ? { origin: requestOrigin } : {} }));
    assert.equal(response.status, 403);
    assert.equal(flow.calls.checks, 0);
    assert.equal(flow.calls.starts.length, 0);
  }
});

test('Google start uses a GET redirect with a fixed app callback and identity-only defaults', async () => {
  const flow = app();
  const response = await flow.post(new Request(`${origin}/auth/google?next=https://attacker.invalid`, { method: 'POST', headers: { origin }, body: 'redirectTo=https://attacker.invalid' }));
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('location')!).origin, project);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const input = flow.calls.starts[0];
  assert.equal(input.provider, 'google');
  assert.equal(input.options.redirectTo, `${origin}/auth/callback`);
  assert.equal(input.options.queryParams.login_hint, undefined);
  assert.equal(input.options.queryParams.prompt, 'select_account');
  assert.equal(input.options.scopes, undefined);
  assert.equal(input.options.queryParams.access_type, undefined);
});

test('disabled or unreachable Google setup remains separate from email sign-in and starts no OAuth', async () => {
  for (const availability of ['disabled', 'unavailable']) {
    const flow = app({ availability });
    const response = await flow.post();
    assert.equal(response.headers.get('location'), `${origin}/login?error=google-unavailable`);
    assert.equal(flow.calls.starts.length, 0);
  }
});

test('login shows Google readiness honestly, retains email fallback and discloses requests before sign-in', () => {
  for (const availability of ['disabled', 'unavailable', 'enabled'] as const) {
    const html = renderToStaticMarkup(createElement(LoginForm, { googleAvailability: availability }));
    assert.ok(html.indexOf('Continue with Google') < html.indexOf('Email me a sign-in link'));
    assert.match(html, /action="\/auth\/google" method="post"/);
    assert.match(html, /name and email/);
    assert.match(html, /does not grant access/);
    if (availability !== 'enabled') assert.match(html, /disabled=""[^>]*>Continue with Google/);
    if (availability === 'disabled') assert.match(html, /waiting for provider setup/);
    if (availability === 'unavailable') assert.match(html, /could not be checked/);
  }
});

test('provider failures and unexpected authorization destinations never escape to a supplied URL or expose errors', async () => {
  for (const options of [{ startError: true }, { authUrl: 'https://attacker.invalid/' }, { authUrl: `${project}/unexpected` }, { authUrl: 'https://username:password@synthetic.supabase.co/auth/v1/authorize' }]) {
    const response = await app(options).post();
    assert.equal(response.headers.get('location'), `${origin}/login?error=google-unavailable`);
    assert.ok(!(await response.text()).includes('synthetic-private'));
  }
});

test('callback validates the current confirmed owner and ignores untrusted next destinations', async () => {
  const flow = app();
  const response = await flow.callback('/auth/callback?code=synthetic-code&next=https://attacker.invalid');
  assert.equal(response.headers.get('location'), `${origin}/`);
  assert.equal(flow.calls.users, 1);
  assert.deepEqual(flow.calls.exchanges, ['synthetic-code']);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('unconfirmed and non-Google non-owner identities are signed out and cannot request access', async () => {
  for (const user of [
    { id: 'other', email: 'other@example.com', email_confirmed_at: '2026-01-01' },
    { id: 'other', email: 'owner@example.com.attacker.invalid', email_confirmed_at: '2026-01-01' },
    { id: 'owner-id', email: 'owner@example.com', email_confirmed_at: null },
  ]) {
    const flow = app({ user });
    const response = await flow.callback('/auth/callback?code=synthetic-code');
    assert.equal(response.headers.get('location'), `${origin}/login?error=owner-only`);
    assert.equal(flow.calls.signouts.length, 1);
    assert.equal(flow.calls.signouts[0].scope, 'local');
    assert.equal(flow.calls.requests.length, 0);
  }
});

test('verified non-owner Google users receive only their pending page and stay denied by the journal API gate', async () => {
  const user = { id: 'requester-id', email: 'requester@example.com', email_confirmed_at: '2026-01-01', identities: [{ provider: 'google' }] };
  for (const notificationQueued of [false, true]) {
    const flow = app({ user, notificationQueued });
    const response = await flow.callback('/auth/callback?code=synthetic-code&next=/api/journal');
    assert.equal(response.headers.get('location'), `${origin}/access-pending`);
    assert.equal(flow.calls.requests.length, 1);
    assert.equal(flow.calls.requests[0], user);
    assert.equal(flow.calls.signouts.length, 0);
    await assert.rejects(flow.authorize(), (error: any) => error.status === 403);
  }
});

test('failed access-request storage clears the restricted session and does not claim a request was submitted', async () => {
  const flow = app({ user: { id: 'requester-id', email: 'requester@example.com', email_confirmed_at: '2026-01-01', identities: [{ provider: 'google' }] }, requestError: true });
  const response = await flow.callback('/auth/callback?code=synthetic-code');
  assert.equal(response.headers.get('location'), `${origin}/login?error=access-request-failed`);
  assert.equal(flow.calls.signouts[0].scope, 'local');
  assert.match(signInErrorMessage('access-request-failed'), /could not be saved/);
  assert.ok(!(await response.text()).includes('synthetic-private'));
});

test('OAuth cancellation, failed exchange and expired email use fixed human-readable errors', async () => {
  const cancelled = app();
  const result = await cancelled.callback('/auth/callback?error=access_denied&error_description=synthetic-private-provider-error');
  assert.equal(result.headers.get('location'), `${origin}/login?error=google-cancelled`);
  assert.equal(cancelled.calls.exchanges.length, 0);
  for (const options of [{ exchangeError: true }, { exchangeThrows: true }, { userError: true }]) {
    assert.equal((await app(options).callback('/auth/callback?code=synthetic-code')).headers.get('location'), `${origin}/login?error=google-failed`);
    assert.equal((await app(options).callback('/auth/confirm?code=synthetic-code')).headers.get('location'), `${origin}/login?error=invalid-link`);
  }
  assert.equal(signInErrorMessage('synthetic-private-provider-error'), '');
  assert.match(signInErrorMessage('google-cancelled'), /cancelled/);
  assert.match(signInErrorMessage('invalid-link'), /newest email/);
});

test('existing email token-hash callbacks still require email type and owner verification', async () => {
  const valid = app();
  assert.equal((await valid.callback('/auth/confirm?token_hash=synthetic-hash&type=email')).headers.get('location'), `${origin}/`);
  assert.equal(valid.calls.verifications.length, 1);
  assert.equal(valid.calls.users, 1);
  const invalid = app();
  assert.equal((await invalid.callback('/auth/confirm?token_hash=synthetic-hash&type=recovery')).headers.get('location'), `${origin}/login?error=invalid-link`);
  assert.equal(invalid.calls.verifications.length, 0);
});

test('provider availability reads only public settings and fails closed without leaking upstream content', async () => {
  for (const [payload, expected] of [[{ external: { google: true } }, 'enabled'], [{ external: { google: false } }, 'disabled'], [{ error: 'synthetic-private-provider-error' }, 'unavailable']] as const) {
    let requested = false;
    const providers = load('../lib/supabase/providers.ts', { 'server-only': {}, './config': config }, {
      fetch: async (url: URL, init: RequestInit) => {
        requested = true;
        assert.equal(String(url), `${project}/auth/v1/settings`);
        assert.deepEqual(Object.keys(init.headers!), ['apikey']);
        assert.equal((init.headers as Record<string, string>).apikey, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
        assert.equal(init.cache, 'no-store');
        assert.equal(init.redirect, 'error');
        return Response.json(payload);
      },
    });
    assert.equal(await providers.googleSignInAvailability(), expected);
    assert.ok(requested);
  }
  const unavailable = load('../lib/supabase/providers.ts', { 'server-only': {}, './config': config }, { fetch: async () => { throw new Error('synthetic-private-provider-error'); } });
  assert.equal(await unavailable.googleSignInAvailability(), 'unavailable');
});
