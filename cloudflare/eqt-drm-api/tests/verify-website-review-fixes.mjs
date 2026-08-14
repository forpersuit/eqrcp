import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const websiteDir = path.resolve(__dirname, '../../eqt-website');

console.log('=== Running Website Review (W1-W11) Offline Verification ===\n');

let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// 1. Check pricing.html ja translations (W2) & inline onclick removal (W7) & dead code (W10)
const pricingHtml = fs.readFileSync(path.join(websiteDir, 'pricing.html'), 'utf8');

// W2 check: No Korean characters in ja price features
assert(!pricingHtml.includes('"price_free_feat3": "最大5個 of 파일'), 'W2: pricing.html ja price_free_feat3 does not contain Korean 파일');
assert(!pricingHtml.includes('"price_yearly_feat2": "無制限의'), 'W2: pricing.html ja price_yearly_feat2 does not contain Korean 의');
assert(pricingHtml.includes('"price_free_feat3": "最大5個のファイル、単一ファイル最大50MB"'), 'W2: pricing.html ja price_free_feat3 is clean Japanese');
assert(pricingHtml.includes('"price_yearly_feat2": "無制限のセッション時間とファイル数"'), 'W2: pricing.html ja price_yearly_feat2 is clean Japanese');

// W7 check: No inline onclick in pricing.html modal close buttons
assert(!pricingHtml.includes('onclick="closeVerifyModal()"'), 'W7: No inline onclick="closeVerifyModal()" in pricing.html');
assert(!pricingHtml.includes('onclick="closeModal()"'), 'W7: No inline onclick="closeModal()" in pricing.html');

// W10 check: No dead variables in pricing.html
assert(!pricingHtml.includes('let pendingPriceId = null;'), 'W10: No unused let pendingPriceId in pricing.html');
assert(!pricingHtml.includes('let verifiedEmail = null;'), 'W10: No unused let verifiedEmail in pricing.html');

// 2. Check checkout-verify.js for isVerifying lock (W4) and 6-digit regex (W11)
const checkoutVerifyJs = fs.readFileSync(path.join(websiteDir, 'js/checkout-verify.js'), 'utf8');
assert(checkoutVerifyJs.includes('this.isVerifying = false;'), 'W4: checkout-verify.js initializes isVerifying');
assert(checkoutVerifyJs.includes('if (this.isVerifying) return;'), 'W4: checkout-verify.js has isVerifying re-entry guard');
assert(checkoutVerifyJs.includes('if (this.autoVerifyDebounce)'), 'W4: checkout-verify.js clears debounce on verifyAndPay/close');
assert(checkoutVerifyJs.includes('if (!code || !/^\\d{6}$/.test(code))'), 'W11: checkout-verify.js validates 6-digit regex in verifyAndPay');

// 3. Check portal.html for W1, W3, W5, W6, W8, W9
const portalHtml = fs.readFileSync(path.join(websiteDir, 'portal.html'), 'utf8');

// W9 check: Canonical host redirect in head
assert(portalHtml.includes("window.location.replace('https://www.eqt.net.im'"), 'W9: portal.html contains canonical host redirect');

// W5 check: eqt-lang localStorage key
assert(portalHtml.includes("localStorage.setItem('eqt-lang', lang);"), 'W5: portal.html sets eqt-lang in localStorage');

// W6 check: escapeHtml function present and used
assert(portalHtml.includes('function escapeHtml(str)'), 'W6: portal.html defines escapeHtml utility');
assert(portalHtml.includes('const escCode = escapeHtml(lic.license_code);'), 'W6: portal.html escapes license_code');
assert(portalHtml.includes('const escDevKey = escapeHtml(devKey);'), 'W6: portal.html escapes devKey');

// W1 & W8 check: status and error_code checks
assert(portalHtml.includes("err.error_code === 'RATE_LIMITED'"), 'W8: portal.html checks RATE_LIMITED error_code');
assert(portalHtml.includes("err.error_code === 'SESSION_EXPIRED'"), 'W1: portal.html checks SESSION_EXPIRED error_code');

// W3 check: pending upgrade and pagination keys exist across all 7 languages
const langMatches = ['en', 'zh', 'ja', 'ko', 'es', 'de', 'fr'];
for (const l of langMatches) {
  const pendingKeyCheck = portalHtml.includes(`"${l}": {`) || portalHtml.includes(`'${l}': {`);
  assert(pendingKeyCheck, `W3: portal.html defines language ${l}`);
  assert(portalHtml.includes(`"pagination_prev":`), `Pagination: portal.html defines pagination_prev for ${l}`);
  assert(portalHtml.includes(`"pagination_next":`), `Pagination: portal.html defines pagination_next for ${l}`);
}
assert(portalHtml.includes('"pending_upgrade_banner": "終身アップグレード購入済み'), 'W3: ja pending_upgrade_banner defined');
assert(portalHtml.includes('"pending_upgrade_banner": "평생 플랜 업그레이드 구매 완료'), 'W3: ko pending_upgrade_banner defined');
assert(portalHtml.includes('"pending_upgrade_banner": "Pase vitalicio comprado'), 'W3: es pending_upgrade_banner defined');
assert(portalHtml.includes('"pending_upgrade_banner": "Lifetime-Upgrade erworben'), 'W3: de pending_upgrade_banner defined');
assert(portalHtml.includes('"pending_upgrade_banner": "Pass à vie acheté'), 'W3: fr pending_upgrade_banner defined');

// 4. Check portal.html pagination components and functions
assert(portalHtml.includes('id="licenses-pagination"'), 'Pagination: portal.html contains #licenses-pagination element');
assert(portalHtml.includes('id="page-prev-btn"'), 'Pagination: portal.html contains #page-prev-btn element');
assert(portalHtml.includes('id="page-next-btn"'), 'Pagination: portal.html contains #page-next-btn element');
assert(portalHtml.includes('function renderPagination()'), 'Pagination: portal.html defines renderPagination function');
assert(portalHtml.includes('function initPaginationListeners()'), 'Pagination: portal.html defines initPaginationListeners function');
assert(portalHtml.includes('state.page = maxPage;'), 'Pagination: portal.html includes self-healing fallback to maxPage');
assert(portalHtml.includes('return await loadLicenses();'), 'Pagination: portal.html reloads licenses after self-healing page clamp');

console.log(`\n============================================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`============================================================`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
