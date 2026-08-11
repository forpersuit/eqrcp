import { Env } from '../types';

export async function fetchLatestRelease(env: Env): Promise<any> {
  const repo = env.GITHUB_REPO || "forpersuit/eqrcp";
  const ghUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  
  const headers: Record<string, string> = {
    "User-Agent": "EQT-Update-Worker",
    "Accept": "application/vnd.github+json",
  };
  
  if (env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const ghRes = await fetch(ghUrl, { headers });
  if (!ghRes.ok) {
    return { error: `Failed to fetch latest release from GitHub: ${ghRes.statusText}` };
  }

  return await ghRes.json();
}

export async function handleDownloadDomain(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. Root path -> Redirect to official homepage
  if (pathname === "/" || pathname === "") {
    return Response.redirect("https://www.eqt.net.im", 302);
  }

  // 2. GET /update-metadata.json
  if (pathname === "/update-metadata.json" && (request.method === "GET" || request.method === "HEAD")) {
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;
    let response = await cache.match(cacheKey);
    if (response) {
      return response;
    }

    const latestRelease = await fetchLatestRelease(env);
    if (latestRelease.error) {
      return new Response(JSON.stringify({ error: latestRelease.error }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const version = latestRelease.tag_name;
    const result = {
      version: version,
      published_at: latestRelease.published_at,
      changelog: latestRelease.body || "",
      assets: (latestRelease.assets || []).map((asset: any) => {
        return {
          name: asset.name,
          download_url: `https://download.eqt.net.im/downloads/${version}/${asset.name}`,
          size: asset.size
        };
      })
    };

    response = new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=60" // Cache in edge for 1 minute
      }
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }

  // 3. GET /downloads/:version/:filename
  // Pattern: /downloads/([^/]+)/(.+)
  const downloadMatch = pathname.match(/^\/downloads\/([^/]+)\/(.+)$/);
  if (downloadMatch && (request.method === "GET" || request.method === "HEAD")) {
    let version = downloadMatch[1];
    const filename = downloadMatch[2];

    if (version === "latest") {
      const latestRelease = await fetchLatestRelease(env);
      if (latestRelease.error) {
        return new Response(JSON.stringify({ error: latestRelease.error }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      version = latestRelease.tag_name;
    }

    // Public downloads are R2-only (no GitHub Releases fallback).
    if (!env.R2_PUBLIC_URL) {
      return new Response(JSON.stringify({
        error: "R2_PUBLIC_URL is not configured; public downloads require R2 CDN"
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const base = env.R2_PUBLIC_URL.endsWith('/') ? env.R2_PUBLIC_URL.slice(0, -1) : env.R2_PUBLIC_URL;
    return Response.redirect(`${base}/downloads/${version}/${filename}`, 302);
  }

  // Fallback: redirect any unmatched downloads domain requests to the main website
  return Response.redirect("https://www.eqt.net.im", 302);
}
