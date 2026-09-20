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
    desc: 'EQT 是一款跨越 Windows、Mac、Linux、iPhone 与 Android 的局域网直传工具。手机自带相机扫码即传，千兆满速 (10–100 MB/s)，零云端中继，免装 App。支持多文件与目录自动打包 ZIP、剪贴板与文本秒传、局域网 Web 聊天室、Windows 右键分享、首选 80/443 标准端口穿透防火墙与公信 LAN-TLS 绿锁。',
    keywords: '隔空投送Windows版, AirDrop安卓替代品, 电脑手机互传, 局域网文件传输, 免安装文件快传, 文件夹打包下载, 手机剪贴板互传, Windows右键分享, 80端口局域网传输, 局域网加密聊天, 零云端隐私传输',
    sampleKeyword: '局域网'
  },
  ja: {
    code: 'ja',
    name: '日本語',
    htmlLang: 'ja',
    ogLocale: 'ja_JP',
    title: 'EQT - あらゆるデバイスに対応したAirDrop | 高速ローカルLANファイル転送・ZIP一括送受信＆安全なWebチャット',
    desc: 'EQTはPC、iPhone、Android間でカメラQRコードをスキャンするだけでギガビットLAN速度（10–100 MB/s）の高速ファイル転送を実現。クラウド不要、アプリインストール不要。複数ファイル・フォルダのZIP自動アーカイブ、クリップボード送信、Windows右クリック共有、80/443標準ポート対応＆公認LAN-TLS暗号化。',
    keywords: 'AirDrop Windows代替, スマホ PC ファイル転送, アプリ不要 ファイル共有, フォルダZIP一括送信, クリップボード共有, Windows右クリック転送, ローカルLAN転送, QRコードファイル共有, 標準ポート転送',
    sampleKeyword: '転送'
  },
  ko: {
    code: 'ko',
    name: '한국어',
    htmlLang: 'ko',
    ogLocale: 'ko_KR',
    title: 'EQT - 모든 기기를 위한 AirDrop | 초고속 로컬 LAN 파일 전송, 폴더 ZIP 압축 및 보안 웹 채팅',
    desc: 'EQT는 PC, iPhone, Android 간에 기본 카메라 QR 코드로 기가비트 LAN 속도(10–100 MB/s) 파일 전송을 제공합니다. 클라우드 중계 없음, 앱 설치 불필요. 다중 파일 및 폴더 ZIP 자동 패키징, 클립보드 텍스트 전송, Windows 마우스 우클릭 공유, 80/443 표준 포트 및 공식 LAN-TLS 보안 암호화.',
    keywords: 'Windows AirDrop 대체, 안드로이드 PC 파일전송, 앱 설치 없는 파일전송, 폴더 ZIP 전송, 클립보드 전송, Windows 우클릭 파일공유, 로컬 LAN 전송, QR코드 파일공유',
    sampleKeyword: '전송'
  },
  de: {
    code: 'de',
    name: 'Deutsch',
    htmlLang: 'de',
    ogLocale: 'de_DE',
    title: 'EQT - AirDrop für jedes Gerät | Lokale LAN-Dateiübertragung, Ordner-ZIP & Sicherer Web-Chat',
    desc: 'EQT überträgt Dateien zwischen PC, iPhone und Android mit voller Gigabit-LAN-Geschwindigkeit (10–100 MB/s) per QR-Code. Ohne Cloud, ohne App-Installation. Mehrfachdatei- & Ordner-ZIP-Archivierung, Zwischenablage-Transfer, Windows-Rechtsklick-Freigabe, bevorzugte Standard-Ports (80/443) & offizielle LAN-TLS-Verschlüsselung.',
    keywords: 'AirDrop für Windows, AirDrop Alternative Android, Lokale Dateiübertragung WLAN, Ordner als ZIP übertragen, Zwischenablage teilen, Windows Kontextmenü teilen, PC zu Handy ohne App, Datenschutz Dateitransfer',
    sampleKeyword: 'Dateiübertragung'
  },
  fr: {
    code: 'fr',
    name: 'Français',
    htmlLang: 'fr',
    ogLocale: 'fr_FR',
    title: 'EQT - AirDrop pour tous les appareils | Transfert de fichiers LAN local, Archive ZIP & Chat Web sécurisé',
    desc: 'EQT transfère des fichiers entre PC, iPhone et Android à la vitesse Gigabit LAN (10–100 Mo/s) par code QR. Sans cloud, sans installer d\'application. Archivage ZIP automatique des dossiers, partage du presse-papiers, intégration clic droit Windows, ports standard 80/443 et chiffrement LAN-TLS certifié.',
    keywords: 'AirDrop pour Windows, Alternative AirDrop Android, Transfert local sans cloud, Téléchargement dossier ZIP, Partage presse-papiers, Clic droit Windows partager, Transfert PC vers téléphone sans app, Chiffrement LAN-TLS',
    sampleKeyword: 'Transfert'
  },
  es: {
    code: 'es',
    name: 'Español',
    htmlLang: 'es',
    ogLocale: 'es_ES',
    title: 'EQT - AirDrop para cualquier dispositivo | Transferencia LAN local, Archivo ZIP y Chat Web seguro',
    desc: 'EQT transfiere archivos entre PC, iPhone y Android a velocidad Gigabit LAN (10–100 MB/s) mediante código QR. Sin nube, sin instalar apps en el móvil. Empaquetado ZIP de carpetas, envío de portapapeles, menú contextual de Windows, puertos estándar (80/443) y cifrado LAN-TLS oficial.',
    keywords: 'AirDrop para Windows, Alternativa a AirDrop Android, Transferencia local sin nube, Enviar carpetas ZIP, Compartir portapapeles, Clic derecho Windows compartir, PC a celular sin app, Compartir archivos LAN',
    sampleKeyword: 'Transferencia'
  }
};

