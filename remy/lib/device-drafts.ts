export function ownedDeviceDrafts(drafts: any[], ownerId: string | null) {
  return ownerId ? drafts.filter((draft) => draft?.ownerId === ownerId) : [];
}

export function claimUnassignedDeviceDrafts(drafts: any[], ownerId: string | null) {
  if (!ownerId) throw new Error("Sign in before claiming drafts created on this device.");
  return drafts.map((draft) => draft && draft.ownerId == null ? { ...draft, ownerId } : draft);
}
