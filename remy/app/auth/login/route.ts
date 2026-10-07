import { body, failure, json } from '@/lib/http';
import { appOrigin, assertSameOrigin, isAllowedEmail } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = await body(request);
    const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
    const supabase = await createClient();
    // Give the same success response for an unlisted address without sending it a link.
    if (!isAllowedEmail(email)) return json({ sent: true });
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { shouldCreateUser: false, emailRedirectTo: `${appOrigin(request)}/auth/confirm` },
    });
    if (error) {
      if (error.status === 429) return json({ error: 'Please wait before requesting another link. Supabase limits how frequently sign-in emails can be sent.' }, 429);
      return json({ error: 'The sign-in email could not be sent. Check that the owner Auth account exists and email delivery is configured in Supabase. See docs/deployment.md.' }, 503);
    }
    return json({ sent: true });
  } catch (error) { return failure(error); }
}
