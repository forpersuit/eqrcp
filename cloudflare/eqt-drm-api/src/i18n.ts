// Dynamic API i18n Dictionary (Supporting 7 Languages with graceful Fallback)
export const API_I18N: Record<string, Record<string, string>> = {
  unbind_limit_reached: {
    zh: "该授权码过去365天内已达到4次解绑设备上限，无法继续解绑。",
    en: "Unbind limit reached (maximum 4 device unbinds allowed per 365 days).",
    ja: "過去365日以内のデバイス解除上限（最大4回）に達しました。",
    ko: "지난 365일 동안 최대 4회의 기기 해제 한도에 도달했습니다.",
    es: "Se alcanzó el límite de desvinculación (máximo 4 desvinculaciones por año).",
    de: "Entkopplungslimit erreicht (maximal 4 Geräteentkopplungen pro 365 Tage).",
    fr: "Limite de dissociation atteinte (maximum 4 dissociations par 365 jours)."
  },
  unbind_success: {
    zh: "设备已成功解绑",
    en: "Device unbound successfully",
    ja: "デバイスの解除が完了しました",
    ko: "기기 해제가 완료되었습니다",
    es: "Dispositivo desvinculado con éxito",
    de: "Gerät erfolgreich entkoppelt",
    fr: "Appareil dissocié avec succès"
  },
  unauthorized: {
    zh: "身份验证失败，请重新登录",
    en: "Unauthorized, please sign in again.",
    ja: "認証に失敗しました。再ログインしてください。",
    ko: "인증에 실패했습니다. 다시 로그인해 주세요.",
    es: "No autorizado, por favor inicie sesión de nuevo.",
    de: "Nicht autorisiert, bitte melden Sie sich erneut an.",
    fr: "Non autorisé, veuillez vous reconnecter."
  },
  session_expired: {
    zh: "会话已过期，请重新获取验证码登录",
    en: "Session expired or invalid. Please sign in again.",
    ja: "セッションの期限が切れました。再度ログインしてください。",
    ko: "세션이 만료되었습니다. 다시 로그인해 주세요.",
    es: "Sesión expirada o inválida. Inicie sesión de nuevo.",
    de: "Sitzung abgelaufen oder ungültig. Bitte erneut anmelden.",
    fr: "Session expirée ou invalide. Veuillez vous reconnecter."
  },
  missing_params: {
    zh: "请求参数缺失",
    en: "Missing required parameters",
    ja: "必修パラメータが不足しています",
    ko: "필수 매개변수가 누락되었습니다",
    es: "Faltan parámetros requeridos",
    de: "Erforderliche Parameter fehlen",
    fr: "Paramètres requis manquants"
  },
  license_not_found: {
    zh: "未找到对应的授权码",
    en: "License code not found",
    ja: "ライセンスコードが見つかりません",
    ko: "라이선스 코드를 찾을 수 없습니다",
    es: "Código de licencia no encontrado",
    de: "Lizenzcode nicht gefunden",
    fr: "Code de licence introuvable"
  },
  no_purchase_history: {
    zh: "未找到该邮箱的购买记录，请确认邮箱或先购买授权套餐",
    en: "No purchase history found for this email. Please check your email or purchase a license plan first.",
    ja: "このメールアドレスの購入履歴が見つかりません。メールアドレスを確認するか、ライセンスをご購入ください。",
    ko: "이 이메일의 구매 내역을 찾을 수 없습니다. 이메일을 확인하거나 라이선스 플랜을 먼저 구매해 주세요.",
    es: "No se encontraron compras para este correo electrónico. Por favor, compruébelo o adquiera un plan primero.",
    de: "Keine Kaufhistorie für diese E-Mail-Adresse gefunden. Bitte überprüfen Sie Ihre E-Mail oder kaufen Sie zuerst ein Paket.",
    fr: "Aucun historique d'achat trouvé pour cet e-mail. Veuillez vérifier votre e-mail ou acheter un forfait."
  },
  rate_limited: {
    zh: "请求过于频繁，请 60 秒后再试",
    en: "Please wait 60 seconds before requesting another code",
    ja: "リクエストが多すぎます。60秒後に再度お試しください。",
    ko: "요청이 너무 많습니다. 60초 후에 다시 시도해 주세요.",
    es: "Demasiadas solicitudes. Espere 60 segundos e inténtelo de nuevo.",
    de: "Zu viele Anfragen. Bitte warten Sie 60 Sekunden.",
    fr: "Trop de demandes. Veuillez attendre 60 secondes."
  },
  not_license_owner: {
    zh: "您无权操作此授权码",
    en: "You do not own this license",
    ja: "このライセンスを操作する権限がありません",
    ko: "이 라이선스에 대한 권한이 없습니다",
    es: "No es propietario de esta licencia",
    de: "Sie besitzen diese Lizenz nicht",
    fr: "Vous n'êtes pas propriétaire de cette licence"
  },
  activation_not_found: {
    zh: "未找到对应的设备激活记录",
    en: "Activation record not found",
    ja: "デバイスのアクティベーションが見つかりません",
    ko: "기기 활성화 기록을 찾을 수 없습니다",
    es: "No se encontró el registro de activación",
    de: "Aktivierungsdatensatz nicht gefunden",
    fr: "Enregistrement d'activation introuvable"
  },
  license_already_revoked: {
    zh: "该授权已退款或吊销",
    en: "License is already refunded or revoked",
    ja: "このライセンスは既に返金または失効しています",
    ko: "이미 환불되었거나 취소된 라이선스입니다",
    es: "La licencia ya fue reembolsada o revocada",
    de: "Lizenz wurde bereits erstattet oder widerrufen",
    fr: "La licence est déjà remboursée ou révoquée"
  },
  no_paddle_transaction: {
    zh: "该授权无关联的 Paddle 交易，无法自助退款",
    en: "No associated Paddle transaction found for this license",
    ja: "このライセンスに関連する Paddle 取引がありません",
    ko: "이 라이선스에 연결된 Paddle 거래가 없습니다",
    es: "No hay transacción de Paddle asociada a esta licencia",
    de: "Keine zugehörige Paddle-Transaktion für diese Lizenz gefunden",
    fr: "Aucune transaction Paddle associée à cette licence"
  },
  paddle_not_configured: {
    zh: "退款服务暂时不可用，请稍后重试或联系支持",
    en: "Refund service is temporarily unavailable",
    ja: "返金サービスは一時的に利用できません",
    ko: "환불 서비스를 일시적으로 사용할 수 없습니다",
    es: "El servicio de reembolso no está disponible temporalmente",
    de: "Erstattungsservice vorübergehend nicht verfügbar",
    fr: "Service de remboursement temporairement indisponible"
  },
  refund_success: {
    zh: "退款已提交，授权已被吊销",
    en: "Refund request initiated successfully. Your license has been revoked.",
    ja: "返金申請が完了し、ライセンスは失効しました",
    ko: "환불이 접수되었으며 라이선스가 취소되었습니다",
    es: "Reembolso iniciado. La licencia ha sido revocada.",
    de: "Rückerstattung eingeleitet. Ihre Lizenz wurde widerrufen.",
    fr: "Remboursement initié. Votre licence a été révoquée."
  },
  refund_failed: {
    zh: "退款处理失败，请稍后重试",
    en: "Failed to process refund",
    ja: "返金処理に失敗しました",
    ko: "환불 처리에 실패했습니다",
    es: "Error al procesar el reembolso",
    de: "Rückerstattung fehlgeschlagen",
    fr: "Échec du traitement du remboursement"
  },
  license_not_active: {
    zh: "该授权当前不可用（已吊销或暂停），无法解绑设备",
    en: "License is not active (revoked or suspended); unbind is not allowed",
    ja: "このライセンスは無効または停止中のため、デバイス解除できません",
    ko: "라이선스가 활성 상태가 아니어서 기기 해제를 할 수 없습니다",
    es: "La licencia no está activa; no se puede desvincular el dispositivo",
    de: "Lizenz ist nicht aktiv; Entkopplung nicht erlaubt",
    fr: "Licence inactive ; dissociation non autorisée"
  },
  too_many_verify_attempts: {
    zh: "验证码错误次数过多，请 15 分钟后再试",
    en: "Too many failed verification attempts. Please try again in 15 minutes.",
    ja: "認証の失敗が多すぎます。15分後に再度お試しください。",
    ko: "인증 실패 횟수가 너무 많습니다. 15분 후에 다시 시도해 주세요.",
    es: "Demasiados intentos fallidos. Espere 15 minutos e inténtelo de nuevo.",
    de: "Zu viele fehlgeschlagene Versuche. Bitte in 15 Minuten erneut versuchen.",
    fr: "Trop de tentatives échouées. Réessayez dans 15 minutes."
  }
};

