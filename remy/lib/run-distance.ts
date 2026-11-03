export const METERS_PER_MILE = 1609.344;
export const milesFromMeters = (meters: number) => meters / METERS_PER_MILE;

export function milesInputValue(meters: number | null | undefined) {
  return meters == null ? '' : milesFromMeters(meters).toFixed(2);
}

/** Keep source precision when a form's displayed distance has not changed. */
export function metersFromMilesInput(value: string, originalMeters?: number | null) {
  const input = value.trim();
  if (!input) return null;
  if (originalMeters != null && input === milesInputValue(originalMeters)) return originalMeters;
  const miles = Number(input);
  if (!Number.isFinite(miles) || miles < 0) throw new Error('Enter a valid distance in miles.');
  return miles * METERS_PER_MILE;
}
