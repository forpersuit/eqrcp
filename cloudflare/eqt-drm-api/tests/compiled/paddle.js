"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// tests/mocks/cloudflare-sockets-stub.js
var require_cloudflare_sockets_stub = __commonJS({
  "tests/mocks/cloudflare-sockets-stub.js"(exports2, module2) {
    "use strict";
    module2.exports = {
      connect: () => ({})
    };
  }
});

// src/routes/paddle.ts
var paddle_exports = {};
__export(paddle_exports, {
  handlePaddleRoutes: () => handlePaddleRoutes
});
module.exports = __toCommonJS(paddle_exports);

// src/types.ts
var PRICE_LIFETIME_ID = "pri_01kxymyma34hgmndccwswheta3";
var PRICE_YEARLY_ID = "pri_01kxymxqngex49tg65wb0701pc";
var ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1e3;

// src/utils/crypto.ts
async function verifyPaddleSignature(rawBody, signatureHeader, secretKey) {
  if (!signatureHeader || !secretKey) return false;
  const parts = signatureHeader.split(";");
  if (parts.length !== 2) return false;
  const timestampPart = parts.find((p) => p.startsWith("ts="));
  const signaturePart = parts.find((p) => p.startsWith("h1="));
  if (!timestampPart || !signaturePart) return false;
  const ts = timestampPart.split("=")[1];
  const h1 = signaturePart.split("=")[1];
  if (!ts || !h1) return false;
  const timestampInt = parseInt(ts) * 1e3;
  if (isNaN(timestampInt)) return false;
  const currentTime = Date.now();
  if (Math.abs(currentTime - timestampInt) > 300 * 1e3) {
    return false;
  }
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const messageData = encoder.encode(`${ts}:${rawBody}`);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuf = await crypto.subtle.sign("HMAC", key, messageData);
  const signatureHex = Array.prototype.map.call(
    new Uint8Array(signatureBuf),
    (x) => ("00" + x.toString(16)).slice(-2)
  ).join("");
  return signatureHex === h1;
}

// src/services/smtp.ts
var import_cloudflare_sockets = __toESM(require_cloudflare_sockets_stub());

