export interface DesktopSettings {
    lang?: string;
    port?: number;
    autoStop?: boolean;
    qrPort?: number;
    chatHistorySavePath?: string;
    autoUpdateMode?: 'notify' | 'download' | 'silent' | 'off' | string;
    lastUpdateCheckTime?: number;
    closeBehavior?: 'tray' | 'exit' | 'ask' | 'quit' | string;
    interface?: string;
    interfaceOptions?: Array<{ name: string; label?: string; isRecommended?: boolean }>;
    chatSender?: string;
    chatAvatar?: string;
    chatDownloadDir?: string;
    enableChatV2?: boolean;
    showHistory?: boolean;
    debugLog?: boolean;
    viewportDebug?: boolean;
    logDir?: string;
    configPath?: string;
    updateCheckIntervalHours?: number;
    devMode?: boolean;
    output?: string;
    [key: string]: any;
}

export interface IntegrationStatus {
    supported: boolean;
    enabled: boolean;
    needsRepair: boolean;
    detail: string;
}

export interface LicenseStatus {
    tier?: string;
    paidStatus?: boolean;
    verified?: boolean;
    redeemedAt?: string;
    codeDate?: string;
    [key: string]: any;
}

export interface AgentStatusData {
    state?: string;
    current?: any;
    chat?: any;
    clients?: any;
    version?: string;
    history?: any[];
    [key: string]: any;
}

export type SharePathItem = string | { path: string; name?: string; size?: string };

export interface AppState {
    mode: 'share' | 'receive' | 'chat';
    sharePaths: SharePathItem[];
    shareLimitNotice: string;
    receiveDir: string;
    chatSaveDir: string;
    status: AgentStatusData | any;
    settings: DesktopSettings | any;
    rightClickIntegration: IntegrationStatus | null;
    startupIntegration: IntegrationStatus | null;
    appInfo: any;
    activePanel: string;
    error: string;
    notice: string;
    busy: boolean;
    browserFallback: boolean;
    chatAutoSave: boolean;
    closeBehavior: string;
    chatQROpen: boolean;
    chatQRPulseUntil: number;
    chatQRPromptDismissed: boolean;
    lastChatDeviceCount: number;
    activeChatTaskId: number;
    activeChatSessionKey: string;
    chatQRPulseArmed: boolean;
    chatUsageDate: string;
    chatUsageMs: number;
    chatUsageStartedAt: number;
    chatQuotaNoticeShown: boolean;
    updateStatusText: string;
    updateBtnText: string;
    updateBtnDisabled: boolean;
    updateCheckRes: any;
    updateStage: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing';
    license: LicenseStatus | null;
    redeemMessage: string;
    redeemError: string;
    feedbackNotice: string;
    feedbackSent: boolean;
    feedbackError: string;
    feedbackImageBase64: string | null;
    feedbackImageFormat: string | null;
    feedbackMessage: string;
    feedbackContact: string;
    feedbackSendResult: string;
    isSendingFeedback: boolean;
    isEditingChatSender: boolean;
    confirmResetPending: boolean;
    showEmojiPicker: boolean;
    updateBackoffCount: number;
    deviceFilesExpanded?: Record<string, boolean>;
    settingsAdvancedOpen?: boolean;
    settingsDevOpen?: boolean;
    tempRedeemCode?: string;
    isActivating?: boolean;
    pendingSwitchMode?: 'share' | 'receive' | 'chat' | null;
    [key: string]: any;
}

export const state: AppState = {
    mode: 'share',
    sharePaths: [],
    shareLimitNotice: '',
    receiveDir: '',
    chatSaveDir: '',
    status: null,
    settings: null,
    rightClickIntegration: null,
    startupIntegration: null,
    appInfo: null,
    activePanel: '',
    error: '',
    notice: '',
    busy: false,
    browserFallback: false,
    chatAutoSave: true,
    closeBehavior: 'tray',
    chatQROpen: false,
    chatQRPulseUntil: 0,
    chatQRPromptDismissed: false,
    lastChatDeviceCount: 0,
    activeChatTaskId: 0,
    activeChatSessionKey: '',
    chatQRPulseArmed: false,
    chatUsageDate: '',
    chatUsageMs: 0,
    chatUsageStartedAt: 0,
    chatQuotaNoticeShown: false,
    updateStatusText: '',
    updateBtnText: '',
    updateBtnDisabled: false,
    updateCheckRes: null,
    updateStage: 'idle',
    license: null,
    redeemMessage: '',
    redeemError: '',
    feedbackNotice: '',
    feedbackSent: false,
    feedbackError: '',
    feedbackImageBase64: null,
    feedbackImageFormat: null,
    feedbackMessage: '',
    feedbackContact: '',
    feedbackSendResult: '',
    isSendingFeedback: false,
    isEditingChatSender: false,
    confirmResetPending: false,
    showEmojiPicker: false,
    updateBackoffCount: 0,
    deviceFilesExpanded: {},
    settingsAdvancedOpen: false,
    settingsDevOpen: false,
    tempRedeemCode: '',
    isActivating: false,
    pendingSwitchMode: null,
};
