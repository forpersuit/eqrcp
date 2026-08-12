import { Env } from '../types';

export interface D1RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (err: any, attempt: number, delayMs: number) => void;
}

/**
 * Checks if a D1 error is transient and safe to retry with backoff.
 * Non-retryable SQLite errors (constraints, syntax) fail fast.
 */
export function isRetryableD1Error(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.toString() || '');
  const cause = err.cause ? String(err.cause.message || err.cause) : '';
  const combined = `${msg} ${cause}`;

  // Non-retryable SQLite constraints and logical errors
  if (/UNIQUE constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed|CHECK constraint failed|syntax error|no such column|no such table/i.test(combined)) {
    return false;
  }

  // Transient D1 storage, network, and timeout errors
  return /exceeded timeout|object to be reset|storage.*reset|D1_RESET|network connection lost|connection reset|fetch failed|database is locked|sqlite_busy|temporarily unavailable|D1_ERROR.*timeout|D1_NETWORK/i.test(combined);
}

/**
 * Executes an async D1 operation with lightweight exponential backoff retry for transient errors.
 */
export async function withD1Retry<T>(
  operation: () => Promise<T>,
  options: D1RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 150;
  const maxDelayMs = options.maxDelayMs ?? 600;

  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;
      if (attempt >= maxRetries || !isRetryableD1Error(err)) {
        throw err;
      }
      // Exponential backoff with small random jitter
      const jitter = Math.floor(Math.random() * 40);
      const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs);
      if (options.onRetry) {
        options.onRetry(err, attempt + 1, delayMs);
      } else {
        console.warn(`[D1 Retry] Transient D1 error on attempt ${attempt + 1}/${maxRetries + 1}: ${err?.message || err}. Retrying in ${delayMs}ms...`);
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const IS_D1_WRAPPED = Symbol('IS_D1_WRAPPED');
const RAW_STMT = Symbol('RAW_STMT');
const d1WrapperCache = new WeakMap<object, any>();

function wrapPreparedStatement(stmt: any, options?: D1RetryOptions): any {
  if (!stmt || typeof stmt !== 'object') return stmt;

  return new Proxy(stmt, {
    get(target, prop, receiver) {
      if (prop === RAW_STMT) {
        return target;
      }
      if (prop === 'bind') {
        return (...args: any[]) => {
          const bound = target.bind(...args);
          return wrapPreparedStatement(bound, options);
        };
      }
      if (prop === 'first') {
        return (...args: any[]) => withD1Retry(() => target.first(...args), options);
      }
      if (prop === 'all') {
        return (...args: any[]) => withD1Retry(() => target.all(...args), options);
      }
      if (prop === 'run') {
        return (...args: any[]) => withD1Retry(() => target.run(...args), options);
      }
      if (prop === 'raw') {
        return (...args: any[]) => withD1Retry(() => target.raw(...args), options);
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}

/**
 * Transparently wraps a D1Database instance with automatic exponential backoff retry.
 * Returns the identical proxy instance on repeated calls (WeakMap cached).
 */
export function wrapD1WithRetry(db: any, options?: D1RetryOptions): any {
  if (!db || typeof db !== 'object') return db;
  if ((db as any)[IS_D1_WRAPPED]) return db;
  if (d1WrapperCache.has(db)) return d1WrapperCache.get(db);

  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === IS_D1_WRAPPED) return true;
      if (prop === 'prepare') {
        return (query: string) => {
          const stmt = target.prepare(query);
          return wrapPreparedStatement(stmt, options);
        };
      }
      if (prop === 'batch') {
        return (statements: any[]) => {
          const rawStatements = Array.isArray(statements)
            ? statements.map(s => (s && s[RAW_STMT]) || s)
            : statements;
          return withD1Retry(() => target.batch(rawStatements), options);
        };
      }
      if (prop === 'exec') {
        return (query: string) => withD1Retry(() => target.exec(query), options);
      }
      return Reflect.get(target, prop, receiver);
    }
  });

  d1WrapperCache.set(db, wrapped);
  return wrapped;
}
