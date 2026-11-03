import { authorize, failure, json } from '@/lib/http';
import { runningYearToDate } from '@/lib/running-ytd';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const user = await authorize(request);
    return json(await runningYearToDate(user.userId));
  } catch (error) { return failure(error); }
}
