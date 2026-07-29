export type LanguageCode = 'zh' | 'en' | 'ja' | 'ko';

export type ModeType = 'UDP-DIRECT' | 'SIGNAL-FALLBACK' | 'UNKNOWN';
export type ModeDetectCallback = (mode: ModeType, label: string) => void;

export interface PhaseInfo {
    step: number;
    total: number;
    message: string;
    isError?: boolean;
}

export interface FileMeta {
    name: string;
    size: number;
}

export interface TransferProgress {
    receivedBytes: number;
    totalBytes: number;
    speedMBs: string;
    percent: number;
}

export interface SignalMessage {
    id: number;
    type: 'offer' | 'answer' | 'candidate' | 'meta' | 'payload_chunk' | 'request_download';
    payload: string | Record<string, any>;
}

export interface JoinRoomResponse {
    code: number;
    data?: {
        client_token: string;
        ice_servers?: RTCIceServer[];
    };
    error?: string;
    message?: string;
}

export interface I18nDictionary {
    header: string;
    connecting: string;
    waiting_pc: string;
    meta_received: string;
    btn_download: string;
    btn_downloading: string;
    btn_resave: string;
    success_header: string;
    success_summary: string;
    saved_file: string;
    wan_tips: string;
    downloading_status: string;
    completed_status: string;
    speed_unit: string;
}
