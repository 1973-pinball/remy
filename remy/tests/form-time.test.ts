import test from "node:test";
import assert from "node:assert/strict";
import { formInstant, localClock } from "../lib/form-time";

test("nutrition-only correction preserves an original instant in a repeated DST hour", () => {
  const original = "2026-11-01T06:30:27.123Z";
  const clock = localClock(original, "America/New_York");
  assert.equal(clock, "01:30");
  assert.equal(
    formInstant(
      "2026-11-01",
      clock,
      "America/New_York",
      "2026-11-01",
      original,
    ),
    original,
  );
});
test("moving a meal uses the new local day and clearing time preserves unknown", () => {
  const original = "2026-10-06T22:30:00Z";
  assert.equal(
    formInstant(
      "2026-10-05",
      "18:30",
      "America/New_York",
      "2026-10-06",
      original,
    ),
    "2026-10-05T22:30:00.000Z",
  );
  assert.equal(
    formInstant("2026-10-06", "", "America/New_York", "2026-10-06", original),
    null,
  );
});
