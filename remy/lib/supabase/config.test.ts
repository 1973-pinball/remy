import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedEmail, appOrigin, assertSameOrigin, authCookieOptions, isAllowedEmail, publicSupabaseConfig, SetupError } from './config';

test('private access requires an explicit exact email allowlist', () => {
  const before = process.env.REMY_ALLOWED_EMAIL;
  try {
    delete process.env.REMY_ALLOWED_EMAIL;
    assert.throws(() => allowedEmail(), SetupError);
    process.env.REMY_ALLOWED_EMAIL = ' Owner@example.com ';
    assert.equal(isAllowedEmail('owner@example.com'), true);
    assert.equal(isAllowedEmail('OWNER@EXAMPLE.COM'), true);
    assert.equal(isAllowedEmail('other@example.com'), false);
    assert.equal(isAllowedEmail('owner@example.com.attacker.invalid'), false);
    assert.equal(isAllowedEmail(null), false);
  } finally {
    if (before === undefined) delete process.env.REMY_ALLOWED_EMAIL;
    else process.env.REMY_ALLOWED_EMAIL = before;
  }
});

test('writes require the canonical origin and redirects never use a supplied path', () => {
  const before = process.env.APP_ORIGIN;
  try {
    process.env.APP_ORIGIN = 'https://remy.example.com';
    const target = 'https://internal.example.com/api/journal';
    assert.doesNotThrow(() => assertSameOrigin(new Request(target, { headers: { origin: 'https://remy.example.com' } })));
    assert.throws(() => assertSameOrigin(new Request(target)), /must come from/);
    assert.throws(() => assertSameOrigin(new Request(target, { headers: { origin: 'https://other.example.com' } })), /must come from/);
    assert.equal(appOrigin(new Request('https://untrusted.example.com/?next=https://attacker.invalid')), 'https://remy.example.com');
    process.env.APP_ORIGIN = 'https://remy.example.com/login?next=https://attacker.invalid';
    assert.throws(() => appOrigin(), SetupError);
  } finally {
    if (before === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = before;
  }
});

test('missing Supabase config fails closed and public keys reject server secrets', () => {
  const keys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;
  const before = keys.map(key => process.env[key]);
  try {
    keys.forEach(key => delete process.env[key]);
    assert.throws(() => publicSupabaseConfig(), SetupError);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_secret_not_a_real_key';
    assert.throws(() => publicSupabaseConfig(), /publishable key/);
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_not_a_real_key';
    assert.equal(publicSupabaseConfig().url, 'https://project.supabase.co');
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://remote.example.com';
    assert.throws(() => publicSupabaseConfig(), SetupError);
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
  }
});

test('session cookies are http-only and secure on the deployed origin', () => {
  const before = process.env.APP_ORIGIN;
  try {
    process.env.APP_ORIGIN = 'https://remy.example.com';
    assert.deepEqual(authCookieOptions(), { httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
    process.env.APP_ORIGIN = 'http://127.0.0.1:5173';
    assert.equal(authCookieOptions().secure, false);
  } finally {
    if (before === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = before;
  }
});
