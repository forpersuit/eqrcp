#!/usr/bin/env node

/**
 * EQT Official Website Multilingual Static Pre-rendering (SSG) Script
 * 
 * Generates physical, static language subdirectories (/zh/, /ja/, /ko/, /de/, /fr/, /es/)
 * from cloudflare/eqt-website/index.html template.
 * Injects multilingual SEO meta, JSON-LD, hreflang annotations, and deterministic routing.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const WEBSITE_DIR = path.join(REPO_ROOT, 'cloudflare', 'eqt-website');
const INDEX_HTML_PATH = path.join(WEBSITE_DIR, 'index.html');

console.log('=== Starting EQT Website Multilingual Pre-rendering ===');

// 1. Read base index.html
if (!fs.existsSync(INDEX_HTML_PATH)) {
  console.error(`Fatal: ${INDEX_HTML_PATH} does not exist`);
  process.exit(1);
}
let templateHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

// 2. Extract translations dictionary safely
const startToken = 'const translations = {';
const startIdx = templateHtml.indexOf(startToken);
if (startIdx === -1) {
  console.error('Fatal: Unable to locate translations start in index.html');
  process.exit(1);
}

const endToken = 'function getCookie';
const endIdx = templateHtml.indexOf(endToken, startIdx);
if (endIdx === -1) {
  console.error('Fatal: Unable to locate translations end in index.html');
  process.exit(1);
}

let translationsCode = templateHtml.slice(startIdx + 'const translations ='.length, endIdx).trim();
translationsCode = translationsCode.replace(/;+\s*$/, '');

const sandbox = {};
vm.runInNewContext(`translations = ${translationsCode}`, sandbox);
const translations = sandbox.translations;


// 3. Define enhanced metadata & latest feature copy per language
const langConfig = {
  zh: {
    code: 'zh',
    name: '简体中文',
    htmlLang: 'zh-CN',
    ogLocale: 'zh_CN',
    title: 'EQT - 真正支持任何设备的隔空投送 | 极速局域网文件互传与加密便签',
    desc: 'EQT 是跨越 Windows、Mac、iPhone 与 Android 的局域网直传神器。手机自带相机扫码即传，千兆物理满速 (10–100 MB/s)，零云端中继，免装 App。首选 80/443 标准端口穿透防火墙，官方公信绿色安全锁。',
    keywords: '隔空投送Windows版, AirDrop安卓替代品, 电脑手机互传, 局域网文件传输, 免安装文件快传, 80端口局域网传输, 局域网加密聊天, 零云端隐私传输',
    sampleKeyword: '局域网'
  },
  ja: {
    code: 'ja',
    name: '日本語',
    htmlLang: 'ja',
    ogLocale: 'ja_JP',
    title: 'EQT - あらゆるデバイスに対応したAirDrop | 高速ローカルLANファイル転送＆安全なチャット',
    desc: 'EQTはPC、iPhone、Android間でQRコードをスキャンするだけでギガビットLAN速度（10–100 MB/s）の高速ファイル転送を実現。クラウド不要、アプリインストール不要。80/443標準ポート対応＆公認LAN-TLS暗号化。',
    keywords: 'AirDrop Windows代替, スマホ PC ファイル転送, アプリ不要 ファイル共有, ローカルLAN転送, QRコードファイル共有, 標準ポート転送',
    sampleKeyword: '転送'
  },
  ko: {
    code: 'ko',
    name: '한국어',
    htmlLang: 'ko',
    ogLocale: 'ko_KR',
    title: 'EQT - 모든 기기를 위한 AirDrop | 초고속 로컬 LAN 파일 전송 및 보안 채팅',
    desc: 'EQT는 PC, iPhone, Android 간에 카메라 QR 코드로 최대 기가비트 LAN 속도(10–100 MB/s)로 파일을 전송합니다. 클라우드 중계 없음, 앱 설치 불필요. 표준 80/443 포트 지원 및 공식 LAN-TLS 보안 암호화.',
    keywords: 'Windows AirDrop 대체, 안드로이드 PC 파일전송, 앱 설치 없는 파일전송, 로컬 LAN 전송, QR코드 파일공유',
    sampleKeyword: '전송'
  },
  de: {
    code: 'de',
    name: 'Deutsch',
    htmlLang: 'de',
    ogLocale: 'de_DE',
    title: 'EQT - AirDrop für jedes Gerät | Lokale LAN-Dateiübertragung & Sicherer Chat',
    desc: 'EQT überträgt Dateien zwischen PC, iPhone und Android mit voller Gigabit-LAN-Geschwindigkeit (10–100 MB/s) per QR-Code. Ohne Cloud, ohne App-Installation. Bevorzugte Standard-Ports (80/443) & offizielle LAN-TLS-Verschlüsselung.',
    keywords: 'AirDrop für Windows, AirDrop Alternative Android, Lokale Dateiübertragung WLAN, PC zu Handy ohne App, Datenschutz Dateitransfer',
    sampleKeyword: 'Dateiübertragung'
  },
  fr: {
    code: 'fr',
    name: 'Français',
    htmlLang: 'fr',
    ogLocale: 'fr_FR',
    title: 'EQT - AirDrop pour tous les appareils | Transfert de fichiers local & Chat sécurisé',
    desc: 'EQT transfère des fichiers entre PC, iPhone et Android à la vitesse Gigabit LAN (10–100 Mo/s) par code QR. Sans cloud, sans installer d\'application. Ports standard 80/443 et chiffrement LAN-TLS certifié.',
    keywords: 'AirDrop pour Windows, Alternative AirDrop Android, Transfert local sans cloud, Transfert PC vers téléphone sans app, Chiffrement LAN-TLS',
    sampleKeyword: 'Transfert'
  },
  es: {
    code: 'es',
    name: 'Español',
    htmlLang: 'es',
    ogLocale: 'es_ES',
    title: 'EQT - AirDrop para cualquier dispositivo | Transferencia LAN local y Chat seguro',
    desc: 'EQT transfiere archivos entre PC, iPhone y Android a velocidad Gigabit LAN (10–100 MB/s) mediante código QR. Sin nube, sin instalar apps en el móvil. Puertos estándar (80/443) y cifrado LAN-TLS oficial.',
    keywords: 'AirDrop para Windows, Alternativa a AirDrop Android, Transferencia local sin nube, PC a celular sin app, Compartir archivos LAN',
    sampleKeyword: 'Transferencia'
  }
};

// 4. Enrich translation dictionaries with latest features & aligned copy
function enrichTranslations(dict) {
  // English updates
  dict.en = Object.assign(dict.en || {}, {
    hero_badge_new: "v1.36.165 Released: Preferred Ports (80/443), Android Support &amp; Web Chat",
    feat1_title: "Instant QR &amp; Standard Ports",
    feat1_desc: "Scan from any device camera to start transfers instantly. Prefers standard ports (80/443) for clean URLs without messy port numbers, effortlessly penetrating enterprise firewalls.",
    feat4_title: "AirDrop for Any Device",
    feat4_desc: "Break free from ecosystem walls. Seamlessly transfer between iPhone, Android, Windows, Mac, and Linux with zero app install on receiving devices."
  });

  // Chinese updates
  dict.zh = Object.assign(dict.zh || {}, {
    hero_badge_new: "v1.36.165 正式发布：首选 80/443 标准端口、全面支持安卓 &amp; 免装网页快传",
    feat1_title: "扫码即传 &amp; 首选标准端口",
    feat1_desc: "手机原生相机扫码即开。优先绑定 80/443 常用标准端口，生成的链接干净无非标端口后缀，轻松穿透企业内网与校园防火墙。",
    feat4_title: "打破跨平台生态壁垒",
    feat4_desc: "真正支持任何设备的 AirDrop。全面覆盖 iPhone、Android、Windows、Mac 与 Linux，接收端无需安装任何第三方 App。"
  });

  // Japanese updates
  dict.ja = Object.assign(dict.ja || {}, {
    hero_badge_new: "v1.36.165 リリース：80/443標準ポート対応、Android全面サポート＆Webチャット",
    feat1_title: "即座QRスキャン＆標準ポート",
    feat1_desc: "スマホのカメラでスキャンするだけで即座に開始。80/443標準ポートを優先使用し、不要なポート番号のないクリーンなURLを生成。企業のファイアウォールも容易に回避できます。",
    feat4_title: "真のクロスプラットフォーム",
    feat4_desc: "エコシステムの壁を打破。iPhone、Android、Windows、Mac、Linux間でシームレスに相互転送。受信側はアプリのインストールが一切不要です。"
  });

  // Korean updates
  dict.ko = Object.assign(dict.ko || {}, {
    hero_badge_new: "v1.36.165 출시: 80/443 표준 포트 우선 지원, Android 완벽 호환 및 Web 전송",
    feat1_title: "즉석 QR 및 표준 포트 지원",
    feat1_desc: "기본 카메라로 QR을 스캔하여 즉시 시작하세요. 80/443 표준 포트를 우선 바인딩하여 깔끔한 URL을 제공하며 엄격한 기업 방화벽을 원활히 통과합니다.",
    feat4_title: "플랫폼 장벽 해제 (AirDrop 자유)",
    feat4_desc: "생태계 장벽을 넘어 iPhone, Android, Windows, Mac, Linux 간 자유로운 파일 전송을 경험하세요. 수신 기기에는 어떠한 앱도 설치할 필요가 없습니다."
  });

  // German updates
  dict.de = Object.assign(dict.de || {}, {
    hero_badge_new: "v1.36.165 Veröffentlicht: Standard-Ports (80/443), Android-Support &amp; Web-Chat",
    feat1_title: "Sofortiger QR-Scan &amp; Standard-Ports",
    feat1_desc: "Einfach mit der Kamera scannen. Bevorzugt Standard-Ports (80/443) für saubere URLs ohne störende Portnummern – ideal zur problemlosen Umgehung strenger Unternehmens-Firewalls.",
    feat4_title: "AirDrop für buchstäblich jedes Gerät",
    feat4_desc: "Überwinden Sie Ökosystemgrenzen. Reibungsloser Datenaustausch zwischen iPhone, Android, Windows, Mac und Linux – ohne App-Installation auf dem Mobilgerät."
  });

  // French updates
  dict.fr = Object.assign(dict.fr || {}, {
    hero_badge_new: "v1.36.165 Sortie : Ports standard (80/443), Support Android &amp; Chat Web",
    feat1_title: "QR Code instantané &amp; Ports standard",
    feat1_desc: "Scannez avec votre appareil photo natif. Utilise en priorité les ports 80/443 pour des URL nettes sans numéros de port complexes, traversant aisément les pare-feu d'entreprise.",
    feat4_title: "AirDrop pour absolument tous les appareils",
    feat4_desc: "Brisez les barrières des écosystèmes. Échangez facilement entre iPhone, Android, Windows, Mac et Linux sans installer la moindre application sur le téléphone."
  });

  // Spanish updates
  dict.es = Object.assign(dict.es || {}, {
    hero_badge_new: "Lanzamiento v1.36.165: Puertos estándar (80/443), Soporte Android y Chat Web",
    feat1_title: "Escaneo QR y Puertos Estándar",
    feat1_desc: "Escanee con la cámara nativa para comenzar. Prioriza puertos estándar (80/443) para URLs limpias sin puertos extraños, sorteando fácilmente cortafuegos corporativos.",
    feat4_title: "AirDrop para cualquier dispositivo",
    feat4_desc: "Rompa las barreras de los ecosistemas. Transfiera sin esfuerzo entre iPhone, Android, Windows, Mac y Linux sin necesidad de instalar apps en el móvil receptor."
  });
}

enrichTranslations(translations);

// 5. Update base English index.html with enriched translations and pre-rendered copy
const newTranslationsJson = JSON.stringify(translations, null, 4);
let enrichedBaseHtml = templateHtml.slice(0, startIdx + 'const translations = '.length) +
  newTranslationsJson + ';;;\n' + templateHtml.slice(endIdx);

enrichedBaseHtml = enrichedBaseHtml.replace(/<([a-zA-Z0-9]+)([^>]*?data-i18n="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g, (fullMatch, tag, attrs, key, currentContent) => {
  const text = (translations.en || {})[key];
  if (text === undefined) {
    return fullMatch;
  }
  return `<${tag}${attrs}>${text}</${tag}>`;
});

fs.writeFileSync(INDEX_HTML_PATH, enrichedBaseHtml, 'utf8');
templateHtml = enrichedBaseHtml;
console.log(`✓ Synchronized EN base page -> ${INDEX_HTML_PATH}`);

// 6. Generate pre-rendered static HTML for each language
function renderLanguageHtml(lang, cfg) {
  let html = templateHtml;
  const langDict = translations[lang] || {};
  const fallbackDict = translations.en || {};

  // Replace <html lang="...">
  html = html.replace(/<html class="dark scroll-smooth" lang="en">/, `<html class="dark scroll-smooth" lang="${cfg.htmlLang}">`);

  // Replace canonical URL
  html = html.replace(/<link rel="canonical" href="https:\/\/www\.eqt\.net\.im\/"\/>/, `<link rel="canonical" href="https://www.eqt.net.im/${lang}/"/>`);

  // Replace Title & Meta tags
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${cfg.title}</title>`);
  html = html.replace(/<meta name="description" content="[\s\S]*?"\/>/, `<meta name="description" content="${cfg.desc}"/>`);
  html = html.replace(/<meta name="keywords" content="[\s\S]*?"\/>/, `<meta name="keywords" content="${cfg.keywords}"/>`);
  html = html.replace(/<meta property="og:title" content="[\s\S]*?"\/>/, `<meta property="og:title" content="${cfg.title}"/>`);
  html = html.replace(/<meta property="og:description" content="[\s\S]*?"\/>/, `<meta property="og:description" content="${cfg.desc}"/>`);
  html = html.replace(/<meta property="og:url" content="[\s\S]*?"\/>/, `<meta property="og:url" content="https://www.eqt.net.im/${lang}/"/>`);
  html = html.replace(/<meta name="twitter:title" content="[\s\S]*?"\/>/, `<meta name="twitter:title" content="${cfg.title}"/>`);
  html = html.replace(/<meta name="twitter:description" content="[\s\S]*?"\/>/, `<meta name="twitter:description" content="${cfg.desc}"/>`);

  // Replace current language indicator in navbar
  html = html.replace(/<span id="current-lang-txt" class="font-label-md text-label-md">English<\/span>/, `<span id="current-lang-txt" class="font-label-md text-label-md">${cfg.name}</span>`);

  // Replace Schema.org JSON-LD url and inLanguage
  html = html.replace(
    /"url": "https:\/\/www\.eqt\.net\.im\/"/,
    `"url": "https://www.eqt.net.im/${lang}/",\n  "inLanguage": "${cfg.htmlLang}"`
  );

  // Pre-render data-i18n attributes into real DOM text
  html = html.replace(/<([a-zA-Z0-9]+)([^>]*?data-i18n="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g, (fullMatch, tag, attrs, key, currentContent) => {
    let text = langDict[key];
    if (text === undefined) {
      text = fallbackDict[key];
    }
    if (text === undefined) {
      return fullMatch;
    }
    return `<${tag}${attrs}>${text}</${tag}>`;
  });

  return html;
}

// 7. Output to physical language subdirectories
const generatedFiles = [];
for (const [lang, cfg] of Object.entries(langConfig)) {
  const targetDir = path.join(WEBSITE_DIR, lang);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const targetPath = path.join(targetDir, 'index.html');
  const renderedHtml = renderLanguageHtml(lang, cfg);
  fs.writeFileSync(targetPath, renderedHtml, 'utf8');
  generatedFiles.push({ lang, path: targetPath, size: renderedHtml.length, sampleKeyword: cfg.sampleKeyword });
  console.log(`✓ Generated ${lang.toUpperCase()} static page -> ${targetPath} (${Math.round(renderedHtml.length / 1024)} KB)`);
}

// 7. Fail-Loud Quality & Deterministic Assertion Gate
console.log('\n=== Running Deterministic Assertion Quality Gate ===');
let hasError = false;

for (const item of generatedFiles) {
  const content = fs.readFileSync(item.path, 'utf8');
  
  // Rule 1: File size > 50KB
  if (content.length < 50000) {
    console.error(`[FAIL] ${item.lang}: Generated HTML file too small (${content.length} bytes)`);
    hasError = true;
  }

  // Rule 2: Zero relative assets / scripts (P0 prevention)
  const relativeAssetMatches = content.match(/(src|href)="assets\//g);
  if (relativeAssetMatches) {
    console.error(`[FAIL] ${item.lang}: Contains relative asset paths: ${relativeAssetMatches.join(', ')}`);
    hasError = true;
  }
  const relativeJsMatches = content.match(/(src|href)="js\//g);
  if (relativeJsMatches) {
    console.error(`[FAIL] ${item.lang}: Contains relative js paths: ${relativeJsMatches.join(', ')}`);
    hasError = true;
  }

  // Rule 3: hreflang annotations present
  if (!content.includes('hreflang="zh"') || !content.includes('hreflang="en"') || !content.includes('hreflang="x-default"')) {
    console.error(`[FAIL] ${item.lang}: Missing standard bidirectional hreflang links`);
    hasError = true;
  }

  // Rule 4: Native language keyword presence check
  if (!content.includes(item.sampleKeyword)) {
    console.error(`[FAIL] ${item.lang}: Native pre-rendered keyword '${item.sampleKeyword}' not found in output`);
    hasError = true;
  }
}

if (hasError) {
  console.error('\n❌ Pre-rendering failed assertions. Halting build.');
  process.exit(1);
}

console.log('✅ All 6 language static pages passed deterministic assertions with 0 errors!');
console.log('=== Pre-rendering Completed Successfully ===\n');
