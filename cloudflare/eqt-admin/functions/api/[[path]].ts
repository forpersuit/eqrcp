/**
 * Same-origin Admin API proxy for Cloudflare Access.
 *
 * Browser → https://admin.eqt.net.im/api/v1/admin/...
 *   (Access injects Cf-Access-Jwt-Assertion on this host)
 * Function → https://lic.eqt.net.im/api/v1/admin/...
 *   (forwards JWT so Worker can validate identity)
 *
 * Local Vite dev does not use this file; it talks to VITE_API_BASE directly with secret.
 */

const DEFAULT_UPSTREAM = "https://lic.eqt.net.im";

interface PagesContext {
  request: Request;
  params: { path?: string | string[] };
  env?: { DRM_API_UPSTREAM?: string };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const upstreamBase = (context.env?.DRM_API_UPSTREAM || DEFAULT_UPSTREAM).replace(/\/$/, "");
  const reqUrl = new URL(context.request.url);

  const pathParam = context.params.path;
  const subPath = Array.isArray(pathParam)
    ? pathParam.join("/")
    : pathParam
      ? String(pathParam)
      : "";

  // Incoming: /api/<subPath>  → upstream /api/<subPath>
  const target = `${upstreamBase}/api/${subPath}${reqUrl.search}`;

  const headers = new Headers();
  // Forward content + auth-related headers only (avoid hop-by-hop noise)
  const allow = [
    "content-type",
    "accept",
    "cf-access-jwt-assertion",
    "x-admin-secret",
    "authorization",
  ];
  for (const [k, v] of context.request.headers) {
    if (allow.includes(k.toLowerCase())) {
      headers.set(k, v);
    }
  }

  // Cloudflare may expose identity on Access-protected host
  const jwt =
    context.request.headers.get("Cf-Access-Jwt-Assertion") ||
    context.request.headers.get("cf-access-jwt-assertion");
  if (jwt) {
    headers.set("Cf-Access-Jwt-Assertion", jwt);
  }

  const init: RequestInit = {
    method: context.request.method,
    headers,
    redirect: "manual",
  };

  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    init.body = context.request.body;
    // @ts-expect-error duplex required for streaming body in some runtimes
    init.duplex = "half";
  }

  const upstream = await fetch(target, init);
  // Clone response with CORS-friendly headers for same-origin SPA (same host → fine)
  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete("content-encoding");
  outHeaders.delete("transfer-encoding");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
