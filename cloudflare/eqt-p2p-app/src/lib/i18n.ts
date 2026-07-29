import type { LanguageCode, I18nDictionary } from './types';

export const translations: Record<LanguageCode, I18nDictionary> = {
    zh: {
        header: '文件已准备就绪',
        connecting: '📡 正在打通公网信令与加密 P2P 通道...',
        waiting_pc: '⏳ 等待 P2P 物理连接...',
        meta_received: '⚡ 公网 P2P 通道打通，文件已就绪！',
        btn_download: '开始极速下载',
        btn_downloading: '⏳ 正在物理传输中...',
        btn_resave: '🎉 重新保存文件',
        success_header: '✅ 传输成功',
        success_summary: '文件已成功接收并保存至您的设备！',
        saved_file: '待接收文件',
        wan_tips: '公网 WAN P2P 直连',
        downloading_status: '正在接收数据流...',
        completed_status: '物理传输已完成',
        speed_unit: 'MB/s'
    },
    en: {
        header: 'File Ready for Download',
        connecting: '📡 Establishing WAN Signaling & Encrypted P2P Channel...',
        waiting_pc: '⏳ Waiting for P2P Connection...',
        meta_received: '⚡ P2P Channel Ready! File is ready to download.',
        btn_download: 'Start Download',
        btn_downloading: '⏳ Downloading Payload...',
        btn_resave: '🎉 Save File Again',
        success_header: '✅ Transfer Completed',
        success_summary: 'File received and saved successfully!',
        saved_file: 'File to Receive',
        wan_tips: 'WAN P2P Direct Connection',
        downloading_status: 'Receiving Data Stream...',
        completed_status: 'Transfer Completed',
        speed_unit: 'MB/s'
    },
    ja: {
        header: 'ダウンロードの受取準備完了',
        connecting: '📡 接続確立中...',
        waiting_pc: '⏳ 接続待機中...',
        meta_received: '⚡ 共有完了！ダウンロード可能です。',
        btn_download: '高速ダウンロード開始',
        btn_downloading: '⏳ 受信中...',
        btn_resave: '🎉 再保存',
        success_header: '✅ 転送完了',
        success_summary: '正常に保存されました。',
        saved_file: '受信ファイル',
        wan_tips: 'WAN P2P 直速連系',
        downloading_status: 'データストリーム受信中...',
        completed_status: '転送完了',
        speed_unit: 'MB/s'
    },
    ko: {
        header: '다운로드 준비 완료',
        connecting: '📡 연결 중...',
        waiting_pc: '⏳ 대기 중...',
        meta_received: '⚡ 공유 완료! 다운로드 가능합니다.',
        btn_download: '초고속 다운로드 시작',
        btn_downloading: '⏳ 데이터 수신 중...',
        btn_resave: '🎉 다시 저장',
        success_header: '✅ 전송 완료',
        success_summary: '성공적으로 저장되었습니다.',
        saved_file: '수신 파일',
        wan_tips: 'WAN P2P 직련',
        downloading_status: '데이터 스트림 수신 중...',
        completed_status: '전송 완료',
        speed_unit: 'MB/s'
    }
};

export function formatBytes(bytes: number): string {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
