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

const DEFAULT_PROD_UPSTREAM = "https://lic.eqt.net.im";
const DEFAULT_TEST_UPSTREAM = "https://lic-test.eqt.net.im";

interface PagesContext {
  request: Request;
  params: { path?: string | string[] };
  env?: {
    DRM_API_UPSTREAM?: string;
    DRM_API_TEST_UPSTREAM?: string;
  };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const envHeader = (context.request.headers.get("X-EQT-Environment") || context.request.headers.get("x-eqt-environment") || "").toLowerCase().trim();
  const isTest = (envHeader === "test" || envHeader === "sandbox");

  let upstreamBase = isTest
    ? (context.env?.DRM_API_TEST_UPSTREAM || DEFAULT_TEST_UPSTREAM)
    : (context.env?.DRM_API_UPSTREAM || DEFAULT_PROD_UPSTREAM);
  upstreamBase = upstreamBase.replace(/\/$/, "");

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
    "authorization",
    "cookie",
  ];
  for (const [k, v] of context.request.headers) {
    if (allow.includes(k.toLowerCase())) {
      headers.set(k, v);
    }
  }

  // Cloudflare may expose identity on Access-protected host via header or cookie
  let jwt =
    context.request.headers.get("Cf-Access-Jwt-Assertion") ||
    context.request.headers.get("cf-access-jwt-assertion");
  if (!jwt) {
    const cookieHeader = context.request.headers.get("cookie") || context.request.headers.get("Cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/CF_Authorization=([^;]+)/);
      if (match) {
        jwt = match[1].trim();
      }
    }
  }
  if (jwt) {
    headers.set("Cf-Access-Jwt-Assertion", jwt);
    headers.set("Authorization", `Bearer ${jwt}`);
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
