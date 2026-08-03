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

// src/routes/drm.ts
var drm_exports = {};
__export(drm_exports, {
  checkAndApplyPendingUpgrade: () => checkAndApplyPendingUpgrade,
  handleDrmRoutes: () => handleDrmRoutes
});
module.exports = __toCommonJS(drm_exports);

// src/i18n.ts
var API_I18N = {
  too_many_requests: {
    zh: "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5",
    en: "Too many requests. Please try again later.",
    ja: "\u30EA\u30AF\u30A8\u30B9\u30C8\u304C\u591A\u3059\u304E\u307E\u3059\u3002\u5F8C\u307B\u3069\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    ko: "\uC694\uCCAD\uC774 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4. \uB098\uC911\uC5D0 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
    es: "Demasiadas solicitudes. Por favor, int\xE9ntelo de nuevo m\xE1s tarde.",
    de: "Zu viele Anfragen. Bitte versuchen Sie es sp\xE4ter erneut.",
    fr: "Trop de requ\xEAtes. Veuillez r\xE9essayer plus tard."
  },
  unbind_limit_reached: {
    zh: "\u8BE5\u6388\u6743\u7801\u8FC7\u53BB365\u5929\u5185\u5DF2\u8FBE\u52304\u6B21\u89E3\u7ED1\u8BBE\u5907\u4E0A\u9650\uFF0C\u65E0\u6CD5\u7EE7\u7EED\u89E3\u7ED1\u3002",
    en: "Unbind limit reached (maximum 4 device unbinds allowed per 365 days).",
    ja: "\u904E\u53BB365\u65E5\u4EE5\u5185\u306E\u30C7\u30D0\u30A4\u30B9\u89E3\u9664\u4E0A\u9650\uFF08\u6700\u59274\u56DE\uFF09\u306B\u9054\u3057\u307E\u3057\u305F\u3002",
    ko: "\uC9C0\uB09C 365\uC77C \uB3D9\uC548 \uCD5C\uB300 4\uD68C\uC758 \uAE30\uAE30 \uD574\uC81C \uD55C\uB3C4\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4.",
    es: "Se alcanz\xF3 el l\xEDmite de desvinculaci\xF3n (m\xE1ximo 4 desvinculaciones por a\xF1o).",
    de: "Entkopplungslimit erreicht (maximal 4 Ger\xE4teentkopplungen pro 365 Tage).",
    fr: "Limite de dissociation atteinte (maximum 4 dissociations par 365 jours)."
  },
  refund_window_block: {
    zh: "\u76EE\u6807\u6388\u6743\u7801\u5904\u4E8E14\u5929\u9000\u6B3E\u4FDD\u4FEE\u671F\u5185\uFF0C\u4E0D\u652F\u6301\u76F4\u63A5\u5347\u7EA7\uFF0C\u8BF7\u5148\u7533\u8BF7\u9000\u6B3E\u518D\u8D2D\u4E70\u7EC8\u8EAB\u7248\u3002",
    en: "Target license is within the 14-day refund window. Please request a refund first before purchasing lifetime.",
    ja: "\u5BFE\u8C61\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306F14\u65E5\u9593\u306E\u8FD4\u91D1\u4FDD\u8A3C\u671F\u9593\u5185\u3067\u3059\u3002\u5148\u306B\u8FD4\u91D1\u3092\u7533\u8ACB\u3057\u3066\u304B\u3089\u7121\u671F\u9650\u7248\u3092\u3054\u8CFC\u5165\u304F\u3060\u3055\u3044\u3002",
    ko: "\uB300\uC0C1 \uB77C\uC774\uC120\uC2A4\uAC00 14\uC77C \uD658\uBD88 \uBCF4\uC99D \uAE30\uAC04 \uB0B4\uC5D0 \uC788\uC2B5\uB2C8\uB2E4. \uBA3C\uC800 \uD658\uBD88\uC744 \uC2E0\uCCAD\uD55C \uD6C4 \uD3C9\uC0DD \uB77C\uC774\uC120\uC2A4\uB97C \uAD6C\uB9E4\uD574 \uC8FC\uC138\uC694.",
    es: "La licencia de destino est\xE1 dentro del per\xEDodo de reembolso de 14 d\xEDas. Solicite un reembolso primero antes de comprar la versi\xF3n de por vida.",
    de: "Die Ziellizenz befindet sich innerhalb der 14-t\xE4gigen R\xFCckerstattungsfrist. Bitte beantragen Sie zuerst eine R\xFCckerstattung, bevor Sie die Lifetime-Version kaufen.",
    fr: "La licence cible est dans la p\xE9riode de remboursement de 14 jours. Veuillez d'abord demander un remboursement avant d'acheter la version \xE0 vie."
  },
  unbind_success: {
    zh: "\u8BBE\u5907\u5DF2\u6210\u529F\u89E3\u7ED1",
    en: "Device unbound successfully",
    ja: "\u30C7\u30D0\u30A4\u30B9\u306E\u89E3\u9664\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F",
    ko: "\uAE30\uAE30 \uD574\uC81C\uAC00 \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    es: "Dispositivo desvinculado con \xE9xito",
    de: "Ger\xE4t erfolgreich entkoppelt",
    fr: "Appareil dissoci\xE9 avec succ\xE8s"
  },
  unauthorized: {
    zh: "\u8EAB\u4EFD\u9A8C\u8BC1\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55",
    en: "Unauthorized, please sign in again.",
    ja: "\u8A8D\u8A3C\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u518D\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    ko: "\uC778\uC99D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.",
    es: "No autorizado, por favor inicie sesi\xF3n de nuevo.",
    de: "Nicht autorisiert, bitte melden Sie sich erneut an.",
    fr: "Non autoris\xE9, veuillez vous reconnecter."
  },
  session_expired: {
    zh: "\u4F1A\u8BDD\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u83B7\u53D6\u9A8C\u8BC1\u7801\u767B\u5F55",
    en: "Session expired or invalid. Please sign in again.",
    ja: "\u30BB\u30C3\u30B7\u30E7\u30F3\u306E\u671F\u9650\u304C\u5207\u308C\u307E\u3057\u305F\u3002\u518D\u5EA6\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    ko: "\uC138\uC158\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574 \uC8FC\uC138\uC694.",
    es: "Sesi\xF3n expirada o inv\xE1lida. Inicie sesi\xF3n de nuevo.",
    de: "Sitzung abgelaufen oder ung\xFCltig. Bitte erneut anmelden.",
    fr: "Session expir\xE9e ou invalide. Veuillez vous reconnecter."
  },
  missing_params: {
    zh: "\u8BF7\u6C42\u53C2\u6570\u7F3A\u5931",
    en: "Missing required parameters",
    ja: "\u5FC5\u4FEE\u30D1\u30E9\u30E1\u30FC\u30BF\u304C\u4E0D\u8DB3\u3057\u3066\u3044\u307E\u3059",
    ko: "\uD544\uC218 \uB9E4\uAC1C\uBCC0\uC218\uAC00 \uB204\uB77D\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    es: "Faltan par\xE1metros requeridos",
    de: "Erforderliche Parameter fehlen",
    fr: "Param\xE8tres requis manquants"
  },
  license_not_found: {
    zh: "\u672A\u627E\u5230\u5BF9\u5E94\u7684\u6388\u6743\u7801",
    en: "License code not found",
    ja: "\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093",
    ko: "\uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "C\xF3digo de licencia no encontrado",
    de: "Lizenzcode nicht gefunden",
    fr: "Code de licence introuvable"
  },
  no_purchase_history: {
    zh: "\u672A\u627E\u5230\u8BE5\u90AE\u7BB1\u7684\u8D2D\u4E70\u8BB0\u5F55\uFF0C\u8BF7\u786E\u8BA4\u90AE\u7BB1\u6216\u5148\u8D2D\u4E70\u6388\u6743\u5957\u9910",
    en: "No purchase history found for this email. Please check your email or purchase a license plan first.",
    ja: "\u3053\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u8CFC\u5165\u5C65\u6B74\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3092\u78BA\u8A8D\u3059\u308B\u304B\u3001\u30E9\u30A4\u30BB\u30F3\u30B9\u3092\u3054\u8CFC\u5165\u304F\u3060\u3055\u3044\u3002",
    ko: "\uC774 \uC774\uBA54\uC77C\uC758 \uAD6C\uB9E4 \uB0B4\uC5ED\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC774\uBA54\uC77C\uC744 \uD655\uC778\uD558\uAC70\uB098 \uB77C\uC774\uC120\uC2A4 \uD50C\uB79C\uC744 \uBA3C\uC800 \uAD6C\uB9E4\uD574 \uC8FC\uC138\uC694.",
    es: "No se encontraron compras para este correo electr\xF3nico. Por favor, compru\xE9belo o adquiera un plan primero.",
    de: "Keine Kaufhistorie f\xFCr diese E-Mail-Adresse gefunden. Bitte \xFCberpr\xFCfen Sie Ihre E-Mail oder kaufen Sie zuerst ein Paket.",
    fr: "Aucun historique d'achat trouv\xE9 pour cet e-mail. Veuillez v\xE9rifier votre e-mail ou acheter un forfait."
  },
  rate_limited: {
    zh: "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7 60 \u79D2\u540E\u518D\u8BD5",
    en: "Please wait 60 seconds before requesting another code",
    ja: "\u30EA\u30AF\u30A8\u30B9\u30C8\u304C\u591A\u3059\u304E\u307E\u3059\u300260\u79D2\u5F8C\u306B\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
    ko: "\uC694\uCCAD\uC774 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4. 60\uCD08 \uD6C4\uC5D0 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
    es: "Demasiadas solicitudes. Espere 60 segundos e int\xE9ntelo de nuevo.",
    de: "Zu viele Anfragen. Bitte warten Sie 60 Sekunden.",
    fr: "Trop de demandes. Veuillez attendre 60 secondes."
  },
  not_license_owner: {
    zh: "\u60A8\u65E0\u6743\u64CD\u4F5C\u6B64\u6388\u6743\u7801",
    en: "You do not own this license",
    ja: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u3092\u64CD\u4F5C\u3059\u308B\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093",
    ko: "\uC774 \uB77C\uC774\uC120\uC2A4\uC5D0 \uB300\uD55C \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "No es propietario de esta licencia",
    de: "Sie besitzen diese Lizenz nicht",
    fr: "Vous n'\xEAtes pas propri\xE9taire de cette licence"
  },
  activation_not_found: {
    zh: "\u672A\u627E\u5230\u5BF9\u5E94\u7684\u8BBE\u5907\u6FC0\u6D3B\u8BB0\u5F55",
    en: "Activation record not found",
    ja: "\u30C7\u30D0\u30A4\u30B9\u306E\u30A2\u30AF\u30C6\u30A3\u30D9\u30FC\u30B7\u30E7\u30F3\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093",
    ko: "\uAE30\uAE30 \uD65C\uC131\uD654 \uAE30\uB85D\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "No se encontr\xF3 el registro de activaci\xF3n",
    de: "Aktivierungsdatensatz nicht gefunden",
    fr: "Enregistrement d'activation introuvable"
  },
  license_already_revoked: {
    zh: "\u8BE5\u6388\u6743\u5DF2\u9000\u6B3E\u6216\u540A\u9500",
    en: "License is already refunded or revoked",
    ja: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306F\u65E2\u306B\u8FD4\u91D1\u307E\u305F\u306F\u5931\u52B9\u3057\u3066\u3044\u307E\u3059",
    ko: "\uC774\uBBF8 \uD658\uBD88\uB418\uC5C8\uAC70\uB098 \uCDE8\uC18C\uB41C \uB77C\uC774\uC120\uC2A4\uC785\uB2C8\uB2E4",
    es: "La licencia ya fue reembolsada o revocada",
    de: "Lizenz wurde bereits erstattet oder widerrufen",
    fr: "La licence est d\xE9j\xE0 rembours\xE9e ou r\xE9voqu\xE9e"
  },
  lifetime_cannot_renew: {
    zh: "\u7EC8\u8EAB\u6388\u6743\u65E0\u9700\u7EED\u671F",
    en: "Lifetime licenses cannot be renewed",
    ja: "\u6C38\u4E45\u30E9\u30A4\u30BB\u30F3\u30B9\u306F\u66F4\u65B0\u3067\u304D\u307E\u305B\u3093",
    ko: "\uC601\uAD6C \uB77C\uC774\uC120\uC2A4\uB294 \uC5F0\uC7A5\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "Las licencias de por vida no se pueden renovar",
    de: "Lifetime-Lizenzen k\xF6nnen nicht verl\xE4ngert werden",
    fr: "Les licences \xE0 vie ne peuvent pas \xEAtre renouvel\xE9es"
  },
  lifetime_already_owned: {
    zh: "\u60A8\u5DF2\u62E5\u6709\u8BE5\u7EA7\u522B\u7684\u7EC8\u8EAB\u6388\u6743\uFF0C\u65E0\u9700\u91CD\u590D\u8D2D\u4E70",
    en: "You already own a lifetime license for this tier",
    ja: "\u3053\u306E\u30C6\u30A3\u30A2\u306E\u6C38\u4E45\u30E9\u30A4\u30BB\u30F3\u30B9\u3092\u65E2\u306B\u6240\u6709\u3057\u3066\u3044\u307E\u3059",
    ko: "\uC774\uBBF8 \uC774 \uB4F1\uAE09\uC758 \uC601\uAD6C \uB77C\uC774\uC120\uC2A4\uB97C \uC18C\uC720\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4",
    es: "Ya posee una licencia de por vida para este nivel",
    de: "Sie besitzen bereits eine Lifetime-Lizenz f\xFCr diese Stufe",
    fr: "Vous poss\xE9dez d\xE9j\xE0 une licence \xE0 vie pour ce niveau"
  },
  entitlement_term_yearly: {
    zh: "\u5E74\u5EA6\u8BA2\u9605",
    en: "Yearly Subscription",
    ja: "\u5E74\u9593\u30B5\u30D6\u30B9\u30AF\u30EA\u30D7\u30B7\u30E7\u30F3",
    ko: "\uC5F0\uAC04 \uAD6C\uB3C5",
    es: "Suscripci\xF3n anual",
    de: "Jahresabonnement",
    fr: "Abonnement annuel"
  },
  no_paddle_transaction: {
    zh: "\u8BE5\u6388\u6743\u65E0\u5173\u8054\u7684 Paddle \u4EA4\u6613\uFF0C\u65E0\u6CD5\u81EA\u52A9\u9000\u6B3E",
    en: "No associated Paddle transaction found for this license",
    ja: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306B\u95A2\u9023\u3059\u308B Paddle \u53D6\u5F15\u304C\u3042\u308A\u307E\u305B\u3093",
    ko: "\uC774 \uB77C\uC774\uC120\uC2A4\uC5D0 \uC5F0\uACB0\uB41C Paddle \uAC70\uB798\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "No hay transacci\xF3n de Paddle asociada a esta licencia",
    de: "Keine zugeh\xF6rige Paddle-Transaktion f\xFCr diese Lizenz gefunden",
    fr: "Aucune transaction Paddle associ\xE9e \xE0 cette licence"
  },
  refund_not_allowed_for_source: {
    zh: "\u8BE5\u6388\u6743\u4E3A\u6D3B\u52A8\u8D60\u9001\u6216\u975E\u8D2D\u4E70\u6E20\u9053\u53D1\u653E\uFF0C\u4E0D\u652F\u6301\u81EA\u52A9\u9000\u6B3E",
    en: "This license is promotional or non-purchase and is not eligible for self-service refund",
    ja: "\u30AD\u30E3\u30F3\u30DA\u30FC\u30F3\u7B49\u306E\u975E\u8CFC\u5165\u30E9\u30A4\u30BB\u30F3\u30B9\u306E\u305F\u3081\u8FD4\u91D1\u3067\u304D\u307E\u305B\u3093",
    ko: "\uD504\uB85C\uBAA8\uC158/\uBE44\uAD6C\uB9E4 \uB77C\uC774\uC120\uC2A4\uB294 \uC790\uAC00 \uD658\uBD88\uC774 \uBD88\uAC00\uD569\uB2C8\uB2E4",
    es: "Esta licencia promocional o no comprada no admite reembolso autoservicio",
    de: "Promo-/Nicht-Kauf-Lizenzen sind nicht selbst erstattungsf\xE4hig",
    fr: "Licence promotionnelle ou non achet\xE9e : remboursement libre-service indisponible"
  },
  blacklist_email: {
    zh: "\u8BE5\u90AE\u7BB1\u5728\u8FC7\u53BB 365 \u5929\u5185\u56E0\u5DF2\u6FC0\u6D3B\u6388\u6743\u7684\u9000\u6B3E/\u62D2\u4ED8\u8FBE\u5230 3 \u6B21\u53CA\u4EE5\u4E0A\uFF0C\u6682\u65F6\u65E0\u6CD5\u8D2D\u4E70\u6216\u6FC0\u6D3B\u3002\u8BF7\u66F4\u6362\u90AE\u7BB1\u6216\u8054\u7CFB support@eqt.net.im\u3002",
    en: "This email is restricted for 365 days after 3 or more refund/chargeback revocations on activated licenses. Use another email or contact support@eqt.net.im.",
    ja: "\u3053\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306F\u3001\u904E\u53BB365\u65E5\u4EE5\u5185\u306E\u6709\u52B9\u5316\u6E08\u307F\u30E9\u30A4\u30BB\u30F3\u30B9\u306E\u8FD4\u91D1/\u30C1\u30E3\u30FC\u30B8\u30D0\u30C3\u30AF\u304C3\u56DE\u4EE5\u4E0A\u306E\u305F\u3081\u5236\u9650\u3055\u308C\u3066\u3044\u307E\u3059\u3002",
    ko: "\uC774 \uC774\uBA54\uC77C\uC740 \uCD5C\uADFC 365\uC77C \uB0B4 \uD65C\uC131\uD654\uB41C \uB77C\uC774\uC120\uC2A4\uC758 \uD658\uBD88/\uCC28\uC9C0\uBC31\uC774 3\uD68C \uC774\uC0C1\uC774\uB77C \uC81C\uD55C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
    es: "Este correo est\xE1 restringido por 3 o m\xE1s reembolsos/contracargos de licencias activadas en 365 d\xEDas.",
    de: "Diese E-Mail ist wegen 3+ Erstattungen/Chargebacks aktivierter Lizenzen (365 Tage) eingeschr\xE4nkt.",
    fr: "Cet e-mail est restreint apr\xE8s 3 remboursements/chargebacks ou plus sur licences activ\xE9es (365 jours)."
  },
  blacklist_device: {
    zh: "\u8BE5\u8BBE\u5907\u5728\u8FC7\u53BB 365 \u5929\u5185\u56E0\u9000\u6B3E/\u62D2\u4ED8\u8FBE\u5230 3 \u6B21\u53CA\u4EE5\u4E0A\uFF0C\u65E0\u6CD5\u5728\u6B64\u8BBE\u5907\u6FC0\u6D3B\u3002\u8BF7\u66F4\u6362\u8BBE\u5907\u6FC0\u6D3B\uFF0C\u6216\u82E5\u521A\u7528\u5176\u4ED6\u90AE\u7BB1\u8D2D\u4E70\u53EF\u7533\u8BF7\u9000\u6B3E\u540E\u6539\u7528\u5176\u4ED6\u8BBE\u5907\u3002",
    en: "This device is restricted for 365 days after 3 or more refund/chargeback revocations. Activate on another device, or request a refund if you just purchased with a different email.",
    ja: "\u3053\u306E\u7AEF\u672B\u306F\u8FD4\u91D1/\u30C1\u30E3\u30FC\u30B8\u30D0\u30C3\u30AF\u304C3\u56DE\u4EE5\u4E0A\u306E\u305F\u3081\u5236\u9650\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u5225\u306E\u7AEF\u672B\u3067\u6709\u52B9\u5316\u3059\u308B\u304B\u3001\u8FD4\u91D1\u5F8C\u306B\u5225\u7AEF\u672B\u3092\u3054\u5229\u7528\u304F\u3060\u3055\u3044\u3002",
    ko: "\uC774 \uAE30\uAE30\uB294 \uD658\uBD88/\uCC28\uC9C0\uBC31\uC774 3\uD68C \uC774\uC0C1\uC774\uB77C \uC81C\uD55C\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB2E4\uB978 \uAE30\uAE30\uC5D0\uC11C \uD65C\uC131\uD654\uD558\uAC70\uB098 \uD658\uBD88 \uD6C4 \uB2E4\uB978 \uAE30\uAE30\uB97C \uC0AC\uC6A9\uD558\uC138\uC694.",
    es: "Este dispositivo est\xE1 restringido por 3+ reembolsos/contracargos. Use otro dispositivo o solicite reembolso.",
    de: "Dieses Ger\xE4t ist wegen 3+ Erstattungen/Chargebacks eingeschr\xE4nkt. Anderes Ger\xE4t nutzen oder Erstattung beantragen.",
    fr: "Cet appareil est restreint (3+ remboursements/chargebacks). Utilisez un autre appareil ou demandez un remboursement."
  },
  paddle_not_configured: {
    zh: "\u9000\u6B3E\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u8054\u7CFB\u652F\u6301",
    en: "Refund service is temporarily unavailable",
    ja: "\u8FD4\u91D1\u30B5\u30FC\u30D3\u30B9\u306F\u4E00\u6642\u7684\u306B\u5229\u7528\u3067\u304D\u307E\u305B\u3093",
    ko: "\uD658\uBD88 \uC11C\uBE44\uC2A4\uB97C \uC77C\uC2DC\uC801\uC73C\uB85C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "El servicio de reembolso no est\xE1 disponible temporalmente",
    de: "Erstattungsservice vor\xFCbergehend nicht verf\xFCgbar",
    fr: "Service de remboursement temporairement indisponible"
  },
  refund_success: {
    zh: "\u9000\u6B3E\u5DF2\u63D0\u4EA4\uFF0C\u6388\u6743\u5DF2\u88AB\u540A\u9500",
    en: "Refund request initiated successfully. Your license has been revoked.",
    ja: "\u8FD4\u91D1\u7533\u8ACB\u304C\u5B8C\u4E86\u3057\u3001\u30E9\u30A4\u30BB\u30F3\u30B9\u306F\u5931\u52B9\u3057\u307E\u3057\u305F",
    ko: "\uD658\uBD88\uC774 \uC811\uC218\uB418\uC5C8\uC73C\uBA70 \uB77C\uC774\uC120\uC2A4\uAC00 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    es: "Reembolso iniciado. La licencia ha sido revocada.",
    de: "R\xFCckerstattung eingeleitet. Ihre Lizenz wurde widerrufen.",
    fr: "Remboursement initi\xE9. Votre licence a \xE9t\xE9 r\xE9voqu\xE9e."
  },
  /** Synthetic / e2e transaction IDs (txn_test_*, etc.) — local revoke only, no Paddle money movement. */
  refund_test_local_success: {
    zh: "\u6D4B\u8BD5\u8BA2\u5355\u5DF2\u672C\u5730\u540A\u9500\uFF08\u65E0\u771F\u5B9E\u652F\u4ED8\u6E20\u9053\u9000\u6B3E\uFF09",
    en: "Test license revoked locally (no real payment-channel refund)",
    ja: "\u30C6\u30B9\u30C8\u6CE8\u6587\u3092\u30ED\u30FC\u30AB\u30EB\u3067\u5931\u52B9\u3057\u307E\u3057\u305F\uFF08\u5B9F\u8FD4\u91D1\u306A\u3057\uFF09",
    ko: "\uD14C\uC2A4\uD2B8 \uC8FC\uBB38\uC774 \uB85C\uCEEC\uC5D0\uC11C \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4(\uC2E4\uC81C \uD658\uBD88 \uC5C6\uC74C)",
    es: "Licencia de prueba revocada localmente (sin reembolso real)",
    de: "Testlizenz lokal widerrufen (keine echte Erstattung)",
    fr: "Licence de test r\xE9voqu\xE9e localement (pas de vrai remboursement)"
  },
  paddle_transaction_invalid: {
    zh: "\u5173\u8054\u7684\u4EA4\u6613\u5355\u53F7\u65E0\u6548\uFF0C\u65E0\u6CD5\u5411\u652F\u4ED8\u6E20\u9053\u53D1\u8D77\u9000\u6B3E",
    en: "Associated transaction ID is invalid; cannot refund via payment channel",
    ja: "\u95A2\u9023\u53D6\u5F15ID\u304C\u7121\u52B9\u306A\u305F\u3081\u8FD4\u91D1\u3067\u304D\u307E\u305B\u3093",
    ko: "\uC5F0\uACB0\uB41C \uAC70\uB798 ID\uAC00 \uC720\uD6A8\uD558\uC9C0 \uC54A\uC544 \uD658\uBD88\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "El ID de transacci\xF3n asociado no es v\xE1lido",
    de: "Zugeh\xF6rige Transaktions-ID ist ung\xFCltig",
    fr: "L'identifiant de transaction associ\xE9 est invalide"
  },
  cross_code_stacking_blocked: {
    zh: "\u5F53\u524D\u8BBE\u5907\u5DF2\u7ED1\u5B9A\u751F\u6548\u4E2D\u7684\u5176\u5B83\u6388\u6743\u7801\u3002\u7CFB\u7EDF\u4E0D\u652F\u6301\u591A\u4E2A\u6FC0\u6D3B\u7801\u76F4\u63A5\u53E0\u52A0\uFF0C\u8BF7\u5148\u89E3\u7ED1\u65E7\u8BBE\u5907\u540E\u518D\u4F7F\u7528\u65B0\u6FC0\u6D3B\u7801\u3002",
    en: "Current device is bound to another active license. Stacking across different license codes is disabled. Please unbind the existing license first.",
    ja: "\u73FE\u5728\u306E\u30C7\u30D0\u30A4\u30B9\u306F\u4ED6\u306E\u6709\u52B9\u306A\u30E9\u30A4\u30BB\u30F3\u30B9\u306B\u30D0\u30A4\u30F3\u30C9\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u8907\u6570\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9\u306E\u76F4\u63A5\u91CD\u8907\u306F\u30B5\u30DD\u30FC\u30C8\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u89E3\u7D04\u30FB\u89E3\u9664\u5F8C\u306B\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    ko: "\uD604\uC7AC \uAE30\uAE30\uC5D0 \uB2E4\uB978 \uD65C\uC131 \uB77C\uC774\uC120\uC2A4\uAC00 \uBC14\uC778\uB529\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4. \uC11C\uB85C \uB2E4\uB978 \uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC\uC758 \uC9C1\uC811 \uC911\uBCF5\uC740 \uC9C0\uC6D0\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uAE30\uC874 \uAE30\uAE30 \uD574\uC81C \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
    es: "El dispositivo actual est\xE1 vinculado a otra licencia activa. No se permite la superposici\xF3n de diferentes c\xF3digos. Desvincule la licencia existente primero.",
    de: "Das aktuelle Ger\xE4t ist an eine andere aktive Lizenz gebunden. Das Stapeln verschiedener Lizenzcodes ist deaktiviert. Bitte entkoppeln Sie zuerst die bestehende Lizenz.",
    fr: "L'appareil actuel est li\xE9 \xE0 une autre licence active. Le cumul de codes de licence diff\xE9rents est d\xE9sactiv\xE9. Veuillez d'abord dissocier la licence existante."
  },
  lifetime_stacking_blocked: {
    zh: "\u5F53\u524D\u8BBE\u5907\u5DF2\u7ED1\u5B9A\u751F\u6548\u4E2D\u7684\u5176\u5B83\u6388\u6743\u7801\u3002\u7CFB\u7EDF\u4E0D\u652F\u6301\u591A\u4E2A\u6FC0\u6D3B\u7801\u76F4\u63A5\u53E0\u52A0\uFF0C\u8BF7\u5148\u89E3\u7ED1\u65E7\u8BBE\u5907\u540E\u518D\u4F7F\u7528\u65B0\u6FC0\u6D3B\u7801\u3002",
    en: "Current device is bound to another active license. Stacking across different license codes is disabled. Please unbind the existing license first.",
    ja: "\u73FE\u5728\u306E\u30C7\u30D0\u30A4\u30B9\u306F\u4ED6\u306E\u6709\u52B9\u306A\u30E9\u30A4\u30BB\u30F3\u30B9\u306B\u30D0\u30A4\u30F3\u30C9\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u8907\u6570\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9\u306E\u76F4\u63A5\u91CD\u8907\u306F\u30B5\u30DD\u30FC\u30C8\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u89E3\u7D04\u30FB\u89E3\u9664\u5F8C\u306B\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    ko: "\uD604\uC7AC \uAE30\uAE30\uC5D0 \uB2E4\uB978 \uD65C\uC131 \uB77C\uC774\uC120\uC2A4\uAC00 \uBC14\uC778\uB529\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4. \uC11C\uB85C \uB2E4\uB978 \uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC\uC758 \uC9C1\uC811 \uC911\uBCF5\uC740 \uC9C0\uC6D0\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uAE30\uC874 \uAE30\uAE30 \uD574\uC81C \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
    es: "El dispositivo actual est\xE1 vinculado a otra licencia activa. No se permite la superposici\xF3n de diferentes c\xF3digos. Desvincule la licencia existente primero.",
    de: "Das aktuelle Ger\xE4t ist an eine andere aktive Lizenz gebunden. Das Stapeln verschiedener Lizenzcodes ist deaktiviert. Bitte entkoppeln Sie zuerst die bestehende Lizenz.",
    fr: "L'appareil actuel est li\xE9 \xE0 une autre licence active. Le cumul de codes de licence diff\xE9rents est d\xE9sactiv\xE9. Veuillez d'abord dissocier la licence existante."
  },
  refund_failed: {
    zh: "\u9000\u6B3E\u5904\u7406\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5",
    en: "Failed to process refund",
    ja: "\u8FD4\u91D1\u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F",
    ko: "\uD658\uBD88 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4",
    es: "Error al procesar el reembolso",
    de: "R\xFCckerstattung fehlgeschlagen",
    fr: "\xC9chec du traitement du remboursement"
  },
  no_paddle_subscription: {
    zh: "\u8BE5\u6388\u6743\u65E0\u5173\u8054\u7684\u8BA2\u9605\uFF0C\u65E0\u6CD5\u53D6\u6D88\u7EED\u8D39",
    en: "No subscription is linked to this license",
    ja: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306B\u95A2\u9023\u3059\u308B\u30B5\u30D6\u30B9\u30AF\u30EA\u30D7\u30B7\u30E7\u30F3\u304C\u3042\u308A\u307E\u305B\u3093",
    ko: "\uC774 \uB77C\uC774\uC120\uC2A4\uC5D0 \uC5F0\uACB0\uB41C \uAD6C\uB3C5\uC774 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "No hay suscripci\xF3n asociada a esta licencia",
    de: "Kein Abonnement mit dieser Lizenz verkn\xFCpft",
    fr: "Aucun abonnement associ\xE9 \xE0 cette licence"
  },
  cancel_not_allowed: {
    zh: "\u8BE5\u6388\u6743\u65E0\u6CD5\u53D6\u6D88\u8BA2\u9605\uFF08\u975E\u5E74\u4ED8\u8BA2\u9605\u6216\u72B6\u6001\u4E0D\u53EF\u7528\uFF09",
    en: "This license cannot cancel a subscription (not an active yearly subscription)",
    ja: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u3067\u306F\u30B5\u30D6\u30B9\u30AF\u30EA\u30D7\u30B7\u30E7\u30F3\u3092\u89E3\u7D04\u3067\u304D\u307E\u305B\u3093",
    ko: "\uC774 \uB77C\uC774\uC120\uC2A4\uB294 \uAD6C\uB3C5\uC744 \uCDE8\uC18C\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "Esta licencia no puede cancelar una suscripci\xF3n",
    de: "F\xFCr diese Lizenz kann kein Abonnement gek\xFCndigt werden",
    fr: "Cette licence ne peut pas annuler d'abonnement"
  },
  cancel_success: {
    zh: "\u8BA2\u9605\u5DF2\u53D6\u6D88\uFF0C\u6388\u6743\u5DF2\u7ACB\u5373\u5931\u6548\uFF08\u8FD9\u4E0D\u662F\u9000\u6B3E\uFF09",
    en: "Subscription canceled. License revoked immediately (this is not a refund).",
    ja: "\u30B5\u30D6\u30B9\u30AF\u30EA\u30D7\u30B7\u30E7\u30F3\u3092\u89E3\u7D04\u3057\u3001\u30E9\u30A4\u30BB\u30F3\u30B9\u306F\u5373\u6642\u5931\u52B9\u3057\u307E\u3057\u305F\uFF08\u8FD4\u91D1\u3067\u306F\u3042\u308A\u307E\u305B\u3093\uFF09",
    ko: "\uAD6C\uB3C5\uC774 \uCDE8\uC18C\uB418\uC5C8\uACE0 \uB77C\uC774\uC120\uC2A4\uAC00 \uC989\uC2DC \uD574\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4(\uD658\uBD88 \uC544\uB2D8)",
    es: "Suscripci\xF3n cancelada. Licencia revocada de inmediato (no es un reembolso).",
    de: "Abo gek\xFCndigt. Lizenz sofort widerrufen (keine Erstattung).",
    fr: "Abonnement annul\xE9. Licence r\xE9voqu\xE9e imm\xE9diatement (ce n'est pas un remboursement)."
  },
  cancel_test_local_success: {
    zh: "\u6D4B\u8BD5\u8BA2\u9605\u5DF2\u672C\u5730\u53D6\u6D88\u5E76\u540A\u9500\uFF08\u672A\u8C03\u7528 Paddle\uFF09",
    en: "Test subscription canceled locally (no Paddle call)",
    ja: "\u30C6\u30B9\u30C8\u8CFC\u8AAD\u3092\u30ED\u30FC\u30AB\u30EB\u3067\u89E3\u7D04\u3057\u307E\u3057\u305F\uFF08Paddle \u672A\u547C\u51FA\uFF09",
    ko: "\uD14C\uC2A4\uD2B8 \uAD6C\uB3C5\uC774 \uB85C\uCEEC\uC5D0\uC11C \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4(Paddle \uD638\uCD9C \uC5C6\uC74C)",
    es: "Suscripci\xF3n de prueba cancelada localmente (sin Paddle)",
    de: "Test-Abo lokal gek\xFCndigt (kein Paddle-Aufruf)",
    fr: "Abonnement de test annul\xE9 localement (sans Paddle)"
  },
  cancel_failed: {
    zh: "\u53D6\u6D88\u8BA2\u9605\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u8054\u7CFB support@eqt.net.im",
    en: "Failed to cancel subscription. Try again or contact support@eqt.net.im",
    ja: "\u89E3\u7D04\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002support@eqt.net.im \u307E\u3067\u3054\u9023\u7D61\u304F\u3060\u3055\u3044",
    ko: "\uAD6C\uB3C5 \uCDE8\uC18C\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. support@eqt.net.im \uC73C\uB85C \uBB38\uC758\uD574 \uC8FC\uC138\uC694",
    es: "No se pudo cancelar la suscripci\xF3n. Contacte support@eqt.net.im",
    de: "Abo-K\xFCndigung fehlgeschlagen. support@eqt.net.im kontaktieren",
    fr: "\xC9chec de l'annulation. Contactez support@eqt.net.im"
  },
  invoice_not_available: {
    zh: "\u8BE5\u6388\u6743\u6CA1\u6709\u53EF\u67E5\u8BE2\u7684 Paddle \u4EA4\u6613\u5355\uFF0C\u65E0\u6CD5\u6253\u5F00\u53D1\u7968",
    en: "No Paddle transaction is linked; invoice is not available",
    ja: "\u95A2\u9023\u3059\u308B Paddle \u53D6\u5F15\u304C\u306A\u3044\u305F\u3081\u8ACB\u6C42\u66F8\u3092\u958B\u3051\u307E\u305B\u3093",
    ko: "\uC5F0\uACB0\uB41C Paddle \uAC70\uB798\uAC00 \uC5C6\uC5B4 \uC778\uBCF4\uC774\uC2A4\uB97C \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "No hay transacci\xF3n de Paddle; factura no disponible",
    de: "Keine Paddle-Transaktion verkn\xFCpft; Rechnung nicht verf\xFCgbar",
    fr: "Aucune transaction Paddle ; facture indisponible"
  },
  invoice_paddle_unavailable: {
    zh: "\u8D26\u5355\u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528\u3002\u8BF7\u5C06\u4EA4\u6613\u5355\u53F7\u53D1\u7ED9 support@eqt.net.im \u534F\u52A9\u67E5\u8BE2",
    en: "Billing service is temporarily unavailable. Email support@eqt.net.im with your transaction ID",
    ja: "\u8ACB\u6C42\u30B5\u30FC\u30D3\u30B9\u306F\u4E00\u6642\u5229\u7528\u4E0D\u53EF\u3067\u3059\u3002\u53D6\u5F15ID\u3092 support@eqt.net.im \u307E\u3067\u304A\u9001\u308A\u304F\u3060\u3055\u3044",
    ko: "\uCCAD\uAD6C \uC11C\uBE44\uC2A4\uB97C \uC77C\uC2DC\uC801\uC73C\uB85C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uAC70\uB798 ID\uB97C support@eqt.net.im \uC73C\uB85C \uBCF4\uB0B4 \uC8FC\uC138\uC694",
    es: "Servicio de facturaci\xF3n no disponible. Escriba a support@eqt.net.im con el ID de transacci\xF3n",
    de: "Abrechnung vor\xFCbergehend nicht verf\xFCgbar. Transaktions-ID an support@eqt.net.im senden",
    fr: "Facturation indisponible. Envoyez l'ID de transaction \xE0 support@eqt.net.im"
  },
  invoice_manual_help: {
    zh: "\u8BF7\u590D\u5236\u4EA4\u6613\u5355\u53F7\uFF0C\u53D1\u9001\u81F3 support@eqt.net.im\uFF0C\u6216\u767B\u5F55 Paddle \u53D1\u7ED9\u60A8\u7684\u8D26\u5355\u90AE\u4EF6\u67E5\u770B\u53D1\u7968",
    en: "Copy the transaction ID and email support@eqt.net.im, or open the receipt email from Paddle",
    ja: "\u53D6\u5F15ID\u3092\u30B3\u30D4\u30FC\u3057\u3066 support@eqt.net.im \u3078\u9001\u308B\u304B\u3001Paddle \u306E\u9818\u53CE\u30E1\u30FC\u30EB\u3092\u3054\u78BA\u8A8D\u304F\u3060\u3055\u3044",
    ko: "\uAC70\uB798 ID\uB97C \uBCF5\uC0AC\uD574 support@eqt.net.im \uC73C\uB85C \uBCF4\uB0B4\uAC70\uB098 Paddle \uC601\uC218\uC99D \uBA54\uC77C\uC744 \uD655\uC778\uD558\uC138\uC694",
    es: "Copie el ID de transacci\xF3n y escriba a support@eqt.net.im, o abra el correo de Paddle",
    de: "Transaktions-ID kopieren und an support@eqt.net.im senden, oder die Paddle-Mail \xF6ffnen",
    fr: "Copiez l'ID de transaction et \xE9crivez \xE0 support@eqt.net.im, ou ouvrez l'e-mail Paddle"
  },
  invoice_failed: {
    zh: "\u6253\u5F00\u53D1\u7968\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u8054\u7CFB support@eqt.net.im",
    en: "Could not open invoice. Try again or contact support@eqt.net.im",
    ja: "\u8ACB\u6C42\u66F8\u3092\u958B\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002support@eqt.net.im \u307E\u3067\u3054\u9023\u7D61\u304F\u3060\u3055\u3044",
    ko: "\uC778\uBCF4\uC774\uC2A4\uB97C \uC5F4 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. support@eqt.net.im \uC73C\uB85C \uBB38\uC758\uD574 \uC8FC\uC138\uC694",
    es: "No se pudo abrir la factura. Contacte support@eqt.net.im",
    de: "Rechnung konnte nicht ge\xF6ffnet werden. support@eqt.net.im kontaktieren",
    fr: "Impossible d'ouvrir la facture. Contactez support@eqt.net.im"
  },
  license_not_active: {
    zh: "\u8BE5\u6388\u6743\u5F53\u524D\u4E0D\u53EF\u7528\uFF08\u5DF2\u540A\u9500\u6216\u6682\u505C\uFF09\uFF0C\u65E0\u6CD5\u89E3\u7ED1\u8BBE\u5907",
    en: "License is not active (revoked or suspended); unbind is not allowed",
    ja: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306F\u7121\u52B9\u307E\u305F\u306F\u505C\u6B62\u4E2D\u306E\u305F\u3081\u3001\u30C7\u30D0\u30A4\u30B9\u89E3\u9664\u3067\u304D\u307E\u305B\u3093",
    ko: "\uB77C\uC774\uC120\uC2A4\uAC00 \uD65C\uC131 \uC0C1\uD0DC\uAC00 \uC544\uB2C8\uC5B4\uC11C \uAE30\uAE30 \uD574\uC81C\uB97C \uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4",
    es: "La licencia no est\xE1 activa; no se puede desvincular el dispositivo",
    de: "Lizenz ist nicht aktiv; Entkopplung nicht erlaubt",
    fr: "Licence inactive ; dissociation non autoris\xE9e"
  },
  too_many_verify_attempts: {
    zh: "\u9A8C\u8BC1\u7801\u9519\u8BEF\u6B21\u6570\u8FC7\u591A\uFF0C\u8BF7 15 \u5206\u949F\u540E\u518D\u8BD5",
    en: "Too many failed verification attempts. Please try again in 15 minutes.",
    ja: "\u8A8D\u8A3C\u306E\u5931\u6557\u304C\u591A\u3059\u304E\u307E\u3059\u300215\u5206\u5F8C\u306B\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
    ko: "\uC778\uC99D \uC2E4\uD328 \uD69F\uC218\uAC00 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4. 15\uBD84 \uD6C4\uC5D0 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.",
    es: "Demasiados intentos fallidos. Espere 15 minutos e int\xE9ntelo de nuevo.",
    de: "Zu viele fehlgeschlagene Versuche. Bitte in 15 Minuten erneut versuchen.",
    fr: "Trop de tentatives \xE9chou\xE9es. R\xE9essayez dans 15 minutes."
  },
  missing_license_code: {
    zh: "\u6FC0\u6D3B\u7801\u4E0D\u80FD\u4E3A\u7A7A",
    en: "Missing license code",
    ja: "\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044",
    ko: "\uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC\uB97C \uC785\uB825\uD574 \uC8FC\uC138\uC694",
    es: "Falta el c\xF3digo de licencia",
    de: "Lizenzcode fehlt",
    fr: "Code de licence manquant"
  },
  license_suspended_or_revoked: {
    zh: "\u8BE5\u6388\u6743\u7801\u5F53\u524D\u4E0D\u53EF\u7528\uFF08\u5DF2\u6682\u505C\u4F7F\u7528\u3001\u9000\u6B3E\u6216\u540A\u9500\uFF09",
    en: "License is suspended, refunded, or revoked",
    ja: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306F\u505C\u6B62\u3001\u8FD4\u91D1\u3001\u307E\u305F\u306F\u5931\u52B9\u3057\u3066\u3044\u307E\u3059",
    ko: "\uB77C\uC774\uC120\uC2A4\uAC00 \uC815\uC9C0, \uD658\uBD88 \uB610\uB294 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    es: "La licencia est\xE1 suspendida, reembolsada o revocada",
    de: "Lizenz ist ausgesetzt, erstattet oder widerrufen",
    fr: "La licence est suspendue, rembours\xE9e ou r\xE9voqu\xE9e"
  },
  license_redeem_expired: {
    zh: "\u8BE5\u6388\u6743\u7801\u5DF2\u8D85\u8FC7\u5151\u6362\u622A\u6B62\u65F6\u95F4\uFF0C\u65E0\u6CD5\u7EE7\u7EED\u6FC0\u6D3B",
    en: "This license code has passed its redeem deadline and can no longer be activated.",
    ja: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9\u306F\u5F15\u304D\u63DB\u3048\u671F\u9650\u3092\u904E\u304E\u3066\u3044\u308B\u305F\u3081\u6709\u52B9\u5316\u3067\u304D\u307E\u305B\u3093\u3002",
    ko: "\uC774 \uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC\uB294 \uAD50\uD658 \uB9CC\uB8CC\uC77C\uC774 \uC9C0\uB098 \uB354 \uC774\uC0C1 \uD65C\uC131\uD654\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    es: "Este c\xF3digo de licencia ha pasado su fecha l\xEDmite de canje.",
    de: "Dieser Lizenzcode hat seine Einl\xF6sefrist \xFCberschritten.",
    fr: "Ce code de licence a d\xE9pass\xE9 sa date limite d'activation."
  },
  license_expired: {
    zh: "\u8BE5\u6388\u6743\u7801\u5DF2\u8D85\u8FC7\u6709\u6548\u671F",
    en: "License has expired",
    ja: "\u30E9\u30A4\u30BB\u30F3\u30B9\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059",
    ko: "\uB77C\uC774\uC120\uC2A4 \uC720\uD6A8 \uAE30\uAC04\uC774 \uB9CC\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    es: "La licencia ha expirado",
    de: "Lizenz ist abgelaufen",
    fr: "La licence a expir\xE9"
  },
  max_devices_reached: {
    zh: "\u8BE5\u6388\u6743\u7801\u6FC0\u6D3B\u8BBE\u5907\u6570\u91CF\u5DF2\u8FBE\u4E0A\u9650\uFF08\u53EF\u901A\u8FC7 Portal \u89E3\u7ED1\u65E7\u8BBE\u5907\uFF09",
    en: "Maximum number of devices reached for this license (unbind old devices in Portal)",
    ja: "\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u306E\u30A2\u30AF\u30C6\u30A3\u30D9\u30FC\u30B7\u30E7\u30F3\u7AEF\u672B\u6570\u304C\u4E0A\u9650\u306B\u9054\u3057\u307E\u3057\u305F",
    ko: "\uC774 \uB77C\uC774\uC120\uC2A4\uC758 \uAE30\uAE30 \uD65C\uC131\uD654 \uC218\uAC00 \uCD5C\uB300 \uD55C\uB3C4\uC5D0 \uB3C4\uB2EC\uD588\uC2B5\uB2C8\uB2E4",
    es: "Se alcanz\xF3 el n\xFAmero m\xE1ximo de dispositivos para esta licencia",
    de: "Maximale Anzahl an Ger\xE4ten f\xFCr diese Lizenz erreicht",
    fr: "Nombre maximal d'appareils atteint pour cette licence"
  },
  auto_renew_off_success: {
    zh: "\u81EA\u52A8\u7EED\u8D39\u5DF2\u5173\u95ED\u3002\u60A8\u7684 Plus \u6743\u76CA\u53EF\u7EE7\u7EED\u6B63\u5E38\u4F7F\u7528\u81F3\u5230\u671F\u65E5\uFF0C\u5C4A\u65F6\u5C06\u4E0D\u4F1A\u81EA\u52A8\u6263\u8D39\u3002",
    en: "Auto-renewal disabled. Your Plus status remains active until expiration date, and you will not be billed again.",
    ja: "\u81EA\u52D5\u66F4\u65B0\u3092\u30AA\u30D5\u306B\u3057\u307E\u3057\u305F\u3002\u6709\u52B9\u671F\u9650\u307E\u3067 Plus \u6A5F\u80FD\u3092\u5F15\u304D\u7D9A\u304D\u3054\u5229\u7528\u3044\u305F\u3060\u3051\u307E\u3059\u3002",
    ko: "\uC790\uB3D9 \uAC31\uC2E0\uC774 \uD574\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB9CC\uB8CC\uC77C\uAE4C\uC9C0 Plus \uD61C\uD0DD\uC744 \uACC4\uC18D \uC774\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
    es: "Renovaci\xF3n autom\xE1tica desactivada. Su estado Plus permanece activo hasta la fecha de expiraci\xF3n.",
    de: "Automatische Verl\xE4ngerung deaktiviert. Ihr Plus-Status bleibt bis zum Ablaufdatum aktiv.",
    fr: "Renouvellement automatique d\xE9sactiv\xE9. Votre statut Plus reste actif jusqu'\xE0 la date d'expiration."
  },
  auto_renew_on_success: {
    zh: "\u81EA\u52A8\u7EED\u8D39\u5DF2\u5F00\u542F\u3002\u5C06\u4E8E\u5230\u671F\u65E5\u81EA\u52A8\u6263\u8D39\u7EED\u8BA2\u9605\u3002",
    en: "Auto-renewal enabled. Your subscription will renew automatically on the expiration date.",
    ja: "\u81EA\u52D5\u66F4\u65B0\u3092\u30AA\u30F3\u306B\u3057\u307E\u3057\u305F\u3002\u6709\u52B9\u671F\u9650\u65E5\u306B\u81EA\u52D5\u7684\u306B\u66F4\u65B0\u3055\u308C\u307E\u3059\u3002",
    ko: "\uC790\uB3D9 \uAC31\uC2E0\uC774 \uC124\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uB9CC\uB8CC\uC77C\uC5D0 \uC790\uB3D9\uC73C\uB85C \uAC31\uC2E0\uB429\uB2C8\uB2E4.",
    es: "Renovaci\xF3n autom\xE1tica activada. Su suscripci\xF3n se renovar\xE1 autom\xE1ticamente en la fecha de expiraci\xF3n.",
    de: "Automatische Verl\xE4ngerung aktiviert. Ihr Abonnement wird am Ablaufdatum automatisch verl\xE4ngert.",
    fr: "Renouvellement automatique activ\xE9. Votre abonnement se renouveltera automatiquement \xE0 la date d'expiration."
  },
  toast_code_sent: {
    zh: "\u9A8C\u8BC1\u7801\u5DF2\u53D1\u9001\u81F3\u60A8\u7684\u90AE\u7BB1\uFF0C\u8BF7\u6CE8\u610F\u67E5\u6536\u3002",
    en: "Verification code sent to your email.",
    ja: "\u8A8D\u8A3C\u30B3\u30FC\u30C9\u3092\u30E1\u30FC\u30EB\u306B\u9001\u4FE1\u3057\u307E\u3057\u305F\u3002",
    ko: "\uC774\uBA54\uC77C\uB85C \uC778\uC99D \uCF54\uB4DC\uAC00 \uC804\uC1A1\uB418\uC5C8\uC2B5\uB2C8\uB2E4.",
    es: "C\xF3digo enviado a tu correo.",
    de: "Best\xE4tigungscode an Ihre E-Mail gesendet.",
    fr: "Code de v\xE9rification envoy\xE9 \xE0 votre e-mail."
  },
  device_not_activated: {
    zh: "\u6B64\u8BBE\u5907\u672A\u5728\u7ED9\u5B9A\u7684\u6388\u6743\u7801\u4E0B\u6FC0\u6D3B",
    en: "This device is not activated under the provided license",
    ja: "\u3053\u306E\u30C7\u30D0\u30A4\u30B9\u306F\u6307\u5B9A\u3055\u308C\u305F\u30E9\u30A4\u30BB\u30F3\u30B9\u3067\u30A2\u30AF\u30C6\u30A3\u30D9\u30FC\u30C8\u3055\u308C\u3066\u3044\u307E\u305B\u3093",
    ko: "\uC774 \uAE30\uAE30\uB294 \uD574\uB2F9 \uB77C\uC774\uC120\uC2A4\uB85C \uD65C\uC131\uD654\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4",
    es: "Este dispositivo no est\xE1 activado bajo la licencia proporcionada",
    de: "Dieses Ger\xE4t ist nicht unter der angegebenen Lizenz aktiviert",
    fr: "Cet appareil n'est pas activ\xE9 sous la licence fournie"
  }
};
function extractRequestLang(request, body) {
  if (body && typeof body.lang === "string" && body.lang.trim()) {
    return body.lang.trim();
  }
  const acceptLang = request.headers.get("Accept-Language");
  if (acceptLang) {
    const primary = acceptLang.split(",")[0].trim().toLowerCase();
    if (primary.startsWith("zh")) return "zh";
    if (primary.startsWith("ja")) return "ja";
    if (primary.startsWith("ko")) return "ko";
    if (primary.startsWith("es")) return "es";
    if (primary.startsWith("de")) return "de";
    if (primary.startsWith("fr")) return "fr";
  }
  return "en";
}
function getApiTranslation(key, lang) {
  const norm = (lang || "en").toLowerCase().substring(0, 2);
  const dict = API_I18N[key];
  if (!dict) return key;
  return dict[norm] || dict["zh"] || dict["en"] || key;
}
var DEVICE_NOTIFICATION_I18N = {
  zh: {
    boundSubject: "\u3010EQT \u6388\u6743\u5B89\u5168\u63D0\u9192\u3011\u60A8\u7684\u6388\u6743\u7801\u5DF2\u7ED1\u5B9A\u65B0\u8BBE\u5907",
    boundTitle: "\u65B0\u8BBE\u5907\u6FC0\u6D3B\u901A\u77E5",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">\u5C0A\u656C\u7684\u7528\u6237\uFF0C\u60A8\u7684 EQT \u6388\u6743\u7801\u5DF2\u5728\u65B0\u7684\u786C\u4EF6\u8BBE\u5907\u4E0A\u5B8C\u6210\u7ED1\u5B9A\uFF1A</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>\u6388\u6743\u7801\uFF1A</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u7ED1\u5B9A\u65F6\u95F4\uFF1A</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u8BBE\u5907\u7279\u5F81\u6458\u8981\uFF1A</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u5DF2\u7528\u8BBE\u5907\u6570\uFF1A</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">\u82E5\u975E\u60A8\u672C\u4EBA\u64CD\u4F5C\uFF0C\u8BF7\u53CA\u65F6\u524D\u5F80\u7528\u6237\u81EA\u670D\u52A1\u95E8\u6237\u89E3\u7ED1\u975E\u6CD5\u8BBE\u5907\u3002</p>`,
    unboundSubject: "\u3010EQT \u6388\u6743\u5B89\u5168\u63D0\u9192\u3011\u60A8\u7684\u6388\u6743\u7801\u5DF2\u6210\u529F\u89E3\u7ED1\u4E00\u53F0\u8BBE\u5907",
    unboundTitle: "\u8BBE\u5907\u89E3\u7ED1\u6210\u529F\u901A\u77E5",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">\u5C0A\u656C\u7684\u7528\u6237\uFF0C\u60A8\u7684 EQT \u6388\u6743\u7801\u5DF2\u6210\u529F\u89E3\u7ED1\u4E00\u53F0\u786C\u4EF6\u8BBE\u5907\uFF1A</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>\u6388\u6743\u7801\uFF1A</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u89E3\u7ED1\u65F6\u95F4\uFF1A</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u8FC7\u53BB 365 \u5929\u5269\u4F59\u89E3\u7ED1\u989D\u5EA6\uFF1A</strong> ${remainingUnbinds} / 4 \u6B21</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>\u8BBE\u5907\u6062\u590D\u4E0E\u91CD\u65B0\u7ED1\u5B9A\u8BF4\u660E\uFF1A</strong><br/>
      1. \u89E3\u7ED1\u540E\u7A7A\u51FA\u7684\u8BBE\u5907\u989D\u5EA6\u73B0\u53EF\u7528\u4E8E\u7ED1\u5B9A\u65B0\u7684\u8BBE\u5907\u3002<br/>
      2. \u5982\u9700\u5728\u539F\u8BBE\u5907\u6216\u65B0\u8BBE\u5907\u4E0A\u6062\u590D\u4ED8\u8D39\u6388\u6743\uFF0C\u53EA\u9700\u5728\u76EE\u6807\u8BBE\u5907\u4E0A\u6253\u5F00 EQT \u5BA2\u6237\u7AEF\u5E76\u91CD\u65B0\u8F93\u5165\u8BE5\u6388\u6743\u7801\u6FC0\u6D3B\u5373\u53EF\u3002<br/>
      3. \u6263\u51CF\u7684\u89E3\u7ED1\u989D\u5EA6\u5C06\u5728\u8BE5\u89E3\u7ED1\u64CD\u4F5C\u53D1\u751F 365 \u5929\u540E\u81EA\u52A8\u6062\u590D\u3002</p>`
  },
  en: {
    boundSubject: "[EQT Security Alert] New Device Bound to Your License",
    boundTitle: "New Device Activated",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Hello, a new hardware device has been bound to your EQT license:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>License Code:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Activated At:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Device Hash:</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Devices In Use:</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">If you did not authorize this action, please visit the self-service portal to unbind unknown devices.</p>`,
    unboundSubject: "[EQT Security Alert] Device Unbound from Your License",
    unboundTitle: "Device Unbound Successfully",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Hello, a device has been unbound from your EQT license:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>License Code:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Unbound At:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Remaining Yearly Unbind Quota:</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Device Slot & Restoration Guide:</strong><br/>
      1. The freed device slot is now available for new device activations.<br/>
      2. To restore authorization on a device, simply open EQT on that target device and re-enter this license code.<br/>
      3. Used unbind quota automatically recovers 365 days after the operation date.</p>`
  },
  ja: {
    boundSubject: "\u3010EQT \u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u8B66\u544A\u3011\u65B0\u3057\u3044\u30C7\u30D0\u30A4\u30B9\u304C\u30E9\u30A4\u30BB\u30F3\u30B9\u306B\u9023\u643A\u3055\u308C\u307E\u3057\u305F",
    boundTitle: "\u65B0\u898F\u30C7\u30D0\u30A4\u30B9\u30A2\u30AF\u30C6\u30A3\u30D9\u30FC\u30B7\u30E7\u30F3\u901A\u77E5",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">EQT \u30E9\u30A4\u30BB\u30F3\u30B9\u306B\u65B0\u3057\u3044\u30CF\u30FC\u30C9\u30A6\u30A7\u30A2\u30C7\u30D0\u30A4\u30B9\u304C\u9023\u643A\u3055\u308C\u307E\u3057\u305F\uFF1A</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9\uFF1A</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u30A2\u30AF\u30C6\u30A3\u30D9\u30FC\u30C8\u65E5\u6642\uFF1A</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u30C7\u30D0\u30A4\u30B9\u30CF\u30C3\u30B7\u30E5\uFF1A</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u4F7F\u7528\u4E2D\u30C7\u30D0\u30A4\u30B9\u6570\uFF1A</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">\u5FC3\u5F53\u305F\u308A\u306E\u306A\u3044\u5834\u5408\u306F\u3001\u30AB\u30B9\u30BF\u30DE\u30FC\u30DD\u30FC\u30BF\u30EB\u304B\u3089\u89E3\u9664\u3092\u884C\u3063\u3066\u304F\u3060\u3055\u3044\u3002</p>`,
    unboundSubject: "\u3010EQT \u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u8B66\u544A\u3011\u30C7\u30D0\u30A4\u30B9\u306E\u9023\u643A\u89E3\u9664\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F",
    unboundTitle: "\u30C7\u30D0\u30A4\u30B9\u9023\u643A\u89E3\u9664\u901A\u77E5",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">EQT \u30E9\u30A4\u30BB\u30F3\u30B9\u304B\u3089\u30C7\u30D0\u30A4\u30B9\u306E\u9023\u643A\u304C\u6B63\u5E38\u306B\u89E3\u9664\u3055\u308C\u307E\u3057\u305F\uFF1A</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9\uFF1A</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u89E3\u9664\u65E5\u6642\uFF1A</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\u904E\u53BB365\u65E5\u4EE5\u5185\u306E\u6B8B\u308A\u89E3\u9664\u67A0\uFF1A</strong> ${remainingUnbinds} / 4 \u56DE</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>\u30C7\u30D0\u30A4\u30B9\u5FA9\u5143\u3068\u518D\u9023\u643A\u306B\u3064\u3044\u3066\uFF1A</strong><br/>
      1. \u7A7A\u3044\u305F\u30C7\u30D0\u30A4\u30B9\u67A0\u306F\u65B0\u3057\u3044\u30C7\u30D0\u30A4\u30B9\u306E\u30A2\u30AF\u30C6\u30A3\u30D9\u30FC\u30B7\u30E7\u30F3\u306B\u4F7F\u7528\u3067\u304D\u307E\u3059\u3002<br/>
      2. \u30C7\u30D0\u30A4\u30B9\u3067\u6709\u6599\u6A5F\u80FD\u3092\u518D\u6709\u52B9\u5316\u3059\u308B\u306B\u306F\u3001EQT \u30A2\u30D7\u30EA\u3092\u8D77\u52D5\u3057\u3066\u3053\u306E\u30E9\u30A4\u30BB\u30F3\u30B9\u30B3\u30FC\u30C9\u3092\u518D\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002<br/>
      3. \u6D88\u8CBB\u3055\u308C\u305F\u89E3\u9664\u67A0\u306F\u3001\u64CD\u4F5C\u65E5\u304B\u3089365\u65E5\u7D4C\u904E\u5F8C\u306B\u81EA\u52D5\u7684\u306B\u56DE\u5FA9\u3057\u307E\u3059\u3002</p>`
  },
  ko: {
    boundSubject: "\u3010EQT \uBCF4\uC548 \uC54C\uB9BC\u3011\uC0C8 \uAE30\uAE30\uAC00 \uB77C\uC774\uC120\uC2A4\uC5D0 \uC5F0\uB3D9\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    boundTitle: "\uC0C8 \uAE30\uAE30 \uC778\uC99D \uC54C\uB9BC",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">EQT \uB77C\uC774\uC120\uC2A4\uC5D0 \uC0C8\uB85C\uC6B4 \uD558\uB4DC\uC6E8\uC5B4 \uAE30\uAE30\uAC00 \uC5F0\uB3D9\uB418\uC5C8\uC2B5\uB2C8\uB2E4:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>\uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC\uFF1A</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\uC778\uC99D \uC2DC\uAC04\uFF1A</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\uAE30\uAE30 \uD574\uC2DC\uFF1A</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\uC0AC\uC6A9 \uC911 \uAE30\uAE30 \uC218\uFF1A</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">\uBCF8\uC778\uC758 \uC694\uCCAD\uC774 \uC544\uB2CC \uACBD\uC6B0 \uD3EC\uD138\uC5D0\uC11C \uC784\uC758 \uAE30\uAE30\uB97C \uD574\uC81C\uD574 \uC8FC\uC138\uC694.</p>`,
    unboundSubject: "\u3010EQT \uBCF4\uC548 \uC54C\uB9BC\u3011\uAE30\uAE30 \uC5F0\uB3D9\uC774 \uD574\uC81C\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
    unboundTitle: "\uAE30\uAE30 \uC5F0\uB3D9 \uD574\uC81C \uC644\uB8CC",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">EQT \uB77C\uC774\uC120\uC2A4\uC5D0\uC11C \uAE30\uAE30 \uC5F0\uB3D9 \uD574\uC81C\uAC00 \uC131\uACF5\uC801\uC73C\uB85C \uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>\uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC\uFF1A</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\uD574\uC81C \uC2DC\uAC04\uFF1A</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>\uCD5C\uADFC 365\uC77C \uB0A8\uC740 \uD574\uC81C \uD69F\uC218\uFF1A</strong> ${remainingUnbinds} / 4 \uD68C</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>\uAE30\uAE30 \uBCF5\uAD6C \uBC0F \uC7AC\uC5F0\uB3D9 \uC548\uB0B4\uFF1A</strong><br/>
      1. \uD655\uBCF4\uB41C \uC2AC\uB86F\uC740 \uC0C8\uB85C\uC6B4 \uAE30\uAE30 \uC778\uC99D\uC5D0 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.<br/>
      2. \uD574\uC81C\uB41C \uAE30\uAE30\uC5D0\uC11C \uC778\uC99D\uC744 \uB2E4\uC2DC \uBCF5\uAD6C\uD558\uB824\uBA74 EQT \uC571\uC5D0\uC11C \uB77C\uC774\uC120\uC2A4 \uCF54\uB4DC\uB97C \uB2E4\uC2DC \uC785\uB825\uD574 \uC8FC\uC138\uC694.<br/>
      3. \uC0AC\uC6A9\uB41C \uD574\uC81C \uD69F\uC218\uB294 \uD574\uB2F9 \uC791\uC5C5\uC77C \uAE30\uC900 365\uC77C \uD6C4 \uC790\uB3D9\uC73C\uB85C \uBCF5\uAD6C\uB429\uB2C8\uB2E4.</p>`
  },
  es: {
    boundSubject: "[EQT Alerta de Seguridad] Nuevo dispositivo vinculado a su licencia",
    boundTitle: "Nuevo dispositivo activado",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Hola, se ha vinculado un nuevo dispositivo a su licencia EQT:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>C\xF3digo de licencia:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Fecha de activaci\xF3n:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Hash de dispositivo:</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Dispositivos en uso:</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Si no autoriz\xF3 esta acci\xF3n, desvincule los dispositivos en el portal de autoservicio.</p>`,
    unboundSubject: "[EQT Alerta de Seguridad] Dispositivo desvinculado con \xE9xito",
    unboundTitle: "Dispositivo desvinculado",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Un dispositivo se ha desvinculado correctamente de su licencia EQT:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>C\xF3digo de licencia:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Fecha de desvinculaci\xF3n:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Cupo anual restante de desvinculaciones:</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Gu\xEDa de restauraci\xF3n de dispositivos:</strong><br/>
      1. El espacio liberado est\xE1 listo para activarse en un nuevo dispositivo.<br/>
      2. Para restaurar la licencia en un dispositivo, abra EQT en el dispositivo de destino y vuelva a ingresar este c\xF3digo.<br/>
      3. El cupo de desvinculaci\xF3n consumido se restaura autom\xE1ticamente 365 d\xEDas despu\xE9s de la operaci\xF3n.</p>`
  },
  de: {
    boundSubject: "[EQT Sicherheitsmeldung] Neues Ger\xE4t mit Ihrer Lizenz verkn\xFCpft",
    boundTitle: "Neues Ger\xE4t aktiviert",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Hallo, ein neues Ger\xE4t wurde mit Ihrer EQT-Lizenz verkn\xFCpft:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Lizenzschl\xFCssel:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Aktiviert am:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Ger\xE4te-Hash:</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Verwendete Ger\xE4te:</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Wenn Sie dies nicht autorisiert haben, trennen Sie unbekannte Ger\xE4te im Selbstbedienungsportal.</p>`,
    unboundSubject: "[EQT Sicherheitsmeldung] Ger\xE4t erfolgreich entkoppelt",
    unboundTitle: "Ger\xE4teentkopplung erfolgreich",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Ein Ger\xE4t wurde erfolgreich von Ihrer EQT-Lizenz getrennt:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Lizenzschl\xFCssel:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Entkoppelt am:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Verbleibendes Jahreskontingent:</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Wiederherstellung & Neukopplung:</strong><br/>
      1. Der freigegebene Platz steht f\xFCr eine neue Ger\xE4teaktivierung zur Verf\xFCgung.<br/>
      2. Um die Lizenz auf einem Ger\xE4t wiederherzustellen, geben Sie den Schl\xFCssel in EQT erneut ein.<br/>
      3. Das verbrauchte Kontingent wird 365 Tage nach dem Entkopplungsdatum automatisch wiederhergestellt.</p>`
  },
  fr: {
    boundSubject: "[EQT Alerte de S\xE9curit\xE9] Nouveau p\xE9riph\xE9rique li\xE9 \xE0 votre licence",
    boundTitle: "Nouveau p\xE9riph\xE9rique activ\xE9",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Bonjour, un nouveau p\xE9riph\xE9rique a \xE9t\xE9 li\xE9 \xE0 votre licence EQT :</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Cl\xE9 de licence :</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Activ\xE9 le :</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Hash de l'appareil :</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>P\xE9riph\xE9riques utilis\xE9s :</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Si vous n'avez pas autoris\xE9 cette action, rendez-vous sur le portail client pour d\xE9lier l'appareil.</p>`,
    unboundSubject: "[EQT Alerte de S\xE9curit\xE9] P\xE9riph\xE9rique dissoci\xE9 avec succ\xE8s",
    unboundTitle: "Dissociation du p\xE9riph\xE9rique r\xE9ussie",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Un p\xE9riph\xE9rique a \xE9t\xE9 dissoci\xE9 avec succ\xE8s de votre licence EQT :</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Cl\xE9 de licence :</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Dissoci\xE9 le :</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Quota annuel restant de dissociation :</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Restauration & R\xE9association :</strong><br/>
      1. Emplacement lib\xE9r\xE9 disponible pour l'activation d'un nouveau p\xE9riph\xE9rique.<br/>
      2. Pour restaurer la licence sur un appareil cible, ouvrez EQT et ressaisissez cette cl\xE9 de licence.<br/>
      3. Le quota de dissociation consomm\xE9 se restaure automatiquement 365 jours apr\xE8s la date de l'op\xE9ration.</p>`
  }
};
function getDeviceNoticeTemplate(lang) {
  const norm = (lang || "en").toLowerCase().substring(0, 2);
  return DEVICE_NOTIFICATION_I18N[norm] || DEVICE_NOTIFICATION_I18N["zh"] || DEVICE_NOTIFICATION_I18N["en"];
}

