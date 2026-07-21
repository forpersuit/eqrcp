export interface DesktopSettings {
    lang?: string;
    port?: number;
    autoStop?: boolean;
    qrPort?: number;
    chatHistorySavePath?: string;
    autoUpdateMode?: 'notify' | 'download' | 'silent' | 'off';
    lastUpdateCheckTime?: number;
    closeBehavior?: 'tray' | 'exit' | 'ask';
    [key: string]: unknown;
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
    [key: string]: unknown;
}

export interface AgentStatusData {
    state?: string;
    current?: Record<string, unknown>;
    chat?: Record<string, unknown>;
    clients?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface AppState {
    mode: 'share' | 'receive' | 'chat';
    sharePaths: string[];
    shareLimitNotice: string;
    receiveDir: string;
    chatSaveDir: string;
    status: AgentStatusData | null;
    settings: DesktopSettings | null;
    rightClickIntegration: IntegrationStatus | null;
    startupIntegration: IntegrationStatus | null;
    appInfo: Record<string, unknown> | null;
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
    updateCheckRes: Record<string, unknown> | null;
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
};
