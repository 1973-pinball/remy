'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AccessRequestSummary } from '@/lib/access-requests';

export function notificationText(request: AccessRequestSummary) {
  if (request.notification === 'sent') return 'Submitted to email service';
  if (request.notification === 'sending') return 'Notification in progress';
  if (request.notification === 'review') return request.reason === 'configuration_changed' ? 'Review needed: mail settings changed after an attempt' : request.reason === 'retry_limit' ? 'Review needed: retry limit reached' : 'Review needed: safe retry window expired';
  if (request.reason === 'unconfigured') return 'Queued: initial notification not sent';
  if (request.reason === 'rate_limited') return 'Queued: notification rate limit';
  if (request.reason === 'delivery_failed') return 'Queued: email service rejected the attempt';
  if (request.reason === 'delivery_unknown') return 'Queued: previous delivery result is unknown';
  return 'Queued for notification';
}

export default function RequestList({ requests, emailConfigured }: { requests: AccessRequestSummary[]; emailConfigured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  async function retry(userId: string) {
    setBusy(userId); setMessage('');
    try {
      const response = await fetch('/api/access-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      if (!response.ok) throw new Error();
      const result = await response.json() as { request: AccessRequestSummary; emailConfigured: boolean };
      setMessage(result.emailConfigured ? notificationText(result.request) : 'The request remains queued until email setup is complete.');
      router.refresh();
    } catch { setMessage('The notification could not be retried. Refresh and try again.'); }
    finally { setBusy(null); }
  }
  return <div style={{ display: 'grid', gap: 16 }}>
    {message && <p role="status">{message}</p>}
    {!requests.length && <p>No access requests yet.</p>}
    {requests.map(request => <article className="card" key={request.userId} style={{ overflowWrap: 'anywhere' }}>
      <h2 style={{ fontSize: 18, margin: '0 0 6px' }}>{request.name || 'Google account'}</h2>
      <p style={{ margin: '0 0 8px' }}>{request.email}</p>
      <p style={{ fontSize: 13, color: '#64716a' }}>Requested {new Date(request.requestedAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC · Access pending</p>
      <p>{notificationText(request)}</p>
      {request.notification === 'review' && <p style={{ fontSize: 13, lineHeight: 1.6 }}>Check the Resend dashboard before taking further action. Another automatic attempt is disabled to avoid duplicate mail. The request remains available here.</p>}
      {request.notification === 'queued' && <>
        <button className="quiet-button" disabled={!emailConfigured || !request.canRetry || busy !== null} onClick={() => retry(request.userId)}>{busy === request.userId ? 'Retrying…' : 'Retry notification'}</button>
        {emailConfigured && !request.canRetry && request.retryAt && <p style={{ fontSize: 13 }}>Retry is available after {new Date(request.retryAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC. Refresh to check.</p>}
      </>}
    </article>)}
  </div>;
}
