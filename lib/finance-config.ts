export const DEFAULT_FINANCE_TIMEZONE = "America/Toronto";
export const DEFAULT_REVIEW_THRESHOLD = 0.7;

export class FinanceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceConfigurationError";
  }
}

export type FinanceEnvironment = Readonly<Record<string, string | undefined>>;

export interface FinanceConfig {
  readonly financeTimezone: string;
  readonly reviewThreshold: number;
}

/**
 * Parses server-side finance environment values into validated dashboard settings.
 *
 * @param environment - Environment values to parse; defaults to the process environment.
 * @returns A valid finance timezone and review threshold.
 * @throws FinanceConfigurationError when a supplied setting is invalid.
 */
export function getFinanceConfig(
  environment: FinanceEnvironment = process.env
): FinanceConfig {
  const rawTimezone = environment.FINANCE_TIMEZONE;
  const financeTimezone =
    rawTimezone === undefined ? DEFAULT_FINANCE_TIMEZONE : rawTimezone.trim();

  if (!financeTimezone) {
    throw new FinanceConfigurationError(
      "FINANCE_TIMEZONE must be a valid IANA timezone, such as America/Toronto."
    );
  }

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: financeTimezone }).format();
  } catch {
    throw new FinanceConfigurationError(
      "FINANCE_TIMEZONE must be a valid IANA timezone, such as America/Toronto."
    );
  }

  const rawThreshold = environment.REVIEW_THRESHOLD;
  if (rawThreshold !== undefined && !rawThreshold.trim()) {
    throw new FinanceConfigurationError(
      "REVIEW_THRESHOLD must be a finite number from 0 through 1."
    );
  }

  const reviewThreshold = Number(
    rawThreshold === undefined ? DEFAULT_REVIEW_THRESHOLD : rawThreshold.trim()
  );
  if (!Number.isFinite(reviewThreshold) || reviewThreshold < 0 || reviewThreshold > 1) {
    throw new FinanceConfigurationError(
      "REVIEW_THRESHOLD must be a finite number from 0 through 1."
    );
  }

  return { financeTimezone, reviewThreshold };
}
