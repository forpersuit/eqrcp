/**
 * EQT API 根路径解析 —— 全站单一来源(在 checkout-verify.js / 内联脚本之前引入)。
 *
 * 规则:
 *   localhost / 127.0.0.1                    → 本地 wrangler dev(http://localhost:8787)
 *   test.eqt.net.im                          → 测试 Worker(见 docs/deploy/test-environment.md)
 *   其余(生产自定义域名 www)                 → 生产 https://lic.eqt.net.im
 *
 * 统一采用专属自定义域名体系。
 */
(function (window) {
    'use strict';
    var host = window.location.hostname;
    // 专属测试域名：享受 Cloudflare CDN 稳定网络
    var TEST_API = 'https://lic-test.eqt.net.im';
    var base;
    if (host === 'localhost' || host.indexOf('127.0.0.1') === 0) {
        base = 'http://localhost:8787';
    } else if (host === 'test.eqt.net.im') {
        base = TEST_API;
    } else {
        base = 'https://lic.eqt.net.im';
    }
    window.EQT_API_BASE = base;
    window.EQT_IS_TEST = (base !== 'https://lic.eqt.net.im');
})(window);
