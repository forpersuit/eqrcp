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
const indexHtml = fs.readFileSync(path.join(websiteDir, 'index.html'), 'utf8');
const refundHtml = fs.readFileSync(path.join(websiteDir, 'refund.html'), 'utf8');
const privacyHtml = fs.readFileSync(path.join(websiteDir, 'privacy.html'), 'utf8');
const termsHtml = fs.readFileSync(path.join(websiteDir, 'terms.html'), 'utf8');

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

// 2. Check email-otp.js shared module & checkout-verify.js
const emailOtpJs = fs.readFileSync(path.join(websiteDir, 'js/email-otp.js'), 'utf8');
assert(emailOtpJs.includes('class EmailOtpController'), 'EmailOtp: defines EmailOtpController class');
assert(emailOtpJs.includes('this.startCooldown('), 'EmailOtp: handles startCooldown');
assert(emailOtpJs.includes('this.cancelCooldown('), 'EmailOtp: handles cancelCooldown');
assert(emailOtpJs.includes('window.EmailOtp ='), 'EmailOtp: exports to window.EmailOtp');
assert(emailOtpJs.includes('this.cooldownRemaining > 0'), 'F2: email-otp.js guards sendCode against cooldownRemaining');

assert(pricingHtml.includes('js/email-otp.js'), 'pricing.html imports js/email-otp.js');
assert(pricingHtml.includes('js/checkout-verify.js'), 'pricing.html imports js/checkout-verify.js');

const checkoutVerifyJs = fs.readFileSync(path.join(websiteDir, 'js/checkout-verify.js'), 'utf8');
assert(!checkoutVerifyJs.includes(': Object)'), 'F1: checkout-verify.js does not use fake Object fallback');
assert(checkoutVerifyJs.includes('window.EmailOtp'), 'checkout-verify.js uses window.EmailOtp');
assert(checkoutVerifyJs.includes('this.otp.sendCode'), 'checkout-verify.js delegates sendCode to this.otp');
assert(checkoutVerifyJs.includes('this.otp.verifyCode'), 'checkout-verify.js delegates verifyCode to this.otp');
assert(!checkoutVerifyJs.includes('startCooldown(seconds)'), 'F4: checkout-verify.js does not define unused startCooldown wrapper');
assert(checkoutVerifyJs.includes('if (this.autoVerifyDebounce)'), 'W4: checkout-verify.js clears debounce on verifyAndPay/close');
assert(checkoutVerifyJs.includes('if (!code || !/^\\d{6}$/.test(code))'), 'W11: checkout-verify.js validates 6-digit regex in verifyAndPay');

// 3. Check portal.html for W1, W3, W5, W6, W8, W9 & email-otp.js integration
const portalHtml = fs.readFileSync(path.join(websiteDir, 'portal.html'), 'utf8');
assert(portalHtml.includes('js/email-otp.js'), 'portal.html imports js/email-otp.js');
assert(!portalHtml.includes(': Object)'), 'F1: portal.html does not use fake Object fallback');
assert(!portalHtml.includes('sendCodeInFlight:'), 'F3: portal.html removes dead sendCodeInFlight state');
assert(portalHtml.includes('portalOtp.cancelCooldown()'), 'F3: portal.html cancels cooldown on logout');
assert(portalHtml.includes('portalOtp.sendCode'), 'portal.html delegates sendCode to portalOtp');
assert(portalHtml.includes('portalOtp.verifyCode'), 'portal.html delegates verifyCode to portalOtp');

// W9 check: Canonical host redirect in head
assert(portalHtml.includes("window.location.replace('https://www.eqt.net.im'"), 'W9: portal.html contains canonical host redirect');

// W5 check: eqt-lang localStorage key
assert(portalHtml.includes("localStorage.setItem('eqt-lang', lang);"), 'W5: portal.html sets eqt-lang in localStorage');

// W6 check: escapeHtml function present and used
assert(portalHtml.includes('function escapeHtml(str)'), 'W6: portal.html defines escapeHtml utility');
assert(portalHtml.includes('const escCode = escapeHtml(lic.license_code);'), 'W6: portal.html escapes license_code');
assert(portalHtml.includes('const escDevKey = escapeHtml(devKey);'), 'W6: portal.html escapes devKey');

function extractTranslations(htmlContent) {
  const match = htmlContent.match(/const\s+translations\s*=\s*(\{[\s\S]*?\n\s*\});/);
  if (!match) throw new Error('Could not find translations dictionary in HTML content');
  return new Function(`return (${match[1]});`)();
}