// src/i18n.ts
var PURCHASE_EMAIL_I18N = {
  en: {
    subject: "[EQT] Your License Code & Order Details",
    title: "Thank you for purchasing EQT!",
    body: (planName, code, expiresStr) => `
      <p style="color: #475569; font-size: 14px;">Thank you for choosing EQT Easy QR Transfer! Your paid license details:</p>
      <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">Tier</td><td style="padding: 10px; border: 1px solid #ddd;">${planName}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">License Code</td><td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${code}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Expires</td><td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Max Devices</td><td style="padding: 10px; border: 1px solid #ddd;">2 Devices</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">Open EQT app &rarr; Settings &rarr; Redeem Code, and paste your code to activate.</p>`
  },
  zh: {
    subject: "\u3010EQT\u3011\u60A8\u7684\u8D2D\u4E70\u6FC0\u6D3B\u7801\u4E0E\u670D\u52A1\u660E\u7EC6",
    title: "\u611F\u8C22\u60A8\u8D2D\u4E70 EQT\uFF01",
    body: (planName, code, expiresStr) => `
      <p style="color: #475569; font-size: 14px;">\u611F\u8C22\u60A8\u9009\u62E9 EQT Easy QR Transfer\uFF01\u4EE5\u4E0B\u662F\u60A8\u7684\u4ED8\u8D39\u6388\u6743\u660E\u7EC6\uFF1A</p>
      <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">\u6388\u6743\u7EA7\u522B (Tier)</td><td style="padding: 10px; border: 1px solid #ddd;">${planName}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\u6FC0\u6D3B\u7801 (License Code)</td><td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${code}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\u6709\u6548\u671F\u9650 (Expires)</td><td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\u6700\u5927\u6FC0\u6D3B\u8BBE\u5907\u6570</td><td style="padding: 10px; border: 1px solid #ddd;">2 \u53F0\u8BBE\u5907</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">\u6253\u5F00 EQT \u5BA2\u6237\u7AEF &rarr; \u8BBE\u7F6E/\u5173\u4E8E\u9762\u677F &rarr; \u5151\u6362\u6FC0\u6D3B\u7801\uFF0C\u8F93\u5165\u4E0A\u8FF0\u6FC0\u6D3B\u7801\u5373\u53EF\u6FC0\u6D3B\u3002</p>`
  },
  ja: {
    subject: "\u3010EQT\u3011\u3054\u8CFC\u5165\u7528\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9\u306E\u304A\u77E5\u3089\u305B",
    title: "EQT \u3092\u3054\u8CFC\u5165\u3044\u305F\u3060\u304D\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\uFF01",
    body: (planName, code, expiresStr) => `
      <p style="color: #475569; font-size: 14px;">EQT Easy QR Transfer \u3092\u304A\u9078\u3073\u3044\u305F\u3060\u304D\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002\u30E9\u30A4\u30BB\u30F3\u30B9\u8A73\u7D30\uFF1A</p>
      <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">\u30D7\u30E9\u30F3 (Tier)</td><td style="padding: 10px; border: 1px solid #ddd;">${planName}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9</td><td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${code}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\u6709\u52B9\u671F\u9650</td><td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\u6700\u5927\u53F0\u6570</td><td style="padding: 10px; border: 1px solid #ddd;">2 \u53F0</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">EQT \u30A2\u30D7\u30EA\u3092\u958B\u304D\u3001\u300C\u8A2D\u5B9A\u300D\u304B\u3089\u30B3\u30FC\u30C9\u3092\u5165\u529B\u3057\u3066\u6709\u52B9\u5316\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p>`
  },
  ko: {
    subject: "\u3010EQT\u3011\uAD6C\uB9E4 \uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC \uBC0F \uC8FC\uBB38 \uC0C1\uC138",
    title: "EQT\uB97C \uAD6C\uB9E4\uD574 \uC8FC\uC154\uC11C \uAC10\uC0AC\uD569\uB2C8\uB2E4!",
    body: (planName, code, expiresStr) => `
      <p style="color: #475569; font-size: 14px;">EQT Easy QR Transfer\uB97C \uC120\uD0DD\uD574 \uC8FC\uC154\uC11C \uAC10\uC0AC\uD569\uB2C8\uB2E4. \uB77C\uC774\uC120\uC2A4 \uC0C1\uC138 \uC815\uBCF4:</p>
      <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">\uD50C\uB79C (Tier)</td><td style="padding: 10px; border: 1px solid #ddd;">${planName}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC</td><td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${code}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\uB9CC\uB8CC\uC77C</td><td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\uCD5C\uB300 \uAE30\uAE30 \uC218</td><td style="padding: 10px; border: 1px solid #ddd;">2 \uB300</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">EQT \uC571\uC744 \uC5F4\uACE0 \uC124\uC815 \uBA54\uB274\uC5D0\uC11C \uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC\uB97C \uC785\uB825\uD558\uC5EC \uD65C\uC131\uD654\uD558\uC138\uC694.</p>`
  },
  es: {
    subject: "[EQT] Su c\xF3digo de licencia y detalles del pedido",
    title: "\xA1Gracias por comprar EQT!",
    body: (planName, code, expiresStr) => `
      <p style="color: #475569; font-size: 14px;">\xA1Gracias por elegir EQT Easy QR Transfer! Detalles de su licencia:</p>
      <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">Plan</td><td style="padding: 10px; border: 1px solid #ddd;">${planName}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">C\xF3digo de Licencia</td><td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${code}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Vencimiento</td><td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Dispositivos m\xE1ximos</td><td style="padding: 10px; border: 1px solid #ddd;">2 Dispositivos</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">Abra la app EQT, vaya a Ajustes y pegue el c\xF3digo para activar.</p>`
  },
  de: {
    subject: "[EQT] Ihr Lizenzschl\xFCssel & Bestelldetails",
    title: "Vielen Dank f\xFCr Ihren Kauf von EQT!",
    body: (planName, code, expiresStr) => `
      <p style="color: #475569; font-size: 14px;">Vielen Dank, dass Sie sich f\xFCr EQT entschieden haben. Ihre Lizenzdetails:</p>
      <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">Tarif</td><td style="padding: 10px; border: 1px solid #ddd;">${planName}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Lizenzschl\xFCssel</td><td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${code}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Ablaufdatum</td><td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Max. Ger\xE4te</td><td style="padding: 10px; border: 1px solid #ddd;">2 Ger\xE4te</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">\xD6ffnen Sie EQT &rarr; Einstellungen &rarr; Code einl\xF6sen, um Ihre Lizenz zu aktivieren.</p>`
  },
  fr: {
    subject: "[EQT] Votre code de licence et d\xE9tails de la commande",
    title: "Merci d'avoir achet\xE9 EQT !",
    body: (planName, code, expiresStr) => `
      <p style="color: #475569; font-size: 14px;">Merci d'avoir choisi EQT Easy QR Transfer ! D\xE9tails de votre licence :</p>
      <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">Forfait</td><td style="padding: 10px; border: 1px solid #ddd;">${planName}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Cl\xE9 de licence</td><td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${code}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Expiration</td><td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Appareils max</td><td style="padding: 10px; border: 1px solid #ddd;">2 Appareils</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">Ouvrez l'application EQT &rarr; Param\xE8tres &rarr; Activer le code pour d\xE9verrouiller vos fonctionnalit\xE9s.</p>`
  }
};
var RENEWAL_EMAIL_I18N = {
  en: {
    subject: "[EQT] Subscription Renewal Successful \xB7 License Preserved",
    title: "Subscription Renewed Successfully",
    body: (code, expiresStr) => `
      <p style="color: #475569; font-size: 14px;">Paddle has completed the recurring payment. Your <strong>license code remains unchanged</strong> and your privileges have been extended:</p>
      <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">License Code</td><td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${code}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">New Expiration</td><td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">Status</td><td style="padding: 10px; border: 1px solid #ddd;">Active</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">Activated devices will automatically refresh their certificates. No re-entry required.</p>`
  },
  zh: {
    subject: "\u3010EQT\u3011\u5E74\u4ED8\u8BA2\u9605\u5DF2\u7EED\u8D39\u6210\u529F \xB7 \u6FC0\u6D3B\u7801\u4E0D\u53D8",
    title: "\u5E74\u4ED8\u8BA2\u9605\u5DF2\u7EED\u8D39\u6210\u529F",
    body: (code, expiresStr) => `
      <p style="color: #475569; font-size: 14px;">Paddle \u5DF2\u5B8C\u6210\u672C\u5468\u671F\u6263\u8D39\u3002\u60A8\u7684<strong>\u6FC0\u6D3B\u7801\u4E0D\u53D8</strong>\uFF0C\u6743\u76CA\u5DF2\u5EF6\u957F\uFF1A</p>
      <table style="border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 600px;">
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9; width: 180px;">\u6FC0\u6D3B\u7801</td><td style="padding: 10px; border: 1px solid #ddd; font-family: monospace; font-size: 16px; font-weight: bold; color: #10b981;">${code}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\u65B0\u6709\u6548\u671F\u81F3</td><td style="padding: 10px; border: 1px solid #ddd;">${expiresStr}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; background: #f9f9f9;">\u72B6\u6001</td><td style="padding: 10px; border: 1px solid #ddd;">Active (\u6D3B\u8DC3)</td></tr>
      </table>
      <p style="font-size: 13px; color: #64748b;">\u5DF2\u6FC0\u6D3B\u8BBE\u5907\u4E0B\u6B21\u8054\u7F51\u65F6\u4F1A\u81EA\u52A8\u5237\u65B0\u8BC1\u4E66\uFF0C\u65E0\u9700\u91CD\u65B0\u8F93\u5165\u6FC0\u6D3B\u7801\u3002</p>`
  }
};
function getPurchaseEmailTemplate(lang) {
  const norm = (lang || "en").toLowerCase().substring(0, 2);
  return PURCHASE_EMAIL_I18N[norm] || PURCHASE_EMAIL_I18N["en"];
}
function getRenewalEmailTemplate(lang) {
  const norm = (lang || "en").toLowerCase().substring(0, 2);
  return RENEWAL_EMAIL_I18N[norm] || RENEWAL_EMAIL_I18N["en"];
}
function revokeMailBlock(lic, tier, statusLine) {
  return `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Plan / \u5957\u9910\uFF1A</strong> ${tier}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>License / \u6FC0\u6D3B\u7801\uFF1A</strong> <span style="font-family: monospace; text-decoration: line-through; color: #888;">${lic}</span></p>
        <p style="margin: 4px 0; color: #ef4444;"><strong>Status\uFF1A</strong> ${statusLine}</p>
      </div>`;
}
var REVOKE_EMAIL_BY_REASON = {
  refund: {
    zh: {
      subject: "\u3010EQT\u3011\u9000\u6B3E\u5DF2\u5904\u7406 \xB7 \u6388\u6743\u5DF2\u5931\u6548",
      title: "\u9000\u6B3E\u5DF2\u5904\u7406",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">\u60A8\u7684<strong>\u9000\u6B3E</strong>\u7533\u8BF7\u5DF2\u5904\u7406\u5B8C\u6210\u3002\u6B3E\u9879\u5C06\u9000\u56DE\u539F\u652F\u4ED8\u65B9\u5F0F\uFF08\u5230\u8D26\u65F6\u95F4\u4EE5\u652F\u4ED8\u6E20\u9053\u4E3A\u51C6\uFF09\u3002</p>
      <p style="color: #475569; font-size: 14px;">\u4F5C\u4E3A\u9000\u6B3E\u7684\u7ED3\u679C\uFF0C\u4EE5\u4E0B<strong>\u4ED8\u8D39\u6388\u6743\u5DF2\u5931\u6548</strong>\uFF08\u4E0E\u300C\u4EC5\u540A\u9500\u4E0D\u9000\u6B3E\u300D\u4E0D\u540C\uFF09\uFF1A</p>
      ${revokeMailBlock(lic, tier, "\u5DF2\u9000\u6B3E \xB7 \u6388\u6743\u5931\u6548")}
      <p style="color: #64748b; font-size: 13px;">\u5DF2\u6FC0\u6D3B\u8BBE\u5907\u5C06\u5728\u4E0B\u6B21\u8054\u7F51\u5BF9\u8D26\uFF08\u6216\u6700\u8FDF 7 \u5929\u79DF\u7EA6\uFF09\u65F6\u81EA\u52A8\u964D\u7EA7\u4E3A\u514D\u8D39\u7248\u3002</p>`
    },
    en: {
      subject: "[EQT] Refund processed \xB7 license entitlement ended",
      title: "Refund processed",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Your <strong>refund</strong> has been processed. Funds return to the original payment method (timing depends on your provider).</p>
      <p style="color: #475569; font-size: 14px;">As a result of the refund, the following <strong>paid entitlement has ended</strong>:</p>
      ${revokeMailBlock(lic, tier, "Refunded \xB7 entitlement ended")}
      <p style="color: #64748b; font-size: 13px;">Activated devices will downgrade on the next online sync (or within the 7-day offline grace period).</p>`
    }
  },
  chargeback: {
    zh: {
      subject: "\u3010EQT\u3011\u652F\u4ED8\u4E89\u8BAE/\u62D2\u4ED8 \xB7 \u6388\u6743\u5DF2\u5931\u6548",
      title: "\u652F\u4ED8\u4E89\u8BAE\u5BFC\u81F4\u6388\u6743\u5931\u6548",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">\u652F\u4ED8\u6E20\u9053\u901A\u77E5\uFF1A\u8BE5\u8BA2\u5355\u53D1\u751F<strong>\u94F6\u884C\u62D2\u4ED8/\u4E89\u8BAE\uFF08chargeback\uFF09</strong>\u3002\u8FD9<strong>\u4E0D\u662F</strong>\u5BA2\u6237\u81EA\u52A9\u9000\u6B3E\u6D41\u7A0B\u3002</p>
      <p style="color: #475569; font-size: 14px;">\u5BF9\u5E94\u4ED8\u8D39\u6388\u6743\u5DF2\u5931\u6548\uFF1A</p>
      ${revokeMailBlock(lic, tier, "\u62D2\u4ED8 \xB7 \u6388\u6743\u5931\u6548")}
      <p style="color: #64748b; font-size: 13px;">\u5DF2\u6FC0\u6D3B\u8BBE\u5907\u5C06\u5728\u4E0B\u6B21\u8054\u7F51\u5BF9\u8D26\u65F6\u964D\u7EA7\u4E3A\u514D\u8D39\u7248\u3002\u5982\u6709\u7591\u95EE\u8BF7\u8054\u7CFB support@eqt.net.im\u3002</p>`
    },
    en: {
      subject: "[EQT] Payment dispute / chargeback \xB7 license ended",
      title: "Chargeback: entitlement ended",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Our payment provider reported a <strong>chargeback / payment dispute</strong> on this order. This is <strong>not</strong> a customer self-service refund.</p>
      <p style="color: #475569; font-size: 14px;">The related paid entitlement has ended:</p>
      ${revokeMailBlock(lic, tier, "Chargeback \xB7 entitlement ended")}
      <p style="color: #64748b; font-size: 13px;">Devices will downgrade on the next online sync. Contact support@eqt.net.im if you need help.</p>`
    }
  },
  admin: {
    zh: {
      subject: "\u3010EQT\u3011\u6388\u6743\u5DF2\u540A\u9500\uFF08\u8FD0\u8425\u5904\u7406\uFF09",
      title: "\u6388\u6743\u5DF2\u540A\u9500",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">\u60A8\u7684\u6388\u6743\u5DF2\u88AB\u8FD0\u8425\u4FA7<strong>\u540A\u9500</strong>\u3002\u672C\u6B21\u5904\u7406<strong>\u4E0D\u5305\u542B\u9000\u6B3E</strong>\uFF08\u9664\u975E\u53E6\u884C\u901A\u77E5\u652F\u4ED8\u6E20\u9053\uFF09\u3002</p>
      ${revokeMailBlock(lic, tier, "\u5DF2\u540A\u9500 \xB7 \u975E\u9000\u6B3E")}
      <p style="color: #64748b; font-size: 13px;">\u5DF2\u6FC0\u6D3B\u8BBE\u5907\u5C06\u5728\u4E0B\u6B21\u8054\u7F51\u5BF9\u8D26\u65F6\u964D\u7EA7\u4E3A\u514D\u8D39\u7248\u3002</p>`
    },
    en: {
      subject: "[EQT] License revoked (operator action)",
      title: "License revoked",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Your license was <strong>revoked by the operator</strong>. This action <strong>does not include a refund</strong> unless separately processed by the payment provider.</p>
      ${revokeMailBlock(lic, tier, "Revoked \xB7 no refund")}
      <p style="color: #64748b; font-size: 13px;">Devices will downgrade on the next online sync.</p>`
    }
  },
  subscription: {
    zh: {
      subject: "\u3010EQT\u3011\u8BA2\u9605\u5DF2\u7ED3\u675F \xB7 \u6388\u6743\u5931\u6548",
      title: "\u8BA2\u9605\u5DF2\u7ED3\u675F",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">\u60A8\u7684\u8BA2\u9605\u5DF2\u53D6\u6D88\u3001\u903E\u671F\u6216\u6682\u505C\uFF0C\u5BF9\u5E94\u6388\u6743\u5DF2\u5931\u6548\u3002<strong>\u8FD9\u4E0D\u662F\u9000\u6B3E\u901A\u77E5</strong>\u3002</p>
      ${revokeMailBlock(lic, tier, "\u8BA2\u9605\u7ED3\u675F \xB7 \u6388\u6743\u5931\u6548")}
      <p style="color: #64748b; font-size: 13px;">\u5982\u9700\u7EE7\u7EED\u4F7F\u7528\uFF0C\u8BF7\u524D\u5F80\u5B98\u7F51\u91CD\u65B0\u8BA2\u9605\u3002</p>`
    },
    en: {
      subject: "[EQT] Subscription ended \xB7 license inactive",
      title: "Subscription ended",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Your subscription was canceled, past due, or paused. The license is no longer active. <strong>This is not a refund notice.</strong></p>
      ${revokeMailBlock(lic, tier, "Subscription ended")}
      <p style="color: #64748b; font-size: 13px;">Resubscribe on the website if you want to continue.</p>`
    }
  },
  test: {
    zh: {
      subject: "\u3010EQT\u3011[\u6D4B\u8BD5] \u6388\u6743\u5DF2\u672C\u5730\u540A\u9500",
      title: "\u6D4B\u8BD5\u540A\u9500",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">\u8FD9\u662F<strong>\u6D4B\u8BD5\u8DEF\u5F84</strong>\u7684\u672C\u5730\u540A\u9500\u901A\u77E5\uFF0C\u65E0\u771F\u5B9E\u652F\u4ED8\u9000\u6B3E\u3002</p>
      ${revokeMailBlock(lic, tier, "\u6D4B\u8BD5\u540A\u9500")}`
    },
    en: {
      subject: "[EQT] [Test] License revoked locally",
      title: "Test revoke",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">This is a <strong>test-path</strong> local revoke. No real payment refund.</p>
      ${revokeMailBlock(lic, tier, "Test revoke")}`
    }
  }
};
function getLicenseRevokeEmailTemplate(lang, reason = "refund") {
  const norm = (lang || "en").toLowerCase().substring(0, 2);
  const r = (reason || "refund").toLowerCase();
  const byReason = REVOKE_EMAIL_BY_REASON[r] || REVOKE_EMAIL_BY_REASON.refund;
  return byReason[norm] || byReason.en || REVOKE_EMAIL_BY_REASON.refund.en;
}

