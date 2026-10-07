import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { allowedEmail, appOrigin, assertSameOrigin, publicSupabaseConfig } from '@/lib/supabase/config';
import { googleSignInAvailability } from '@/lib/supabase/providers';
import { failure } from '@/lib/http';

function redirect(location: URL | string) {
  const response = NextResponse.redirect(location, 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function POST(request: Request) {
  let origin: string;
  try {
    assertSameOrigin(request);
    origin = appOrigin(request);
  } catch (error) { return failure(error); }

  try {
    allowedEmail();
    if (await googleSignInAvailability() !== 'enabled') {
      return redirect(new URL('/login?error=google-unavailable', origin));
    }
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/auth/callback`,
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error || !data.url) return redirect(new URL('/login?error=google-unavailable', origin));
    // Redirect only to this project's authorization endpoint, never a request URL.
    const destination = new URL(data.url);
    const project = new URL(publicSupabaseConfig().url);
    if (destination.origin !== project.origin || destination.pathname !== '/auth/v1/authorize' || destination.username || destination.password) {
      return redirect(new URL('/login?error=google-unavailable', origin));
    }
    return redirect(destination);
  } catch {
    return redirect(new URL('/login?error=google-unavailable', origin));
  }
}