function findDuplicateKeys(htmlContent) {
  const match = htmlContent.match(/const\s+translations\s*=\s*(\{[\s\S]*?\n\s*\});/);
  if (!match) return [];
  const src = match[1];
  const duplicates = [];
  
  let i = 0;
  const n = src.length;
  
  // Scope stack: each entry is { path: string, seen: Set<string>, expectingKey: boolean, isObject: boolean }
  const stack = [];
  let currentKey = null;
  
  function skipWhitespaceAndComments() {
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i++;
      } else if (c === '/' && src[i + 1] === '/') {
        i += 2;
        while (i < n && src[i] !== '\n') i++;
      } else if (c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        if (i < n) i += 2;
      } else {
        break;
      }
    }
  }

  function readString() {
    const quote = src[i]; // ' or "
    i++;
    let str = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        if (i + 1 < n) {
          str += src[i + 1];
          i += 2;
        } else {
          i++;
        }
      } else if (c === quote) {
        i++;
        return str;
      } else {
        str += c;
        i++;
      }
    }
    return str;
  }

  while (i < n) {
    skipWhitespaceAndComments();
    if (i >= n) break;
    const c = src[i];
    const top = stack[stack.length - 1];

    if (c === '{') {
      const parentPath = top ? (currentKey ? `${top.path}.${currentKey}` : top.path) : 'translations';
      stack.push({ path: parentPath, seen: new Set(), expectingKey: true, isObject: true });
      currentKey = null;
      i++;
    } else if (c === '}') {
      stack.pop();
      currentKey = null;
      i++;
    } else if (c === '[') {
      stack.push({ path: top ? top.path : 'array', seen: new Set(), expectingKey: false, isObject: false });
      i++;
    } else if (c === ']') {
      stack.pop();
      i++;
    } else if (c === ':') {
      if (top && top.isObject && currentKey !== null) {
        if (top.seen.has(currentKey)) {
          duplicates.push({ scope: top.path, key: currentKey });
        } else {
          top.seen.add(currentKey);
        }
        top.expectingKey = false;
      }
      i++;
    } else if (c === ',') {
      if (top && top.isObject) {
        top.expectingKey = true;
        currentKey = null;
      }
      i++;
    } else if (c === '"' || c === "'") {
      const strVal = readString();
      if (top && top.isObject && top.expectingKey) {
        currentKey = strVal;
      }
    } else {
      // Numbers, booleans, identifiers, etc.
      i++;
    }
  }

  return duplicates;
}

const pricingTranslations = extractTranslations(pricingHtml);
const portalTranslations = extractTranslations(portalHtml);

// C2 check: No duplicated keys in language dictionaries
const pricingDups = findDuplicateKeys(pricingHtml);
assert(pricingDups.length === 0, `C2: pricing.html has no duplicate translation keys (found: ${JSON.stringify(pricingDups)})`);

const portalDups = findDuplicateKeys(portalHtml);
assert(portalDups.length === 0, `C2: portal.html has no duplicate translation keys (found: ${JSON.stringify(portalDups)})`);

// W1 & W8 check: status and error_code checks
assert(emailOtpJs.includes("err.error_code === 'RATE_LIMITED'"), 'W8: email-otp.js checks RATE_LIMITED error_code');
assert(portalHtml.includes("err.error_code === 'SESSION_EXPIRED'"), 'W1: portal.html checks SESSION_EXPIRED error_code');