// src/utils/error-logger.ts
async function ensureAuditLogTable(env) {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS system_error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL DEFAULT 'ERROR',
        category TEXT NOT NULL,
        error_message TEXT NOT NULL,
        context_json TEXT,
        created_at TEXT NOT NULL
      )
    `).run();
  } catch (err) {
    console.error("Failed to ensure audit log table:", err);
  }
}
async function logSystemError(env, category, level, error, context) {
  try {
    await ensureAuditLogTable(env);
    const errorMsg = error instanceof Error ? `${error.message}
${error.stack || ""}` : String(error);
    const contextJson = context ? JSON.stringify(context) : null;
    await env.DB.prepare(
      "INSERT INTO system_error_logs (level, category, error_message, context_json, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(level, category, errorMsg, contextJson, (/* @__PURE__ */ new Date()).toISOString()).run();
  } catch (err) {
    console.error("Failed to log system error to D1:", err);
  }
}

// src/services/smtp.ts
async function sendMailViaSmtp(options) {
  const socket = (0, import_cloudflare_sockets.connect)({ hostname: options.host, port: options.port }, { secureTransport: "on", allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  async function readLine() {
    while (true) {
      const idx = buffer.indexOf("\r\n");
      if (idx !== -1) {
        const line = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.length > 0) {
          const line = buffer;
          buffer = "";
          return line;
        }
        throw new Error("SMTP server closed connection unexpectedly");
      }
      buffer += decoder.decode(value, { stream: true });
    }
  }
  async function readResponse() {
    const lines = [];
    while (true) {
      const line = await readLine();
      lines.push(line);
      if (line.match(/^\d{3} /)) {
        const code = parseInt(line.substring(0, 3));
        return { code, lines };
      }
    }
  }
  async function sendCmd(cmd, expectedCode) {
    await writer.write(encoder.encode(cmd + "\r\n"));
    const resp = await readResponse();
    if (resp.code !== expectedCode) {
      throw new Error(`SMTP command '${cmd.split(" ")[0]}' failed. Expected ${expectedCode}, got ${resp.code}: ${resp.lines.join("; ")}`);
    }
  }
  try {
    let encodeRFC20472 = function(str) {
      if (/^[\x00-\x7F]*$/.test(str)) {
        return str;
      }
      const bytes = new TextEncoder().encode(str);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `=?UTF-8?B?${btoa(binary)}?=`;
    };
    var encodeRFC2047 = encodeRFC20472;
    const greet = await readResponse();
    if (greet.code !== 220) {
      throw new Error(`SMTP connection greeting failed: ${greet.lines.join("; ")}`);
    }
    await sendCmd("EHLO eqt-drm-api", 250);
    await sendCmd("AUTH LOGIN", 334);
    const userBase64 = btoa(options.sender);
    await sendCmd(userBase64, 334);
    const passBase64 = btoa(options.senderPass);
    await sendCmd(passBase64, 235);
    await sendCmd(`MAIL FROM:<${options.sender}>`, 250);
    await sendCmd(`RCPT TO:<${options.to}>`, 250);
    await sendCmd("DATA", 354);
    const encodedSubject = encodeRFC20472(options.subject);
    const bodyLines = [
      `From: "EQT" <${options.sender}>`,
      `To: <${options.to}>`,
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset="utf-8"`,
      ``,
      options.html,
      `.`
    ];
    await sendCmd(bodyLines.join("\r\n"), 250);
    await sendCmd("QUIT", 221);
  } finally {
    writer.releaseLock();
    reader.releaseLock();
    await socket.close();
  }
}
async function sendDRMEmail(env, to, subject, html) {
  const host = env.MAIL_SEND_SERVER;
  const pass = env.MAIL_SENDER_PASSWORD;
  const sender = env.MAIL_SENDER;
  const portStr = env.MAIL_SEND_SAFE_PORT;
  if (!host || !pass || !sender || !portStr) {
    console.warn("DRM SMTP Send Warning: SMTP credentials are not fully configured in env, skipping email delivery.");
    return;
  }
  const port = parseInt(portStr) || 465;
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await sendMailViaSmtp({
        sender,
        senderPass: pass,
        host,
        port,
        to,
        subject,
        html
      });
      console.log(`DRM SMTP Send Success (attempt ${attempt}): Email successfully sent to ${to} with subject "${subject}"`);
      return;
    } catch (err) {
      lastErr = err;
      console.error(`DRM SMTP Send Attempt ${attempt} Error to ${to}:`, err.message || err);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  await logSystemError(env, "SMTP_EMAIL_FAIL", "WARN", lastErr, { to, subject });
  throw lastErr;
}
function renderEmailWrapper(title, contentHtml) {
  return `
    <div style="font-family: Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; color: #334155; line-height: 1.6;">
      <div style="border-bottom: 2px solid #10b981; padding-bottom: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">EQT <span style="font-size: 13px; font-weight: 600; color: #10b981;">Easy QR Transfer</span></span>
        <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Official Notice</span>
      </div>
      <h2 style="color: #0f172a; margin-top: 0; font-size: 18px; font-weight: 700;">${title}</h2>
      ${contentHtml}
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0 16px 0;" />
      <p style="font-size: 12px; color: #94a3b8; margin: 0; text-align: center;">\xA9 2026 EQT (Easy QR Transfer). All rights reserved.</p>
    </div>
  `;
}

