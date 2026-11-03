import { authorize, failure } from '@/lib/http';
import { getEntry, operationGuard, readMealPhoto } from '@/lib/store';
import { assertMealPhotoPath } from '@/lib/meal-photo';

export const runtime = 'nodejs';
const missing = () => Object.assign(new Error('This meal photo is not available.'), { status: 404 });
export async function GET(request: Request) {
  try {
    const user = await authorize(request);
    const guard = await operationGuard(user.userId);
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !/^[A-Za-z0-9:_-]{1,180}$/.test(id)) throw missing();
    const entry = await getEntry(user.userId, id);
    if (!entry || entry.deleted || entry.kind !== 'meal' || typeof entry.data.photoId !== 'string') throw missing();
    const path = assertMealPhotoPath(user.userId, entry.data.photoId);
    if (Number(path.split('/')[1]) !== guard.generation) throw missing();
    const photo = await readMealPhoto(user.userId, path);
    const [after, current] = await Promise.all([operationGuard(user.userId), getEntry(user.userId, id)]);
    if (after.generation !== guard.generation || !current || current.deleted || current.kind !== 'meal' || current.data.photoId !== path) throw missing();
    const mime = path.endsWith('.jpg') ? 'image/jpeg' : path.endsWith('.png') ? 'image/png' : 'image/webp';
    return new Response(photo, { headers: { 'Content-Type': mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  } catch (error) { return failure(error); }
}
