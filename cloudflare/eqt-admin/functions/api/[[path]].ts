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
const DEFAULT_P2P_UPSTREAM = "https://signal.eqt.net.im";
const DEFAULT_FEEDBACK_UPSTREAM = "https://feedback.eqt.net.im";

interface PagesContext {
  request: Request;
  params: { path?: string | string[] };
  env?: {
    DRM_API_UPSTREAM?: string;
    P2P_API_UPSTREAM?: string;
    FEEDBACK_API_UPSTREAM?: string;
  };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const reqUrl = new URL(context.request.url);

  const pathParam = context.params.path;
  const subPath = Array.isArray(pathParam)
    ? pathParam.join("/")
    : pathParam
      ? String(pathParam)
      : "";

  let upstreamBase = context.env?.DRM_API_UPSTREAM || DEFAULT_UPSTREAM;
  if (subPath.startsWith("v1/p2p/") || subPath.startsWith("p2p/")) {
    upstreamBase = context.env?.P2P_API_UPSTREAM || DEFAULT_P2P_UPSTREAM;
  } else if (subPath.startsWith("v1/feedback/") || subPath.startsWith("feedback/") || subPath.includes("feedbacks")) {
    upstreamBase = context.env?.FEEDBACK_API_UPSTREAM || DEFAULT_FEEDBACK_UPSTREAM;
  }

  upstreamBase = upstreamBase.replace(/\/$/, "");

  // Incoming: /api/<subPath>  → upstream /api/<subPath>
  const target = `${upstreamBase}/api/${subPath}${reqUrl.search}`;

  const headers = new Headers();
  // Forward content + auth-related headers only (avoid hop-by-hop noise)
  const allow = [
    "content-type",
    "accept",
    "cf-access-jwt-assertion",
    "authorization",
  ];
  for (const [k, v] of context.request.headers) {
    if (allow.includes(k.toLowerCase())) {
      headers.set(k, v);
    }
  }

  // Cloudflare exposes identity via header or CF_Authorization cookie on Access host
  let jwt =
    context.request.headers.get("Cf-Access-Jwt-Assertion") ||
    context.request.headers.get("cf-access-jwt-assertion");

  if (!jwt) {
    const cookieHeader = context.request.headers.get("cookie") || "";
    const match = cookieHeader.match(/CF_Authorization=([^;]+)/);
    if (match && match[1]) {
      jwt = match[1].trim();
    }
  }

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

  try {
    let upstream = await fetch(target, init);
    if (!upstream.ok && target.includes("signal.eqt.net.im")) {
      const fallbackTarget = target.replace("https://signal.eqt.net.im", "https://eqt-p2p-signal.leeyelon.workers.dev");
      const fbRes = await fetch(fallbackTarget, init);
      if (fbRes.ok) upstream = fbRes;
    }
    const outHeaders = new Headers(upstream.headers);
    outHeaders.delete("content-encoding");
    outHeaders.delete("transfer-encoding");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (err: any) {
    if (target.includes("signal.eqt.net.im")) {
      try {
        const fallbackTarget = target.replace("https://signal.eqt.net.im", "https://eqt-p2p-signal.leeyelon.workers.dev");
        const fallbackUpstream = await fetch(fallbackTarget, init);
        const outHeaders = new Headers(fallbackUpstream.headers);
        outHeaders.delete("content-encoding");
        outHeaders.delete("transfer-encoding");
        return new Response(fallbackUpstream.body, {
          status: fallbackUpstream.status,
          statusText: fallbackUpstream.statusText,
          headers: outHeaders,
        });
      } catch (fErr) {}
    }
    return new Response(JSON.stringify({
      error: `Upstream service unavailable (${err?.message || "connection error"})`,
      target
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}
