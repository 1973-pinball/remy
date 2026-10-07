import { authorize, body, failure, json } from '@/lib/http';
import { listAccessRequests, retryAccessNotification } from '@/lib/access-requests';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await authorize(request);
    return json(await listAccessRequests(actor, Number(new URL(request.url).searchParams.get('offset') || 0)));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authorize(request, true);
    const input: unknown = await body(request);
    if (!input || typeof input !== 'object' || !('userId' in input) || typeof input.userId !== 'string') return json({ error: 'Choose an access request to retry.' }, 400);
    return json(await retryAccessNotification(actor, input.userId));
  } catch (error) { return failure(error); }
}
