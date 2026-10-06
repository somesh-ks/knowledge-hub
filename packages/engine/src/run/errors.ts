/** A flag or argument the caller got wrong. The CLI exits 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * A stage that could not finish. The message is one line and written by this engine, so it is
 * safe to print. The CLI exits 1 and leaves state untouched.
 */
export class StageFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageFailure";
  }
}