// src/utils/license-source.ts
function revokeLicenseSql() {
  return `UPDATE licenses
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, ?),
        revoke_reason = COALESCE(revoke_reason, ?)
    WHERE license_code = ?`;
}
function revokeByPaddleTxnSql() {
  return `UPDATE licenses
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, ?),
        revoke_reason = COALESCE(revoke_reason, ?)
    WHERE paddle_transaction_id = ?`;
}
function revokeByPaddleSubSql() {
  return `UPDATE licenses
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, ?),
        revoke_reason = COALESCE(revoke_reason, ?)
    WHERE paddle_subscription_id = ?`;
}

// src/utils/cf-access-jwt.ts
var JWKS_TTL_MS = 60 * 60 * 1e3;

// src/utils/auth.ts
async function ensureLicenseSourceColumns(env) {
  const alters = [
    "ALTER TABLE licenses ADD COLUMN source TEXT DEFAULT NULL",
    "ALTER TABLE licenses ADD COLUMN revoked_at TEXT DEFAULT NULL",
    "ALTER TABLE licenses ADD COLUMN revoke_reason TEXT DEFAULT NULL",
    "ALTER TABLE licenses ADD COLUMN last_purchased_at TEXT DEFAULT NULL"
  ];
  for (const sql of alters) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
    }
  }
}

