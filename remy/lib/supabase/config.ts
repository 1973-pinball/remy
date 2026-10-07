export class SetupError extends Error {
  readonly status = 503;
  readonly setupRequired = true;
}

export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url || !key) throw new SetupError('Private storage is not connected yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then finish the Supabase setup in docs/deployment.md.');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(parsed.hostname))) throw new Error();
  } catch { throw new SetupError('NEXT_PUBLIC_SUPABASE_URL must be your Supabase project URL.'); }
  if (key.startsWith('sb_secret_')) throw new SetupError('Use the Supabase publishable key for NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Keep the secret key server-side.');
  return { url, key };
}

export function allowedEmail() {
  const email = process.env.REMY_ALLOWED_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SetupError('Private access is not configured yet. Set REMY_ALLOWED_EMAIL to your sign-in email in the server environment.');
  return email;
}

export function isAllowedEmail(email: string | undefined | null) {
  return !!email && email.trim().toLowerCase() === allowedEmail();
}

function isLoopback(hostname: string) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

export function appOrigin(request?: Request) {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) throw new Error();
      return url.origin;
    } catch { throw new SetupError('APP_ORIGIN must be the exact HTTPS address of Remy Mux, without a path. Local development may use http://127.0.0.1:5173.'); }
  }
  if (request && !process.env.VERCEL) {
    const url = new URL(request.url);
    if (isLoopback(url.hostname)) return url.origin;
  }
  throw new SetupError('Set APP_ORIGIN to the deployed Remy Mux address before enabling sign-in.');
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== appOrigin(request)) throw Object.assign(new Error('This request must come from your Remy Mux journal.'), { status: 403 });
}

export function authCookieOptions() {
  const origin = process.env.APP_ORIGIN;
  const local = origin ? /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/.test(origin) : !process.env.VERCEL;
  return { httpOnly: true, sameSite: 'lax' as const, secure: !local, path: '/' };
}

export function authSetupMessage() {
  try {
    publicSupabaseConfig();
    allowedEmail();
    if (process.env.VERCEL) appOrigin();
    return null;
  } catch (error) { return error instanceof Error ? error.message : 'Finish the private storage setup in docs/deployment.md.'; }
}
