/**
 * EQT API 根路径解析 —— 全站单一来源(在 checkout-verify.js / 内联脚本之前引入)。
 *
 * 规则:
 *   localhost / 127.0.0.1                    → 本地 wrangler dev(http://localhost:8787)
 *   test.eqt.net.im / *.eqt-test.pages.dev   → 测试 Worker(见 docs/deploy/test-environment.md)
 *   其余(生产自定义域名 www)                 → 生产 https://lic.eqt.net.im
 *
 * 刻意不把 *.eqt.pages.dev(生产 Pages 项目别名)划入测试,避免真实用户经 pages.dev
 * 访问时打到测试 API。测试站未搭建时 EQT_IS_TEST 恒为 false,行为与改动前一致。
 */
(function (window) {
    'use strict';
    var host = window.location.hostname;
    // ⚠️ 占位符:搭建测试环境(文档 P1 步骤)后,把 <subdomain> 换成实际 workers.dev 子域。
    var TEST_API = 'https://eqt-drm-api-test.<subdomain>.workers.dev';
    var base;
    if (host === 'localhost' || host.indexOf('127.0.0.1') === 0) {
        base = 'http://localhost:8787';
    } else if (host === 'test.eqt.net.im' ||
               host.slice(-'.eqt-test.pages.dev'.length) === '.eqt-test.pages.dev') {
        base = TEST_API;
    } else {
        base = 'https://lic.eqt.net.im';
    }
    window.EQT_API_BASE = base;
    window.EQT_IS_TEST = (base !== 'https://lic.eqt.net.im');
})(window);
