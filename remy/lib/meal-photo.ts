/** Photos are addressed by owner + journal generation, never by a public URL. */
export function assertMealPhotoPath(owner: string, path: string) {
  const match = /^([0-9a-f-]{36})\/(\d+)\/meal-photos\/([0-9a-f-]{36})-([0-5])\.(jpg|png|webp)$/i.exec(path);
  if (!match || match[1] !== owner) throw new Error('This meal photo is not available.');
  return path;
}