export function extractRequestLang(request: Request, body?: any): string {
  if (body && typeof body.lang === 'string' && body.lang.trim()) {
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

export function getApiTranslation(key: string, lang: string): string {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  const dict = API_I18N[key];
  if (!dict) return key;
  return dict[norm] || dict['zh'] || dict['en'] || key;
}

// Multi-language dictionary for Portal Auth Login Verification Code Email (7 Languages)
export const AUTH_CODE_EMAIL_I18N: Record<string, { subject: string; title: string; bodyText: string; validityText: string }> = {
  zh: {
    subject: "【EQT 登录验证码】您的验证码",
    title: "登录验证码",
    bodyText: "尊敬的用户，您正在登录 EQT 客户管理门户。您的验证码为：",
    validityText: "验证码有效期为 5 分钟。请勿将验证码泄露给他人。若非您本人操作，请忽略此邮件。"
  },
  en: {
    subject: "[EQT Login] Verification Code",
    title: "Login Verification Code",
    bodyText: "Hello, you are signing in to the EQT Customer Portal. Your verification code is:",
    validityText: "This code is valid for 5 minutes. Do not share it with anyone. If you did not request this, please ignore this email."
  },
  ja: {
    subject: "【EQT ログイン】認証コード通知",
    title: "ログイン認証コード",
    bodyText: "EQT カスタマーポータルにログインするための認証コードは以下の通りです：",
    validityText: "このコードは5分間有効です。他人に共有しないでください。心当たりのない場合は無視してください。"
  },
  ko: {
    subject: "【EQT 로그인】인증 코드 안내",
    title: "로그인 인증 코드",
    bodyText: "EQT 고객 포털에 로그인하기 위한 인증 코드입니다:",
    validityText: "이 코드는 5분 동안 유효합니다. 타인에게 공유하지 마세요. 요청하지 않으셨다면 이 메일을 무시해 주세요."
  },
  es: {
    subject: "[EQT Inicio de Sesión] Código de verificación",
    title: "Código de verificación",
    bodyText: "Hola, estás iniciando sesión en el Portal del Cliente EQT. Tu código de verificación es:",
    validityText: "Este código es válido durante 5 minutos. No lo comparta con nadie. Si no lo solicitó, ignore este correo."
  },
  de: {
    subject: "[EQT Anmeldung] Bestätigungscode",
    title: "Anmelde-Bestätigungscode",
    bodyText: "Hallo, Sie melden sich im EQT Kundenportal an. Ihr Bestätigungscode lautet:",
    validityText: "Dieser Code ist 5 Minuten lang gültig. Bitte geben Sie ihn nicht weiter. Wenn Sie diesen Code nicht angefordert haben, ignorieren Sie diese E-Mail."
  },
  fr: {
    subject: "[EQT Connexion] Code de vérification",
    title: "Code de vérification",
    bodyText: "Bonjour, vous vous connectez au Portail Client EQT. Votre code de vérification est :",
    validityText: "Ce code est valable pendant 5 minutes. Ne le partagez avec personne. Si vous ne l'avez pas demandé, veuillez ignorer cet e-mail."
  }
};

// Multi-language dictionary for purchase checkout email verification (7 Languages)
export const CHECKOUT_EMAIL_I18N: Record<string, { subject: string; title: string; bodyHtml: string; validityText: string }> = {
  zh: {
    subject: "【EQT】您的购买邮箱验证码",
    title: "购买邮箱验证",
    bodyHtml: "感谢您选择 EQT 尊享服务。您当前正在验证购买邮箱，验证码为：",
    validityText: "验证码有效期为 10 分钟。请勿透露给他人。"
  },
  en: {
    subject: "[EQT] Your Purchase Email Verification Code",
    title: "Verify Your Purchase Email",
    bodyHtml: "Thank you for choosing EQT Premium. Your verification code for purchase is:",
    validityText: "Valid for 10 minutes. Do not share with anyone."
  },
  ja: {
    subject: "【EQT】ご購入用メールアドレス認証コード",
    title: "ご購入メールアドレスの確認",
    bodyHtml: "EQT プレミアムサービスをご選択いただきありがとうございます。認証コード：",
    validityText: "有効期限は10分間です。他人に共有しないでください。"
  },
  ko: {
    subject: "【EQT】구매 이메일 인증 코드",
    title: "구매 이메일 인증",
    bodyHtml: "EQT 프리미엄 서비스를 선택해 주셔서 감사합니다. 귀하의 인증 코드는 다음과 같습니다:",
    validityText: "이 코드는 10분 동안 유효합니다. 타인에게 공유하지 마세요."
  },
  es: {
    subject: "[EQT] Código de verificación para su compra",
    title: "Verificación de correo para la compra",
    bodyHtml: "Gracias por elegir EQT Premium. Su código de verificación para la compra es:",
    validityText: "Válido durante 10 minutos. No lo comparta con nadie."
  },
  de: {
    subject: "[EQT] Ihr Bestätigungscode für den Kauf",
    title: "Bestätigung der E-Mail-Adresse",
    bodyHtml: "Vielen Dank, dass Sie sich für EQT Premium entschieden haben. Ihr Bestätigungscode lautet:",
    validityText: "Gültig für 10 Minuten. Bitte nicht weitergeben."
  },
  fr: {
    subject: "[EQT] Votre code de vérification d'achat",
    title: "Vérification de l'e-mail d'achat",
    bodyHtml: "Merci d'avoir choisi EQT Premium. Votre code de vérification est :",
    validityText: "Valable pendant 10 minutes. Ne le partagez pas."
  }
};

export const DEVICE_NOTIFICATION_I18N: Record<string, {
  boundSubject: string;
  boundTitle: string;
  boundBody: (lic: string, time: string, devHash: string, current: number, max: number) => string;
  unboundSubject: string;
  unboundTitle: string;
  unboundBody: (lic: string, time: string, remainingUnbinds: number) => string;
}> = {
  zh: {
    boundSubject: "【EQT 授权安全提醒】您的授权码已绑定新设备",
    boundTitle: "新设备激活通知",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">尊敬的用户，您的 EQT 授权码已在新的硬件设备上完成绑定：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>授权码：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>绑定时间：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>设备特征摘要：</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>已用设备数：</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">若非您本人操作，请及时前往用户自服务门户解绑非法设备。</p>`,
    unboundSubject: "【EQT 授权安全提醒】您的授权码已成功解绑一台设备",
    unboundTitle: "设备解绑成功通知",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">尊敬的用户，您的 EQT 授权码已成功解绑一台硬件设备：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>授权码：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>解绑时间：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>过去 365 天剩余解绑额度：</strong> ${remainingUnbinds} / 4 次</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>设备恢复与重新绑定说明：</strong><br/>
      1. 解绑后空出的设备额度现可用于绑定新的设备。<br/>
      2. 如需在原设备或新设备上恢复付费授权，只需在目标设备上打开 EQT 客户端并重新输入该授权码激活即可。<br/>
      3. 扣减的解绑额度将在该解绑操作发生 365 天后自动恢复。</p>`
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
    boundSubject: "【EQT セキュリティ警告】新しいデバイスがライセンスに連携されました",
    boundTitle: "新規デバイスアクティベーション通知",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">EQT ライセンスに新しいハードウェアデバイスが連携されました：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>ライセンスコード：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>アクティベート日時：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>デバイスハッシュ：</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>使用中デバイス数：</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">心当たりのない場合は、カスタマーポータルから解除を行ってください。</p>`,
    unboundSubject: "【EQT セキュリティ警告】デバイスの連携解除が完了しました",
    unboundTitle: "デバイス連携解除通知",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">EQT ライセンスからデバイスの連携が正常に解除されました：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>ライセンスコード：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>解除日時：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>過去365日以内の残り解除枠：</strong> ${remainingUnbinds} / 4 回</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>デバイス復元と再連携について：</strong><br/>
      1. 空いたデバイス枠は新しいデバイスのアクティベーションに使用できます。<br/>
      2. デバイスで有料機能を再有効化するには、EQT アプリを起動してこのライセンスコードを再入力してください。<br/>
      3. 消費された解除枠は、操作日から365日経過後に自動的に回復します。</p>`
  },
  ko: {
    boundSubject: "【EQT 보안 알림】새 기기가 라이선스에 연동되었습니다",
    boundTitle: "새 기기 인증 알림",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">EQT 라이선스에 새로운 하드웨어 기기가 연동되었습니다:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>라이선스 코드：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>인증 시간：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>기기 해시：</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>사용 중 기기 수：</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">본인의 요청이 아닌 경우 포털에서 임의 기기를 해제해 주세요.</p>`,
    unboundSubject: "【EQT 보안 알림】기기 연동이 해제되었습니다",
    unboundTitle: "기기 연동 해제 완료",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">EQT 라이선스에서 기기 연동 해제가 성공적으로 완료되었습니다:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>라이선스 코드：</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>해제 시간：</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>최근 365일 남은 해제 횟수：</strong> ${remainingUnbinds} / 4 회</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>기기 복구 및 재연동 안내：</strong><br/>
      1. 확보된 슬롯은 새로운 기기 인증에 사용할 수 있습니다.<br/>
      2. 해제된 기기에서 인증을 다시 복구하려면 EQT 앱에서 라이선스 코드를 다시 입력해 주세요.<br/>
      3. 사용된 해제 횟수는 해당 작업일 기준 365일 후 자동으로 복구됩니다.</p>`
  },
  es: {
    boundSubject: "[EQT Alerta de Seguridad] Nuevo dispositivo vinculado a su licencia",
    boundTitle: "Nuevo dispositivo activado",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Hola, se ha vinculado un nuevo dispositivo a su licencia EQT:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Código de licencia:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Fecha de activación:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Hash de dispositivo:</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Dispositivos en uso:</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Si no autorizó esta acción, desvincule los dispositivos en el portal de autoservicio.</p>`,
    unboundSubject: "[EQT Alerta de Seguridad] Dispositivo desvinculado con éxito",
    unboundTitle: "Dispositivo desvinculado",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Un dispositivo se ha desvinculado correctamente de su licencia EQT:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Código de licencia:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Fecha de desvinculación:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Cupo anual restante de desvinculaciones:</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Guía de restauración de dispositivos:</strong><br/>
      1. El espacio liberado está listo para activarse en un nuevo dispositivo.<br/>
      2. Para restaurar la licencia en un dispositivo, abra EQT en el dispositivo de destino y vuelva a ingresar este código.<br/>
      3. El cupo de desvinculación consumido se restaura automáticamente 365 días después de la operación.</p>`
  },
  de: {
    boundSubject: "[EQT Sicherheitsmeldung] Neues Gerät mit Ihrer Lizenz verknüpft",
    boundTitle: "Neues Gerät aktiviert",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Hallo, ein neues Gerät wurde mit Ihrer EQT-Lizenz verknüpft:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Lizenzschlüssel:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Aktiviert am:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Geräte-Hash:</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Verwendete Geräte:</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Wenn Sie dies nicht autorisiert haben, trennen Sie unbekannte Geräte im Selbstbedienungsportal.</p>`,
    unboundSubject: "[EQT Sicherheitsmeldung] Gerät erfolgreich entkoppelt",
    unboundTitle: "Geräteentkopplung erfolgreich",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Ein Gerät wurde erfolgreich von Ihrer EQT-Lizenz getrennt:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Lizenzschlüssel:</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Entkoppelt am:</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Verbleibendes Jahreskontingent:</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Wiederherstellung & Neukopplung:</strong><br/>
      1. Der freigegebene Platz steht für eine neue Geräteaktivierung zur Verfügung.<br/>
      2. Um die Lizenz auf einem Gerät wiederherzustellen, geben Sie den Schlüssel in EQT erneut ein.<br/>
      3. Das verbrauchte Kontingent wird 365 Tage nach dem Entkopplungsdatum automatisch wiederhergestellt.</p>`
  },
  fr: {
    boundSubject: "[EQT Alerte de Sécurité] Nouveau périphérique lié à votre licence",
    boundTitle: "Nouveau périphérique activé",
    boundBody: (lic, time, devHash, current, max) => `
      <p style="color: #475569; font-size: 14px;">Bonjour, un nouveau périphérique a été lié à votre licence EQT :</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Clé de licence :</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Activé le :</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Hash de l'appareil :</strong> ${devHash}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Périphériques utilisés :</strong> ${current} / ${max}</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Si vous n'avez pas autorisé cette action, rendez-vous sur le portail client pour délier l'appareil.</p>`,
    unboundSubject: "[EQT Alerte de Sécurité] Périphérique dissocié avec succès",
    unboundTitle: "Dissociation du périphérique réussie",
    unboundBody: (lic, time, remainingUnbinds) => `
      <p style="color: #475569; font-size: 14px;">Un périphérique a été dissocié avec succès de votre licence EQT :</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Clé de licence :</strong> ${lic}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Dissocié le :</strong> ${time}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Quota annuel restant de dissociation :</strong> ${remainingUnbinds} / 4</p>
      </div>
      <p style="color: #64748b; font-size: 13px;"><strong>Restauration & Réassociation :</strong><br/>
      1. Emplacement libéré disponible pour l'activation d'un nouveau périphérique.<br/>
      2. Pour restaurer la licence sur un appareil cible, ouvrez EQT et ressaisissez cette clé de licence.<br/>
      3. Le quota de dissociation consommé se restaure automatiquement 365 jours après la date de l'opération.</p>`
  }
};

export function getDeviceNoticeTemplate(lang: string) {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  return DEVICE_NOTIFICATION_I18N[norm] || DEVICE_NOTIFICATION_I18N['zh'] || DEVICE_NOTIFICATION_I18N['en'];
}

/** Portal self-service refund → revoke notification (7 languages). */
export const REFUND_REVOKE_EMAIL_I18N: Record<string, {
  subject: string;
  title: string;
  body: (lic: string, tier: string) => string;
}> = {
  zh: {
    subject: "【EQT】许可证授权吊销与退款通知",
    title: "您的 EQT 许可证授权已吊销",
    body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">您的退款申请已提交并处理，以下授权已被立即吊销：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>套餐：</strong> ${tier}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>激活码：</strong> <span style="font-family: monospace; text-decoration: line-through; color: #888;">${lic}</span></p>
        <p style="margin: 4px 0; color: #ef4444;"><strong>状态：</strong> 已吊销</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">已激活设备将在下次联网对账（或最迟 7 天租约到期）时自动降级为免费版。退款到账时间以支付渠道为准。</p>`
  },
  en: {
    subject: "[EQT] License Revoked — Refund Notification",
    title: "Your EQT license has been revoked",
    body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Your refund request has been submitted. The following license is revoked immediately:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Plan:</strong> ${tier}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>License:</strong> <span style="font-family: monospace; text-decoration: line-through; color: #888;">${lic}</span></p>
        <p style="margin: 4px 0; color: #ef4444;"><strong>Status:</strong> Revoked</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Activated devices will downgrade on the next online sync (or within the 7-day offline grace period). Refund timing depends on your payment provider.</p>`
  },
  ja: {
    subject: "【EQT】ライセンス失効・返金のお知らせ",
    title: "EQT ライセンスが失効しました",
    body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">返金申請を受け付け、以下のライセンスを直ちに失効しました：</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>プラン：</strong> ${tier}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>ライセンス：</strong> <span style="font-family: monospace; text-decoration: line-through; color: #888;">${lic}</span></p>
        <p style="margin: 4px 0; color: #ef4444;"><strong>状態：</strong> 失効</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">アクティブな端末は次回のオンライン同期（または最大7日間のオフライン猶予後）に無料版へ降格します。</p>`
  },
  ko: {
    subject: "【EQT】라이선스 취소 및 환불 안내",
    title: "EQT 라이선스가 취소되었습니다",
    body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">환불 요청이 접수되어 다음 라이선스가 즉시 취소되었습니다:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>요금제:</strong> ${tier}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>라이선스:</strong> <span style="font-family: monospace; text-decoration: line-through; color: #888;">${lic}</span></p>
        <p style="margin: 4px 0; color: #ef4444;"><strong>상태:</strong> 취소됨</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">활성화된 기기는 다음 온라인 동기화(또는 최대 7일 오프라인 유예 후)에 무료 버전으로 전환됩니다.</p>`
  },
  es: {
    subject: "[EQT] Licencia revocada — Aviso de reembolso",
    title: "Su licencia EQT ha sido revocada",
    body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Su solicitud de reembolso fue procesada. La siguiente licencia queda revocada de inmediato:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Plan:</strong> ${tier}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Licencia:</strong> <span style="font-family: monospace; text-decoration: line-through; color: #888;">${lic}</span></p>
        <p style="margin: 4px 0; color: #ef4444;"><strong>Estado:</strong> Revocada</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Los dispositivos activados volverán a la versión gratuita en la próxima sincronización (o en el plazo de gracia de 7 días).</p>`
  },
  de: {
    subject: "[EQT] Lizenz widerrufen — Erstattungsbenachrichtigung",
    title: "Ihre EQT-Lizenz wurde widerrufen",
    body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Ihre Erstattungsanfrage wurde übermittelt. Die folgende Lizenz ist sofort widerrufen:</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Tarif:</strong> ${tier}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Lizenz:</strong> <span style="font-family: monospace; text-decoration: line-through; color: #888;">${lic}</span></p>
        <p style="margin: 4px 0; color: #ef4444;"><strong>Status:</strong> Widerrufen</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Aktivierte Geräte werden bei der nächsten Online-Synchronisation (oder spätestens nach 7 Tagen Offline-Grace) auf die Free-Version zurückgestuft.</p>`
  },
  fr: {
    subject: "[EQT] Licence révoquée — Notification de remboursement",
    title: "Votre licence EQT a été révoquée",
    body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Votre demande de remboursement a été prise en compte. La licence suivante est révoquée immédiatement :</p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Offre :</strong> ${tier}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>Licence :</strong> <span style="font-family: monospace; text-decoration: line-through; color: #888;">${lic}</span></p>
        <p style="margin: 4px 0; color: #ef4444;"><strong>Statut :</strong> Révoquée</p>
      </div>
      <p style="color: #64748b; font-size: 13px;">Les appareils activés repasseront en version gratuite à la prochaine synchronisation (ou sous 7 jours de grâce hors ligne).</p>`
  }
};

export function getRefundRevokeEmailTemplate(lang: string) {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  return REFUND_REVOKE_EMAIL_I18N[norm] || REFUND_REVOKE_EMAIL_I18N['en'];
}