// src/utils/crypto.ts
function hexToUint8Array(hex) {
  hex = hex.trim();
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    array[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return array;
}
function bufToHex(buffer) {
  return Array.prototype.map.call(new Uint8Array(buffer), (x) => ("00" + x.toString(16)).slice(-2)).join("");
}

// src/types.ts
var ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1e3;
var MAX_YEARLY_ABUSIVE_REFUNDS = 3;

// src/utils/license-source.ts
var REAL_PADDLE_TXN = /^txn_01[a-z0-9]{16,}$/i;
var SYNTHETIC_TXN = /^(txn_test_|txn_chrome_|txn_mock_|txn_e2e_|txn_yearly_)/i;
function isRealPaddleTransactionId(transactionId) {
  if (!transactionId) return false;
  if (isSyntheticTestTransactionId(transactionId)) return false;
  return REAL_PADDLE_TXN.test(transactionId);
}
function isSyntheticTestTransactionId(transactionId) {
  return !!transactionId && SYNTHETIC_TXN.test(transactionId);
}
function normalizeLicenseSource(raw, paddleTransactionId) {
  const s = (raw || "").trim().toLowerCase();
  if (s === "purchase" || s === "promo" || s === "admin" || s === "test") {
    return s;
  }
  if (isRealPaddleTransactionId(paddleTransactionId || null)) return "purchase";
  if (isSyntheticTestTransactionId(paddleTransactionId || null)) return "test";
  return "admin";
}
function isPurchaseLikeRevocation(license) {
  const source = normalizeLicenseSource(license.source, license.paddle_transaction_id);
  if (source !== "purchase") return false;
  const reason = (license.revoke_reason || "").toLowerCase();
  if (!reason) return true;
  if (reason === "admin" || reason === "test" || reason === "subscription" || reason === "expired") {
    return false;
  }
  return reason === "refund" || reason === "chargeback";
}

// src/utils/blacklist.ts
function matchFingerprint(clientUuid, clientCpu, clientDisk, storedUuid, storedCpu, storedDisk) {
  let matches = 0;
  if (clientUuid && storedUuid && clientUuid === storedUuid) matches++;
  if (clientCpu && storedCpu && clientCpu === storedCpu) matches++;
  if (clientDisk && storedDisk && clientDisk === storedDisk) matches++;
  return matches >= 2;
}
function withinRollingYear(iso, oneYearAgoMs) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= oneYearAgoMs;
}
async function ensureManualBlacklistTable(env) {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS manual_blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        email TEXT DEFAULT NULL,
        email_hash TEXT DEFAULT NULL,
        device_id TEXT DEFAULT NULL,
        uuid_hash TEXT DEFAULT NULL,
        cpu_hash TEXT DEFAULT NULL,
        disk_hash TEXT DEFAULT NULL,
        reason TEXT DEFAULT NULL,
        created_by TEXT DEFAULT NULL,
        created_at TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      )
    `).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_manual_bl_email_hash ON manual_blacklist(email_hash)`
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_manual_bl_device_id ON manual_blacklist(device_id)`
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_manual_bl_active ON manual_blacklist(active)`
    ).run();
  } catch (err) {
    console.error("Failed to ensure manual_blacklist table:", err);
  }
}
function wasEverActivated(row) {
  const acts = Number(row.act_n || 0);
  const unbinds = Number(row.unbind_n || 0);
  return acts > 0 || unbinds > 0;
}
var emptyResult = () => ({
  isAbusive: false,
  kind: "",
  reason: "",
  reasonKey: "",
  hits: 0
});
async function checkManualBlacklist(env, buyerEmailHash, uuidHash, cpuHash, diskHash, opts) {
  const checkEmail = opts?.checkEmail !== false;
  const checkDevice = opts?.checkDevice !== false;
  const deviceId = (opts?.deviceId || "").trim();
  await ensureManualBlacklistTable(env);
  if (checkEmail && buyerEmailHash) {
    const hit = await env.DB.prepare(
      `SELECT id, reason FROM manual_blacklist
       WHERE active = 1 AND kind = 'email' AND email_hash = ?
       LIMIT 1`
    ).bind(buyerEmailHash).first();
    if (hit) {
      return {
        isAbusive: true,
        kind: "email",
        hits: 1,
        source: "manual",
        reasonKey: "blacklist_email",
        reason: hit.reason || "This email address has been restricted by the operator."
      };
    }
  }
  if (checkDevice && (deviceId || uuidHash || cpuHash || diskHash)) {
    if (deviceId) {
      const byId = await env.DB.prepare(
        `SELECT id, reason FROM manual_blacklist
         WHERE active = 1 AND kind = 'device' AND device_id = ?
         LIMIT 1`
      ).bind(deviceId).first();
      if (byId) {
        return {
          isAbusive: true,
          kind: "device",
          hits: 1,
          source: "manual",
          reasonKey: "blacklist_device",
          reason: byId.reason || "This device has been restricted by the operator."
        };
      }
    }
    if (uuidHash || cpuHash || diskHash) {
      const { results } = await env.DB.prepare(
        `SELECT id, reason, uuid_hash, cpu_hash, disk_hash FROM manual_blacklist
         WHERE active = 1 AND kind = 'device'
           AND (uuid_hash IS NOT NULL OR cpu_hash IS NOT NULL OR disk_hash IS NOT NULL)`
      ).all();
      for (const row of results || []) {
        if (matchFingerprint(
          uuidHash || "",
          cpuHash || "",
          diskHash || "",
          row.uuid_hash || "",
          row.cpu_hash || "",
          row.disk_hash || ""
        )) {
          return {
            isAbusive: true,
            kind: "device",
            hits: 1,
            source: "manual",
            reasonKey: "blacklist_device",
            reason: row.reason || "This device has been restricted by the operator."
          };
        }
      }
    }
  }
  return emptyResult();
}
async function checkAbusiveRefundBlacklist(env, buyerEmailHash, uuidHash, cpuHash, diskHash, opts) {
  const checkEmail = opts?.checkEmail !== false;
  const checkDevice = opts?.checkDevice !== false;
  const oneYearAgoMs = Date.now() - ONE_YEAR_MS;
  const manual = await checkManualBlacklist(env, buyerEmailHash, uuidHash, cpuHash, diskHash, opts);
  if (manual.isAbusive) return manual;
  if (checkEmail && buyerEmailHash) {
    const { results: revokedByEmail } = await env.DB.prepare(
      `SELECT l.source, l.paddle_transaction_id, l.revoke_reason, l.revoked_at, l.created_at, l.license_code,
              (SELECT COUNT(*) FROM activations a WHERE a.license_code = l.license_code) AS act_n,
              (SELECT COUNT(*) FROM unbind_records u WHERE u.license_code = l.license_code) AS unbind_n
       FROM licenses l
       WHERE l.buyer_email_hash = ? AND l.status = 'revoked'`
    ).bind(buyerEmailHash).all();
    let emailHits = 0;
    for (const row of revokedByEmail || []) {
      if (!isPurchaseLikeRevocation(row)) continue;
      if (!wasEverActivated(row)) continue;
      const when = row.revoked_at || row.created_at;
      if (withinRollingYear(when, oneYearAgoMs)) {
        emailHits++;
        if (emailHits >= MAX_YEARLY_ABUSIVE_REFUNDS) {
          return {
            isAbusive: true,
            kind: "email",
            hits: emailHits,
            source: "auto",
            reasonKey: "blacklist_email",
            reason: "This email address is restricted due to multiple refund or chargeback revocations (on activated licenses) within the past 365 days."
          };
        }
      }
    }
  }
  if (checkDevice && (uuidHash || cpuHash || diskHash)) {
    const { results: revokedActivations } = await env.DB.prepare(`
      SELECT a.uuid_hash, a.cpu_hash, a.disk_hash,
             l.source, l.paddle_transaction_id, l.revoke_reason, l.revoked_at, l.created_at
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE l.status = 'revoked'
    `).all();
    let deviceHits = 0;
    for (const act of revokedActivations || []) {
      if (!isPurchaseLikeRevocation(act)) continue;
      const when = act.revoked_at || act.created_at;
      if (!withinRollingYear(when, oneYearAgoMs)) continue;
      if (matchFingerprint(
        uuidHash || "",
        cpuHash || "",
        diskHash || "",
        act.uuid_hash || "",
        act.cpu_hash || "",
        act.disk_hash || ""
      )) {
        deviceHits++;
        if (deviceHits >= MAX_YEARLY_ABUSIVE_REFUNDS) {
          return {
            isAbusive: true,
            kind: "device",
            hits: deviceHits,
            source: "auto",
            reasonKey: "blacklist_device",
            reason: "This device is restricted due to multiple refund or chargeback revocations within the past 365 days. Please use another device, or request a refund if you just purchased with a different email."
          };
        }
      }
    }
  }
  return emptyResult();
}

