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
    title: 'EQT - 真正支持任何设备的隔空投送 | 极速局域网文件互传、文件夹ZIP打包与安全聊天',
    desc: 'EQT 是一款跨越 Windows、Mac、Linux、iPhone 与 Android 的局域网直传工具。手机自带相机扫码即传，千兆满速 (10–100 MB/s)，零云端中继，免装 App。支持多文件与目录自动打包 ZIP、剪贴板与文本秒传、局域网 Web 聊天室、首选 80/443 标准端口穿透防火墙与默认支持安全传输 (HTTPS)。',
    keywords: '隔空投送Windows版, AirDrop安卓替代品, 电脑手机互传, 局域网文件传输, 免安装文件快传, 文件夹打包下载, 手机剪贴板互传, 80端口局域网传输, 局域网加密聊天, 零云端隐私传输',
    sampleKeyword: '局域网'
  },
  ja: {
    code: 'ja',
    name: '日本語',
    htmlLang: 'ja',
    ogLocale: 'ja_JP',
    title: 'EQT - あらゆるデバイスに対応したAirDrop | 高速ローカルLANファイル転送・ZIP一括送受信＆安全なWebチャット',
    desc: 'EQTはPC、iPhone、Android間でカメラQRコードをスキャンするだけでギガビットLAN速度（10–100 MB/s）の高速ファイル転送を実現。クラウド不要、アプリインストール不要。複数ファイル・フォルダのZIP自動アーカイブ、クリップボード送信、80/443標準ポート対応＆安全なHTTPS暗号化転送を標準サポート。',
    keywords: 'AirDrop Windows代替, スマホ PC ファイル転送, アプリ不要 ファイル共有, フォルダZIP一括送信, クリップボード共有, ローカルLAN転送, QRコードファイル共有, 標準ポート転送',
    sampleKeyword: '転送'
  },
  ko: {
    code: 'ko',
    name: '한국어',
    htmlLang: 'ko',
    ogLocale: 'ko_KR',
    title: 'EQT - 모든 기기를 위한 AirDrop | 초고속 로컬 LAN 파일 전송, 폴더 ZIP 압축 및 보안 웹 채팅',
    desc: 'EQT는 PC, iPhone, Android 간에 기본 카메라 QR 코드로 기가비트 LAN 속도(10–100 MB/s) 파일 전송을 제공합니다. 클라우드 중계 없음, 앱 설치 불필요. 다중 파일 및 폴더 ZIP 자동 패키징, 클립보드 텍스트 전송, 80/443 표준 포트 및 기본 보안 전송(HTTPS) 지원.',
    keywords: 'Windows AirDrop 대체, 안드로이드 PC 파일전송, 앱 설치 없는 파일전송, 폴더 ZIP 전송, 클립보드 전송, 로컬 LAN 전송, QR코드 파일공유',
    sampleKeyword: '전송'
  },
  de: {
    code: 'de',
    name: 'Deutsch',
    htmlLang: 'de',
    ogLocale: 'de_DE',
    title: 'EQT - AirDrop für jedes Gerät | Lokale LAN-Dateiübertragung, Ordner-ZIP & Sicherer Web-Chat',
    desc: 'EQT überträgt Dateien zwischen PC, iPhone und Android mit voller Gigabit-LAN-Geschwindigkeit (10–100 MB/s) per QR-Code. Ohne Cloud, ohne App-Installation. Mehrfachdatei- & Ordner-ZIP-Archivierung, Zwischenablage-Transfer, Standard-Ports (80/443) & standardmäßig sichere Übertragung (HTTPS).',
    keywords: 'AirDrop für Windows, AirDrop Alternative Android, Lokale Dateiübertragung WLAN, Ordner als ZIP übertragen, Zwischenablage teilen, PC zu Handy ohne App, Datenschutz Dateitransfer',
    sampleKeyword: 'Dateiübertragung'
  },
  fr: {
    code: 'fr',
    name: 'Français',
    htmlLang: 'fr',
    ogLocale: 'fr_FR',
    title: 'EQT - AirDrop pour tous les appareils | Transfert de fichiers LAN local, Archive ZIP & Chat Web sécurisé',
    desc: 'EQT transfère des fichiers entre PC, iPhone et Android à la vitesse Gigabit LAN (10–100 Mo/s) par code QR. Sans cloud, sans installer d\'application. Archivage ZIP automatique des dossiers, partage du presse-papiers, ports standard 80/443 et transfert sécurisé par défaut (HTTPS).',
    keywords: 'AirDrop pour Windows, Alternative AirDrop Android, Transfert local sans cloud, Téléchargement dossier ZIP, Partage presse-papiers, Transfert PC vers téléphone sans app, Chiffrement LAN-TLS',
    sampleKeyword: 'Transfert'
  },
  es: {
    code: 'es',
    name: 'Español',
    htmlLang: 'es',
    ogLocale: 'es_ES',
    title: 'EQT - AirDrop para cualquier dispositivo | Transferencia LAN local, Archivo ZIP y Chat Web seguro',
    desc: 'EQT transfiere archivos entre PC, iPhone y Android a velocidad Gigabit LAN (10–100 MB/s) mediante código QR. Sin nube, sin instalar apps en el móvil. Empaquetado ZIP de carpetas, envío de portapapeles, puertos estándar (80/443) y transmisión segura por defecto (HTTPS).',
    keywords: 'AirDrop para Windows, Alternativa a AirDrop Android, Transferencia local sin nube, Enviar carpetas ZIP, Compartir portapapeles, PC a celular sin app, Compartir archivos LAN',
    sampleKeyword: 'Transferencia'
  }
};

