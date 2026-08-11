/**
 * Structured JSON logging middleware for Workers.
 * Each request produces one JSON line via console.log for Logpush ingestion.
 *
 * Usage: wrap the fetch handler's response before returning.
 *
 *   const response = await handleRequest(request, env, ctx);
 *   ctx.waitUntil(logStructuredRequest(request, response, startMs));
 *   return response;
 *
 * §6.2 — infrastructure-observability.md
 */

export interface StructuredLogFields {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  country: string;
  colo: string;
  userAgent: string;
  worker: string;
}

/**
 * Log a structured JSON line for a completed request.
 * Call via ctx.waitUntil() so it runs asynchronously and doesn't block the response.
 */
export function logStructuredRequest(
  request: Request,
  response: Response,
  startMs: number,
  workerName: string = 'eqt-drm-api'
): Promise<void> {
  const cf = (request as any).cf || {};
  const url = new URL(request.url);
  const durationMs = Date.now() - startMs;

  const level: 'INFO' | 'WARN' | 'ERROR' =
    response.status >= 500 ? 'ERROR' :
    response.status >= 400 ? 'WARN' :
    'INFO';

  const fields: StructuredLogFields = {
    timestamp: new Date().toISOString(),
    level,
    requestId: request.headers.get('cf-ray') || crypto.randomUUID(),
    method: request.method,
    path: url.pathname,
    statusCode: response.status,
    durationMs,
    country: cf.country || 'unknown',
    colo: cf.colo || 'unknown',
    userAgent: (request.headers.get('user-agent') || '').slice(0, 80),
    worker: workerName,
  };

  console.log(JSON.stringify(fields));
  return Promise.resolve();
}
