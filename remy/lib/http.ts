import { createClient } from '@/lib/supabase/server';
import { allowedEmail, assertSameOrigin, isAllowedEmail } from '@/lib/supabase/config';

export type AuthorizedUser = { userId: string; email: string; fullName: string | null };

export async function authorize(request: Request, write = false): Promise<AuthorizedUser> {
  allowedEmail();
  const supabase = await createClient();
  if (write) assertSameOrigin(request);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw Object.assign(new Error('Sign in to use your private journal.'), { status: 401 });
  const user = data.user;
  if (!user.email_confirmed_at || !isAllowedEmail(user.email)) throw Object.assign(new Error('This Remy journal is private to its owner.'), { status: 403 });
  return { userId: user.id, email: user.email!, fullName: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null };
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export function failure(error: unknown) {
  const e = error as Error & { status?: number; setupRequired?: boolean };
  if (e?.name === 'ZodError') return json({ error: 'Check the form values. ' + e.message.slice(0, 350) }, 400);
  return json({ error: e?.message ?? 'The request could not be completed.', ...(e?.setupRequired ? { setupRequired: true } : {}) }, e?.status ?? 400);
}

export async function body(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 2_000_000) throw Object.assign(new Error('Request too large.'), { status: 413 });
  const text = await request.text();
  if (text.length > 2_000_000) throw Object.assign(new Error('Request too large.'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Send valid JSON.'), { status: 400 }); }
}
