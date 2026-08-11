/**
 * Cloudflare Pages Middleware — GEO Language Detection
 * Reads CF-IPCountry header and sets a lang cookie for Chinese-speaking regions.
 * The cookie is only set if no lang preference already exists.
 */
export async function onRequest(context) {
  const { request, next } = context;

  const response = await next();

  // Chinese-speaking regions
  const CHINESE_REGIONS = new Set(['CN', 'TW', 'HK', 'MO']);

  const country = request.headers.get('CF-IPCountry') || '';
  const cookie  = request.headers.get('Cookie') || '';

  // Don't override if user has already chosen a language
  const hasLangCookie = /\beqt-lang\s*=/.test(cookie);

  if (!hasLangCookie) {
    const lang = CHINESE_REGIONS.has(country) ? 'zh' : 'en';
    const newResponse = new Response(response.body, response);
    newResponse.headers.append(
      'Set-Cookie',
      `eqt-lang=${lang}; Path=/; Max-Age=86400; SameSite=Lax`
    );
    // Expose the detected locale to client via a safe header
    newResponse.headers.set('X-Geo-Locale', lang);
    return newResponse;
  }

  return response;
}
