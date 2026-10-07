import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { appOrigin, isAllowedEmail } from '@/lib/supabase/config';
import type { AuthorizedUser } from '@/lib/http';

export type VerifiedAccessUser = {
  id: string; email?: string | null; email_confirmed_at?: string | null;
  identities?: { provider: string }[]; user_metadata?: Record<string, unknown>;
};
type NotificationStatus = 'queued' | 'sending' | 'sent' | 'review';
type RequestRow = {
  user_id: string; email: string; display_name: string | null; requested_at: string;
  notification_status: NotificationStatus; notification_reason: string | null;
  notified_at: string | null; attempts: number; next_attempt_at: string | null;
  first_attempt_at: string | null; lease_expires_at: string | null; notification_payload?: MailPayload;
};
type MailPayload = { from: string; to: string[]; subject: string; text: string };
export type AccessRequestSummary = {
  userId: string; email: string; name: string | null; requestedAt: string;
  notification: NotificationStatus; reason: string | null; notifiedAt: string | null;
  attempts: number; retryAt: string | null; canRetry: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const email = /^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/;
const safeColumns = 'user_id,email,display_name,requested_at,notification_status,notification_reason,notified_at,attempts,next_attempt_at,first_attempt_at,lease_expires_at';
const unavailable = () => Object.assign(new Error('Access requests are temporarily unavailable. Please try again.'), { status: 503 });

function requester(user: VerifiedAccessUser) {
  const address = user.email?.trim().toLowerCase();
  if (!uuid.test(user.id) || !address || address.length > 254 || !email.test(address) || !user.email_confirmed_at ||
    !user.identities?.some(identity => identity.provider === 'google') || isAllowedEmail(address)) {
    throw Object.assign(new Error('A verified Google account is required to request access.'), { status: 403 });
  }
  const rawName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  const name = typeof rawName === 'string' ? rawName.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  return { userId: user.id, email: address, name: name || null };
}

function requireOwner(actor: AuthorizedUser) {
  if (!uuid.test(actor.userId) || !isAllowedEmail(actor.email)) throw Object.assign(new Error('Only the journal owner can view access requests.'), { status: 403 });
}

function mailConfig() {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.ACCESS_REQUEST_FROM_EMAIL?.trim();
  const to = process.env.ACCESS_REQUEST_TO_EMAIL?.trim();
  // Use plain mailbox addresses, never user-supplied headers or an owner-email fallback.
  if (!key || !from || !to || from.length > 254 || to.length > 254 || !email.test(from) || !email.test(to)) return null;
  try { return { key, from, to, origin: appOrigin() }; } catch { return null; }
}

export function accessNotificationConfigured() { return mailConfig() !== null; }

function summary(row: RequestRow): AccessRequestSummary {
  const now = Date.now();
  const expired = row.first_attempt_at !== null && Date.parse(row.first_attempt_at) <= now - 23 * 60 * 60 * 1000;
  const activeLease = row.lease_expires_at !== null && Date.parse(row.lease_expires_at) > now;
  const exhausted = row.attempts >= 3;
  const needsReview = row.notification_status !== 'sent' && !activeLease && (expired || exhausted);
  const notification = needsReview ? 'review' : row.notification_status === 'sending' && !activeLease ? 'queued' : row.notification_status;
  return {
    userId: row.user_id, email: row.email, name: row.display_name, requestedAt: row.requested_at,
    notification, reason: needsReview ? (expired ? 'idempotency_expired' : 'retry_limit') : row.notification_reason,
    notifiedAt: row.notified_at, attempts: row.attempts, retryAt: row.next_attempt_at,
    canRetry: notification === 'queued' && !activeLease && (!row.next_attempt_at || Date.parse(row.next_attempt_at) <= now),
  };
}

async function readRequest(userId: string): Promise<RequestRow | null> {
  const { data, error } = await createAdminClient().from('remy_access_requests').select(safeColumns).eq('user_id', userId).maybeSingle();
  if (error) throw unavailable();
  return data as RequestRow | null;
}

async function notify(row: RequestRow): Promise<'sent' | 'queued'> {
  if (row.notification_status === 'sent') return 'sent';
  const config = mailConfig();
  if (!config) return 'queued';
  const payload: MailPayload = {
    from: config.from, to: [config.to], subject: 'New Remy Mux access request',
    text: `A verified Google account requested access to Remy Mux.\n\nEmail: ${row.email}\nName: ${row.display_name || 'Not provided'}\nRequested: ${row.requested_at}\n\nReview requests: ${config.origin}/access-requests\n\nThis request has not granted access to the private journal.`,
  };
  const token = randomUUID();
  try {
    const db = createAdminClient();
    const claimed = await db.rpc('remy_claim_access_notification', { p_user: row.user_id, p_token: token, p_payload: payload });
    if (claimed.error || !claimed.data) return 'queued';
    const claim = claimed.data as { claimed: boolean; request: RequestRow };
    if (!claim.claimed) return claim.request.notification_status === 'sent' ? 'sent' : 'queued';
    const first = Date.parse(claim.request.first_attempt_at!);
    // Recheck the lease/window immediately before I/O in case execution was suspended.
    if (!Number.isFinite(first) || first <= Date.now() - 23 * 60 * 60 * 1000 || Date.parse(claim.request.lease_expires_at!) <= Date.now()) return 'queued';
    let messageId: string | null = null;
    let reason = 'delivery_unknown';
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000),
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `remy-access/${row.user_id}` },
        body: JSON.stringify(claim.request.notification_payload),
      });
      if (response.ok) {
        const result: unknown = await response.json();
        if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string' && uuid.test(result.id)) messageId = result.id;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 409 && response.status !== 408) reason = 'delivery_failed';
    } catch { /* Keep ambiguous results retryable only within the idempotency window. */ }
    const finished = await db.rpc('remy_finish_access_notification', { p_user: row.user_id, p_token: token, p_message_id: messageId, p_reason: messageId ? null : reason });
    return messageId && !finished.error ? 'sent' : 'queued';
  } catch { return 'queued'; }
}