// 4. Enrich translation dictionaries with latest features & aligned copy
function enrichTranslations(dict) {
  // English updates
  dict.en = Object.assign(dict.en || {}, {
    hero_badge_new: "v1.36.165 Released: Preferred Ports (80/443), Android Support &amp; Web Chat",
    feat1_title: "Instant QR &amp; Standard Ports (80/443)",
    feat1_desc: "Scan from any camera to start transfers instantly. Prefers standard ports (80/443) for clean URLs without messy port numbers, effortlessly penetrating corporate firewalls.",
    feat2_title: "Gigabit LAN Full Speed (10-100+ MB/s)",
    feat2_desc: "Utilize the full physical limits of your local Wi-Fi 6 or Ethernet router. Transfer 4K videos and multi-gigabyte files with zero throttling and zero ISP internet dependency.",
    feat3_title: "AirDrop for Any Device (Zero App Install)",
    feat3_desc: "Universal freedom across Windows, Mac, Linux, iOS, and Android. Receiving and mobile devices need zero app installation, zero registration, and zero cloud accounts.",
    feat4_title: "Batch Files &amp; Recursive Folder ZIP",
    feat4_desc: "Select multiple disjoint files or entire project directories. EQT dynamically bundles folders into a structured ZIP archive for instantaneous one-tap mobile downloading.",
    feat5_title: "Instant Web Chat &amp; Host Device Controls",
    feat5_desc: "Zero-cloud P2P chatroom over WebSockets with lossless attachment sharing. Host dashboard inspects connected devices and can force suspicious peers offline in one click.",
    feat6_title: "Windows Explorer Right-Click &amp; Headless CLI",
    feat6_desc: "Right-click any file to 'Share with EQT', drag-and-drop into desktop GUI, or run our single-binary CLI with ANSI terminal QR codes in headless Linux SSH sessions.",
    feat7_title: "Tus Resumable Upload &amp; HTTP Range Seeking",
    feat7_desc: "Open Tus protocol resists mobile screen sleep and Wi-Fi drops with automatic resume. Full RFC 7233/9110 Range support enables smooth 4K video scrubbing on phones.",
    feat8_title: "LAN-TLS Green Lock &amp; Offline DRM",
    feat8_desc: "Client-generated ECDSA P-256 keys never leave the machine. Automated WebPKI wildcard certificates prevent iOS 1.5GB OOM crashes with genuine browser green locks."
  });

  // Chinese updates
  dict.zh = Object.assign(dict.zh || {}, {
    hero_badge_new: "v1.36.165 正式发布：首选 80/443 标准端口、全面支持安卓 &amp; 免装网页快传",
    feat1_title: "扫码即传 &amp; 首选标准端口 (80/443)",
    feat1_desc: "手机原生相机扫码即开。优先绑定 80/443 标准端口，生成的链接干净无非标端口后缀，轻松穿透企业内网与校园防火墙。",
    feat2_title: "千兆局域网满速 (10–100+ MB/s)",
    feat2_desc: "充分释放 Wi-Fi 6 与千兆网卡硬件潜力。大容量 4K 原画视频与数十 GB 压缩包极速送达，完全不受外网宽带或流量上限限制。",
    feat3_title: "打破生态壁垒 (手机免装 App)",
    feat3_desc: "真正支持任何设备的隔空投送。全面覆盖 Windows、Mac、Linux、iPhone 与 Android，手机端无需安装任何应用、无需注册登录。",
    feat4_title: "多文件批量与目录 ZIP 自动打包",
    feat4_desc: "支持一次性挑选多个文件或整个复杂目录。服务端动态打包为 ZIP 归档流，移动端一键完整下载，告别逐个点选烦恼。",
    feat5_title: "局域网 Web 聊天室与主机设备管控",
    feat5_desc: "基于 WebSocket 的纯内网端到端即时通讯，原图原文件无损直传。电脑端实时查看连入设备并可一键踢出可疑设备。",
    feat6_title: "Windows 右键菜单集成与全能 CLI",
    feat6_desc: "文件右键直接“使用 EQT 分享”，桌面端支持全局拖拽投送与托盘常驻；同时提供单二进制 CLI 工具，支持 SSH 终端 ANSI 字符二维码。",
    feat7_title: "Tus 断点续传与 HTTP Range 视频播放",
    feat7_desc: "采用开放 Tus 分块协议，抗手机息屏与弱网抖动；深度支持 RFC 7233/9110 Range 规范，4K 视频可在手机端随意拖拽进度条预览。",
    feat8_title: "公信绿锁 LAN-TLS 与离线授权 (PLUS)",
    feat8_desc: "本地生成 ECDSA P-256 私钥（永不出机），自动化配置公信 WebPKI 通配符证书，彻底解决 iOS Safari 1.5GB 闪退并保障全链路安全。"
  });

  // Japanese updates
  dict.ja = Object.assign(dict.ja || {}, {
    hero_badge_new: "v1.36.165 リリース：80/443標準ポート対応、Android全面サポート＆Webチャット",
    feat1_title: "即座QRスキャン＆標準ポート (80/443)",
    feat1_desc: "スマホのカメラでスキャンするだけで即座に開始。80/443標準ポートを優先使用し、不要なポート番号のないクリーンなURLを生成。企業のファイアウォールも容易に回避できます。",
    feat2_title: "ギガビットLAN全速力 (10–100+ MB/s)",
    feat2_desc: "Wi-Fi 6および有線LANルーターの物理的限界をフル活用。4K動画や数ギガバイトの大容量ファイルも、外部インターネット帯域の影響を受けずに高速転送。",
    feat3_title: "あらゆる端末対応のAirDrop (アプリ不要)",
    feat3_desc: "エコシステムの壁を打破。iPhone、Android、Windows、Mac、Linux間でシームレスに相互転送。受信側のスマホにはアプリのインストールも登録も一切不要です。",
    feat4_title: "複数ファイル＆フォルダZIP自動圧縮",
    feat4_desc: "散らばった複数ファイルやプロジェクトフォルダ全体を一括選択可能。サーバー側で自動的にZIPアーカイブ化し、スマホ側で1タップでまとめてダウンロードできます。",
    feat5_title: "即時Webチャット＆ホスト端末管理",
    feat5_desc: "WebSocketによるクラウドを一切経由しないP2Pチャットルーム。原画・添付ファイルの無劣化転送と、ホスト側からの接続端末の監視・ワンクリック切断機能を搭載。",
    feat6_title: "Windows右クリック共有＆高機能CLI",
    feat6_desc: "エクスプローラーでファイルを右クリックして「EQTで共有」、デスクトップ画面へのドラッグ＆ドロップ、LinuxのSSH端末でのANSI QR表示に完全対応。",
    feat7_title: "Tusレジューム転送＆HTTP Range再生",
    feat7_desc: "オープンTusプロトコルによりスマホのスリープやWi-Fiの瞬断にも強く、中断箇所から自動再開。RFC 7233/9110 Range対応で4K動画のシーク再生も快適です。",
    feat8_title: "公認LAN-TLS緑の鍵マーク＆オフライン認証",
    feat8_desc: "ローカル生成のECDSA P-256秘密鍵は外部に一切流出しません。自動化されたWebPKIワイルドカード証明書により、iOS Safariの1.5GBクラッシュを防ぎ完全保護。"
  });

  // Korean updates
  dict.ko = Object.assign(dict.ko || {}, {
    hero_badge_new: "v1.36.165 출시: 80/443 표준 포트 우선 지원, Android 완벽 호환 및 Web 전송",
    feat1_title: "즉석 QR 및 표준 포트 (80/443) 지원",
    feat1_desc: "기본 카메라로 QR을 스캔하여 즉시 시작하세요. 80/443 표준 포트를 우선 바인딩하여 깔끔한 URL을 제공하며 엄격한 기업 방화벽을 원활히 통과합니다.",
    feat2_title: "기가비트 LAN 최고 속도 (10–100+ MB/s)",
    feat2_desc: "Wi-Fi 6 및 로컬 라우터의 하드웨어 한계를 최대한 활용합니다. 4K 비디오와 수 기가바이트 파일도 인터넷 대역폭 제한 없이 순수 로컬로 고속 전송합니다.",
    feat3_title: "모든 기기를 위한 AirDrop (앱 설치 불필요)",
    feat3_desc: "생태계 장벽을 넘어 iPhone, Android, Windows, Mac, Linux 간 자유로운 파일 전송을 경험하세요. 수신 모바일 기기에는 어떠한 앱 설치나 계정 로그인도 필요 없습니다.",
    feat4_title: "다중 파일 및 폴더 ZIP 자동 패키징",
    feat4_desc: "여러 파일이나 전체 폴더를 손쉽게 공유하세요. EQT가 폴더를 즉시 구조화된 ZIP 아카이브로 묶어 모바일 기기에서 탭 한 번으로 간편하게 다운로드할 수 있습니다.",
    feat5_title: "실시간 웹 채팅 및 호스트 기기 관리",
    feat5_desc: "클라우드 없는 순수 WebSocket P2P 채팅방. 원본 사진 및 대용량 첨부파일 전송은 물론, 데스크톱 호스트 화면에서 접속된 기기를 모니터링하고 원클릭 강퇴할 수 있습니다.",
    feat6_title: "Windows 우클릭 메뉴 및 터미널 CLI",
    feat6_desc: "탐색기에서 파일 우클릭 후 'EQT로 공유', GUI 창으로 드래그 앤 드롭, 또는 헤드리스 Linux SSH 세션에서 터미널 ANSI QR 코드를 활용한 고속 CLI 실행을 완벽 지원합니다.",
    feat7_title: "Tus 이어올리기 및 HTTP Range 스트리밍",
    feat7_desc: "Tus 프로토콜을 통해 화면 꺼짐이나 무선 불안정 상황에서도 중단된 위치부터 안정적으로 이어받기 가능. RFC Range 규격 지원으로 폰에서 대용량 비디오 탐색 재생 지원.",
    feat8_title: "공인 LAN-TLS 보안 자물쇠 및 오프라인 DRM",
    feat8_desc: "로컬에서 생성된 ECDSA P-256 개인키는 절대로 외부로 유출되지 않습니다. 공인 WebPKI 와일드카드 인증서를 자동 발급하여 모바일 1.5GB OOM 튕김 현상을 완벽 방지합니다."
  });

  // German updates
  dict.de = Object.assign(dict.de || {}, {
    hero_badge_new: "v1.36.165 Veröffentlicht: Standard-Ports (80/443), Android-Support &amp; Web-Chat",
    feat1_title: "Sofortiger QR-Scan &amp; Standard-Ports (80/443)",
    feat1_desc: "Einfach mit der Kamera scannen. Bevorzugt Standard-Ports (80/443) für saubere URLs ohne störende Portnummern – ideal zur problemlosen Umgehung strenger Unternehmens-Firewalls.",
    feat2_title: "Gigabit-LAN-Höchstgeschwindigkeit (10–100+ MB/s)",
    feat2_desc: "Nutzen Sie das volle Potenzial Ihres Wi-Fi 6- oder Gigabit-Netzwerks. Übertragen Sie 4K-Videos und große Archive ohne Drosselung und völlig unabhängig vom Internetanbieter.",
    feat3_title: "AirDrop für buchstäblich jedes Gerät (Ohne App)",
    feat3_desc: "Überwinden Sie Ökosystemgrenzen. Reibungsloser Datenaustausch zwischen iPhone, Android, Windows, Mac und Linux – ohne App-Installation oder Registrierung auf dem Mobilgerät.",
    feat4_title: "Mehrfachdateien &amp; Ordner-ZIP-Archivierung",
    feat4_desc: "Wählen Sie mehrere Dateien oder ganze Ordner aus. EQT packt Ordner dynamisch in strukturierte ZIP-Archive für den sofortigen 1-Klick-Download auf Smartphones.",
    feat5_title: "Sofortiger Web-Chat &amp; Host-Gerätesteuerung",
    feat5_desc: "Cloudfreier P2P-Chatraum über WebSockets mit verlustfreiem Dateianhang. Das Host-Dashboard prüft verbundene Geräte und kann unerwünschte Clients mit einem Klick trennen.",
    feat6_title: "Windows-Rechtsklick &amp; Headless-CLI",
    feat6_desc: "Rechtsklick auf Dateien zur Freigabe mit EQT, Drag-and-Drop in die Desktop-App oder Ausführung über das schlanke CLI mit ANSI-Terminal-QR-Codes in SSH-Sitzungen.",
    feat7_title: "Fortsetzbare Tus-Uploads &amp; HTTP-Range-Streaming",
    feat7_desc: "Das Tus-Protokoll widersteht Displaysperren und WLAN-Schwankungen mit automatischer Wiederaufnahme. Vollständige RFC 7233/9110-Range-Unterstützung für flüssiges 4K-Video-Scrubbing.",
    feat8_title: "Offizielles LAN-TLS-Schloss &amp; Offline-DRM",
    feat8_desc: "Lokal erzeugte ECDSA P-256-Schlüssel verlassen das Gerät nie. Automatisierte WebPKI-Zertifikate verhindern Speicherabstürze (1,5 GB OOM) auf iOS-Safari zuverlässig."
  });

  // French updates
  dict.fr = Object.assign(dict.fr || {}, {
    hero_badge_new: "v1.36.165 Sortie : Ports standard (80/443), Support Android &amp; Chat Web",
    feat1_title: "QR Code instantané &amp; Ports standard (80/443)",
    feat1_desc: "Scannez avec votre appareil photo natif. Utilise en priorité les ports 80/443 pour des URL nettes sans numéros de port complexes, traversant aisément les pare-feu d'entreprise.",
    feat2_title: "Pleine vitesse Gigabit LAN (10–100+ Mo/s)",
    feat2_desc: "Exploitez les limites physiques de votre routeur Wi-Fi 6 ou Ethernet. Transférez des vidéos 4K et de gros fichiers sans aucun bridage et sans dépendre d'Internet.",
    feat3_title: "AirDrop pour absolument tous les appareils (Sans app)",
    feat3_desc: "Brisez les barrières des écosystèmes. Échangez facilement entre iPhone, Android, Windows, Mac et Linux sans installer d'application ni créer de compte sur le téléphone.",
    feat4_title: "Fichiers multiples &amp; Archivage ZIP de dossiers",
    feat4_desc: "Sélectionnez plusieurs fichiers ou des dossiers entiers. EQT regroupe dynamiquement les dossiers dans une archive ZIP pour un téléchargement mobile direct en un clic.",
    feat5_title: "Chat Web instantané &amp; Contrôle des appareils",
    feat5_desc: "Salon de discussion P2P sans cloud sur WebSockets avec transfert de pièces jointes sans perte. Le tableau de bord hôte surveille et peut déconnecter les appareils indésirables.",
    feat6_title: "Clic droit Windows &amp; CLI pour serveurs",
    feat6_desc: "Clic droit sur un fichier pour 'Partager avec EQT', glisser-déposer dans l'interface graphique, ou exécution via CLI avec QR code ANSI directement dans les terminaux SSH.",
    feat7_title: "Uploads reprenables Tus &amp; Lecture vidéo Range",
    feat7_desc: "Le protocole ouvert Tus résiste à la mise en veille et aux coupures Wi-Fi avec reprise automatique. Prise en charge RFC Range pour prévisualiser les vidéos 4K sans accroc.",
    feat8_title: "Chiffrement LAN-TLS certifié &amp; DRM hors-ligne",
    feat8_desc: "Clé privée ECDSA P-256 générée localement ne quittant jamais la machine. Les certificats WebPKI évitent les plantages mémoire (1,5 Go OOM) sous iOS Safari."
  });

  // Spanish updates
  dict.es = Object.assign(dict.es || {}, {
    hero_badge_new: "Lanzamiento v1.36.165: Puertos estándar (80/443), Soporte Android y Chat Web",
    feat1_title: "Escaneo QR y Puertos Estándar (80/443)",
    feat1_desc: "Escanee con la cámara nativa para comenzar. Prioriza puertos estándar (80/443) para URLs limpias sin puertos extraños, sorteando fácilmente cortafuegos corporativos.",
    feat2_title: "Velocidad máxima Gigabit LAN (10–100+ MB/s)",
    feat2_desc: "Aproveche al máximo su red Wi-Fi 6 o Ethernet. Transfiera videos 4K y archivos pesados sin límites de ancho de banda y con total independencia de Internet.",
    feat3_title: "AirDrop para cualquier dispositivo (Sin instalar apps)",
    feat3_desc: "Rompa las barreras de los ecosistemas. Transfiera sin esfuerzo entre iPhone, Android, Windows, Mac y Linux sin necesidad de instalar apps ni registrarse en el celular.",
    feat4_title: "Archivos múltiples y Empaquetado ZIP de carpetas",
    feat4_desc: "Seleccione múltiples archivos o carpetas completas. EQT las comprime dinámicamente en un archivo ZIP estructurado para una descarga móvil directa en un solo toque.",
    feat5_title: "Chat Web instantáneo y Control de dispositivos",
    feat5_desc: "Sala de chat P2P sin nube mediante WebSockets con envío de adjuntos sin compresión. El panel del host permite inspeccionar y expulsar dispositivos sospechosos.",
    feat6_title: "Menú contextual de Windows y CLI profesional",
    feat6_desc: "Clic derecho en archivos para 'Compartir con EQT', arrastrar y soltar en la app de escritorio o ejecución mediante CLI con códigos QR ANSI en sesiones remotas SSH.",
    feat7_title: "Cargas reanudables Tus y Streaming HTTP Range",
    feat7_desc: "El protocolo Tus resiste el bloqueo de pantalla y caídas de Wi-Fi con reanudación automática. Compatibilidad con RFC Range para avance fluido de videos 4K.",
    feat8_title: "Candado verde LAN-TLS y DRM fuera de línea",
    feat8_desc: "Claves ECDSA P-256 generadas en el cliente que nunca salen de la máquina. Certificados WebPKI oficiales que previenen cierres por memoria (1.5GB OOM) en iOS Safari."
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
