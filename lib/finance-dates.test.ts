import fc from "fast-check";

import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  getFinanceDateKey,
  getFinanceMonthKey,
  getUtcRangeBounds,
  parseDateKey,
  zonedMidnightToUtc
} from "./finance-dates";

const TIME_ZONE = "America/Toronto";
const RUNS = { numRuns: 100 };

const EPOCH_DAY_MS = 86_400_000;
const ARB_BASE_DATE = Date.UTC(2020, 0, 1);

/**
 * Any real calendar date across roughly eleven years, wide enough to span many DST
 * transitions. Generated from a day offset rather than fc.date() because fc.date()
 * can emit an Invalid Date unless explicitly constrained.
 */
const dateKeyArb = fc
  .integer({ min: 0, max: 4_017 })
  .map((offset) => new Date(ARB_BASE_DATE + offset * EPOCH_DAY_MS).toISOString().slice(0, 10));

describe("parseDateKey", () => {
  it("returns calendar parts for a valid key", () => {
    expect(parseDateKey("2026-06-17")).toEqual({ year: 2026, month: 6, day: 17 });
  });

  it.each(["2026-6-17", "26-06-17", "2026/06/17", "", "last month", "2026-06-17T00:00:00Z"])(
    "rejects malformed key %s",
    (dateKey) => {
      expect(() => parseDateKey(dateKey)).toThrow(RangeError);
    }
  );

  it.each(["2026-02-30", "2026-13-01", "2025-02-29", "2026-00-10", "2026-06-00"])(
    "rejects non-calendar date %s",
    (dateKey) => {
      expect(() => parseDateKey(dateKey)).toThrow(RangeError);
    }
  );

  it("accepts the leap day in a leap year", () => {
    expect(parseDateKey("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
  });
});

describe("addCalendarDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addCalendarDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addCalendarDays("2026-06-17", 0)).toBe("2026-06-17");
  });

  it("crosses a daylight-saving transition without shifting the calendar date", () => {
    // 2026-03-08 is the spring-forward date in America/Toronto.
    expect(addCalendarDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addCalendarDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("is reversible for any valid date key", () => {
    fc.assert(
      fc.property(dateKeyArb, fc.integer({ min: -400, max: 400 }), (dateKey, days) => {
        expect(addCalendarDays(addCalendarDays(dateKey, days), -days)).toBe(dateKey);
      }),
      RUNS
    );
  });
});

describe("getFinanceDateKey", () => {
  it("uses the finance timezone rather than UTC at the day boundary", () => {
    // 02:00Z on Jan 1 is still 21:00 on Dec 31 in Toronto.
    expect(getFinanceDateKey(new Date("2026-01-01T02:00:00Z"), TIME_ZONE)).toBe("2025-12-31");
    expect(getFinanceDateKey(new Date("2026-01-01T12:00:00Z"), TIME_ZONE)).toBe("2026-01-01");
  });

  it("throws on an invalid date", () => {
    expect(() => getFinanceDateKey(new Date("nonsense"), TIME_ZONE)).toThrow(RangeError);
  });
});

describe("getFinanceMonthKey", () => {
  it("derives the month key from the finance-local date", () => {
    expect(getFinanceMonthKey(new Date("2026-07-01T02:00:00Z"), TIME_ZONE)).toBe("2026-06");
  });
});

describe("zonedMidnightToUtc", () => {
  it("resolves standard time and daylight time offsets", () => {
    // Toronto is UTC-5 in January and UTC-4 in July.
    expect(zonedMidnightToUtc("2026-01-15", TIME_ZONE)).toBe("2026-01-15T05:00:00.000Z");
    expect(zonedMidnightToUtc("2026-07-15", TIME_ZONE)).toBe("2026-07-15T04:00:00.000Z");
  });

  it("resolves the spring-forward transition date", () => {
    // Clocks jump 02:00 -> 03:00 on 2026-03-08. Local midnight is still EST (UTC-5).
    expect(zonedMidnightToUtc("2026-03-08", TIME_ZONE)).toBe("2026-03-08T05:00:00.000Z");
    // The day after the transition is EDT (UTC-4).
    expect(zonedMidnightToUtc("2026-03-09", TIME_ZONE)).toBe("2026-03-09T04:00:00.000Z");
  });

  it("resolves the fall-back transition date", () => {
    // Clocks fall 02:00 -> 01:00 on 2026-11-01. Local midnight is still EDT (UTC-4).
    expect(zonedMidnightToUtc("2026-11-01", TIME_ZONE)).toBe("2026-11-01T04:00:00.000Z");
    // The day after the transition is EST (UTC-5).
    expect(zonedMidnightToUtc("2026-11-02", TIME_ZONE)).toBe("2026-11-02T05:00:00.000Z");
  });

  it("round-trips to the same finance-local date key for any valid date", () => {
    fc.assert(
      fc.property(dateKeyArb, (dateKey) => {
        const midnight = zonedMidnightToUtc(dateKey, TIME_ZONE);
        expect(getFinanceDateKey(new Date(midnight), TIME_ZONE)).toBe(dateKey);
      }),
      RUNS
    );
  });

  it("handles a timezone with a fractional-hour offset", () => {
    expect(zonedMidnightToUtc("2026-06-17", "Asia/Kolkata")).toBe("2026-06-16T18:30:00.000Z");
  });
});

describe("getUtcRangeBounds", () => {
  it("returns a half-open range whose upper bound is the day after the end date", () => {
    expect(getUtcRangeBounds("2026-05-01", "2026-05-31", TIME_ZONE)).toEqual({
      startTimestamp: "2026-05-01T04:00:00.000Z",
      endTimestamp: "2026-06-01T04:00:00.000Z"
    });
  });

  it("covers a single day as a full 24-hour window", () => {
    expect(getUtcRangeBounds("2026-06-17", "2026-06-17", TIME_ZONE)).toEqual({
      startTimestamp: "2026-06-17T04:00:00.000Z",
      endTimestamp: "2026-06-18T04:00:00.000Z"
    });
  });

  it("produces a 23-hour span across spring-forward", () => {
    const bounds = getUtcRangeBounds("2026-03-08", "2026-03-08", TIME_ZONE);
    const hours =
      (Date.parse(bounds.endTimestamp) - Date.parse(bounds.startTimestamp)) / 3_600_000;

    expect(hours).toBe(23);
  });

  it("produces a 25-hour span across fall-back", () => {
    const bounds = getUtcRangeBounds("2026-11-01", "2026-11-01", TIME_ZONE);
    const hours =
      (Date.parse(bounds.endTimestamp) - Date.parse(bounds.startTimestamp)) / 3_600_000;

    expect(hours).toBe(25);
  });

  it("rejects an inverted range", () => {
    expect(() => getUtcRangeBounds("2026-05-31", "2026-05-01", TIME_ZONE)).toThrow(RangeError);
  });

  it("rejects a malformed bound", () => {
    expect(() => getUtcRangeBounds("last month", "2026-05-01", TIME_ZONE)).toThrow(RangeError);
    expect(() => getUtcRangeBounds("2026-05-01", "2026-02-30", TIME_ZONE)).toThrow(RangeError);
  });

  it("always orders the bounds strictly for any valid range", () => {
    fc.assert(
      fc.property(dateKeyArb, fc.integer({ min: 0, max: 365 }), (startDate, span) => {
        const endDate = addCalendarDays(startDate, span);
        const bounds = getUtcRangeBounds(startDate, endDate, TIME_ZONE);

        expect(Date.parse(bounds.startTimestamp)).toBeLessThan(Date.parse(bounds.endTimestamp));
      }),
      RUNS
    );
  });

  it("excludes midnight on the day after the range and includes the last instant before it", () => {
    fc.assert(
      fc.property(dateKeyArb, fc.integer({ min: 0, max: 60 }), (startDate, span) => {
        const endDate = addCalendarDays(startDate, span);
        const bounds = getUtcRangeBounds(startDate, endDate, TIME_ZONE);
        const lastInstant = new Date(Date.parse(bounds.endTimestamp) - 1);

        // The exclusive upper bound belongs to the following day, so a half-open
        // comparison keeps endDate inclusive without leaking the next day in.
        expect(getFinanceDateKey(lastInstant, TIME_ZONE)).toBe(endDate);
        expect(getFinanceDateKey(new Date(bounds.endTimestamp), TIME_ZONE)).toBe(
          addCalendarDays(endDate, 1)
        );
      }),
      RUNS
    );
  });
});
