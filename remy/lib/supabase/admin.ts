import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { SetupError } from './config';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) throw new SetupError('Private storage is not connected yet. Configure the Supabase project URL and server-only SUPABASE_SECRET_KEY, then apply the database migration in docs/deployment.md.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
