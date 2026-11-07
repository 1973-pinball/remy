import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { appOrigin, isAllowedEmail } from '@/lib/supabase/config';
import { failure } from '@/lib/http';
import { queueAccessRequest } from '@/lib/access-requests';

function redirect(origin: string, path: string) {
  const response = NextResponse.redirect(new URL(path, origin));
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(request: Request) {
  let origin: string;
  try { origin = appOrigin(request); }
  catch (error) { return failure(error); }

  const url = new URL(request.url);
  const params = url.searchParams;
  const tokenHash = params.get('token_hash');
  const oauth = url.pathname === '/auth/callback' && !tokenHash;
  const failedPath = oauth ? '/login?error=google-failed' : '/login?error=invalid-link';
  try {
    if (params.has('error') || params.has('error_code')) {
      return redirect(origin, oauth && params.get('error') === 'access_denied'
        ? '/login?error=google-cancelled' : failedPath);
    }
    const supabase = await createClient();
    const code = params.get('code');
    let verified = false;
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      verified = !error;
    } else if (tokenHash && params.get('type') === 'email') {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
      verified = !error;
    }
    if (verified) {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!error && user?.email_confirmed_at && isAllowedEmail(user.email)) {
        // Resume only the fixed consent page, never an arbitrary next URL.
        const pending = /(?:^|;\s*)remy-oauth-authorization=([0-9a-f-]{36})(?:;|$)/i.exec(request.headers.get('cookie') ?? '')?.[1];
        const valid = pending && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending);
        const response = redirect(origin, valid ? `/oauth/consent?authorization_id=${pending}` : '/');
        response.cookies.delete('remy-oauth-authorization');
        return response;
      }
      if (oauth && !error && user?.email && user.email_confirmed_at && user.identities?.some(identity => identity.provider === 'google')) {
        try {
          await queueAccessRequest(user);
          return redirect(origin, '/access-pending');
        } catch {
          await supabase.auth.signOut({ scope: 'local' });
          return redirect(origin, '/login?error=access-request-failed');
        }
      }
      await supabase.auth.signOut({ scope: 'local' });
      return redirect(origin, !error && user ? '/login?error=owner-only' : failedPath);
    }
    return redirect(origin, failedPath);
  } catch { return redirect(origin, failedPath); }
}
