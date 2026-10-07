import { failure, json } from '@/lib/http';
import { assertSameOrigin } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) return json({ error: 'Could not sign out. Please retry.' }, 503);
    return json({ signedOut: true });
  } catch (error) { return failure(error); }
}