/** Caller must supply the User returned by a fresh Supabase auth.getUser(). */
export async function queueAccessRequest(user: VerifiedAccessUser): Promise<{ status: 'pending'; notification: 'sent' | 'queued' }> {
  const identity = requester(user);
  const { data, error } = await createAdminClient().rpc('remy_queue_access_request', { p_user: identity.userId, p_email: identity.email, p_name: identity.name });
  if (error || !data) throw unavailable();
  return { status: 'pending', notification: await notify(data as RequestRow) };
}

/** Narrow DTO: a requester can learn only their own pending/notification state. */
export async function ownAccessRequest(user: VerifiedAccessUser) {
  const identity = requester(user);
  const { data, error } = await createAdminClient().from('remy_access_requests').select('requested_at,notification_status').eq('user_id', identity.userId).maybeSingle();
  if (error) throw unavailable();
  return data ? { status: 'pending' as const, notification: data.notification_status === 'sent' ? 'sent' as const : 'queued' as const, requestedAt: data.requested_at as string } : null;
}

export async function listAccessRequests(actor: AuthorizedUser, offset = 0) {
  requireOwner(actor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw Object.assign(new Error('Invalid request page.'), { status: 400 });
  const { data, error, count } = await createAdminClient().from('remy_access_requests').select(safeColumns, { count: 'exact' }).order('requested_at', { ascending: false }).order('user_id', { ascending: true }).range(offset, offset + 49);
  if (error) throw unavailable();
  return { requests: ((data || []) as RequestRow[]).map(summary), total: count || 0, offset, hasMore: offset + 50 < (count || 0), emailConfigured: accessNotificationConfigured() };
}

export async function retryAccessNotification(actor: AuthorizedUser, userId: string) {
  requireOwner(actor);
  if (!uuid.test(userId)) throw Object.assign(new Error('Invalid access request.'), { status: 400 });
  const row = await readRequest(userId);
  if (!row) throw Object.assign(new Error('Access request not found.'), { status: 404 });
  await notify(row);
  return { request: summary((await readRequest(userId)) || row), emailConfigured: accessNotificationConfigured() };
}
