import { Env } from './types';
import { getCorsHeaders } from './utils/auth';
import { logSystemError, getSafeUserErrorMessage } from './utils/error-logger';
import { handleDownloadDomain } from './services/github';
import { handleAdminRoutes } from './routes/admin';
import { handleAuthRoutes } from './routes/auth';
import { handlePortalRoutes } from './routes/portal';
import { handlePaddleRoutes } from './routes/paddle';
import { handleDrmRoutes } from './routes/drm';

export type { Env };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Dynamic CORS Headers with Origin domain matching
    const corsHeaders = getCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. Route to Download Domain handler if matching download host / paths
      if (
        (url.hostname === "download.eqt.net.im" ||
         url.hostname.endsWith(".workers.dev") ||
         url.hostname === "localhost" ||
         url.hostname === "127.0.0.1" ||
         url.pathname === "/update-metadata.json" ||
         url.pathname.startsWith("/downloads/")) &&
        !url.pathname.startsWith("/api/v1/")
      ) {
        return await handleDownloadDomain(request, env, ctx, corsHeaders);
      }

      // 2. Route to Admin endpoints (/api/v1/admin/*)
      if (url.pathname.startsWith("/api/v1/admin/")) {
        const adminResp = await handleAdminRoutes(request, env, ctx, url, corsHeaders);
        if (adminResp) return adminResp;
      }

      // 3. Route to Auth & Checkout endpoints (/api/v1/auth/*, /api/v1/checkout/*)
      if (url.pathname.startsWith("/api/v1/auth/") || url.pathname.startsWith("/api/v1/checkout/")) {
        const authResp = await handleAuthRoutes(request, env, ctx, url, corsHeaders);
        if (authResp) return authResp;
      }

      // 4. Route to User Portal endpoints (/api/v1/user/*)
      if (url.pathname.startsWith("/api/v1/user/")) {
        const portalResp = await handlePortalRoutes(request, env, ctx, url, corsHeaders);
        if (portalResp) return portalResp;
      }

      // 5. Route to Paddle Webhook & License Query endpoints (/api/v1/paddle/*)
      if (url.pathname.startsWith("/api/v1/paddle/")) {
        const paddleResp = await handlePaddleRoutes(request, env, ctx, url, corsHeaders);
        if (paddleResp) return paddleResp;
      }

      // 6. Route to Client DRM endpoints (/api/v1/activate, /api/v1/verify, /api/v1/update/check)
      const drmResp = await handleDrmRoutes(request, env, ctx, url, corsHeaders);
      if (drmResp) return drmResp;

      // 7. Health check or basic index fallback
      return new Response(JSON.stringify({ status: "EQT DRM Serverless API Running" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (e: any) {
      ctx.waitUntil(logSystemError(env, 'SERVER_EXCEPTION', 'CRITICAL', e, { url: request.url, method: request.method }));
      const safeMsg = getSafeUserErrorMessage(e.message || String(e), "An unexpected server error occurred. Please try again later.");
      return new Response(JSON.stringify({ error: safeMsg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
