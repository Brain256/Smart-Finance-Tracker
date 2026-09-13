/**
 * Shared finance-timezone date primitives.
 *
 * Every date boundary in the project is a *finance-local* calendar boundary, not a
 * UTC or browser-local one. These helpers were previously duplicated as module-private
 * functions in `lib/dashboard-data.ts` and `lib/finance-analytics.ts`; they live here so
 * the dashboard read path, the analytics layer, and the chat tool layer all derive
 * identical boundaries from identical logic.
 */

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a YYYY-MM-DD key into its calendar parts.
 *
 * @param dateKey - Candidate finance-local date key.
 * @returns The year, month (1-12), and day components.
 * @throws RangeError when the key is malformed or is not a real calendar date,
 *   such as 2026-02-30.
 */
export function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    throw new RangeError("Date keys must use YYYY-MM-DD.");
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError("Date key is not a calendar date.");
  }

  return { year, month, day };
}

/**
 * Shifts a date key by whole days without crossing a browser-local boundary.
 *
 * @param dateKey - Finance-local date key to shift.
 * @param days - Signed day offset.
 * @returns The shifted YYYY-MM-DD key.
 * @throws RangeError when dateKey is not a valid calendar date.
 */
export function addCalendarDays(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const result = new Date(Date.UTC(year, month - 1, day));
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/**
 * Extracts calendar parts for an instant as observed in a specific timezone.
 *
 * @param date - Instant to inspect.
 * @param timeZone - IANA timezone name.
 * @returns Zero-padded year, month, and day values.
 * @throws RangeError when the date is invalid.
 */
function getDateParts(date: Date, timeZone: string): Record<string, string> {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Date must be valid.");
  }

  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

/**
 * Returns the YYYY-MM-DD key for an instant in the configured finance timezone.
 *
 * @param date - Instant to convert.
 * @param timeZone - IANA timezone name.
 * @returns The finance-local date key.
 * @throws RangeError when the date is invalid.
 */
export function getFinanceDateKey(date: Date, timeZone: string): string {
  const parts = getDateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Returns the YYYY-MM key for an instant in the configured finance timezone.
 *
 * @param date - Instant to convert.
 * @param timeZone - IANA timezone name.
 * @returns The finance-local month key.
 * @throws RangeError when the date is invalid.
 */
export function getFinanceMonthKey(date: Date, timeZone: string): string {
  return getFinanceDateKey(date, timeZone).slice(0, 7);
}

/**
 * Measures a timezone's UTC offset at a specific instant.
 *
 * @param instant - Instant to measure at, which determines whether daylight saving
 *   time is in effect.
 * @param timeZone - IANA timezone name.
 * @returns Offset in milliseconds, positive east of UTC.
 */
function getTimeZoneOffsetMilliseconds(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return (
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second)
    ) - instant.getTime()
  );
}

/**
 * Converts finance-local midnight on a date key to its UTC instant.
 *
 * The offset is measured twice on purpose. A timezone's offset depends on the instant
 * being measured, so the first measurement (taken at the UTC guess) can land on the
 * wrong side of a daylight-saving transition. Re-measuring at the corrected candidate
 * resolves the boundary case.
 *
 * @param dateKey - Finance-local date key.
 * @param timeZone - IANA timezone name.
 * @returns ISO 8601 timestamp for local midnight on that date.
 * @throws RangeError when dateKey is not a valid calendar date.
 */
export function zonedMidnightToUtc(dateKey: string, timeZone: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  const utcGuess = new Date(Date.UTC(year, month - 1, day));
  const initialOffset = getTimeZoneOffsetMilliseconds(utcGuess, timeZone);
  const candidate = new Date(utcGuess.getTime() - initialOffset);
  const correctedOffset = getTimeZoneOffsetMilliseconds(candidate, timeZone);

  return new Date(utcGuess.getTime() - correctedOffset).toISOString();
}

export type UtcRangeBounds = {
  /** Inclusive lower bound: finance-local midnight on the start date. */
  startTimestamp: string;
  /** Exclusive upper bound: finance-local midnight on the day after the end date. */
  endTimestamp: string;
};

/**
 * Converts an inclusive finance-local date range to half-open UTC timestamp bounds.
 *
 * The returned range is `[startTimestamp, endTimestamp)`. The upper bound is the start
 * of the day *after* `endDate`, which is what makes the caller's `endDate` inclusive
 * while still allowing a strict `<` comparison. Query callers must therefore pair these
 * with `.gte(startTimestamp)` and `.lt(endTimestamp)` — using `.lte(endTimestamp)` would
 * wrongly include transactions at exactly midnight on the following day.
 *
 * @param startDate - Inclusive finance-local start date key.
 * @param endDate - Inclusive finance-local end date key.
 * @param timeZone - IANA timezone name.
 * @returns Half-open UTC bounds covering every instant in the local range.
 * @throws RangeError when either key is not a calendar date, or when the range is inverted.
 */
export function getUtcRangeBounds(
  startDate: string,
  endDate: string,
  timeZone: string
): UtcRangeBounds {
  parseDateKey(startDate);
  parseDateKey(endDate);

  if (startDate > endDate) {
    throw new RangeError("The start date must be on or before the end date.");
  }

  return {
    startTimestamp: zonedMidnightToUtc(startDate, timeZone),
    endTimestamp: zonedMidnightToUtc(addCalendarDays(endDate, 1), timeZone)
  };
}