// src/routes/paddle.ts
function detectBuyerLang(data) {
  const country = String(
    data.customer?.address?.country_code || data.customer_address?.country_code || data.country_code || ""
  ).toUpperCase();
  if (["CN", "TW", "HK", "MO"].includes(country)) return "zh";
  if (country === "JP") return "ja";
  if (country === "KR") return "ko";
  if (["ES", "MX", "AR", "CO", "CL"].includes(country)) return "es";
  if (["DE", "AT", "CH"].includes(country)) return "de";
  if (["FR", "BE", "CA"].includes(country)) return "fr";
  return "en";
}
async function handlePaddleRoutes(request, env, ctx, url, corsHeaders) {
  if (url.pathname === "/api/v1/paddle/webhook" && request.method === "POST") {
    await ensureLicenseSourceColumns(env);
    const rawBody = await request.text();
    const signature = request.headers.get("paddle-signature");
    const webhookSecret = env.PADDLE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      ctx.waitUntil(logSystemError(
        env,
        "PADDLE_WEBHOOK",
        "CRITICAL",
        new Error("PADDLE_WEBHOOK_SECRET is not configured"),
        { path: url.pathname }
      ));
      return new Response(JSON.stringify({ error: "Paddle Webhook secret is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const isValid = await verifyPaddleSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      ctx.waitUntil(logSystemError(
        env,
        "PADDLE_WEBHOOK",
        "WARN",
        new Error("Invalid Paddle webhook signature"),
        { path: url.pathname, has_signature: Boolean(signature) }
      ));
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (parseErr) {
      ctx.waitUntil(logSystemError(
        env,
        "PADDLE_WEBHOOK",
        "ERROR",
        parseErr,
        { path: url.pathname, reason: "invalid_json" }
      ));
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const eventType = event.event_type;
    const data = event.data;
    console.log("PADDLE_WEBHOOK_EVENT:", JSON.stringify(event));
    try {
      if (eventType === "transaction.completed") {
        const nowMs = Date.now();
        const transactionId = data.id;
        const subscriptionId = data.subscription_id || null;
        let buyerEmail = data.customer?.email || data.billing_details?.email_address || data.customer_email || data.user?.email || data.custom_data?.email || data.custom_data?.buyer_email || data.custom_data?.buyerEmail || "";
        const customerId = data.customer_id || (typeof data.customer === "string" ? data.customer : null);
        if (!buyerEmail && customerId && env.PADDLE_API_KEY) {
          try {
            const isSandbox = env.PADDLE_API_KEY.startsWith("pdl_sdbx_");
            const paddleBaseUrl = isSandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
            const custRes = await fetch(`${paddleBaseUrl}/customers/${customerId}`, {
              headers: { "Authorization": `Bearer ${env.PADDLE_API_KEY}` }
            });
            if (custRes.ok) {
              const custData = await custRes.json();
              buyerEmail = custData.data?.email || "";
            } else {
              const errBody = await custRes.text().catch(() => "");
              ctx.waitUntil(logSystemError(
                env,
                "PADDLE_API_ERROR",
                "WARN",
                new Error(`Paddle customers API HTTP ${custRes.status}`),
                { customer_id: customerId, transaction_id: transactionId, body: errBody.slice(0, 500) }
              ));
            }
          } catch (cErr) {
            console.error("Failed to fetch customer email from Paddle API:", cErr);
            ctx.waitUntil(logSystemError(
              env,
              "PADDLE_API_ERROR",
              "WARN",
              cErr,
              { customer_id: customerId, transaction_id: transactionId, action: "fetch_customer_email" }
            ));
          }
        }
        const existing = await env.DB.prepare(
          "SELECT license_code FROM licenses WHERE paddle_transaction_id = ?"
        ).bind(transactionId).first();
        if (existing) {
          return new Response(JSON.stringify({ message: "Transaction already processed", license_code: existing.license_code }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const items = data.items || [];
        let matchedPriceId = "";
        for (const item of items) {
          const priceId = item.price?.id || item.price_id;
          if (priceId === PRICE_LIFETIME_ID || priceId === PRICE_YEARLY_ID) {
            matchedPriceId = priceId;
            break;
          }
        }
        if (!matchedPriceId) {
          return new Response(JSON.stringify({ message: "No matching EQT pricing items in transaction" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const tier = "PLUS";
        let expiresAt = "LIFETIME";
        let durationDays = null;
        const YEARLY_MS = 365 * 86400 * 1e3;
        if (matchedPriceId === PRICE_YEARLY_ID) {
          durationDays = 365;
          expiresAt = new Date(Date.now() + YEARLY_MS).toISOString();
        }
        let emailHash = "";
        if (buyerEmail) {
          const te = new TextEncoder();
          const emailHashBuf = await crypto.subtle.digest("SHA-256", te.encode(buyerEmail.trim().toLowerCase()));
          emailHash = Array.prototype.map.call(new Uint8Array(emailHashBuf), (x) => ("00" + x.toString(16)).slice(-2)).join("");
        }
        let targetCode = "";
        try {
          const rawCustom = data.custom_data || data.passthrough;
          if (typeof rawCustom === "object" && rawCustom?.target_license_code) {
            targetCode = String(rawCustom.target_license_code).trim();
          } else if (typeof rawCustom === "string" && rawCustom.startsWith("{")) {
            const parsed = JSON.parse(rawCustom);
            if (parsed?.target_license_code) {
              targetCode = String(parsed.target_license_code).trim();
            }
          }
        } catch {
          targetCode = "";
        }
        if (targetCode) {
          const targetLic = await env.DB.prepare(
            `SELECT license_code, expires_at, status, tier, buyer_email, buyer_email_hash, duration_days, created_at, last_purchased_at, paddle_subscription_id, paddle_transaction_id
           FROM licenses WHERE license_code = ?`
          ).bind(targetCode).first();
          let isOwner = false;
          if (targetLic && buyerEmail) {
            const targetEmail = (targetLic.buyer_email || "").trim().toLowerCase();
            const currentEmail = buyerEmail.trim().toLowerCase();
            if (!targetEmail || targetEmail === currentEmail || targetLic.buyer_email_hash && targetLic.buyer_email_hash === emailHash) {
              isOwner = true;
            }
          }
          if (targetLic && isOwner && targetLic.tier === tier && targetLic.status === "active" && targetLic.expires_at !== "LIFETIME") {
            const REFUND_WINDOW_MS = 14 * 86400 * 1e3;
            const lastPurchaseTime = targetLic.last_purchased_at || targetLic.created_at ? new Date(targetLic.last_purchased_at || targetLic.created_at).getTime() : 0;
            const isInRefundWindow = lastPurchaseTime > 0 && nowMs - lastPurchaseTime < REFUND_WINDOW_MS;
            if (matchedPriceId === PRICE_LIFETIME_ID) {
              if (isInRefundWindow) {
                return new Response(JSON.stringify({
                  error: "Target license is within the 14-day refund window of its latest payment. Please request a refund first before purchasing lifetime.",
                  code: "UPGRADE_BLOCKED_REFUND_WINDOW"
                }), {
                  status: 400,
                  headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
              }
              const existingPending = await env.DB.prepare(
                "SELECT id, effective_at FROM license_upgrades WHERE target_license_code = ? AND status = 'pending' LIMIT 1"
              ).bind(targetLic.license_code).first();
              if (existingPending) {
                ctx.waitUntil(logSystemError(
                  env,
                  "DUPLICATE_UPGRADE_ATTEMPT",
                  "WARN",
                  new Error(`Duplicate lifetime upgrade attempted for license ${targetLic.license_code}`),
                  { target_license_code: targetLic.license_code, duplicate_txn_id: transactionId, existing_effective_at: existingPending.effective_at }
                ));
                return new Response(JSON.stringify({
                  error: "Target license already has a pending lifetime upgrade scheduled",
                  code: "UPGRADE_ALREADY_PENDING",
                  license_code: targetLic.license_code,
                  effective_at: existingPending.effective_at
                }), {
                  status: 400,
                  headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
              }
              let effectiveAt = targetLic.expires_at;
              if (!effectiveAt || isNaN(new Date(effectiveAt).getTime()) || new Date(effectiveAt).getTime() < nowMs) {
                effectiveAt = new Date(nowMs).toISOString();
              }
              const nowIso2 = new Date(nowMs).toISOString();
              await env.DB.prepare(`
              INSERT OR IGNORE INTO license_upgrades (
                user_email, target_license_code, lifetime_txn_id, purchased_at, effective_at, status, created_at
              ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
            `).bind(
                buyerEmail || targetLic.buyer_email || "",
                targetLic.license_code,
                transactionId,
                nowIso2,
                effectiveAt,
                nowIso2
              ).run();
              await env.DB.prepare(`
              UPDATE licenses SET
                auto_renew = 0,
                buyer_email = COALESCE(NULLIF(buyer_email, ''), ?),
                buyer_email_hash = COALESCE(NULLIF(buyer_email_hash, ''), ?)
              WHERE license_code = ?
            `).bind(
                buyerEmail || null,
                emailHash || null,
                targetLic.license_code
              ).run();
              const subId = targetLic.paddle_subscription_id;
              if (subId && env.PADDLE_API_KEY) {
                const isSandbox = env.PADDLE_API_KEY.startsWith("pdl_sdbx_");
                const paddleBaseUrl = isSandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
                ctx.waitUntil((async () => {
                  try {
                    const res = await fetch(`${paddleBaseUrl}/subscriptions/${subId}/cancel`, {
                      method: "POST",
                      headers: {
                        "Authorization": `Bearer ${env.PADDLE_API_KEY}`,
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({ effective_from: "next_billing_period" })
                    });
                    if (!res.ok) {
                      const errText = await res.text().catch(() => "");
                      await logSystemError(
                        env,
                        "PADDLE_API_ERROR",
                        "WARN",
                        new Error(`Paddle cancel subscription HTTP ${res.status}`),
                        { subscription_id: subId, license_code: targetLic.license_code, response: errText.slice(0, 300) }
                      );
                    }
                  } catch (e) {
                    await logSystemError(
                      env,
                      "PADDLE_API_ERROR",
                      "WARN",
                      e,
                      { subscription_id: subId, license_code: targetLic.license_code, action: "cancel_subscription" }
                    );
                  }
                })());
              }
              if (buyerEmail) {
                const buyerLang = detectBuyerLang(data);
                const expiresStr = new Date(effectiveAt).toLocaleDateString();
                const tmpl = getRenewalEmailTemplate(buyerLang);
                const emailHtml = renderEmailWrapper(tmpl.title, tmpl.body(targetLic.license_code, `Pending Lifetime (Effective ${expiresStr})`));
                ctx.waitUntil(sendDRMEmail(env, buyerEmail, tmpl.subject, emailHtml));
              }
              return new Response(JSON.stringify({
                message: "Lifetime upgrade purchased and scheduled (pending effective date)",
                license_code: targetLic.license_code,
                effective_at: effectiveAt,
                status: "pending_upgrade"
              }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            } else if (matchedPriceId === PRICE_YEARLY_ID) {
              let newExpires = expiresAt;
              if (targetLic.expires_at) {
                const prev = new Date(targetLic.expires_at).getTime();
                const base = Number.isFinite(prev) ? Math.max(nowMs, prev) : nowMs;
                newExpires = new Date(base + YEARLY_MS).toISOString();
              }
              await env.DB.prepare(`
              UPDATE licenses SET
                status = 'active',
                expires_at = ?,
                duration_days = ?,
                paddle_transaction_id = ?,
                last_purchased_at = ?,
                revoked_at = NULL,
                revoke_reason = NULL,
                buyer_email = COALESCE(NULLIF(buyer_email, ''), ?),
                buyer_email_hash = COALESCE(NULLIF(buyer_email_hash, ''), ?)
              WHERE license_code = ?
            `).bind(
                newExpires,
                targetLic.duration_days ?? null,
                transactionId,
                new Date(nowMs).toISOString(),
                buyerEmail || null,
                emailHash || null,
                targetLic.license_code
              ).run();
              if (buyerEmail) {
                const buyerLang = detectBuyerLang(data);
                const expiresStr = new Date(newExpires).toLocaleDateString();
                const tmpl = getRenewalEmailTemplate(buyerLang);
                const emailHtml = renderEmailWrapper(tmpl.title, tmpl.body(targetLic.license_code, expiresStr));
                ctx.waitUntil(sendDRMEmail(env, buyerEmail, tmpl.subject, emailHtml));
              }
              return new Response(JSON.stringify({
                message: "Target license renewed via payment",
                license_code: targetLic.license_code,
                expires_at: newExpires
              }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
        }
        if (matchedPriceId === PRICE_YEARLY_ID && subscriptionId) {
          const subLicense = await env.DB.prepare(
            `SELECT license_code, expires_at, status, buyer_email, paddle_transaction_id
           FROM licenses WHERE paddle_subscription_id = ?
           ORDER BY created_at ASC LIMIT 1`
          ).bind(subscriptionId).first();
          if (subLicense?.license_code) {
            let newExpires = expiresAt;
            if (subLicense.expires_at && subLicense.expires_at !== "LIFETIME") {
              const prev = new Date(subLicense.expires_at).getTime();
              const base = Number.isFinite(prev) ? Math.max(Date.now(), prev) : Date.now();
              newExpires = new Date(base + YEARLY_MS).toISOString();
            } else if (subLicense.expires_at === "LIFETIME") {
              newExpires = "LIFETIME";
            }
            await env.DB.prepare(`
            UPDATE licenses SET
              status = 'active',
              expires_at = ?,
              duration_days = COALESCE(duration_days, ?),
              paddle_transaction_id = ?,
              last_purchased_at = ?,
              revoked_at = NULL,
              revoke_reason = NULL,
              buyer_email = COALESCE(NULLIF(buyer_email, ''), ?),
              buyer_email_hash = COALESCE(NULLIF(buyer_email_hash, ''), ?)
            WHERE license_code = ?
          `).bind(
              newExpires,
              durationDays,
              transactionId,
              (/* @__PURE__ */ new Date()).toISOString(),
              buyerEmail || null,
              emailHash || null,
              subLicense.license_code
            ).run();
            if (buyerEmail) {
              const buyerLang = detectBuyerLang(data);
              const expiresStr = newExpires === "LIFETIME" ? "Lifetime" : new Date(newExpires).toLocaleDateString();
              const tmpl = getRenewalEmailTemplate(buyerLang);
              const emailHtml = renderEmailWrapper(tmpl.title, tmpl.body(subLicense.license_code, expiresStr));
              ctx.waitUntil(sendDRMEmail(env, buyerEmail, tmpl.subject, emailHtml));
            }
            return new Response(JSON.stringify({
              message: "Subscription renewed; existing license extended",
              license_code: subLicense.license_code,
              renewed: true,
              expires_at: newExpires
            }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }
        const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
        const charSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let randStr = "";
        const randBytes = new Uint8Array(6);
        crypto.getRandomValues(randBytes);
        for (let i = 0; i < 6; i++) {
          randStr += charSet[randBytes[i] % charSet.length];
        }
        const checkSumPayload = `${tier}-${todayStr}-${randStr}`;
        const encoder = new TextEncoder();
        const checkHashBuf = await crypto.subtle.digest("MD5", encoder.encode(checkSumPayload));
        const checkHex = Array.prototype.map.call(new Uint8Array(checkHashBuf), (x) => ("00" + x.toString(16)).slice(-2)).join("").slice(0, 4).toUpperCase();
        const licenseCode = `EQT-${tier}-${todayStr}-${randStr}-${checkHex}`;
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        await env.DB.prepare(`
        INSERT INTO licenses (
          license_code, tier, status, max_devices, expires_at, duration_days,
          buyer_email_hash, buyer_email, paddle_transaction_id, paddle_subscription_id,
          source, created_at, last_purchased_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
          licenseCode,
          tier,
          "active",
          2,
          expiresAt,
          durationDays,
          emailHash || null,
          buyerEmail || null,
          transactionId,
          subscriptionId,
          "purchase",
          nowIso,
          nowIso
        ).run();
        if (buyerEmail) {
          const buyerLang = detectBuyerLang(data);
          const planName = tier === "PLUS" ? "EQT Plus" : tier === "PRO" ? "EQT Pro" : tier;
          const expiresStr = expiresAt === "LIFETIME" ? buyerLang === "zh" ? "Lifetime (\u4E70\u65AD\u6C38\u4E45\u7248)" : "Lifetime" : new Date(expiresAt).toLocaleDateString();
          const tmpl = getPurchaseEmailTemplate(buyerLang);
          const emailHtml = renderEmailWrapper(tmpl.title, tmpl.body(planName, licenseCode, expiresStr));
          ctx.waitUntil(sendDRMEmail(env, buyerEmail, tmpl.subject, emailHtml));
        }
        return new Response(JSON.stringify({ message: "License generated and fulfilled", license_code: licenseCode }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (eventType === "transaction.refunded") {
        const transactionId = data.id;
        const upgradeRow = await env.DB.prepare(
          "SELECT id, target_license_code, status FROM license_upgrades WHERE lifetime_txn_id = ?"
        ).bind(transactionId).first();
        if (upgradeRow) {
          if (upgradeRow.status === "pending") {
            await env.DB.prepare(
              "UPDATE license_upgrades SET status = 'cancelled' WHERE id = ?"
            ).bind(upgradeRow.id).run();
            return new Response(JSON.stringify({ message: "Pending lifetime upgrade cancelled due to refund", status: "cancelled" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          } else if (upgradeRow.status === "applied") {
            await env.DB.prepare(
              "UPDATE license_upgrades SET status = 'cancelled' WHERE id = ?"
            ).bind(upgradeRow.id).run();
            await env.DB.prepare(revokeLicenseSql()).bind((/* @__PURE__ */ new Date()).toISOString(), "refund", upgradeRow.target_license_code).run();
            const targetLic = await env.DB.prepare(
              "SELECT license_code, buyer_email, tier FROM licenses WHERE license_code = ?"
            ).bind(upgradeRow.target_license_code).first();
            if (targetLic && targetLic.buyer_email) {
              const buyerLang = detectBuyerLang(data);
              const planName = targetLic.tier === "PLUS" ? "EQT Plus" : targetLic.tier === "PRO" ? "EQT Pro" : targetLic.tier;
              const t = getLicenseRevokeEmailTemplate(buyerLang, "refund");
              const emailHtml = renderEmailWrapper(t.title, t.body(targetLic.license_code, planName));
              ctx.waitUntil(sendDRMEmail(env, targetLic.buyer_email, t.subject, emailHtml));
            }
            return new Response(JSON.stringify({ message: "Applied lifetime upgrade revoked due to refund", status: "revoked" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        }
        const license = await env.DB.prepare(
          "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_transaction_id = ?"
        ).bind(transactionId).first();
        await env.DB.prepare(revokeByPaddleTxnSql()).bind(
          (/* @__PURE__ */ new Date()).toISOString(),
          "refund",
          transactionId
        ).run();
        if (license && license.buyer_email) {
          const buyerLang = detectBuyerLang(data);
          const planName = license.tier === "PLUS" ? "EQT Plus" : license.tier === "PRO" ? "EQT Pro" : license.tier;
          const t = getLicenseRevokeEmailTemplate(buyerLang, "refund");
          const emailHtml = renderEmailWrapper(t.title, t.body(license.license_code, planName));
          ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.subject, emailHtml));
        }
        return new Response(JSON.stringify({ message: "License revoked due to refund", revoke_reason: "refund" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (eventType === "adjustment.created" || eventType === "adjustment.updated") {
        const action = String(data.action || data.type || "").toLowerCase();
        const transactionId = data.transaction_id || data.transactionId || null;
        if (transactionId && (action === "chargeback" || action === "refund")) {
          const upgradeRow = await env.DB.prepare(
            "SELECT id, target_license_code, status FROM license_upgrades WHERE lifetime_txn_id = ?"
          ).bind(transactionId).first();
          if (upgradeRow) {
            if (upgradeRow.status === "pending") {
              await env.DB.prepare(
                "UPDATE license_upgrades SET status = 'cancelled' WHERE id = ?"
              ).bind(upgradeRow.id).run();
              return new Response(JSON.stringify({ message: "Pending lifetime upgrade cancelled due to adjustment refund", status: "cancelled" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            } else if (upgradeRow.status === "applied") {
              await env.DB.prepare(
                "UPDATE license_upgrades SET status = 'cancelled' WHERE id = ?"
              ).bind(upgradeRow.id).run();
              await env.DB.prepare(revokeLicenseSql()).bind((/* @__PURE__ */ new Date()).toISOString(), action, upgradeRow.target_license_code).run();
              return new Response(JSON.stringify({ message: "Applied lifetime upgrade revoked due to adjustment refund", status: "revoked" }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
          const reason = action === "chargeback" ? "chargeback" : "refund";
          const license = await env.DB.prepare(
            "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_transaction_id = ?"
          ).bind(transactionId).first();
          await env.DB.prepare(revokeByPaddleTxnSql()).bind(
            (/* @__PURE__ */ new Date()).toISOString(),
            reason,
            transactionId
          ).run();
          if (license && license.buyer_email) {
            const buyerLang = detectBuyerLang(data);
            const planName = license.tier === "PLUS" ? "EQT Plus" : license.tier === "PRO" ? "EQT Pro" : license.tier;
            const t = getLicenseRevokeEmailTemplate(buyerLang, reason);
            const emailHtml = renderEmailWrapper(t.title, t.body(license.license_code, planName));
            ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.subject, emailHtml));
          }
          return new Response(JSON.stringify({
            message: `License revoked due to adjustment ${action}`,
            revoke_reason: reason
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
      if (eventType === "subscription.canceled" || eventType === "subscription.updated") {
        const subscriptionId = data.id;
        const status = data.status;
        if (eventType === "subscription.canceled" || status === "canceled") {
          await env.DB.prepare(
            "UPDATE licenses SET auto_renew = 0 WHERE paddle_subscription_id = ?"
          ).bind(subscriptionId).run();
          return new Response(JSON.stringify({ message: "Subscription auto-renewal canceled, license remains active until expires_at" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        if (status === "past_due" || status === "paused") {
          const license = await env.DB.prepare(
            "SELECT license_code, buyer_email, tier FROM licenses WHERE paddle_subscription_id = ?"
          ).bind(subscriptionId).first();
          await env.DB.prepare(revokeByPaddleSubSql()).bind(
            (/* @__PURE__ */ new Date()).toISOString(),
            status,
            subscriptionId
          ).run();
          if (license && license.buyer_email) {
            const buyerLang = detectBuyerLang(data);
            const planName = license.tier === "PLUS" ? "EQT Plus" : license.tier === "PRO" ? "EQT Pro" : license.tier;
            const t = getLicenseRevokeEmailTemplate(buyerLang, "subscription");
            const emailHtml = renderEmailWrapper(t.title, t.body(license.license_code, planName));
            ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.subject, emailHtml));
          }
          return new Response(JSON.stringify({ message: "License revoked due to subscription non-payment/paused" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }
      return new Response(JSON.stringify({ message: `Webhook event '${eventType}' acknowledged` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (webhookErr) {
      console.error("Paddle webhook processing error:", webhookErr);
      ctx.waitUntil(logSystemError(env, "PADDLE_WEBHOOK", "ERROR", webhookErr, {
        path: url.pathname,
        event_type: eventType,
        transaction_id: data?.id || null,
        subscription_id: data?.subscription_id || data?.id || null
      }));
      return new Response(JSON.stringify({ error: "Webhook processing failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
  if (url.pathname === "/api/v1/paddle/license-query" && request.method === "GET") {
    const transactionId = url.searchParams.get("transaction_id");
    if (!transactionId) {
      return new Response(JSON.stringify({ error: "Missing transaction_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const license = await env.DB.prepare(
      "SELECT license_code, tier, expires_at, status FROM licenses WHERE paddle_transaction_id = ?"
    ).bind(transactionId).first();
    if (!license) {
      return new Response(JSON.stringify({ error: "License not generated yet, pending payment confirmation" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      status: license.status,
      license_code: license.license_code,
      tier: license.tier,
      expires_at: license.expires_at
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handlePaddleRoutes
});
