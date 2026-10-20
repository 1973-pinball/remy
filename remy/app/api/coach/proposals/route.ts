import { authorize, body, json, failure } from '@/lib/http';
import * as store from '@/lib/store';
import { coachDecisionSchema, decideCoach } from '@/lib/coach-service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await authorize(request, true);
    const guard = await store.operationGuard(user.userId);
    const input = coachDecisionSchema.parse(await body(request));
    return json(await decideCoach(user.userId, input, guard, store));
  } catch (error) { return failure(error); }
}
