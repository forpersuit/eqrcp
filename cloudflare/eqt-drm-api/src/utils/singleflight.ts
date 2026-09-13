/**
 * SingleFlight request coalescing utility.
 * Suppresses duplicate concurrent executions of identical operations.
 *
 * Modeled after Go's golang.org/x/sync/singleflight pattern, adapted
 * for TypeScript and Cloudflare Workers runtime.
 */

export interface FlightResult<T> {
  result: T;
  shared: boolean;
}

export class SingleFlightGroup<T = any, C = any> {
  private flights = new Map<
    string,
    {
      promise: Promise<{ result: T; shared: boolean }>;
      context?: C;
    }
  >();

  /**
   * Executes and returns the result of the given async function, ensuring that
   * only one execution is in-flight for a given key at any moment.
   *
   * If a duplicate request with the same key arrives while an operation is already
   * in progress:
   *   1. If `onConflict` is provided and returns an Error, the conflicting caller is rejected immediately.
   *   2. Otherwise, the caller awaits the ongoing operation and receives its result with `shared: true`.
   *
   * When the in-flight function finishes (either resolve or reject), the flight entry is
   * removed, and any subsequent calls will trigger a fresh execution.
   */
  async do(
    key: string,
    fn: () => Promise<T>,
    context?: C,
    onConflict?: (existingContext: C | undefined, incomingContext: C | undefined) => Error | void
  ): Promise<FlightResult<T>> {
    const existing = this.flights.get(key);
    if (existing) {
      if (onConflict) {
        const conflictErr = onConflict(existing.context, context);
        if (conflictErr) {
          throw conflictErr;
        }
      }
      const res = await existing.promise;
      return { result: res.result, shared: true };
    }

    let resolvePromise!: (val: { result: T; shared: boolean }) => void;
    let rejectPromise!: (err: any) => void;

    const promise = new Promise<{ result: T; shared: boolean }>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    this.flights.set(key, { promise, context });

    try {
      const val = await fn();
      const output = { result: val, shared: false };
      resolvePromise(output);
      return output;
    } catch (err) {
      rejectPromise(err);
      throw err;
    } finally {
      this.flights.delete(key);
    }
  }

  /**
   * Returns whether a flight with the given key is currently active.
   */
  has(key: string): boolean {
    return this.flights.has(key);
  }

  /**
   * Returns current active flight keys.
   */
  activeKeys(): string[] {
    return Array.from(this.flights.keys());
  }

  /**
   * Returns active flight count.
   */
  activeCount(): number {
    return this.flights.size;
  }

  /**
   * Clears all flights (used in tests and teardowns).
   */
  clear(): void {
    this.flights.clear();
  }
}
