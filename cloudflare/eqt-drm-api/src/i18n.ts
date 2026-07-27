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
  refund_not_allowed_for_source: {
    zh: "该授权为活动赠送或非购买渠道发放，不支持自助退款",
    en: "This license is promotional or non-purchase and is not eligible for self-service refund",
    ja: "キャンペーン等の非購入ライセンスのため返金できません",
    ko: "프로모션/비구매 라이선스는 자가 환불이 불가합니다",
    es: "Esta licencia promocional o no comprada no admite reembolso autoservicio",
    de: "Promo-/Nicht-Kauf-Lizenzen sind nicht selbst erstattungsfähig",
    fr: "Licence promotionnelle ou non achetée : remboursement libre-service indisponible"
  },
  blacklist_email: {
    zh: "该邮箱在过去 365 天内因已激活授权的退款/拒付达到 3 次及以上，暂时无法购买或激活。请更换邮箱或联系 support@eqt.net.im。",
    en: "This email is restricted for 365 days after 3 or more refund/chargeback revocations on activated licenses. Use another email or contact support@eqt.net.im.",
    ja: "このメールアドレスは、過去365日以内の有効化済みライセンスの返金/チャージバックが3回以上のため制限されています。",
    ko: "이 이메일은 최근 365일 내 활성화된 라이선스의 환불/차지백이 3회 이상이라 제한되었습니다.",
    es: "Este correo está restringido por 3 o más reembolsos/contracargos de licencias activadas en 365 días.",
    de: "Diese E-Mail ist wegen 3+ Erstattungen/Chargebacks aktivierter Lizenzen (365 Tage) eingeschränkt.",
    fr: "Cet e-mail est restreint après 3 remboursements/chargebacks ou plus sur licences activées (365 jours)."
  },
  blacklist_device: {
    zh: "该设备在过去 365 天内因退款/拒付达到 3 次及以上，无法在此设备激活。请更换设备激活，或若刚用其他邮箱购买可申请退款后改用其他设备。",
    en: "This device is restricted for 365 days after 3 or more refund/chargeback revocations. Activate on another device, or request a refund if you just purchased with a different email.",
    ja: "この端末は返金/チャージバックが3回以上のため制限されています。別の端末で有効化するか、返金後に別端末をご利用ください。",
    ko: "이 기기는 환불/차지백이 3회 이상이라 제한되었습니다. 다른 기기에서 활성화하거나 환불 후 다른 기기를 사용하세요.",
    es: "Este dispositivo está restringido por 3+ reembolsos/contracargos. Use otro dispositivo o solicite reembolso.",
    de: "Dieses Gerät ist wegen 3+ Erstattungen/Chargebacks eingeschränkt. Anderes Gerät nutzen oder Erstattung beantragen.",
    fr: "Cet appareil est restreint (3+ remboursements/chargebacks). Utilisez un autre appareil ou demandez un remboursement."
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
  /** Synthetic / e2e transaction IDs (txn_test_*, etc.) — local revoke only, no Paddle money movement. */
  refund_test_local_success: {
    zh: "测试订单已本地吊销（无真实支付渠道退款）",
    en: "Test license revoked locally (no real payment-channel refund)",
    ja: "テスト注文をローカルで失効しました（実返金なし）",
    ko: "테스트 주문이 로컬에서 취소되었습니다(실제 환불 없음)",
    es: "Licencia de prueba revocada localmente (sin reembolso real)",
    de: "Testlizenz lokal widerrufen (keine echte Erstattung)",
    fr: "Licence de test révoquée localement (pas de vrai remboursement)"
  },
  paddle_transaction_invalid: {
    zh: "关联的交易单号无效，无法向支付渠道发起退款",
    en: "Associated transaction ID is invalid; cannot refund via payment channel",
    ja: "関連取引IDが無効なため返金できません",
    ko: "연결된 거래 ID가 유효하지 않아 환불할 수 없습니다",
    es: "El ID de transacción asociado no es válido",
    de: "Zugehörige Transaktions-ID ist ungültig",
    fr: "L'identifiant de transaction associé est invalide"
  },
  cross_code_stacking_blocked: {
    zh: "当前设备已绑定生效中的其它授权码。系统不支持多个激活码直接叠加，请先解绑旧设备后再使用新激活码。",
    en: "Current device is bound to another active license. Stacking across different license codes is disabled. Please unbind the existing license first.",
    ja: "現在のデバイスは他の有効なライセンスにバインドされています。複数のライセンスコードの直接重複はサポートされていません。解約・解除後に再試行してください。",
    ko: "현재 기기에 다른 활성 라이선스가 바인딩되어 있습니다. 서로 다른 라이선스 코드의 직접 중복은 지원되지 않습니다. 기존 기기 해제 후 다시 시도해 주세요.",
    es: "El dispositivo actual está vinculado a otra licencia activa. No se permite la superposición de diferentes códigos. Desvincule la licencia existente primero.",
    de: "Das aktuelle Gerät ist an eine andere aktive Lizenz gebunden. Das Stapeln verschiedener Lizenzcodes ist deaktiviert. Bitte entkoppeln Sie zuerst die bestehende Lizenz.",
    fr: "L'appareil actuel est lié à une autre licence active. Le cumul de codes de licence différents est désactivé. Veuillez d'abord dissocier la licence existante."
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
  no_paddle_subscription: {
    zh: "该授权无关联的订阅，无法取消续费",
    en: "No subscription is linked to this license",
    ja: "このライセンスに関連するサブスクリプションがありません",
    ko: "이 라이선스에 연결된 구독이 없습니다",
    es: "No hay suscripción asociada a esta licencia",
    de: "Kein Abonnement mit dieser Lizenz verknüpft",
    fr: "Aucun abonnement associé à cette licence"
  },
  cancel_not_allowed: {
    zh: "该授权无法取消订阅（非年付订阅或状态不可用）",
    en: "This license cannot cancel a subscription (not an active yearly subscription)",
    ja: "このライセンスではサブスクリプションを解約できません",
    ko: "이 라이선스는 구독을 취소할 수 없습니다",
    es: "Esta licencia no puede cancelar una suscripción",
    de: "Für diese Lizenz kann kein Abonnement gekündigt werden",
    fr: "Cette licence ne peut pas annuler d'abonnement"
  },
  cancel_success: {
    zh: "订阅已取消，授权已立即失效（这不是退款）",
    en: "Subscription canceled. License revoked immediately (this is not a refund).",
    ja: "サブスクリプションを解約し、ライセンスは即時失効しました（返金ではありません）",
    ko: "구독이 취소되었고 라이선스가 즉시 해제되었습니다(환불 아님)",
    es: "Suscripción cancelada. Licencia revocada de inmediato (no es un reembolso).",
    de: "Abo gekündigt. Lizenz sofort widerrufen (keine Erstattung).",
    fr: "Abonnement annulé. Licence révoquée immédiatement (ce n'est pas un remboursement)."
  },
  cancel_test_local_success: {
    zh: "测试订阅已本地取消并吊销（未调用 Paddle）",
    en: "Test subscription canceled locally (no Paddle call)",
    ja: "テスト購読をローカルで解約しました（Paddle 未呼出）",
    ko: "테스트 구독이 로컬에서 취소되었습니다(Paddle 호출 없음)",
    es: "Suscripción de prueba cancelada localmente (sin Paddle)",
    de: "Test-Abo lokal gekündigt (kein Paddle-Aufruf)",
    fr: "Abonnement de test annulé localement (sans Paddle)"
  },
  cancel_failed: {
    zh: "取消订阅失败，请稍后重试或联系 support@eqt.net.im",
    en: "Failed to cancel subscription. Try again or contact support@eqt.net.im",
    ja: "解約に失敗しました。support@eqt.net.im までご連絡ください",
    ko: "구독 취소에 실패했습니다. support@eqt.net.im 으로 문의해 주세요",
    es: "No se pudo cancelar la suscripción. Contacte support@eqt.net.im",
    de: "Abo-Kündigung fehlgeschlagen. support@eqt.net.im kontaktieren",
    fr: "Échec de l'annulation. Contactez support@eqt.net.im"
  },
  invoice_not_available: {
    zh: "该授权没有可查询的 Paddle 交易单，无法打开发票",
    en: "No Paddle transaction is linked; invoice is not available",
    ja: "関連する Paddle 取引がないため請求書を開けません",
    ko: "연결된 Paddle 거래가 없어 인보이스를 열 수 없습니다",
    es: "No hay transacción de Paddle; factura no disponible",
    de: "Keine Paddle-Transaktion verknüpft; Rechnung nicht verfügbar",
    fr: "Aucune transaction Paddle ; facture indisponible"
  },
  missing_transaction_id: {
    zh: "缺少 transaction_id 参数",
    en: "Missing transaction_id parameter",
    ja: "transaction_id パラメータが不足しています",
    ko: "transaction_id 파라미터가 누락되었습니다",
    es: "Falta el parámetro transaction_id",
    de: "Fehlender Parameter transaction_id",
    fr: "Paramètre transaction_id manquant"
  },
  invalid_email: {
    zh: "请输入有效的电子邮箱地址",
    en: "Invalid email address",
    ja: "有効なメールアドレスを入力してください",
    ko: "유효한 이메일 주소를 입력하세요",
    es: "Ingrese una dirección de correo válida",
    de: "Bitte geben Sie eine gültige E-Mail-Adresse ein",
    fr: "Veuillez saisir une adresse e-mail valide"
  },
  send_code_rate_limited: {
    zh: "请求频繁，请等待 60 秒后再重新获取验证码",
    en: "Please wait 60 seconds before requesting another verification code",
    ja: "リクエストが多すぎます。60秒待ってから再試行してください",
    ko: "요청이 너무 잦습니다. 60초 후 다시 시도해 주세요",
    es: "Por favor espere 60 segundos antes de solicitar otro código",
    de: "Bitte warten Sie 60 Sekunden, bevor Sie einen neuen Code anfordern",
    fr: "Veuillez attendre 60 secondes avant de demander un autre code"
  },
  code_sent_success: {
    zh: "验证码已发送至您的邮箱，请查收",
    en: "Verification code sent to your email successfully",
    ja: "認証コードをメールに送信しました",
    ko: "인증 코드가 이메일로 발송되었습니다",
    es: "Código de verificación enviado a su correo",
    de: "Bestätigungscode wurde an Ihre E-Mail gesendet",
    fr: "Code de vérification envoyé à votre e-mail"
  },
  license_pending_fulfillment: {
    zh: "激活码生成中，请等待支付确认完成",
    en: "License not generated yet, pending payment confirmation",
    ja: "ライセンスコード生成中。支払い確認の完了をお待ちください",
    ko: "라이선스 코드가 생성 중입니다. 결제 확인 완결을 기다려 주세요",
    es: "Licencia aún no generada, pendiente de confirmación de pago",
    de: "Lizenz noch nicht generiert, Zahlung ausstehend",
    fr: "Licence non générée, confirmation du paiement en attente"
  },
  invoice_paddle_unavailable: {
    zh: "账单服务暂时不可用。请将交易单号发给 support@eqt.net.im 协助查询",
    en: "Billing service is temporarily unavailable. Email support@eqt.net.im with your transaction ID",
    ja: "請求サービスは一時利用不可です。取引IDを support@eqt.net.im までお送りください",
    ko: "청구 서비스를 일시적으로 사용할 수 없습니다. 거래 ID를 support@eqt.net.im 으로 보내 주세요",
    es: "Servicio de facturación no disponible. Escriba a support@eqt.net.im con el ID de transacción",
    de: "Abrechnung vorübergehend nicht verfügbar. Transaktions-ID an support@eqt.net.im senden",
    fr: "Facturation indisponible. Envoyez l'ID de transaction à support@eqt.net.im"
  },
  invoice_manual_help: {
    zh: "请复制交易单号，发送至 support@eqt.net.im，或登录 Paddle 发给您的账单邮件查看发票",
    en: "Copy the transaction ID and email support@eqt.net.im, or open the receipt email from Paddle",
    ja: "取引IDをコピーして support@eqt.net.im へ送るか、Paddle の領収メールをご確認ください",
    ko: "거래 ID를 복사해 support@eqt.net.im 으로 보내거나 Paddle 영수증 메일을 확인하세요",
    es: "Copie el ID de transacción y escriba a support@eqt.net.im, o abra el correo de Paddle",
    de: "Transaktions-ID kopieren und an support@eqt.net.im senden, oder die Paddle-Mail öffnen",
    fr: "Copiez l'ID de transaction et écrivez à support@eqt.net.im, ou ouvrez l'e-mail Paddle"
  },
  invoice_failed: {
    zh: "打开发票失败，请稍后重试或联系 support@eqt.net.im",
    en: "Could not open invoice. Try again or contact support@eqt.net.im",
    ja: "請求書を開けませんでした。support@eqt.net.im までご連絡ください",
    ko: "인보이스를 열 수 없습니다. support@eqt.net.im 으로 문의해 주세요",
    es: "No se pudo abrir la factura. Contacte support@eqt.net.im",
    de: "Rechnung konnte nicht geöffnet werden. support@eqt.net.im kontaktieren",
    fr: "Impossible d'ouvrir la facture. Contactez support@eqt.net.im"
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
  },
  missing_license_code: {
    zh: "激活码不能为空",
    en: "Missing license code",
    ja: "ライセンスコードを入力してください",
    ko: "라이선스 코드를 입력해 주세요",
    es: "Falta el código de licencia",
    de: "Lizenzcode fehlt",
    fr: "Code de licence manquant"
  },
  license_suspended_or_revoked: {
    zh: "该授权码当前不可用（已暂停使用、退款或吊销）",
    en: "License is suspended, refunded, or revoked",
    ja: "このライセンスは停止、返金、または失効しています",
    ko: "라이선스가 정지, 환불 또는 취소되었습니다",
    es: "La licencia está suspendida, reembolsada o revocada",
    de: "Lizenz ist ausgesetzt, erstattet oder widerrufen",
    fr: "La licence est suspendue, remboursée ou révoquée"
  },
  license_redeem_expired: {
    zh: "该授权码已超过兑换截止时间，无法继续激活",
    en: "This license code has passed its redeem deadline and can no longer be activated.",
    ja: "このライセンスコードは引き換え期限を過ぎているため有効化できません。",
    ko: "이 라이선스 코드는 교환 만료일이 지나 더 이상 활성화할 수 없습니다.",
    es: "Este código de licencia ha pasado su fecha límite de canje.",
    de: "Dieser Lizenzcode hat seine Einlösefrist überschritten.",
    fr: "Ce code de licence a dépassé sa date limite d'activation."
  },
  license_expired: {
    zh: "该授权码已超过有效期",
    en: "License has expired",
    ja: "ライセンスの有効期限が切れています",
    ko: "라이선스 유효 기간이 만료되었습니다",
    es: "La licencia ha expirado",
    de: "Lizenz ist abgelaufen",
    fr: "La licence a expiré"
  },
  max_devices_reached: {
    zh: "该授权码激活设备数量已达上限（可通过 Portal 解绑旧设备）",
    en: "Maximum number of devices reached for this license (unbind old devices in Portal)",
    ja: "このライセンスのアクティベーション端末数が上限に達しました",
    ko: "이 라이선스의 기기 활성화 수가 최대 한도에 도달했습니다",
    es: "Se alcanzó el número máximo de dispositivos para esta licencia",
    de: "Maximale Anzahl an Geräten für diese Lizenz erreicht",
    fr: "Nombre maximal d'appareils atteint pour cette licence"
  },
  lifetime_stacking_blocked: {
    zh: "该设备已激活同级别的终身买断授权，无需重复叠加激活",
    en: "This device already has a lifetime license of the same tier; stacking is not allowed.",
    ja: "この端末には既に同ランクの永久ライセンスが有効化されています",
    ko: "이 기기에는 이미 동일한 등급의 영구 라이선스가 활성화되어 있습니다",
    es: "Este dispositivo ya tiene una licencia de por vida del mismo nivel",
    de: "Dieses Gerät verfügt bereits über eine lebenslange Lizenz desselben Tarifs",
    fr: "Cet appareil dispose déjà d'une licence à vie du même niveau"
  },
  auto_renew_off_success: {
    zh: "自动续费已关闭。您的 Plus 权益可继续正常使用至到期日，届时将不会自动扣费。",
    en: "Auto-renewal disabled. Your Plus status remains active until expiration date, and you will not be billed again.",
    ja: "自動更新をオフにしました。有効期限まで Plus 機能を引き続きご利用いただけます。",
    ko: "자동 갱신이 해제되었습니다. 만료일까지 Plus 혜택을 계속 이용할 수 있습니다.",
    es: "Renovación automática desactivada. Su estado Plus permanece activo hasta la fecha de expiración.",
    de: "Automatische Verlängerung deaktiviert. Ihr Plus-Status bleibt bis zum Ablaufdatum aktiv.",
    fr: "Renouvellement automatique désactivé. Votre statut Plus reste actif jusqu'à la date d'expiration."
  },
  auto_renew_on_success: {
    zh: "自动续费已开启。将于到期日自动扣费续订阅。",
    en: "Auto-renewal enabled. Your subscription will renew automatically on the expiration date.",
    ja: "自動更新をオンにしました。有効期限日に自動的に更新されます。",
    ko: "자동 갱신이 설정되었습니다. 만료일에 자동으로 갱신됩니다.",
    es: "Renovación automática activada. Su suscripción se renovará automáticamente en la fecha de expiración.",
    de: "Automatische Verlängerung aktiviert. Ihr Abonnement wird am Ablaufdatum automatisch verlängert.",
    fr: "Renouvellement automatique activé. Votre abonnement se renouveltera automatiquement à la date d'expiration."
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

/**
 * License status became revoked — emails are keyed by revoke_reason.
 * Refund (money back) and revoke (entitlement removed) are related but not identical:
 * - refund: payment reversed AND license revoked
 * - chargeback: bank dispute AND license revoked (may not be "customer refund")
 * - admin/subscription/test: revoke without a customer-facing refund
 */
type RevokeMail = {
  subject: string;
  title: string;
  body: (lic: string, tier: string) => string;
};

function revokeMailBlock(lic: string, tier: string, statusLine: string): string {
  return `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0; font-size: 14px;">
        <p style="margin: 4px 0; color: #334155;"><strong>Plan / 套餐：</strong> ${tier}</p>
        <p style="margin: 4px 0; color: #334155;"><strong>License / 激活码：</strong> <span style="font-family: monospace; text-decoration: line-through; color: #888;">${lic}</span></p>
        <p style="margin: 4px 0; color: #ef4444;"><strong>Status：</strong> ${statusLine}</p>
      </div>`;
}

const REVOKE_EMAIL_BY_REASON: Record<string, Record<string, RevokeMail>> = {
  refund: {
    zh: {
      subject: "【EQT】退款已处理 · 授权已失效",
      title: "退款已处理",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">您的<strong>退款</strong>申请已处理完成。款项将退回原支付方式（到账时间以支付渠道为准）。</p>
      <p style="color: #475569; font-size: 14px;">作为退款的结果，以下<strong>付费授权已失效</strong>（与「仅吊销不退款」不同）：</p>
      ${revokeMailBlock(lic, tier, '已退款 · 授权失效')}
      <p style="color: #64748b; font-size: 13px;">已激活设备将在下次联网对账（或最迟 7 天租约）时自动降级为免费版。</p>`
    },
    en: {
      subject: "[EQT] Refund processed · license entitlement ended",
      title: "Refund processed",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Your <strong>refund</strong> has been processed. Funds return to the original payment method (timing depends on your provider).</p>
      <p style="color: #475569; font-size: 14px;">As a result of the refund, the following <strong>paid entitlement has ended</strong>:</p>
      ${revokeMailBlock(lic, tier, 'Refunded · entitlement ended')}
      <p style="color: #64748b; font-size: 13px;">Activated devices will downgrade on the next online sync (or within the 7-day offline grace period).</p>`
    }
  },
  chargeback: {
    zh: {
      subject: "【EQT】支付争议/拒付 · 授权已失效",
      title: "支付争议导致授权失效",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">支付渠道通知：该订单发生<strong>银行拒付/争议（chargeback）</strong>。这<strong>不是</strong>客户自助退款流程。</p>
      <p style="color: #475569; font-size: 14px;">对应付费授权已失效：</p>
      ${revokeMailBlock(lic, tier, '拒付 · 授权失效')}
      <p style="color: #64748b; font-size: 13px;">已激活设备将在下次联网对账时降级为免费版。如有疑问请联系 support@eqt.net.im。</p>`
    },
    en: {
      subject: "[EQT] Payment dispute / chargeback · license ended",
      title: "Chargeback: entitlement ended",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Our payment provider reported a <strong>chargeback / payment dispute</strong> on this order. This is <strong>not</strong> a customer self-service refund.</p>
      <p style="color: #475569; font-size: 14px;">The related paid entitlement has ended:</p>
      ${revokeMailBlock(lic, tier, 'Chargeback · entitlement ended')}
      <p style="color: #64748b; font-size: 13px;">Devices will downgrade on the next online sync. Contact support@eqt.net.im if you need help.</p>`
    }
  },
  admin: {
    zh: {
      subject: "【EQT】授权已吊销（运营处理）",
      title: "授权已吊销",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">您的授权已被运营侧<strong>吊销</strong>。本次处理<strong>不包含退款</strong>（除非另行通知支付渠道）。</p>
      ${revokeMailBlock(lic, tier, '已吊销 · 非退款')}
      <p style="color: #64748b; font-size: 13px;">已激活设备将在下次联网对账时降级为免费版。</p>`
    },
    en: {
      subject: "[EQT] License revoked (operator action)",
      title: "License revoked",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Your license was <strong>revoked by the operator</strong>. This action <strong>does not include a refund</strong> unless separately processed by the payment provider.</p>
      ${revokeMailBlock(lic, tier, 'Revoked · no refund')}
      <p style="color: #64748b; font-size: 13px;">Devices will downgrade on the next online sync.</p>`
    }
  },
  subscription: {
    zh: {
      subject: "【EQT】订阅已结束 · 授权失效",
      title: "订阅已结束",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">您的订阅已取消、逾期或暂停，对应授权已失效。<strong>这不是退款通知</strong>。</p>
      ${revokeMailBlock(lic, tier, '订阅结束 · 授权失效')}
      <p style="color: #64748b; font-size: 13px;">如需继续使用，请前往官网重新订阅。</p>`
    },
    en: {
      subject: "[EQT] Subscription ended · license inactive",
      title: "Subscription ended",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">Your subscription was canceled, past due, or paused. The license is no longer active. <strong>This is not a refund notice.</strong></p>
      ${revokeMailBlock(lic, tier, 'Subscription ended')}
      <p style="color: #64748b; font-size: 13px;">Resubscribe on the website if you want to continue.</p>`
    }
  },
  test: {
    zh: {
      subject: "【EQT】[测试] 授权已本地吊销",
      title: "测试吊销",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">这是<strong>测试路径</strong>的本地吊销通知，无真实支付退款。</p>
      ${revokeMailBlock(lic, tier, '测试吊销')}`
    },
    en: {
      subject: "[EQT] [Test] License revoked locally",
      title: "Test revoke",
      body: (lic, tier) => `
      <p style="color: #475569; font-size: 14px;">This is a <strong>test-path</strong> local revoke. No real payment refund.</p>
      ${revokeMailBlock(lic, tier, 'Test revoke')}`
    }
  }
};

/** Prefer reason-specific templates; fallback to refund copy for unknown reasons. */
export function getLicenseRevokeEmailTemplate(lang: string, reason: string = 'refund'): RevokeMail {
  const norm = (lang || 'en').toLowerCase().substring(0, 2);
  const r = (reason || 'refund').toLowerCase();
  const byReason = REVOKE_EMAIL_BY_REASON[r] || REVOKE_EMAIL_BY_REASON.refund;
  return byReason[norm] || byReason.en || REVOKE_EMAIL_BY_REASON.refund.en;
}

/** @deprecated use getLicenseRevokeEmailTemplate(lang, 'refund') */
export function getRefundRevokeEmailTemplate(lang: string) {
  return getLicenseRevokeEmailTemplate(lang, 'refund');
}

// 7-Language Email Dictionaries for Purchase & Renewal
export const PURCHASE_EMAIL_I18N: Record<string, {
  subject: string;
  title: string;
  greeting: string;
  intro: string;
  tierLabel: string;
  codeLabel: string;
  expiresLabel: string;
  devicesLabel: string;
  howToActivateTitle: string;
  howToActivateStep1: string;
  howToActivateStep2: string;
  footerNotice: string;
}> = {
  zh: {
    subject: "【EQT】您的购买激活码与服务明细",
    title: "购买确认与激活指引",
    greeting: "感谢您购买 EQT Easy QR Transfer！",
    intro: "您的付费订单已处理完成。以下是您的付费授权激活码明细：",
    tierLabel: "授权级别 (Tier)",
    codeLabel: "激活码 (License Code)",
    expiresLabel: "有效期限 (Expires)",
    devicesLabel: "最大激活设备数",
    howToActivateTitle: "如何激活：",
    howToActivateStep1: "打开 EQT 客户端，前往设置或关于面板。",
    howToActivateStep2: "点击“输入激活码”并输入上述激活码，然后点击确认即可激活您的 EQT 尊享功能！",
    footerNotice: "此邮件由系统自动发送，请勿直接回复。如有疑问，请访问官网或联系技术支持。"
  },
  en: {
    subject: "[EQT] Your License Code & Order Confirmation",
    title: "Order Confirmation & Activation Guide",
    greeting: "Thank you for purchasing EQT Easy QR Transfer!",
    intro: "Your payment order has been successfully processed. Here are your license details:",
    tierLabel: "License Tier",
    codeLabel: "License Code",
    expiresLabel: "Expiration Date",
    devicesLabel: "Max Activated Devices",
    howToActivateTitle: "How to Activate:",
    howToActivateStep1: "Open your EQT desktop app and navigate to Settings or About panel.",
    howToActivateStep2: "Click 'Enter License Code', paste the code above, and submit to unlock premium features!",
    footerNotice: "This is an automated notification. Please do not reply directly. Contact support if you need assistance."
  },
  ja: {
    subject: "【EQT】ライセンスコードおよび購入完了のお知らせ",
    title: "購入確認とアクティベーション手順",
    greeting: "EQT (Easy QR Transfer) のご購入ありがとうございます！",
    intro: "お支払いが完了いたしました。ライセンスの詳細は以下の通りです：",
    tierLabel: "ライセンスプラン",
    codeLabel: "ライセンスコード",
    expiresLabel: "有効期限",
    devicesLabel: "最大認証端末数",
    howToActivateTitle: "アクティベーション手順：",
    howToActivateStep1: "EQT クライアントを起動し、設定または About パネルを開きます。",
    howToActivateStep2: "「ライセンスコード入力」をクリックし、上記コードを入力して適用してください。",
    footerNotice: "このメールは自動送信されています。返信せず、ご質問はサポート窓口へお問い合わせください。"
  },
  ko: {
    subject: "【EQT】라이선스 코드 및 결제 완료 안내",
    title: "구매 확인 및 활성화 안내",
    greeting: "EQT Easy QR Transfer를 구매해 주셔서 감사합니다!",
    intro: "결제가 성공적으로 처리되었습니다. 라이선스 상세 정보는 다음과 같습니다:",
    tierLabel: "라이선스 등급",
    codeLabel: "라이선스 코드",
    expiresLabel: "유효 기간",
    devicesLabel: "최대 활성화 기기 수",
    howToActivateTitle: "활성화 방법:",
    howToActivateStep1: "EQT 데스크톱 앱을 열고 설정 또는 정보(About) 패널로 이동합니다.",
    howToActivateStep2: "'라이선스 코드 입력'을 클릭하고 위 코드를 입력하여 고급 기능을 활성화하세요!",
    footerNotice: "본 메일은 발신 전용입니다. 문의 사항이 있으시면 고객 지원으로 연락해 주세요."
  },
  es: {
    subject: "[EQT] Su Código de Licencia y Confirmación de Compra",
    title: "Confirmación de Pedido y Guía de Activación",
    greeting: "¡Gracias por comprar EQT Easy QR Transfer!",
    intro: "Su orden de pago ha sido procesada con éxito. Aquí están los detalles de su licencia:",
    tierLabel: "Nivel de Licencia",
    codeLabel: "Código de Licencia",
    expiresLabel: "Fecha de Expiración",
    devicesLabel: "Dispositivos Máximos",
    howToActivateTitle: "Cómo Activar:",
    howToActivateStep1: "Abra la aplicación EQT y vaya al panel de Configuración o Acerca de.",
    howToActivateStep2: "Haga clic en 'Ingresar código de licencia', pegue el código anterior y confirme.",
    footerNotice: "Este es un correo automático, por favor no responda directamente. Contacte a soporte si requiere ayuda."
  },
  de: {
    subject: "[EQT] Ihr Lizenzcode & Kaufbestätigung",
    title: "Bestellbestätigung & Aktivierungsanleitung",
    greeting: "Vielen Dank für den Kauf von EQT Easy QR Transfer!",
    intro: "Ihre Zahlung wurde erfolgreich verarbeitet. Hier sind Ihre Lizenzdetails:",
    tierLabel: "Lizenz-Stufe",
    codeLabel: "Lizenzcode",
    expiresLabel: "Ablaufdatum",
    devicesLabel: "Max. aktivierte Geräte",
    howToActivateTitle: "So aktivieren Sie:",
    howToActivateStep1: "Öffnen Sie die EQT-App und gehen Sie zum Einstellungen- oder Info-Bereich.",
    howToActivateStep2: "Klicken Sie auf 'Lizenzcode eingeben', fügen Sie den Code ein und bestätigen Sie.",
    footerNotice: "Dies ist eine automatische Benachrichtigung. Bitte antworten Sie nicht direkt darauf."
  },
  fr: {
    subject: "[EQT] Votre Code de Licence et Confirmation de Commande",
    title: "Confirmation de Commande & Guide d'Activation",
    greeting: "Merci d'avoir acheté EQT Easy QR Transfer !",
    intro: "Votre commande a été traitée avec succès. Voici les détails de votre licence :",
    tierLabel: "Niveau de Licence",
    codeLabel: "Code de Licence",
    expiresLabel: "Date d'Expiration",
    devicesLabel: "Appareils Max. Autorisés",
    howToActivateTitle: "Comment Activer :",
    howToActivateStep1: "Ouvrez l'application EQT et allez dans les Paramètres ou la section À Propos.",
    howToActivateStep2: "Cliquez sur 'Saisir le code de licence', collez le code et validez.",
    footerNotice: "Ceci est un e-mail automatique, veuillez ne pas y répondre directement."
  }
};

export const RENEWAL_EMAIL_I18N: Record<string, {
  subject: string;
  title: string;
  header: string;
  intro: string;
  codeLabel: string;
  newExpiresLabel: string;
  statusLabel: string;
  statusText: string;
  noteText: string;
  footerNotice: string;
}> = {
  zh: {
    subject: "【EQT】订阅已续费成功 · 激活码不变",
    title: "订阅自动续费通知",
    header: "【EQT】订阅已续费成功",
    intro: "Paddle 已完成本周期扣费。您的<strong>激活码不变</strong>，服务权益已成功延展：",
    codeLabel: "激活码",
    newExpiresLabel: "新有效期至",
    statusLabel: "状态",
    statusText: "active（续费成功，保持生效）",
    noteText: "已激活设备在下一次联网对账时会自动刷新本地证书有效期，无需手动重新输入激活码。",
    footerNotice: "此邮件由系统自动发送。如需管理或取消订阅，请使用客户 Portal。"
  },
  en: {
    subject: "[EQT] Subscription Renewed Successfully · License Code Unchanged",
    title: "Subscription Renewal Notice",
    header: "[EQT] Subscription Renewal Successful",
    intro: "Paddle has completed billing for the current period. Your <strong>license code remains unchanged</strong> and validity has been extended:",
    codeLabel: "License Code",
    newExpiresLabel: "New Expiration Date",
    statusLabel: "Status",
    statusText: "active (renewed and valid)",
    noteText: "Activated devices will automatically refresh their local license certificate during the next online sync. No manual entry is required.",
    footerNotice: "This is an automated notification. Use the Customer Portal to manage or cancel subscriptions."
  },
  ja: {
    subject: "【EQT】サブスクリプション自動更新完了のお知らせ",
    title: "サブスクリプション更新通知",
    header: "【EQT】サブスクリプション更新成功",
    intro: "お支払いが完了しました。<strong>ライセンスコードは変更されず</strong>、有効期限が延長されました：",
    codeLabel: "ライセンスコード",
    newExpiresLabel: "新有効期限",
    statusLabel: "ステータス",
    statusText: "active（更新成功・有効）",
    noteText: "認証済みの端末は、次回のオンライン確認時に自動的に証明書が更新されます。",
    footerNotice: "このメールは自動送信されています。サブスクリプションの管理・キャンセルはポータルをご利用ください。"
  },
  ko: {
    subject: "【EQT】구독 자동 갱신 완료 안내 · 라이선스 코드 유지",
    title: "구독 갱신 안내",
    header: "【EQT】구독 갱신 완료",
    intro: "이번 주기 결제가 완료되었습니다. <strong>라이선스 코드는 동일하게 유지</strong>되며 유효 기간이 연장되었습니다:",
    codeLabel: "라이선스 코드",
    newExpiresLabel: "새 만료일",
    statusLabel: "상태",
    statusText: "active (갱신 완료 및 유효함)",
    noteText: "활성화된 기기는 다음 온라인 동기화 시 로컬 라이선스 인증서가 자동으로 갱신됩니다.",
    footerNotice: "본 메일은 자동 발송 메시지입니다. 구독 관리 및 취소는 고객 포털을 이용해 주세요."
  },
  es: {
    subject: "[EQT] Suscripción Renovada Con Éxito · Código Sin Cambios",
    title: "Aviso de Renovación de Suscripción",
    header: "[EQT] Renovación de Suscripción Exitosa",
    intro: "Paddle ha completado el pago del período actual. Su <strong>código de licencia no cambia</strong> y la validez se ha extendido:",
    codeLabel: "Código de Licencia",
    newExpiresLabel: "Nueva Fecha de Expiración",
    statusLabel: "Estado",
    statusText: "active (renovado y activo)",
    noteText: "Los dispositivos activados actualizarán automáticamente su certificado en la próxima sincronización online.",
    footerNotice: "Este es un correo automático. Utilice el Portal del Cliente para gestionar su suscripción."
  },
  de: {
    subject: "[EQT] Abonnement erfolgreich verlängert · Lizenzcode unverändert",
    title: "Abonnement-Verlängerungsbenachrichtigung",
    header: "[EQT] Abonnement-Verlängerung erfolgreich",
    intro: "Paddle hat die Abrechnung für die aktuelle Periode abgeschlossen. Ihr <strong>Lizenzcode bleibt unverändert</strong> und die Gültigkeit wurde verlängert:",
    codeLabel: "Lizenzcode",
    newExpiresLabel: "Neues Ablaufdatum",
    statusLabel: "Status",
    statusText: "active (verlängert und gültig)",
    noteText: "Aktivierte Geräte aktualisieren Ihr lokales Lizenzzertifikat automatisch beim nächsten Online-Abgleich.",
    footerNotice: "Dies ist eine automatische Benachrichtigung. Nutzen Sie das Kundenportal zur Verwaltung Ihres Abonnements."
  },
  fr: {
    subject: "[EQT] Abonnement Renouvelé Avec Succès · Code Inchangé",
    title: "Abonnement Renouvelé Avec Succès",
    header: "[EQT] Renouvellement d'Abonnement Réussi",
    intro: "Paddle a effectué le prélèvement pour la période en cours. Votre <strong>code de licence reste inchangé</strong> et la validité a été prolongée :",
    codeLabel: "Code de Licence",
    newExpiresLabel: "Nouvelle Date d'Expiration",
    statusLabel: "Statut",
    statusText: "active (renouvelé et actif)",
    noteText: "Les appareils activés mettront automatiquement à jour leur certificat lors de la prochaine synchronisation en ligne.",
    footerNotice: "Ceci est un message automatique. Utilisez le Portail Client pour gérer votre abonnement."
  }
};
