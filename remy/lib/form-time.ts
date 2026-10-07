import { zonedInstant } from "./domain";

export function localClock(instant: string | null | undefined, zone: string) {
  if (!instant) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

// Keep the exact original instant (including seconds and DST offset) when a
// correction changes nutrition without changing the displayed date or time.
export function formInstant(
  date: string,
  time: string,
  zone: string,
  previousDate?: string | null,
  previous?: string | null,
) {
  if (!time) return null;
  if (previous && date === previousDate && time === localClock(previous, zone))
    return previous;
  return zonedInstant(`${date}T${time}:00`, zone);
}
