import 'server-only';
import { publicSupabaseConfig } from './config';

export type GoogleSignInAvailability = 'enabled' | 'disabled' | 'unavailable';

// Supabase's public settings expose provider availability, never client secrets.
export async function googleSignInAvailability(): Promise<GoogleSignInAvailability> {
  try {
    const { url, key } = publicSupabaseConfig();
    const response = await fetch(new URL('/auth/v1/settings', url), {
      headers: { apikey: key },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return 'unavailable';
    const settings = await response.json();
    if (settings?.external?.google === true) return 'enabled';
    return settings?.external?.google === false ? 'disabled' : 'unavailable';
  } catch { return 'unavailable'; }
}
