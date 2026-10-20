import { authorize, body, json, failure } from '@/lib/http';
import * as store from '@/lib/store';
import { coachRequestSchema, generateCoach } from '@/lib/coach-model';
import { sendCoach } from '@/lib/coach-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    await authorize(request);
    return json({ available: !!process.env.OPENAI_API_KEY?.trim() });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await authorize(request, true);
    const guard = await store.operationGuard(user.userId);
    const input = coachRequestSchema.parse(await body(request));
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw Object.assign(new Error('The AI coach needs its secure server key. Food logging and your journal remain available.'), { status: 503 });
    return json(await sendCoach(user.userId, input, guard, store, (message, context) =>
      generateCoach(message, context, { apiKey, model: process.env.OPENAI_MODEL })));
  } catch (error) { return failure(error); }
}
