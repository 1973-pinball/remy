import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { appOrigin, isAllowedEmail } from '@/lib/supabase/config';
import { failure } from '@/lib/http';

export async function GET(request: Request) {
  try {
    const origin = appOrigin(request);
    const params = new URL(request.url).searchParams;
    const supabase = await createClient();
    const code = params.get('code');
    const tokenHash = params.get('token_hash');
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
        const response = NextResponse.redirect(new URL('/', origin));
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        return response;
      }
      await supabase.auth.signOut({ scope: 'local' });
    }
    const response = NextResponse.redirect(new URL('/login?error=invalid-link', origin));
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (error) { return failure(error); }
}
