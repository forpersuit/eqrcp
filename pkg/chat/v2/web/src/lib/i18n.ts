export type Lang = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'de' | 'fr';

export const translations: Record<string, Record<Lang, string>> = {
  // App.svelte base translations
  freeTier: {
    zh: '免费版',
    en: 'Free',
    ja: '無料版',
    ko: '무료 버전',
    es: 'Gratis',
    de: 'Kostenlos',
    fr: 'Gratuit'
  },
  freeQuotaRemaining: {
    zh: '剩余 {time}',
    en: '{time} left',
    ja: '残り {time}',
    ko: '{time} 남음',
    es: 'Quedan {time}',
    de: 'Noch {time}',
    fr: '{time} restant'
  },
  freeQuotaDegraded: {
    zh: '已降级',
    en: 'Limited',
    ja: '制限中',
    ko: '제한됨',
    es: 'Limitado',
    de: 'Eingeschränkt',
    fr: 'Limité'
  },
  freeQuotaHint: {
    zh: '今日免费 Chat 额度；仅对端连入后计时。超额后附件限速 100KB/s、单文件 ≤2MB，文本不受影响。',
    en: 'Daily free chat time. Counts only while a remote peer is online. After quota: attachments 100KB/s and ≤2MB; text stays free.',
    ja: '本日の無料チャット枠。相手接続中のみ計測。超過後は添付100KB/s・2MBまで、テキストは影響なし。',
    ko: '오늘 무료 채팅 시간. 상대 연결 시에만 측정. 초과 후 첨부 100KB/s·2MB, 텍스트는 유지.',
    es: 'Tiempo gratis diario. Solo cuenta con un peer remoto. Tras el cupo: adjuntos 100KB/s y ≤2MB; el texto sigue.',
    de: 'Tägliches Gratis-Chat-Kontingent. Zählt nur mit Remote-Peer. Danach: Anhänge 100KB/s und ≤2MB; Text bleibt frei.',
    fr: 'Quota chat gratuit du jour. Compte seulement avec un pair distant. Après: pièces jointes 100KB/s et ≤2Mo; le texte reste libre.'
  },
  freeQuotaDaily: {
    zh: '每日免费额度',
    en: 'Daily free allowance',
    ja: '1日の無料枠',
    ko: '일일 무료 한도',
    es: 'Cupo diario gratis',
    de: 'Tägliches Gratis-Kontingent',
    fr: 'Quota gratuit quotidien'
  },
  freeQuotaUsed: {
    zh: '今日已用',
    en: 'Used today',
    ja: '本日の使用',
    ko: '오늘 사용',
    es: 'Usado hoy',
    de: 'Heute verbraucht',
    fr: "Utilisé aujourd'hui"
  },
  freeQuotaAttachmentPolicy: {
    zh: '超额附件：100KB/s · ≤2MB',
    en: 'Over quota: 100KB/s · ≤2MB files',
    ja: '超過時: 100KB/s・2MBまで',
    ko: '초과 시: 100KB/s · 2MB 이하',
    es: 'Tras cupo: 100KB/s · ≤2MB',
    de: 'Über Kontingent: 100KB/s · ≤2MB',
    fr: 'Hors quota: 100Ko/s · ≤2Mo'
  },
  freeQuotaUpgrade: {
    zh: '升级解锁无限 Chat',
    en: 'Upgrade for unlimited chat',
    ja: 'アップグレードで無制限チャット',
    ko: '업그레이드로 무제한 채팅',
    es: 'Mejora para chat ilimitado',
    de: 'Upgrade für unbegrenzten Chat',
    fr: 'Passez à un chat illimité'
  },
  viewSubscription: {
    zh: '点击查看订阅详情',
    en: 'Click to view subscription details',
    ja: 'クリックしてサブスクリプションの詳細を表示',
    ko: '클릭하여 구독 상세 정보 보기',
    es: 'Haga clic para ver los detalles de la suscripción',
    de: 'Klicken Sie hier, um die Abonnementdetails anzuzeigen',
    fr: "Cliquez pour voir les détails de l'abonnement"
  },
  onlineDevices: {
    zh: '在线设备',
    en: 'Online Devices',
    ja: 'オンラインデバイス',
    ko: '온라인 기기',
    es: 'Dispositivos en línea',
    de: 'Online-Geräte',
    fr: 'Appareils en ligne'
  },
  self: {
    zh: '本机',
    en: 'Self',
    ja: 'この设备',
    ko: '이 기기',
    es: 'Este dispositivo',
    de: 'Dieses Gerät',
    fr: 'Cet appareil'
  },
  online: {
    zh: '在线',
    en: 'Online',
    ja: 'オンライン',
    ko: '온라인',
    es: 'En línea',
    de: 'Online',
    fr: 'En ligne'
  },
  inputDeviceName: {
    zh: '输入设备名称',
    en: 'Enter device name',
    ja: 'デバイス名を入力してください',
    ko: '기기 이름을 입력하세요',
    es: 'Introduzca el nombre del dispositivo',
    de: 'Gerätenamen eingeben',
    fr: "Entrez le nom de l'appareil"
  },
  save: {
    zh: '保存',
    en: 'Save',
    ja: '保存',
    ko: '저장',
    es: 'Guardar',
    de: 'Speichern',
    fr: 'Enregistrer'
  },
  cancel: {
    zh: '取消',
    en: 'Cancel',
    ja: 'キャンセル',
    ko: '취소',
    es: 'Cancelar',
    de: 'Abbrechen',
    fr: 'Annuler'
  },
  renameDevice: {
    zh: '重命名设备',
    en: 'Rename device',
    ja: 'デバイス名の変更',
    ko: '기기 이름 바꾸기',
    es: 'Cambiar nombre del dispositivo',
    de: 'Gerät umbenennen',
    fr: "Renommer l'appareil"
  },
  kickOffline: {
    zh: '强制踢下线',
    en: 'Force offline',
    ja: '強制オフライン',
    ko: '강제 오프라인',
    es: 'Forzar desconexión',
    de: 'Offline erzwingen',
    fr: 'Forcer la déconnexion'
  },
  noOtherDevices: {
    zh: '无其他在线设备',
    en: 'No other online devices',
    ja: '他にオンラインのデバイスはありません',
    ko: '다른 온라인 기기가 없습니다',
    es: 'No hay otros dispositivos en línea',
    de: 'Keine anderen Online-Geräte',
    fr: 'Aucun autre appareil en ligne'
  },
  subscriptionDetails: {
    zh: '订阅与许可证详情',
    en: 'Subscription & License Details',
    ja: 'サブスクリプションとライセンスの詳細',
    ko: '구독 및 라이선스 상세 정보',
    es: 'Detalles de suscripción y licencia',
    de: 'Abonnement- und Lizenzdetails',
    fr: "Détails de l'abonnement et de la licence"
  },
  vipLifetime: {
    zh: 'VIP 永久授权版',
    en: 'VIP Lifetime License',
    ja: 'VIP 永久ライセンス',
    ko: 'VIP 평생 라이선스',
    es: 'Licencia VIP de por vida',
    de: 'Lebenslange VIP-Lizenz',
    fr: 'Licence VIP à vie'
  },
  authStatus: {
    zh: '授权状态',
    en: 'Auth Status',
    ja: '認証ステータス',
    ko: '인증 상태',
    es: 'Estado de autorización',
    de: 'Autorisierungsstatus',
    fr: "Statut d'autorisation"
  },
  validLifetime: {
    zh: '有效（永久）',
    en: 'Valid (Lifetime)',
    ja: '有効（無期限）',
    ko: '유효（평생）',
    es: 'Válido (De por vida)',
    de: 'Gültig (Lebenslang)',
    fr: 'Valide (À vie)'
  },
  speedLimit: {
    zh: '加速限流',
    en: 'Speed Limit',
    ja: '速度制限',
    ko: '속도 제한',
    es: 'Límite de velocidad',
    de: 'Geschwindigkeitsbegrenzung',
    fr: 'Limite de vitesse'
  },
  unlimitedSpeed: {
    zh: '无限制极速加速',
    en: 'Unlimited High Speed',
    ja: '無制限の高速化',
    ko: '무제한 고속',
    es: 'Alta velocidad ilimitada',
    de: 'Unbegrenzte Hochgeschwindigkeit',
    fr: 'Haute vitesse illimitée'
  },
  fingerprintCheck: {
    zh: '指纹校验',
    en: 'Fingerprint Check',
    ja: 'フィンガープリントチェック',
    ko: '지문 확인',
    es: 'Comprobación de huella digital',
    de: 'Fingerabdruck-Prüfung',
    fr: "Vérification d'empreinte"
  },
  passed: {
    zh: '通过',
    en: 'Passed',
    ja: '合格',
    ko: '통과',
    es: 'Aprobado',
    de: 'Bestanden',
    fr: 'Réussi'
  },
  selectLanguage: {
    zh: '选择语言',
    en: 'Select Language',
    ja: '言語の選択',
    ko: '언어 선택',
    es: 'Seleccionar idioma',
    de: 'Sprache auswählen',
    fr: 'Choisir la langue'
  },
  sessionQR: {
    zh: '会话二维码',
    en: 'Session QR Code',
    ja: 'セッションQRコード',
    ko: '세션 QR 코드',
    es: 'Código QR de sesión',
    de: 'Sitzungs-QR-Code',
    fr: 'Code QR de session'
  },
  scanQR: {
    zh: '扫描下方二维码从其他设备加入会话',
    en: 'Scan the QR code below to join from other devices',
    ja: '他のデバイスから参加するには、下のQRコードをスキャンしてください',
    ko: '다른 기기에서 참여하려면 아래 QR 코드를 스캔하세요',
    es: 'Escanee el código QR a continuación para unirse desde otros dispositivos',
    de: 'Scannen Sie den QR-Code unten, um von anderen Geräten beizutreten',
    fr: "Scannez le code QR ci-dessous pour rejoindre depuis d'autres appareils"
  },
  copied: {
    zh: '已复制',
    en: 'Copied',
    ja: 'コピーしました',
    ko: '복사됨',
    es: 'Copiado',
    de: 'Kopiert',
    fr: 'Copié'
  },
  copy: {
    zh: '复制',
    en: 'Copy',
    ja: 'コピー',
    ko: '복사',
    es: 'Copiar',
    de: 'Kopieren',
    fr: 'Copier'
  },
  hideLink: {
    zh: '隐藏加入链接',
    en: 'Hide Join Link',
    ja: '参加リンクを隠す',
    ko: '참여 링크 숨기기',
    es: 'Ocultar enlace de unión',
    de: 'Beitrittslink ausblenden',
    fr: "Masquer le lien d'invitation"
  },
  showLink: {
    zh: '显示加入链接',
    en: 'Show Join Link',
    ja: '参加链接を表示',
    ko: '참여 링크 표시',
    es: 'Mostrar enlace de unión',
    de: 'Beitrittslink anzeigen',
    fr: "Afficher le lien d'invitation"
  },
  justNow: {
    zh: '刚刚',
    en: 'just now',
    ja: 'たった今',
    ko: '방금',
    es: 'hace un momento',
    de: 'gerade eben',
    fr: 'à l\'instant'
  },
  downloadFailed: {
    zh: '下载附件失败',
    en: 'Download attachment failed',
    ja: '添付ファイルのダウンロードに失敗しました',
    ko: '첨부 파일 다운로드 실패',
    es: 'Error al descargar el archivo adjunto',
    de: 'Herunterladen des Anhangs fehlgeschlagen',
    fr: 'Échec du téléchargement de la pièce jointe'
  },
  downloadFailedGeneral: {
    zh: '下载中断或失败',
    en: 'Download interrupted or failed',
    ja: 'ダウンロードが中断されたか、失敗しました',
    ko: '다운로드가 중단되었거나 실패했습니다',
    es: 'Descarga interrumpida o fallida',
    de: 'Herunterladen unterbrochen oder fehlgeschlagen',
    fr: 'Téléchargement interrompu ou échec'
  },
  uploadingFile: {
    zh: '正在上传文件',
    en: 'Uploading file',
    ja: 'ファイルをアップロード中',
    ko: '파일 업로드 중',
    es: 'Subiendo archivo',
    de: 'Datei wird hochgeladen',
    fr: 'Téléchargement du fichier en cours'
  },
  uploadCancelled: {
    zh: '已取消上传文件',
    en: 'Upload cancelled for file',
    ja: 'ファイルのアップロードがキャンセルされました',
    ko: '파일 업로드가 취소되었습니다',
    es: 'Subida de archivo cancelada',
    de: 'Datei-Upload abgebrochen',
    fr: 'Téléchargement du fichier annulé'
  },
  uploadFailed: {
    zh: '上传文件失败',
    en: 'Failed to upload file',
    ja: 'ファイルのアップロードに失敗しました',
    ko: '파일 업로드 실패',
    es: 'Error al subir el archivo',
    de: 'Datei-Upload fehlgeschlagen',
    fr: 'Échec du téléchargement du fichier'
  },
  fileAddedInit: {
    zh: '已添加文件，正在初始化上传',
    en: 'File added. Initializing upload',
    ja: 'ファイルが追加されました。アップロードを初期化中',
    ko: '파일이 추가되었습니다. 업로드 초기화 중',
    es: 'Archivo añadido. Inicializando subida',
    de: 'Datei hinzugefügt. Upload wird initialisiert',
    fr: 'Fichier ajouté. Initialisation du téléchargement'
  },
  addFileFailed: {
    zh: '添加文件失败',
    en: 'Failed to add file',
    ja: 'ファイルの追加に失敗しました',
    ko: '파일 추가 실패',
    es: 'Error al añadir el archivo',
    de: 'Hinzufügen der Datei fehlgeschlagen',
    fr: "Échec de l'ajout du fichier"
  },
  startDownload: {
    zh: '开始下载文件',
    en: 'Started downloading file',
    ja: 'ファイルのダウンロードを開始しました',
    ko: '파일 다운로드 시작',
    es: 'Descarga de archivo iniciada',
    de: 'Herunterladen der Datei gestartet',
    fr: 'Téléchargement du fichier commencé'
  },
  sandboxLimit: {
    zh: '浏览器安全沙箱限制，无法直接定位本地文件夹',
    en: 'Browser sandbox restriction: Cannot locate local folder directly',
    ja: 'ブラウザのサンドボックス制限：ローカルフォルダーを直接开くことはできません',
    ko: '브라우저 샌드박스 제한: 로컬 폴더를 직접 열 수 없습니다',
    es: 'Restricción de sandbox del navegador: No se puede ubicar la carpeta local directamente',
    de: 'Browser-Sandbox-Einschränkung: Lokaler Ordner kann nicht direkt gefunden werden',
    fr: 'Restriction du sandbox du navigateur : Impossible de localiser le dossier local directement'
  },
  exitSession: {
    zh: '退出当前会话',
    en: 'Exit Current Session',
    ja: '現在のセッションを終了',
    ko: '현재 세션 종료',
    es: 'Salir de la sesión actual',
    de: 'Aktuelle Sitzung beenden',
    fr: 'Quitter la session actuelle'
  },
  exitConfirmMsg: {
    zh: '确定要退出当前聊天会话吗？退出后，您的设备将被注销，且必须重新扫描二维码才能再次加入。',
    en: 'Are you sure you want to exit the current chat session? Once you exit, your device will be logged out and you must scan the QR code again to join.',
    ja: '現在のチャットセッションを終了しますか？終了すると、デバイスはログアウトされ、再度参加するにはQRコードをスキャンする必要があります。',
    ko: '현재 채팅 세션을 종료하시겠습니까? 종료하면 기기가 로그아웃되며 다시 참여하려면 QR 코드를 다시 스캔해야 합니다.',
    es: '¿Está seguro de que desea salir de la sesión de chat actual? Una vez que salga, se cerrará la sesión de su dispositivo y deberá escanear el código QR nuevamente para unirse.',
    de: 'Sind Sie sicher, dass Sie die aktuelle Chatsitzung beenden möchten? Sobald Sie sie beenden, wird Ihr Gerät abgemeldet und Sie müssen den QR-Code erneut scannen, um beizutreten.',
    fr: "Êtes-vous sûr de vouloir quitter la session de chat actuelle ? Une fois que vous l'aurez quittée, votre appareil sera déconnecté et vous devrez scanner à nouveau le code QR pour vous joindre."
  },
  exitConfirm: {
    zh: '确定退出',
    en: 'Exit',
    ja: '終了する',
    ko: '종료',
    es: 'Salir',
    de: 'Beenden',
    fr: 'Quitter'
  },
  queued: {
    zh: '排队等待中...',
    en: 'Queued...',
    ja: '待機中...',
    ko: '대기 중...',
    es: 'En cola...',
    de: 'In Warteschlange...',
    fr: 'En attente...'
  },
  statusOnline: {
    zh: '状态: 在线',
    en: 'Status: Online',
    ja: 'ステータス: オンライン',
    ko: '상태: 온라인',
    es: 'Estado: En línea',
    de: 'Status: Online',
    fr: 'Statut: En ligne'
  },
  connectionsCount: {
    zh: '并发连接数: 1',
    en: 'Concurrent Connections: 1',
    ja: '同時接続数: 1',
    ko: '동시 연결 수: 1',
    es: 'Conexiones concurrentes: 1',
    de: 'Gleichzeitige Verbindungen: 1',
    fr: 'Connexions simultanées: 1'
  },
  lastActive: {
    zh: '上次活跃时间:',
    en: 'Last Active:',
    ja: '最終アクティブ:',
    ko: '마지막 활성:',
    es: 'Última vez activo:',
    de: 'Zuletzt aktiv:',
    fr: 'Dernière activité:'
  },
  me: {
    zh: '我',
    en: 'Me',
    ja: '自分',
    ko: '나',
    es: 'Yo',
    de: 'Ich',
    fr: 'Moi'
  },

  // MessageList.svelte translations
  textCopied: {
    zh: '文本已复制',
    en: 'Text copied',
    ja: 'テキストをコピーしました',
    ko: '텍스트 복사됨',
    es: 'Texto copiado',
    de: 'Text kopiert',
    fr: 'Texte copié'
  },
  copyFailed: {
    zh: '复制失败',
    en: 'Copy failed',
    ja: 'コピーに失敗しました',
    ko: '복사 실패',
    es: 'Error al copiar',
    de: 'Kopieren fehlgeschlagen',
    fr: 'Échec de la copie'
  },
  copyText: {
    zh: '复制文本',
    en: 'Copy Text',
    ja: 'テキストをコピー',
    ko: '텍스트 복사',
    es: 'Copiar texto',
    de: 'Text kopieren',
    fr: 'Copier le texte'
  },
  textCopied: {
    zh: '文本已复制',
    en: 'Text copied',
    ja: 'テキストをコピーしました',
    ko: '텍스트가 복사되었습니다',
    es: 'Texto copiado',
    de: 'Text kopiert',
    fr: 'Texte copié'
  },
  copyFailed: {
    zh: '复制失败',
    en: 'Copy failed',
    ja: 'コピーに失敗しました',
    ko: '복사 실패',
    es: 'Error al copiar',
    de: 'Kopieren fehlgeschlagen',
    fr: 'Échec de la copie'
  },
  cancelUpload: {
    zh: '取消上传',
    en: 'Cancel Upload',
    ja: 'アップロードをキャンセル',
    ko: '업로드 취소',
    es: 'Cancelar carga',
    de: 'Upload abbrechen',
    fr: "Annuler l'envoi"
  },
  openInFolder: {
    zh: '定位文件',
    en: 'Open in Folder',
    ja: 'フォルダで開く',
    ko: '폴더에서 열기',
    es: 'Abrir en carpeta',
    de: 'Im Ordner anzeigen',
    fr: 'Ouvrir dans le dossier'
  },
  peerUploading: {
    zh: '对方上传中...',
    en: 'Uploading...',
    ja: '相手がアップロード中...',
    ko: '상대방이 업로드 중...',
    es: 'Subiendo por la otra parte...',
    de: 'Wird von der Gegenstelle hochgeladen...',
    fr: "Téléversement par l'autre partie..."
  },
  download: {
    zh: '下载',
    en: 'Download',
    ja: 'ダウンロード',
    ko: '다운로드',
    es: 'Descargar',
    de: 'Herunterladen',
    fr: 'Télécharger'
  },
  redownload: {
    zh: '已下载 (重新下载)',
    en: 'Downloaded (Redownload)',
    ja: 'ダウンロード済み (再ダウンロード)',
    ko: '다운로드됨 (다시 다운로드)',
    es: 'Descargado (Volver a descargar)',
    de: 'Heruntergeladen (Erneut herunterladen)',
    fr: 'Téléchargé (Re-télécharger)'
  },
  confirmRedownload: {
    zh: '确认重新下载',
    en: 'Confirm Redownload',
    ja: '再ダウンロードの確認',
    ko: '다시 다운로드 확인',
    es: 'Confirmar volver a descargar',
    de: 'Erneutes Herunterladen bestätigen',
    fr: 'Confirmer le re-téléchargement'
  },
  cancelDownload: {
    zh: '取消下载',
    en: 'Cancel Download',
    ja: 'ダウンロードをキャンセル',
    ko: '다운로드 취소',
    es: 'Cancelar descarga',
    de: 'Download abbrechen',
    fr: 'Annuler le téléchargement'
  },
  retryDownload: {
    zh: '重试下载',
    en: 'Retry Download',
    ja: 'ダウンロードを再試行',
    ko: '다운로드 재시도',
    es: 'Reintentar descarga',
    de: 'Download wiederholen',
    fr: 'Réessayer le téléchargement'
  },
  downloadFile: {
    zh: '下载文件',
    en: 'Download',
    ja: 'ダウンロード',
    ko: '다운로드',
    es: 'Descargar',
    de: 'Herunterladen',
    fr: 'Télécharger'
  },
  recallMessage: {
    zh: '撤回消息',
    en: 'Recall',
    ja: '送信取り消し',
    ko: '메시지 회수',
    es: 'Anular envío',
    de: 'Zurückrufen',
    fr: 'Rappeler'
  },
  confirmRecall: {
    zh: '确认撤回',
    en: 'Confirm Recall',
    ja: '取り消しの確認',
    ko: '회수 확인',
    es: 'Confirmar anulación',
    de: 'Zurückrufen bestätigen',
    fr: 'Confirmer le rappel'
  },
  recalledMsgYou: {
    zh: '你撤回了一条消息',
    en: 'You recalled a message',
    ja: 'メッセージの送信を取り消しました',
    ko: '메시지를 회수했습니다',
    es: 'Anulaste el envío de un mensaje',
    de: 'Sie haben eine Nachricht zurückgerufen',
    fr: 'Vous avez rappelé un message'
  },
  recalledMsgOther: {
    zh: '撤回了一条消息',
    en: 'recalled a message',
    ja: 'がメッセージの送信を取り消しました',
    ko: '님이 메시지를 회수했습니다',
    es: 'anuló el envío de un mensaje',
    de: 'hat eine Nachricht zurückgerufen',
    fr: 'a rappelé un message'
  },
  editAgain: {
    zh: '重新编辑',
    en: 'Edit again',
    ja: '再編集',
    ko: '다시 편집',
    es: 'Editar de nuevo',
    de: 'Erneut bearbeiten',
    fr: 'Modifier à nouveau'
  },
  resend: {
    zh: '重新发送',
    en: 'Resend',
    ja: '再送信',
    ko: '재전송',
    es: 'Reenviar',
    de: 'Erneut senden',
    fr: 'Renvoyer'
  },
  cancelSendYou: {
    zh: '你取消了文件发送',
    en: 'You cancelled sending the file',
    ja: 'ファイルの送信をキャンセルしました',
    ko: '파일 전송을 취소했습니다',
    es: 'Cancelaste el envío del archivo',
    de: 'Sie haben das Senden der Datei abgebrochen',
    fr: "Vous avez annulé l'envoi du fichier"
  },
  cancelSendOther: {
    zh: '对方取消了文件发送',
    en: 'cancelled the file transfer',
    ja: 'がファイルの転送をキャンセルしました',
    ko: '님이 파일 전송을 취소했습니다',
    es: 'canceló la transferencia del archivo',
    de: 'hat die Dateiübertragung abgebrochen',
    fr: 'a annulé le transfert de fichier'
  },
  transferring: {
    zh: '传输中',
    en: 'Transferring',
    ja: '転送中',
    ko: '전송 중',
    es: 'Transfiriendo',
    de: 'Übertragung läuft',
    fr: 'Transfert en cours'
  },
  shared: {
    zh: '已分享',
    en: 'Shared',
    ja: '共有済み',
    ko: '공유됨',
    es: 'Compartido',
    de: 'Freigegeben',
    fr: 'Partagé'
  },
  downloaded: {
    zh: '已下载',
    en: 'Downloaded',
    ja: 'ダウンロード済み',
    ko: '다운로드됨',
    es: 'Descargado',
    de: 'Heruntergeladen',
    fr: 'Téléchargé'
  },
  transferFailed: {
    zh: '传输失败',
    en: 'Failed',
    ja: '失敗',
    ko: '실패',
    es: 'Fallido',
    de: 'Fehlgeschlagen',
    fr: 'Échec'
  },
  unknownError: {
    zh: '未知传输错误',
    en: 'Unknown error',
    ja: '未知の転送エラー',
    ko: '알 수 없는 전송 오류',
    es: 'Error de transferencia desconocido',
    de: 'Unbekannter Übertragungsfehler',
    fr: 'Erreur de transfert inconnue'
  },
  cancelled: {
    zh: '已取消',
    en: 'Cancelled',
    ja: 'キャンセル済み',
    ko: '취소됨',
    es: 'Cancelado',
    de: 'Abgebrochen',
    fr: 'Annulé'
  },
  startChatting: {
    zh: '开始聊天吧！',
    en: 'Start chatting!',
    ja: 'チャットを始めましょう！',
    ko: '채팅을 시작하세요!',
    es: '¡Empiece a chatear!',
    de: 'Fangen Sie an zu chatten!',
    fr: 'Commencez à discuter !'
  },
  emptyTips: {
    zh: '向其他已连接设备发送文本或局限大文件。',
    en: 'Send text or local large files to other connected devices.',
    ja: '他の接続済みデバイスにテキストやローカルの大容量ファイルを送信します。',
    ko: '다른 연결된 기기로 텍스트나 로컬 대용량 파일을 전송합니다.',
    es: 'Envíe texto o archivos grandes locales a otros dispositivos conectados.',
    de: 'Senden Sie Text oder lokale große Dateien an andere verbundene Geräte.',
    fr: 'Envoyez du texte ou de gros fichiers locaux à d\'autres appareils connectés.'
  },
  loadEarlierMessages: {
    zh: '上滑加载更早消息',
    en: 'Scroll up for earlier messages',
    ja: '上にスクロールして以前のメッセージを読み込む',
    ko: '위로 스크롤하여 이전 메시지 불러오기',
    es: 'Desplácese hacia arriba para ver mensajes anteriores',
    de: 'Nach oben scrollen für ältere Nachrichten',
    fr: 'Faites défiler vers le haut pour les messages plus anciens'
  },
  loadingHistory: {
    zh: '正在加载历史消息…',
    en: 'Loading earlier messages…',
    ja: '以前のメッセージを読み込み中…',
    ko: '이전 메시지를 불러오는 중…',
    es: 'Cargando mensajes anteriores…',
    de: 'Ältere Nachrichten werden geladen…',
    fr: 'Chargement des messages plus anciens…'
  },
  tabReplacedHint: {
    zh: '本标签页已断开：同一设备在其他标签页连接了本会话。',
    en: 'This tab is offline: the same device connected in another tab.',
    ja: 'このタブは切断されました。同じデバイスが別のタブで接続しています。',
    ko: '이 탭이 연결 해제되었습니다. 같은 기기가 다른 탭에서 연결되었습니다.',
    es: 'Esta pestaña está desconectada: el mismo dispositivo se conectó en otra pestaña.',
    de: 'Dieser Tab ist offline: dasselbe Gerät ist in einem anderen Tab verbunden.',
    fr: 'Cet onglet est hors ligne : le même appareil s’est connecté dans un autre onglet.'
  },
  reconnectSession: {
    zh: '重新连接',
    en: 'Reconnect',
    ja: '再接続',
    ko: '다시 연결',
    es: 'Reconectar',
    de: 'Erneut verbinden',
    fr: 'Reconnecter'
  },
  reconnectExhaustedHint: {
    zh: '连接已断开且自动重连失败。可点击重新连接，无需刷新整页。',
    en: 'Disconnected and auto-reconnect failed. Tap Reconnect without refreshing the page.',
    ja: '切断され、自動再接続に失敗しました。ページを再読み込みせず「再接続」を押してください。',
    ko: '연결이 끊겼고 자동 재연결에 실패했습니다. 새로고침 없이 다시 연결을 누르세요.',
    es: 'Desconectado y falló la reconexión automática. Pulse Reconectar sin recargar la página.',
    de: 'Getrennt und automatische Wiederverbindung fehlgeschlagen. Tippen Sie auf Erneut verbinden, ohne die Seite neu zu laden.',
    fr: 'Déconnecté et échec de la reconnexion auto. Appuyez sur Reconnecter sans recharger la page.'
  },
  desktopTip: {
    zh: '提示：移动端向左/右滑动气泡，或在桌面端右键点击气泡，可唤起操作菜单。',
    en: 'Tip: Swipe left/right on bubble (mobile) or right-click (desktop) to open context menu.',
    ja: 'ヒント：モバイル端末では吹き出しを左右にスワイプ、デスクトップでは右クリックで操作メニューを開きます。',
    ko: '팁: 모바일에서는 말풍선을 왼쪽/오른쪽으로 밀고, 데스크톱에서는 말풍선을 우클릭하여 작업 메뉴를 엽니다.',
    es: 'Consejo: Deslice hacia la izquierda/derecha sobre el globo (móvil) o haga clic derecho (escritorio) para abrir el menú contextual.',
    de: 'Tipp: Wischen Sie auf dem Mobiltelefon auf der Blase nach links/rechts oder klicken Sie auf dem Desktop mit der rechten Maustaste, um das Kontextmenü zu öffnen.',
    fr: 'Astuce : Glissez vers la gauche/droite sur la bulle (mobile) ou faites un clic droit (ordinateur) pour ouvrir le menu contextuel.'
  },

  // MessageComposer.svelte translations
  addAttachment: {
    zh: '添加附件',
    en: 'Add attachment',
    ja: '添付ファイルの追加',
    ko: '첨부 파일 추가',
    es: 'Añadir archivo adjunto',
    de: 'Anhang hinzufügen',
    fr: 'Ajouter une pièce jointe'
  },
  sessionEnded: {
    zh: '会话已结束',
    en: 'Session ended',
    ja: 'セッションは終了しました',
    ko: '세션이 종료되었습니다',
    es: 'Sesión finalizada',
    de: 'Sitzung beendet',
    fr: 'Session terminée'
  },
  inputMessage: {
    zh: '输入消息...',
    en: 'Message...',
    ja: 'メッセージを入力...',
    ko: '메시지 입력...',
    es: 'Escriba un mensaje...',
    de: 'Nachricht eingeben...',
    fr: 'Saisir un message...'
  },
  send: {
    zh: '发送',
    en: 'Send',
    ja: '送信',
    ko: '전송',
    es: 'Enviar',
    de: 'Senden',
    fr: 'Envoyer'
  },

  // TransferStatus.svelte translations
  activeTransfers: {
    zh: '活跃传输任务',
    en: 'Active Transfers',
    ja: 'アクティブな転送タスク',
    ko: '활성 전송 작업',
    es: 'Tareas de transferencia activas',
    de: 'Aktive Übertragungsaufgaben',
    fr: 'Tâches de transfert actives'
  },
  noActiveTransfers: {
    zh: '无进行中传输',
    en: 'No active transfers',
    ja: '進行中の転送はありません',
    ko: '진행 중인 전송 없음',
    es: 'No hay transferencias en curso',
    de: 'Keine laufenden Übertragungen',
    fr: 'Aucun transfert en cours'
  },
  systemNotifications: {
    zh: '系统通知日志',
    en: 'System Notifications',
    ja: 'システム通知ログ',
    ko: '시스템 알림 로그',
    es: 'Registros de notificación del sistema',
    de: 'Systembenachrichtigungsprotokolle',
    fr: 'Journaux des notifications système'
  },
  clear: {
    zh: '清空',
    en: 'Clear',
    ja: 'クリア',
    ko: '지우기',
    es: 'Borrar',
    de: 'Löschen',
    fr: 'Effacer'
  },
  noSystemMessages: {
    zh: '暂无系统消息',
    en: 'No system messages',
    ja: 'システムメッセージはありません',
    ko: '시스템 메시지 없음',
    es: 'No hay mensajes del sistema',
    de: 'Keine Systemmeldungen',
    fr: 'Aucun message système'
  },

  // Server-generated system messages translations
  sysJoined: {
    zh: '{sender} 已加入会话',
    en: '{sender} joined the session',
    ja: '{sender} がセッションに参加しました',
    ko: '{sender} 님이 세션에 참여했습니다',
    es: '{sender} se ha unido a la sesión',
    de: '{sender} ist der Sitzung beigetreten',
    fr: '{sender} a rejoint the session'
  },
  sysReconnected: {
    zh: '{sender} 已重新连接',
    en: '{sender} reconnected',
    ja: '{sender} が再接続しました',
    ko: '{sender} 님이 재연결되었습니다',
    es: '{sender} se ha volver a conectar',
    de: '{sender} hat sich wieder verbunden',
    fr: "{sender} s'est reconnecté"
  },
  sysRenamed: {
    zh: '{oldSender} 修改用户名为 {sender}',
    en: '{oldSender} renamed to {sender}',
    ja: '{oldSender} がユーザー名を {sender} に変更しました',
    ko: '{oldSender} 님이 사용자 이름을 {sender}(으)로 변경했습니다',
    es: '{oldSender} cambió su nombre de usuario a {sender}',
    de: '{oldSender} hat den Benutzernamen in {sender} geändert',
    fr: "{oldSender} a changé son nom en {sender}"
  },
  sysChangedAvatar: {
    zh: '{sender} 修改了头像',
    en: '{sender} changed avatar',
    ja: '{sender} がアバターを変更しました',
    ko: '{sender} 님이 프로필 이미지를 변경했습니다',
    es: '{sender} cambió su avatar',
    de: '{sender} hat das Avatar geändert',
    fr: "{sender} a changé d'avatar"
  },
  sysForcedExit: {
    zh: '已强制设备 {sender} 退出会话',
    en: 'Device {sender} has been forced to exit the session',
    ja: 'デバイス {sender} をセッションから強制退出させました',
    ko: '기기 {sender}을(를) 세션에서 강제 퇴장시켰습니다',
    es: 'Se ha forzado la salida del dispositivo {sender} de la sesión',
    de: 'Gerät {sender} wurde gezwungen, die Sitzung zu beenden',
    fr: "L'appareil {sender} a été forcé de quitter la session"
  },
  sysDisconnected: {
    zh: '{sender} 已断开连接',
    en: '{sender} disconnected',
    ja: '{sender} の接続が切断されました',
    ko: '{sender} 님의 연결이 끊어졌습니다',
    es: '{sender} se ha desconectado',
    de: 'Gerät {sender} hat die Verbindung getrennt',
    fr: "{sender} s'est déconnecté"
  },
  sysJoinedVia: {
    zh: '{sender} 通过 {platform} 加入了会话',
    en: '{sender} joined the session via {platform}',
    ja: '{sender} が {platform} 経由でセッションに参加しました',
    ko: '{sender} 님이 {platform}(을)를 통해 세션에 참여했습니다',
    es: '{sender} se ha unido a la sesión a través de {platform}',
    de: '{sender} ist über {platform} der Sitzung beigetreten',
    fr: '{sender} a rejoint la session via {platform}'
  }
};

export function getTranslation(key: string, currentLang: string): string {
  const langKey = (currentLang || 'zh').toLowerCase().split('-')[0] as Lang;
  const supportedLangs: Lang[] = ['zh', 'en', 'ja', 'ko', 'es', 'de', 'fr'];
  
  // Safely fallback to 'zh' if langKey is unsupported
  const activeLang = supportedLangs.includes(langKey) ? langKey : 'zh';
  
  const dict = translations[key];
  if (!dict) return '';
  
  // Fallback chain: requested language -> 'en' -> 'zh' -> empty string
  return dict[activeLang] || dict['en'] || dict['zh'] || '';
}