// src/utils/cf-access-jwt.ts
var JWKS_TTL_MS = 60 * 60 * 1e3;

// src/utils/auth.ts
async function ensureDeviceIdColumn(env) {
  try {
    await env.DB.prepare(
      "ALTER TABLE activations ADD COLUMN device_id TEXT DEFAULT NULL"
    ).run();
  } catch (err) {
  }
}
async function ensureActivationNetworkColumns(env) {
  const alters = [
    "ALTER TABLE activations ADD COLUMN client_ip TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN ip_country TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN user_agent TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN city TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN region TEXT DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN latitude REAL DEFAULT NULL",
    "ALTER TABLE activations ADD COLUMN longitude REAL DEFAULT NULL"
  ];
  for (const sql of alters) {
    try {
      await env.DB.prepare(sql).run();
    } catch (err) {
    }
  }
}
async function ensureDeviceRegistryTable(env) {
  try {
    await env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS device_registry (
            device_id     TEXT PRIMARY KEY,
            uuid_hash     TEXT,
            cpu_hash      TEXT,
            disk_hash     TEXT,
            tier_label    TEXT NOT NULL DEFAULT 'free',
            license_code  TEXT DEFAULT NULL,
            email         TEXT DEFAULT NULL,
            registered_at TEXT NOT NULL,
            last_seen_at  TEXT,
            last_ip       TEXT DEFAULT NULL,
            ip_country    TEXT DEFAULT NULL,
            city          TEXT DEFAULT NULL,
            region        TEXT DEFAULT NULL,
            latitude      REAL DEFAULT NULL,
            longitude     REAL DEFAULT NULL,
            app_version   TEXT DEFAULT NULL
        )
      `),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_registry_live ON device_registry(tier_label, last_seen_at)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_registry_uuid ON device_registry(uuid_hash)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_registry_cpu ON device_registry(cpu_hash)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_registry_disk ON device_registry(disk_hash)`)
    ]);
  } catch (err) {
    console.error("Failed to ensure device_registry table:", err);
  }
}
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