// 4. Enrich translation dictionaries with latest features & aligned copy
function enrichTranslations(dict) {
  // English updates (User-Centric & Benefit-Driven)
  dict.en = Object.assign(dict.en || {}, {
    hero_badge_new: "v1.36.170 Released: Default HTTPS Transmission, Zero Mobile App Install &amp; One-Tap Folder Pack",
    feat1_title: "Instant Scan, Works on Any Wi-Fi",
    feat1_desc: "Scan with your default phone camera to start instantly. Seamlessly navigates office networks, campus Wi-Fi, and hotel networks without being blocked by corporate firewalls.",
    feat2_title: "Blazing Gigabit LAN Speed (10-100+ MB/s)",
    feat2_desc: "Unleash the full physical potential of your local Wi-Fi 6 or Ethernet. Transfer 4K ProRes videos and massive archives in seconds with zero internet data usage and zero compression.",
    feat3_title: "Universal AirDrop Freedom, Zero App Needed",
    feat3_desc: "Works effortlessly across Windows, Mac, iPhone, iPad, and Android. Receiving phones need no app downloads, no account registrations, and no companion software.",
    feat4_title: "One-Tap Folder Sharing, Instant Zip Download",
    feat4_desc: "Share hundreds of photos or entire project folders at once. EQT bundles them into a single archive so mobile recipients can download everything in one tap instead of saving one by one.",
    feat5_title: "Private Instant Workspace &amp; Device Controls",
    feat5_desc: "Quickly exchange clipboard text, passwords, notes, and raw media between phone and PC. The host dashboard lets you see connected devices and disconnect unwanted guests.",
    feat6_title: "Default Secure Transmission (HTTPS)",
    feat6_desc: "Built-in HTTPS encryption by default. Mobile browsers connect smoothly with zero warning screens. Files transfer directly between your devices over local Wi-Fi, completely private and never touching the cloud.",
    price_free_feat_tls: "Default Secure Transmission (HTTPS)",
    price_plus_feat_tls: "Default Secure Transmission (HTTPS)"
  });
  delete (dict.en || {}).feat7_title;
  delete (dict.en || {}).feat7_desc;
  delete (dict.en || {}).feat8_title;
  delete (dict.en || {}).feat8_desc;

  // Chinese updates (用户视角与使用感受)
  dict.zh = Object.assign(dict.zh || {}, {
    hero_badge_new: "v1.36.170 正式发布：默认支持安全传输 (HTTPS)、安卓与苹果手机免装直传 &amp; 文件夹一键打包",
    feat1_title: "扫码即连，公共 Wi-Fi 畅通无阻",
    feat1_desc: "掏出手机自带相机扫一扫即可开始。智能兼容公司办公网、校园网与酒店 Wi-Fi，杜绝被企业防火墙误拦截，生成的链接干净清爽。",
    feat2_title: "千兆局域网满速狂飙，大文件秒传",
    feat2_desc: "充分释放路由器与网卡的硬件潜力（10–100+ MB/s）。不耗费外网流量，几十 GB 的 4K 原画视频与大型安装包转眼送达，画质绝不压缩。",
    feat3_title: "真正的跨设备隔空投送，手机免装软件",
    feat3_desc: "完美打通 Windows、Mac、iPhone 与安卓手机。接收方设备无需安装任何 App、无需注册账号、无需加好友，纯网页无缝收发。",
    feat4_title: "一键打包整个文件夹，告别逐个点选",
    feat4_desc: "一次性挑选数百张照片或一整个工作文件夹。系统自动打包归档，手机端点一下就能一次性完整存盘，再也不用逐张点击保存。",
    feat5_title: "临时私密互传工作台，会议与访客神器",
    feat5_desc: "在电脑与手机之间随时同步文字、便签、账号密码与原画素材。电脑端可清晰掌控所有连入设备，临时访客用完即走，无任何云端留痕。",
    feat6_title: "默认支持安全传输 (HTTPS)",
    feat6_desc: "开箱默认开启 HTTPS 加密传输，手机浏览器直接顺畅打开，绝无吓人的风险拦截警告。所有文件仅在局域网内点对点极速直连，不走任何外网云端，彻底守护您的隐私。",
    price_free_feat_tls: "默认支持安全传输 (HTTPS)",
    price_plus_feat_tls: "全系标配安全传输 (HTTPS)"
  });
  delete (dict.zh || {}).feat7_title;
  delete (dict.zh || {}).feat7_desc;
  delete (dict.zh || {}).feat8_title;
  delete (dict.zh || {}).feat8_desc;

  // Japanese updates (ユーザー視点＆メリット訴求)
  dict.ja = Object.assign(dict.ja || {}, {
    hero_badge_new: "v1.36.170 リリース：HTTPS安全転送標準対応、スマホアプリ不要＆フォルダ一括共有",
    feat1_title: "カメラで即スキャン、公共Wi-Fiでも快適",
    feat1_desc: "スマホの標準カメラでかざすだけ。オフィスの社内LAN、大学キャンパス、ホテルのWi-Fiでもファイアウォールに遮断されず、いつでもスムーズに接続できます。",
    feat2_title: "ギガビットLAN全速力、大容量も一瞬で完了",
    feat2_desc: "ルーターの限界スピード（10–100+ MB/s）をフル活用。ネット通信量を消費せず、数十GBの高画質4K動画や重いファイルもあっという間に転送完了。",
    feat3_title: "あらゆる端末対応のAirDrop、アプリ導入ゼロ",
    feat3_desc: "Windows、Mac、iPhone、Androidの垣根を完全撤廃。受け取る側のスマホにアプリのインストールも会員登録も一切不要、ブラウザだけで完結します。",
    feat4_title: "フォルダ一括ZIP共有、1タップで保存完了",
    feat4_desc: "大量の写真や作業フォルダ丸ごとを一括共有。自動でZIPにまとめてくれるので、スマホ側で1枚ずつ保存する面倒な作業から解放されます。",
    feat5_title: "一時的なプライベート作業スペース＆端末管理",
    feat5_desc: "テキスト、パスワード、メモ、高画質写真を手軽に共有。PC側から接続端末をリアルタイムに確認・切断でき、会議や来客時にも安心して使えます。",
    feat6_title: "安全なHTTPS暗号化転送を標準サポート",
    feat6_desc: "標準でHTTPS暗号化転送に対応。スマホのブラウザでセキュリティ警告画面が出ずスムーズに接続できます。ファイルはローカルWi-Fi経由で端末間を直接転送され、クラウドを通さずプライバシーは完全に保護されます。",
    price_free_feat_tls: "安全なHTTPS暗号化転送を標準サポート",
    price_plus_feat_tls: "安全なHTTPS暗号化転送を標準サポート"
  });
  delete (dict.ja || {}).feat7_title;
  delete (dict.ja || {}).feat7_desc;
  delete (dict.ja || {}).feat8_title;
  delete (dict.ja || {}).feat8_desc;

  // Korean updates (사용자 관점 및 편의성 강조)
  dict.ko = Object.assign(dict.ko || {}, {
    hero_badge_new: "v1.36.170 출시: 기본 보안 전송(HTTPS) 지원, 모바일 앱 설치 없는 초고속 전송 및 폴더 일괄 다운로드",
    feat1_title: "카메라 즉석 스캔, 공용 Wi-Fi에서도 완벽 접속",
    feat1_desc: "스마트폰 기본 카메라로 비추기만 하면 즉시 시작됩니다. 회사 업무망, 캠퍼스, 호텔 Wi-Fi에서도 방화벽 차단 없이 깔끔하게 접속됩니다.",
    feat2_title: "기가비트 LAN 최대 속도, 대용量 파일 초고속 전송",
    feat2_desc: "공유기 하드웨어 성능을 극한(10–100+ MB/s)까지 활용합니다. 인터넷 데이터를 쓰지 않고 수십 GB의 4K 원본 동영상과 압축파일을 눈 깜짝할 사이에 전송합니다.",
    feat3_title: "모든 기기를 위한 AirDrop, 앱 설치 전혀 불필요",
    feat3_desc: "Windows, Mac, iPhone, 안드로이드 간 장벽을 없앴습니다. 받는 쪽 스마트폰에 앱 설치, 계정 가입, 친구 추가 없이 브라우저로 바로 주고받습니다.",
    feat4_title: "폴더 전체를 한 번에, 번거로운 개별 저장 끝",
    feat4_desc: "수백 장의 사진이나 작업 폴더 전체를 간편하게 공유하세요. 자동으로 ZIP 압축되어 스마트폰에서 탭 한 번으로 깔끔하게 저장됩니다.",
    feat5_title: "임시 프라이빗 워크스페이스 및 접속 기기 관리",
    feat5_desc: "PC와 폰 사이에서 텍스트 메모, 계정 정보, 원본 사진을 즉시 전송합니다. PC 화면에서 연결된 기기를 확인하고 불필요한 기기를 즉시 차단할 수 있습니다.",
    feat6_title: "기본 보안 전송(HTTPS) 지원",
    feat6_desc: "기본적으로 HTTPS 암호화 전송을 지원하여 모바일 브라우저에서 보안 경고창 없이 매끄럽게 열립니다. 모든 파일은 로컬 Wi-Fi를 통해 기기 간에 직접 전송되며, 외부 클라우드를 전혀 거치지 않아 개인정보가 안전하게 보호됩니다.",
    price_free_feat_tls: "기본 보안 전송(HTTPS) 지원",
    price_plus_feat_tls: "기본 보안 전송(HTTPS) 지원"
  });
  delete (dict.ko || {}).feat7_title;
  delete (dict.ko || {}).feat7_desc;
  delete (dict.ko || {}).feat8_title;
  delete (dict.ko || {}).feat8_desc;

  // German updates (Nutzerzentriert & Nutzenorientiert)
  dict.de = Object.assign(dict.de || {}, {
    hero_badge_new: "v1.36.170 Veröffentlicht: Standardmäßig HTTPS-Übertragung, kein App-Download nötig &amp; 1-Klick-Ordner-Download",
    feat1_title: "Sofort-Scan per Kamera, funktioniert in jedem WLAN",
    feat1_desc: "Einfach mit der normalen Smartphone-Kamera scannen. Funktioniert reibungslos im Büro-, Campus- oder Hotel-WLAN, ohne von strikten Firmen-Firewalls blockiert zu werden.",
    feat2_title: "Gigabit-LAN-Vollspeed, riesige Dateien in Sekunden",
    feat2_desc: "Nutzt das volle Potenzial Ihres Heim- oder Büro-Netzwerks (10–100+ MB/s). Völlig unabhängig vom Internetvolumen – selbst 4K-Filme und GB-Archive fliegen blitzschnell rüber.",
    feat3_title: "AirDrop für alle Geräte, keine App-Installation nötig",
    feat3_desc: "Verbindet Windows, Mac, iPhone und Android nahtlos. Auf dem Empfangsgerät muss keine App installiert, kein Konto erstellt und kein Passwort eingegeben werden.",
    feat4_title: "Ganze Ordner mit einem Klick teilen &amp; laden",
    feat4_desc: "Hunderte Fotos oder komplette Projektordner auf einmal freigeben. EQT packt alles automatisch als ZIP – am Smartphone genügt ein Fingertipp zum Speichern.",
    feat5_title: "Privater Sofort-Arbeitsplatz &amp; Gerätekontrolle",
    feat5_desc: "Texte, Passwörter, Notizen und Originalfotos blitzschnell zwischen PC und Handy austauschen. Am PC behalten Sie die volle Kontrolle über verbundene Geräte.",
    feat6_title: "Standardmäßig sichere Übertragung (HTTPS)",
    feat6_desc: "Standardmäßig aktivierte HTTPS-Verschlüsselung. Mobile Browser öffnen sich reibungslos ohne störende Sicherheitswarnungen. Alle Dateien werden direkt über Ihr lokales WLAN übertragen – ohne Cloud-Umweg und mit absolutem Schutz Ihrer Privatsphäre.",
    price_free_feat_tls: "Standardmäßig sichere Übertragung (HTTPS)",
    price_plus_feat_tls: "Standardmäßig sichere Übertragung (HTTPS)"
  });
  delete (dict.de || {}).feat7_title;
  delete (dict.de || {}).feat7_desc;
  delete (dict.de || {}).feat8_title;
  delete (dict.de || {}).feat8_desc;

  // French updates (Orienté utilisateur & Bénéfices)
  dict.fr = Object.assign(dict.fr || {}, {
    hero_badge_new: "v1.36.170 Sortie : Transfert HTTPS par défaut, zéro appli mobile requise &amp; dossiers ZIP en 1 clic",
    feat1_title: "Scannez et connectez, compatible tout Wi-Fi",
    feat1_desc: "Scannez simplement avec l'appareil photo de votre téléphone. Fonctionne parfaitement sur les réseaux de bureau, d'université et d'hôtel sans blocage pare-feu.",
    feat2_title: "Vitesse Gigabit maximale, fichiers lourds instantanés",
    feat2_desc: "Exploite la vitesse maximale de votre réseau local (10–100+ Mo/s). Aucun quota Internet consommé – transférez vos vidéos 4K et gros fichiers sans compression.",
    feat3_title: "AirDrop universel, zéro installation requise",
    feat3_desc: "Relie facilement Windows, Mac, iPhone et Android. Aucun téléchargement d'application ni création de compte n'est nécessaire sur les téléphones mobiles.",
    feat4_title: "Partagez des dossiers entiers en un seul clic",
    feat4_desc: "Partagez des centaines de photos ou des dossiers complets. EQT les regroupe automatiquement en archive ZIP pour un téléchargement direct sur mobile.",
    feat5_title: "Espace d'échange privé et contrôle des appareils",
    feat5_desc: "Échangez instantanément textes, mots de passe et fichiers entre PC et mobile. L'hôte sur PC peut voir les appareils connectés et déconnecter les indésirables.",
    feat6_title: "Transfert sécurisé par défaut (HTTPS)",
    feat6_desc: "Chiffrement HTTPS activé par défaut. Les navigateurs mobiles s'ouvrent sans aucun écran d'alerte de sécurité. Les fichiers transitent directement entre vos appareils via le Wi-Fi local, sans passer par le cloud, pour une confidentialité totale.",
    price_free_feat_tls: "Transfert sécurisé par défaut (HTTPS)",
    price_plus_feat_tls: "Transfert sécurisé par défaut (HTTPS)"
  });
  delete (dict.fr || {}).feat7_title;
  delete (dict.fr || {}).feat7_desc;
  delete (dict.fr || {}).feat8_title;
  delete (dict.fr || {}).feat8_desc;

  // Spanish updates (Enfocado en beneficios de usuario)
  dict.es = Object.assign(dict.es || {}, {
    hero_badge_new: "Lanzamiento v1.36.170: Transmisión HTTPS por defecto, sin instalar apps en el móvil y carpetas ZIP en 1 toque",
    feat1_title: "Escaneo instantáneo, funciona en cualquier Wi-Fi",
    feat1_desc: "Escanee con la cámara de su móvil para comenzar de inmediato. Funciona sin problemas en redes corporativas, universitarias y hoteles sin bloqueos de cortafuegos.",
    feat2_title: "Velocidad Gigabit máxima, archivos pesados al instante",
    feat2_desc: "Aproveche al máximo su red local (10–100+ MB/s). No consume datos de Internet y transfiere videos 4K y archivos gigantescos sin esperas ni compresión.",
    feat3_title: "AirDrop para cualquier dispositivo, sin instalar apps",
    feat3_desc: "Conecte Windows, Mac, iPhone y Android sin barreras. El dispositivo móvil no necesita instalar apps, registrarse ni crear cuentas.",
    feat4_title: "Descarga carpetas completas en un solo toque",
    feat4_desc: "Comparta cientos de fotos o carpetas de proyectos de una sola vez. EQT las agrupa en un archivo ZIP para guardarlas fácilmente en el teléfono.",
    feat5_title: "Área privada de intercambio y control de dispositivos",
    feat5_desc: "Comparta notas de texto, contraseñas y fotos originales entre la PC y el móvil. Controle los dispositivos conectados y desconecte invitados con un clic.",
    feat6_title: "Transmisión segura por defecto (HTTPS)",
    feat6_desc: "Cifrado HTTPS habilitado por defecto. Los navegadores móviles se abren sin pantallas de advertencia de seguridad. Los archivos se transfieren directamente entre sus dispositivos a través de la red Wi-Fi local, sin pasar por la nube, garantizando total privacidad.",
    price_free_feat_tls: "Transmisión segura por defecto (HTTPS)",
    price_plus_feat_tls: "Transmisión segura por defecto (HTTPS)"
  });
  delete (dict.es || {}).feat7_title;
  delete (dict.es || {}).feat7_desc;
  delete (dict.es || {}).feat8_title;
  delete (dict.es || {}).feat8_desc;
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