// W3 check: pending upgrade and pagination keys exist across all 7 languages
const langMatches = ['en', 'zh', 'ja', 'ko', 'es', 'de', 'fr'];
for (const l of langMatches) {
  assert(Boolean(portalTranslations[l]), `W3: portal.html defines language ${l}`);
  assert(typeof portalTranslations[l]?.pagination_prev === 'string' && portalTranslations[l].pagination_prev.length > 0, `Pagination: portal.html defines pagination_prev for ${l}`);
  assert(typeof portalTranslations[l]?.pagination_next === 'string' && portalTranslations[l].pagination_next.length > 0, `Pagination: portal.html defines pagination_next for ${l}`);
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

// 5. Check N1, N2, N3 review findings
assert(pricingHtml.includes('js/email-otp.js?v=1.0.7'), 'N1: pricing.html imports js/email-otp.js?v=1.0.7');
assert(pricingHtml.includes('js/checkout-verify.js?v=1.0.7'), 'N1: pricing.html imports js/checkout-verify.js?v=1.0.7');
assert(portalHtml.includes('js/email-otp.js?v=1.0.7'), 'N1: portal.html imports js/email-otp.js?v=1.0.7');

// T1 / N2 check: Strict per-language verification of module_load_err in parsed dictionary
for (const l of langMatches) {
  assert(
    typeof pricingTranslations[l]?.module_load_err === 'string' && pricingTranslations[l].module_load_err.length > 0,
    `T1/N2: pricing.html defines module_load_err for ${l}`
  );
  assert(
    typeof portalTranslations[l]?.module_load_err === 'string' && portalTranslations[l].module_load_err.length > 0,
    `T1/N2: portal.html defines module_load_err for ${l}`
  );
}
assert(portalHtml.includes("portalOtp.syncButtonWithEmail('', sendBtn)"), 'N3: portal.html resets sendBtn visual state on logout');

// 6. Check that all HTML data-i18n and data-i18n-placeholder keys in portal.html are defined across all 7 languages
function extractHtmlI18nKeys(htmlContent) {
  const keys = new Set();
  const regex = /data-i18n(?:-placeholder)?=["']([^"']+)["']/g;
  let m;
  while ((m = regex.exec(htmlContent)) !== null) {
    keys.add(m[1]);
  }
  return Array.from(keys);
}

const portalHtmlKeys = extractHtmlI18nKeys(portalHtml);
for (const l of langMatches) {
  const missing = portalHtmlKeys.filter(k => typeof portalTranslations[l]?.[k] !== 'string' || portalTranslations[l][k].trim() === '');
  assert(missing.length === 0, `I18n Coverage: portal.html [${l}] defines all HTML data-i18n keys (missing: ${JSON.stringify(missing)})`);
}

// 7. A11y & SEO assertions: dynamic document.documentElement.lang across all 6 pages and form labels
assert(portalHtml.includes('document.documentElement.lang = lang'), 'A11y/SEO: portal.html updates document.documentElement.lang on language switch');
assert(pricingHtml.includes('document.documentElement.lang = lang'), 'A11y/SEO: pricing.html updates document.documentElement.lang on language switch');
assert(indexHtml.includes('document.documentElement.lang = lang'), 'A11y/SEO: index.html updates document.documentElement.lang on language switch');
assert(refundHtml.includes('document.documentElement.lang = lang'), 'A11y/SEO: refund.html updates document.documentElement.lang on language switch');
assert(privacyHtml.includes('document.documentElement.lang = lang'), 'A11y/SEO: privacy.html updates document.documentElement.lang on language switch');
assert(termsHtml.includes('document.documentElement.lang = lang'), 'A11y/SEO: terms.html updates document.documentElement.lang on language switch');
assert(/<label[^>]*for=["']login-email["']/.test(portalHtml), 'A11y: portal.html has associated label[for="login-email"]');
assert(/<label[^>]*for=["']login-code["']/.test(portalHtml), 'A11y: portal.html has associated label[for="login-code"]');
assert(/<label[^>]*for=["']checkout-email-input["']/.test(pricingHtml), 'A11y: pricing.html has associated label[for="checkout-email-input"]');
assert(/<label[^>]*for=["']checkout-code-input["']/.test(pricingHtml), 'A11y: pricing.html has associated label[for="checkout-code-input"]');

// 8. Option A Status Badge assertions: consume is_refunded and activate status_refunded
assert(portalHtml.includes('lic.is_refunded'), 'StatusBadge: portal.html consumes lic.is_refunded');
assert(portalHtml.includes("isRefunded ? 'status_refunded'"), 'StatusBadge: portal.html maps isRefunded to status_refunded');
for (const l of langMatches) {
  assert(
    typeof portalTranslations[l]?.status_refunded === 'string' && portalTranslations[l].status_refunded.length > 0,
    `StatusBadge: portal.html [${l}] defines non-empty status_refunded`
  );
}

// 9. Canonical Language Storage (eqt-lang) resolution across all pages (Rule 7)
assert(portalHtml.includes("localStorage.setItem('eqt-lang', lang)"), 'CanonicalLang: portal.html writes eqt-lang');
assert(pricingHtml.includes("localStorage.setItem('eqt-lang', lang)"), 'CanonicalLang: pricing.html writes eqt-lang');
assert(indexHtml.includes("localStorage.setItem('eqt-lang'"), 'CanonicalLang: index.html writes eqt-lang');
assert(refundHtml.includes("localStorage.setItem('eqt-lang', lang)"), 'CanonicalLang: refund.html writes eqt-lang');
assert(privacyHtml.includes("localStorage.setItem('eqt-lang', lang)"), 'CanonicalLang: privacy.html writes eqt-lang');
assert(termsHtml.includes("localStorage.setItem('eqt-lang', lang)"), 'CanonicalLang: terms.html writes eqt-lang');
assert(privacyHtml.includes("localStorage.getItem('eqt-lang')"), 'CanonicalLang: privacy.html reads eqt-lang');
assert(termsHtml.includes("localStorage.getItem('eqt-lang')"), 'CanonicalLang: terms.html reads eqt-lang');
assert(!portalHtml.includes("localStorage.setItem('eqt_lang'"), 'CanonicalLang: portal.html does not write redundant eqt_lang');
assert(!privacyHtml.includes("localStorage.setItem('eqt_lang'"), 'CanonicalLang: privacy.html does not write redundant eqt_lang');
assert(!termsHtml.includes("localStorage.setItem('eqt_lang'"), 'CanonicalLang: terms.html does not write redundant eqt_lang');

console.log(`\n============================================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`============================================================`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