// src/services/smtp.ts
var import_cloudflare_sockets = __toESM(require_cloudflare_sockets_stub());

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

// src/utils/rate-limit.ts
var WINDOW_MS = 5 * 60 * 1e3;
var OTP_VERIFY_WINDOW_MS = 15 * 60 * 1e3;
function clientIpFromRequest(request) {
  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown";
}
var DEV_REG_WINDOW_MS = 60 * 1e3;
var DEV_REG_MAX_REQUESTS = 10;
var devRegBuckets = /* @__PURE__ */ new Map();
function pruneDevReg(now) {
  if (devRegBuckets.size < 2e3) return;
  for (const [k, b] of devRegBuckets) {
    if (now - b.windowStart > DEV_REG_WINDOW_MS) devRegBuckets.delete(k);
  }
}
function buildDevRegKey(ip, uuidHash, cpuHash, diskHash) {
  const cleanIp = (ip || "unknown").trim();
  const fp = [uuidHash.trim(), cpuHash.trim(), diskHash.trim()].filter(Boolean).join("|") || "anon";
  return `reg:${cleanIp}:${fp}`;
}
function isDeviceRegisterRateLimited(ip, uuidHash, cpuHash, diskHash) {
  const now = Date.now();
  const key = buildDevRegKey(ip, uuidHash, cpuHash, diskHash);
  const b = devRegBuckets.get(key);
  if (!b) return false;
  if (now - b.windowStart > DEV_REG_WINDOW_MS) {
    devRegBuckets.delete(key);
    return false;
  }
  return b.count >= DEV_REG_MAX_REQUESTS;
}
function recordDeviceRegisterRequest(ip, uuidHash, cpuHash, diskHash) {
  const now = Date.now();
  pruneDevReg(now);
  const key = buildDevRegKey(ip, uuidHash, cpuHash, diskHash);
  const b = devRegBuckets.get(key);
  if (!b || now - b.windowStart > DEV_REG_WINDOW_MS) {
    devRegBuckets.set(key, { count: 1, windowStart: now });
    return;
  }
  b.count += 1;
}

