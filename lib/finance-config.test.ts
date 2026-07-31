import { describe, expect, it } from "vitest";

import {
  DEFAULT_FINANCE_TIMEZONE,
  DEFAULT_REVIEW_THRESHOLD,
  FinanceConfigurationError,
  getFinanceConfig
} from "./finance-config";

describe("getFinanceConfig", () => {
  it("uses documented defaults when finance settings are absent", () => {
    expect(getFinanceConfig({})).toEqual({
      financeTimezone: DEFAULT_FINANCE_TIMEZONE,
      reviewThreshold: DEFAULT_REVIEW_THRESHOLD
    });
  });

  it("accepts valid server-side timezone and threshold values", () => {
    expect(
      getFinanceConfig({
        FINANCE_TIMEZONE: "Europe/London",
        REVIEW_THRESHOLD: "0"
      })
    ).toEqual({ financeTimezone: "Europe/London", reviewThreshold: 0 });
  });

  it.each(["", "Not/AZone"])("rejects invalid timezone %s", timezone => {
    expect(() => getFinanceConfig({ FINANCE_TIMEZONE: timezone })).toThrow(
      FinanceConfigurationError
    );
    expect(() => getFinanceConfig({ FINANCE_TIMEZONE: timezone })).toThrow(
      "FINANCE_TIMEZONE"
    );
  });

  it.each(["", "-0.01", "1.01", "NaN", "Infinity", "invalid"])(
    "rejects invalid threshold %s",
    threshold => {
      expect(() => getFinanceConfig({ REVIEW_THRESHOLD: threshold })).toThrow(
        FinanceConfigurationError
      );
      expect(() => getFinanceConfig({ REVIEW_THRESHOLD: threshold })).toThrow(
        "REVIEW_THRESHOLD"
      );
    }
  );
});