// src/utils/device-registry.ts
function generateRandomDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ("00" + b.toString(16)).slice(-2)).join("");
}
function matchRegistryFingerprint(reqUuid, reqCpu, reqDisk, dbUuid, dbCpu, dbDisk) {
  const reqU = (reqUuid || "").trim();
  const reqC = (reqCpu || "").trim();
  const reqD = (reqDisk || "").trim();
  const dbU = (dbUuid || "").trim();
  const dbC = (dbCpu || "").trim();
  const dbD = (dbDisk || "").trim();
  let compareCount = 0;
  if (reqU && dbU) {
    if (reqU !== dbU) return false;
    compareCount++;
  }
  if (reqC && dbC) {
    if (reqC !== dbC) return false;
    compareCount++;
  }
  if (reqD && dbD) {
    if (reqD !== dbD) return false;
    compareCount++;
  }
  return compareCount > 0;
}
var WRITE_DEBOUNCE_MS = 5 * 60 * 1e3;
async function registerOrRefreshDevice(env, params, net) {
  await ensureDeviceRegistryTable(env);
  const uuid = (params.uuidHash || "").trim();
  const cpu = (params.cpuHash || "").trim();
  const disk = (params.diskHash || "").trim();
  const tier = params.tierLabel || "free";
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (!uuid && !cpu && !disk) {
    if (tier === "free") {
      return { device_id: "", tier_label: "free", skipped: true };
    }
  }
  const clauses = [];
  const binds = [];
  if (uuid) {
    clauses.push("uuid_hash = ?");
    binds.push(uuid);
  }
  if (cpu) {
    clauses.push("cpu_hash = ?");
    binds.push(cpu);
  }
  if (disk) {
    clauses.push("disk_hash = ?");
    binds.push(disk);
  }
  let matchedRow = null;
  if (clauses.length > 0) {
    const sql = `SELECT * FROM device_registry WHERE ${clauses.join(" OR ")}`;
    const candidates = await env.DB.prepare(sql).bind(...binds).all();
    for (const cand of candidates.results || []) {
      if (matchRegistryFingerprint(uuid, cpu, disk, cand.uuid_hash || "", cand.cpu_hash || "", cand.disk_hash || "")) {
        matchedRow = cand;
        break;
      }
    }
  }
  if (matchedRow) {
    const deviceId = matchedRow.device_id;
    let newTier = matchedRow.tier_label;
    if (tier === "paid" && matchedRow.tier_label !== "paid") {
      newTier = "paid";
    }
    const lastSeen = matchedRow.last_seen_at ? new Date(matchedRow.last_seen_at).getTime() : 0;
    const shouldUpdate = !lastSeen || Date.now() - lastSeen >= WRITE_DEBOUNCE_MS || newTier !== matchedRow.tier_label;
    if (shouldUpdate) {
      await env.DB.prepare(`
        UPDATE device_registry SET
          tier_label = ?,
          license_code = COALESCE(?, license_code),
          email = COALESCE(?, email),
          last_seen_at = ?,
          last_ip = ?,
          ip_country = ?,
          city = ?,
          region = ?,
          latitude = ?,
          longitude = ?,
          app_version = COALESCE(?, app_version)
        WHERE device_id = ?
      `).bind(
        newTier,
        params.licenseCode || null,
        params.email || null,
        nowIso,
        net.client_ip,
        net.ip_country,
        net.city,
        net.region,
        net.latitude,
        net.longitude,
        params.appVersion || null,
        deviceId
      ).run();
    }
    return { device_id: deviceId, tier_label: newTier };
  }
  const newDeviceId = generateRandomDeviceId();
  await env.DB.prepare(`
    INSERT INTO device_registry (
      device_id, uuid_hash, cpu_hash, disk_hash, tier_label, license_code, email,
      registered_at, last_seen_at, last_ip, ip_country, city, region, latitude, longitude, app_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newDeviceId,
    uuid || null,
    cpu || null,
    disk || null,
    tier,
    params.licenseCode || null,
    params.email || null,
    nowIso,
    nowIso,
    net.client_ip,
    net.ip_country,
    net.city,
    net.region,
    net.latitude,
    net.longitude,
    params.appVersion || null
  ).run();
  return { device_id: newDeviceId, tier_label: tier };
}

// src/routes/drm.ts
function activationClientMeta(request) {
  const ip = clientIpFromRequest(request);
  const client_ip = ip && ip !== "unknown" ? ip : null;
  const cf = request.cf;
  const countryRaw = (request.headers.get("cf-ipcountry") || cf?.country || "").trim().toUpperCase();
  const ip_country = countryRaw && countryRaw !== "XX" && countryRaw !== "T1" ? countryRaw.slice(0, 8) : countryRaw || null;
  const ua = (request.headers.get("user-agent") || "").trim();
  const user_agent = ua ? ua.slice(0, 256) : null;
  const cityRaw = request.headers.get("cf-ipcity") || request.headers.get("cf-city") || cf?.city || "";
  const city = cityRaw ? String(cityRaw).trim().slice(0, 64) : null;
  const regionRaw = request.headers.get("cf-region-code") || request.headers.get("cf-region") || cf?.regionCode || cf?.region || "";
  const region = regionRaw ? String(regionRaw).trim().slice(0, 64) : null;
  const latHeader = request.headers.get("cf-iplatitude") || request.headers.get("cf-latitude");
  const lngHeader = request.headers.get("cf-iplongitude") || request.headers.get("cf-longitude");
  const latNum = parseFloat(latHeader || cf?.latitude);
  const lngNum = parseFloat(lngHeader || cf?.longitude);
  const latitude = !isNaN(latNum) ? latNum : null;
  const longitude = !isNaN(lngNum) ? lngNum : null;
  return { client_ip, ip_country, user_agent, city, region, latitude, longitude };
}
async function findPeerActiveLicensesOnDevice(env, licenseCode, deviceId, uuidHash, cpuHash, diskHash) {
  const peers = [];
  const seen = /* @__PURE__ */ new Set();
  const pushUnique = (rows) => {
    for (const row of rows || []) {
      if (!row?.license_code || row.license_code === licenseCode) continue;
      if (seen.has(row.license_code)) continue;
      seen.add(row.license_code);
      peers.push(row);
    }
  };
  const dev = (deviceId || "").trim();
  if (dev) {
    const byDevice = await env.DB.prepare(`
      SELECT l.license_code, l.expires_at, l.tier, l.duration_days, l.source, l.paddle_transaction_id, l.status
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE a.device_id = ? AND l.license_code != ? AND l.status = 'active'
    `).bind(dev, licenseCode).all();
    pushUnique(byDevice.results);
  }
  const clauses = [];
  const binds = [];
  if (uuidHash) {
    clauses.push("a.uuid_hash = ?");
    binds.push(uuidHash);
  }
  if (cpuHash) {
    clauses.push("a.cpu_hash = ?");
    binds.push(cpuHash);
  }
  if (diskHash) {
    clauses.push("a.disk_hash = ?");
    binds.push(diskHash);
  }
  if (clauses.length > 0) {
    const sql = `
      SELECT a.uuid_hash, a.cpu_hash, a.disk_hash,
             l.license_code, l.expires_at, l.tier, l.duration_days, l.source, l.paddle_transaction_id, l.status
      FROM activations a
      JOIN licenses l ON a.license_code = l.license_code
      WHERE l.license_code != ? AND l.status = 'active'
        AND (${clauses.join(" OR ")})
    `;
    const cand = await env.DB.prepare(sql).bind(licenseCode, ...binds).all();
    for (const row of cand.results || []) {
      if (!matchFingerprint(
        uuidHash || "",
        cpuHash || "",
        diskHash || "",
        row.uuid_hash || "",
        row.cpu_hash || "",
        row.disk_hash || ""
      )) {
        continue;
      }
      pushUnique([row]);
    }
  }
  return peers;
}
function evaluateStacking(peerLicenses, licenseTier, licenseSource, baseExpiresAt, durationDays, reqLang = "en") {
  if (peerLicenses && peerLicenses.length > 0) {
    return {
      remainingMs: 0,
      hasSameTierLifetime: false,
      blockReason: getApiTranslation("cross_code_stacking_blocked", reqLang)
    };
  }
  return { remainingMs: 0, hasSameTierLifetime: false, blockReason: null };
}
async function checkAndApplyPendingUpgrade(env, licenseCode, currentExpiresAt) {
  if (currentExpiresAt === "LIFETIME") return "LIFETIME";
  try {
    const upgrade = await env.DB.prepare(`
      SELECT id, effective_at FROM license_upgrades
      WHERE target_license_code = ? AND status = 'pending'
      ORDER BY id ASC LIMIT 1
    `).bind(licenseCode).first();
    if (upgrade && upgrade.effective_at) {
      const effectiveTime = new Date(upgrade.effective_at).getTime();
      if (!isNaN(effectiveTime) && effectiveTime <= Date.now()) {
        await env.DB.prepare(`
          UPDATE licenses SET expires_at = 'LIFETIME', duration_days = NULL
          WHERE license_code = ? AND expires_at != 'LIFETIME'
        `).bind(licenseCode).run();
        await env.DB.prepare(`
          UPDATE license_upgrades SET status = 'applied' WHERE id = ?
        `).bind(upgrade.id).run();
        return "LIFETIME";
      }
    }
  } catch (err) {
    console.error("Error in checkAndApplyPendingUpgrade:", err);
  }
  return currentExpiresAt;
}
async function handleDrmRoutes(request, env, ctx, url, corsHeaders) {
  if (url.pathname === "/api/v1/device/register" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const reqLang = extractRequestLang(request, body);
    const { uuid_hash, cpu_hash, disk_hash, app_version, license_code } = body;
    const uHash = (uuid_hash || "").trim();
    const cHash = (cpu_hash || "").trim();
    const dHash = (disk_hash || "").trim();
    const net = activationClientMeta(request);
    const clientIp = clientIpFromRequest(request);
    if (isDeviceRegisterRateLimited(clientIp, uHash, cHash, dHash)) {
      return new Response(
        JSON.stringify({
          error: getApiTranslation("too_many_requests", reqLang) || "Too many registration attempts. Please try again later.",
          reason_key: "rate_limited"
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }
    recordDeviceRegisterRequest(clientIp, uHash, cHash, dHash);
    if (uHash || cHash || dHash) {
      const blacklistCheck = await checkAbusiveRefundBlacklist(
        env,
        null,
        uHash,
        cHash,
        dHash
      );
      if (blacklistCheck.isAbusive) {
        return new Response(JSON.stringify({
          error: getApiTranslation("blacklist_device", reqLang) || blacklistCheck.reason
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
    let tierLabel = "free";
    if (license_code) {
      const lic = await env.DB.prepare("SELECT status FROM licenses WHERE license_code = ?").bind(license_code).first();
      if (lic && lic.status === "active") {
        tierLabel = "paid";
      }
    }
    const reg = await registerOrRefreshDevice(env, {
      uuidHash: uHash,
      cpuHash: cHash,
      diskHash: dHash,
      appVersion: app_version || null,
      tierLabel,
      licenseCode: license_code || null
    }, net);
    return new Response(JSON.stringify({
      device_id: reg.device_id,
      tier: reg.tier_label
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  if (url.pathname === "/api/v1/activate" && request.method === "POST") {
    await ensureDeviceIdColumn(env);
    await ensureActivationNetworkColumns(env);
    await ensureLicenseSourceColumns(env);
    const body = await request.json();
    const reqLang = extractRequestLang(request, body);
    const { license_code, uuid_hash, cpu_hash, disk_hash, device_id } = body;
    if (!license_code) {
      return new Response(JSON.stringify({ error: getApiTranslation("missing_license_code", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const uHash = (uuid_hash || "").trim();
    const cHash = (cpu_hash || "").trim();
    const dHash = (disk_hash || "").trim();
    if (!uHash && !cHash && !dHash) {
      return new Response(JSON.stringify({ error: getApiTranslation("insufficient_hardware_permissions", reqLang) || "Insufficient hardware permissions (cannot read hardware fingerprints)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const license = await env.DB.prepare(
      "SELECT * FROM licenses WHERE license_code = ?"
    ).bind(license_code).first();
    if (!license) {
      return new Response(JSON.stringify({ error: getApiTranslation("license_not_found", reqLang) }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (license.status !== "active") {
      return new Response(JSON.stringify({ error: getApiTranslation("license_suspended_or_revoked", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const licenseSource = normalizeLicenseSource(license.source, license.paddle_transaction_id);
    const blacklistCheck = await checkAbusiveRefundBlacklist(
      env,
      license.buyer_email_hash || null,
      uuid_hash || "",
      cpu_hash || "",
      disk_hash || "",
      { deviceId: device_id || null }
    );
    if (blacklistCheck.isAbusive) {
      const key2 = blacklistCheck.reasonKey || (blacklistCheck.kind === "device" ? "blacklist_device" : "blacklist_email");
      return new Response(JSON.stringify({
        error: getApiTranslation(key2, reqLang) || blacklistCheck.reason,
        reason_key: key2,
        blacklist_kind: blacklistCheck.kind
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const usesRedeemWindow = licenseSource === "promo" || licenseSource === "admin" && license.duration_days !== null && license.duration_days !== void 0 && license.expires_at && license.expires_at !== "LIFETIME";
    if (usesRedeemWindow && license.expires_at && license.expires_at !== "LIFETIME") {
      const redeemBy = new Date(license.expires_at).getTime();
      if (!Number.isNaN(redeemBy) && redeemBy < Date.now()) {
        return new Response(JSON.stringify({
          error: getApiTranslation("license_redeem_expired", reqLang)
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
    let baseExpiresAt = license.expires_at || "LIFETIME";
    baseExpiresAt = await checkAndApplyPendingUpgrade(env, license_code, baseExpiresAt);
    if (license.duration_days !== null && license.duration_days !== void 0 && Number(license.duration_days) >= 0 && baseExpiresAt !== "LIFETIME") {
      baseExpiresAt = new Date(Date.now() + Number(license.duration_days) * 86400 * 1e3).toISOString();
    } else if (baseExpiresAt && baseExpiresAt !== "LIFETIME") {
      const expires = new Date(baseExpiresAt);
      if (expires.getTime() < Date.now()) {
        return new Response(JSON.stringify({ error: getApiTranslation("license_expired", reqLang) }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
    const { results: activations } = await env.DB.prepare(
      "SELECT * FROM activations WHERE license_code = ?"
    ).bind(license_code).all();
    let isAlreadyActivated = false;
    for (const act of activations) {
      if (matchFingerprint(
        uuid_hash || "",
        cpu_hash || "",
        disk_hash || "",
        act.uuid_hash || "",
        act.cpu_hash || "",
        act.disk_hash || ""
      )) {
        isAlreadyActivated = true;
        break;
      }
      if (device_id && act.device_id && act.device_id === device_id) {
        isAlreadyActivated = true;
        break;
      }
    }
    const peerLicenses = await findPeerActiveLicensesOnDevice(
      env,
      license_code,
      device_id || "",
      uuid_hash || "",
      cpu_hash || "",
      disk_hash || ""
    );
    const stack = evaluateStacking(
      peerLicenses,
      license.tier,
      licenseSource,
      baseExpiresAt,
      license.duration_days,
      reqLang
    );
    if (stack.blockReason && !isAlreadyActivated) {
      return new Response(JSON.stringify({ error: stack.blockReason }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (!isAlreadyActivated) {
      if (activations.length >= license.max_devices) {
        return new Response(JSON.stringify({ error: getApiTranslation("max_devices_reached", reqLang) }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const net = activationClientMeta(request);
      const regRes = await registerOrRefreshDevice(env, {
        uuidHash: uuid_hash || "",
        cpuHash: cpu_hash || "",
        diskHash: disk_hash || "",
        tierLabel: "paid",
        licenseCode: license_code,
        email: license.buyer_email || null,
        appVersion: body.app_version || null
      }, net);
      const authoritativeDeviceId2 = regRes.device_id || (device_id || "");
      const insRes = await env.DB.prepare(`
        INSERT INTO activations (
          license_code, uuid_hash, cpu_hash, disk_hash, device_id, activated_at,
          client_ip, ip_country, user_agent, city, region, latitude, longitude
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM activations WHERE license_code = ?) < ?
      `).bind(
        license_code,
        uuid_hash || "",
        cpu_hash || "",
        disk_hash || "",
        authoritativeDeviceId2,
        (/* @__PURE__ */ new Date()).toISOString(),
        net.client_ip,
        net.ip_country,
        net.user_agent,
        net.city,
        net.region,
        net.latitude,
        net.longitude,
        license_code,
        license.max_devices
      ).run();
      if (!insRes.meta || insRes.meta.changes === 0) {
        return new Response(JSON.stringify({ error: getApiTranslation("max_devices_reached", reqLang) }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (license.buyer_email) {
        const currentDevicesCount = activations.length + 1;
        const actTimeStr = (/* @__PURE__ */ new Date()).toLocaleString();
        const devHashSummary = uuid_hash ? uuid_hash.substring(0, 8) + "..." : cpu_hash ? cpu_hash.substring(0, 8) + "..." : "Default";
        const t = getDeviceNoticeTemplate(reqLang);
        const emailHtml = renderEmailWrapper(t.boundTitle, t.boundBody(license_code, actTimeStr, devHashSummary, currentDevicesCount, license.max_devices));
        ctx.waitUntil(sendDRMEmail(env, license.buyer_email, t.boundSubject, emailHtml));
      }
    } else {
      const net = activationClientMeta(request);
      ctx.waitUntil(registerOrRefreshDevice(env, {
        uuidHash: uuid_hash || "",
        cpuHash: cpu_hash || "",
        diskHash: disk_hash || "",
        tierLabel: "paid",
        licenseCode: license_code,
        email: license.buyer_email || null,
        appVersion: body.app_version || null
      }, net));
    }
    const netMeta = activationClientMeta(request);
    const finalReg = await registerOrRefreshDevice(env, {
      uuidHash: uuid_hash || "",
      cpuHash: cpu_hash || "",
      diskHash: disk_hash || "",
      tierLabel: "paid",
      licenseCode: license_code,
      email: license.buyer_email || null,
      appVersion: body.app_version || null
    }, netMeta);
    const authoritativeDeviceId = finalReg.device_id;
    const remainingMs = stack.remainingMs;
    let finalExpiresAt = baseExpiresAt;
    if (licenseSource === "purchase" && finalExpiresAt !== "LIFETIME" && remainingMs > 0) {
      const newExpDate = new Date(finalExpiresAt);
      const finalDate = new Date(newExpDate.getTime() + remainingMs);
      finalExpiresAt = finalDate.toISOString();
    }
    const payloadStr = `${license_code}|${license.tier}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${authoritativeDeviceId}|${finalExpiresAt}|${license.max_devices}`;
    const encoder = new TextEncoder();
    const payloadData = encoder.encode(payloadStr);
    const privateKeyHex = env.ED25519_PRIVATE_KEY;
    if (!privateKeyHex) {
      throw new Error("ED25519_PRIVATE_KEY is not configured in Workers Environment Variables");
    }
    const privateKeyBytes = hexToUint8Array(privateKeyHex);
    const pkcs8Bytes = new Uint8Array(16 + privateKeyBytes.length);
    pkcs8Bytes.set([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
    pkcs8Bytes.set(privateKeyBytes, 16);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8Bytes,
      { name: "Ed25519" },
      true,
      ["sign"]
    );
    const signatureBuf = await crypto.subtle.sign("Ed25519", key, payloadData);
    const signatureHex = bufToHex(signatureBuf);
    const currentTime = (/* @__PURE__ */ new Date()).toISOString();
    const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${authoritativeDeviceId || ""}|${currentTime}`;
    const verifyPayloadData = encoder.encode(verifyPayloadStr);
    const verifySignatureBuf = await crypto.subtle.sign("Ed25519", key, verifyPayloadData);
    const verifySignatureHex = bufToHex(verifySignatureBuf);
    let activatedCount = activations.length;
    if (!isAlreadyActivated) {
      activatedCount += 1;
    }
    return new Response(JSON.stringify({
      license_code,
      tier: license.tier,
      uuid_hash: uuid_hash || "",
      cpu_hash: cpu_hash || "",
      disk_hash: disk_hash || "",
      device_id: authoritativeDeviceId,
      expires_at: finalExpiresAt,
      max_devices: license.max_devices,
      activated_devices: activatedCount,
      buyer_email: license.buyer_email || "",
      signature: signatureHex,
      last_online_sync_time: currentTime,
      verify_signature: verifySignatureHex
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  if (url.pathname === "/api/v1/verify" && request.method === "POST") {
    const body = await request.json();
    const reqLang = extractRequestLang(request, body);
    const { license_code, uuid_hash, cpu_hash, disk_hash } = body;
    if (!license_code) {
      return new Response(JSON.stringify({ error: getApiTranslation("missing_license_code", reqLang) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const license = await env.DB.prepare(
      "SELECT * FROM licenses WHERE license_code = ?"
    ).bind(license_code).first();
    if (!license) {
      return new Response(JSON.stringify({ error: getApiTranslation("license_not_found", reqLang) }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (license.status !== "active") {
      return new Response(JSON.stringify({ error: getApiTranslation("license_suspended_or_revoked", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const blacklistCheck = await checkAbusiveRefundBlacklist(
      env,
      license.buyer_email_hash || null,
      uuid_hash || "",
      cpu_hash || "",
      disk_hash || "",
      { deviceId: body.device_id || null }
    );
    if (blacklistCheck.isAbusive) {
      const key2 = blacklistCheck.reasonKey || (blacklistCheck.kind === "device" ? "blacklist_device" : "blacklist_email");
      return new Response(JSON.stringify({
        error: getApiTranslation(key2, reqLang) || blacklistCheck.reason,
        reason_key: key2,
        blacklist_kind: blacklistCheck.kind
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const { results: activations } = await env.DB.prepare(
      "SELECT * FROM activations WHERE license_code = ?"
    ).bind(license_code).all();
    let isActivatedDevice = false;
    for (const act of activations) {
      if (matchFingerprint(
        uuid_hash || "",
        cpu_hash || "",
        disk_hash || "",
        act.uuid_hash || "",
        act.cpu_hash || "",
        act.disk_hash || ""
      )) {
        isActivatedDevice = true;
        break;
      }
    }
    if (!isActivatedDevice) {
      return new Response(JSON.stringify({ error: getApiTranslation("device_not_activated", reqLang) }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    let baseExpiresAt = license.expires_at || "LIFETIME";
    baseExpiresAt = await checkAndApplyPendingUpgrade(env, license_code, baseExpiresAt);
    if (license.duration_days !== null && license.duration_days !== void 0 && Number(license.duration_days) >= 0 && baseExpiresAt !== "LIFETIME") {
      baseExpiresAt = new Date(Date.now() + Number(license.duration_days) * 86400 * 1e3).toISOString();
    }
    const net = activationClientMeta(request);
    const regResult = await registerOrRefreshDevice(env, {
      uuidHash: uuid_hash || "",
      cpuHash: cpu_hash || "",
      diskHash: disk_hash || "",
      tierLabel: "paid",
      licenseCode: license_code,
      email: license.buyer_email || null,
      appVersion: body.app_version || null
    }, net);
    const activeDeviceId = regResult.device_id || "";
    const currentTime = (/* @__PURE__ */ new Date()).toISOString();
    const verifyPayloadStr = `OK|${license_code}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${activeDeviceId}|${currentTime}`;
    const encoder = new TextEncoder();
    const verifyPayloadData = encoder.encode(verifyPayloadStr);
    const privateKeyHex = env.ED25519_PRIVATE_KEY;
    if (!privateKeyHex) {
      throw new Error("ED25519_PRIVATE_KEY is not configured in Workers Environment Variables");
    }
    const privateKeyBytes = hexToUint8Array(privateKeyHex);
    const pkcs8Bytes = new Uint8Array(16 + privateKeyBytes.length);
    pkcs8Bytes.set([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
    pkcs8Bytes.set(privateKeyBytes, 16);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8Bytes,
      { name: "Ed25519" },
      true,
      ["sign"]
    );
    const verifySignatureBuf = await crypto.subtle.sign("Ed25519", key, verifyPayloadData);
    const verifySignatureHex = bufToHex(verifySignatureBuf);
    const certificatePayloadStr = `${license_code}|${license.tier}|${uuid_hash || ""}|${cpu_hash || ""}|${disk_hash || ""}|${activeDeviceId}|${baseExpiresAt}|${license.max_devices}`;
    const certificatePayloadData = encoder.encode(certificatePayloadStr);
    const certificateSignatureBuf = await crypto.subtle.sign("Ed25519", key, certificatePayloadData);
    const certificateSignatureHex = bufToHex(certificateSignatureBuf);
    return new Response(JSON.stringify({
      status: "OK",
      license_code,
      tier: license.tier,
      uuid_hash: uuid_hash || "",
      cpu_hash: cpu_hash || "",
      disk_hash: disk_hash || "",
      device_id: regResult.device_id || "",
      max_devices: license.max_devices || 2,
      activated_devices: activations.length,
      expires_at: baseExpiresAt,
      buyer_email: license.buyer_email || "",
      certificate_signature: certificateSignatureHex,
      current_time: currentTime,
      signature: verifySignatureHex
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  if (url.pathname === "/api/v1/update/check" && request.method === "GET") {
    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.toString(), request);
    const cache = caches.default;
    let response = await cache.match(cacheKey);
    if (response) {
      return response;
    }
    const repo = env.GITHUB_REPO || "forpersuit/eqrcp";
    const ghUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const headers = {
      "User-Agent": "EQT-Update-Worker",
      "Accept": "application/vnd.github+json"
    };
    if (env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
    }
    const ghRes = await fetch(ghUrl, { headers });
    if (!ghRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch latest release from GitHub: ${ghRes.statusText}` }), {
        status: ghRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const release = await ghRes.json();
    const r2PublicUrl = env.R2_PUBLIC_URL;
    if (!r2PublicUrl) {
      return new Response(JSON.stringify({
        error: "R2_PUBLIC_URL is not configured; update assets require R2 CDN"
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const base = r2PublicUrl.endsWith("/") ? r2PublicUrl.slice(0, -1) : r2PublicUrl;
    const result = {
      version: release.tag_name,
      published_at: release.published_at,
      changelog: release.body || "",
      assets: (release.assets || []).map((asset) => {
        return {
          name: asset.name,
          download_url: `${base}/downloads/${release.tag_name}/${asset.name}`,
          size: asset.size
        };
      })
    };
    response = new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=3600"
      }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkAndApplyPendingUpgrade,
  handleDrmRoutes
});
