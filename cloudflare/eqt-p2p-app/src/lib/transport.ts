import type { JoinRoomResponse, SignalMessage, ModeType, ModeDetectCallback } from './types';

export type PhaseCallback = (step: number, total: number, msg: string, isError?: boolean) => void;
export type StatusCallback = (msg: string, color?: string) => void;
export type MetaCallback = (name: string, size: number) => void;
export type ProgressCallback = (doneBytes: number, totalBytes: number) => void;
export type CompleteCallback = (blob: Blob, name: string) => void;

export class EQTTransport {
    private clientToken: string;
    private signalHost: string;
    private roomId: string;
    private pc: RTCPeerConnection | null = null;
    private channel: RTCDataChannel | null = null;
    private remoteDataChannel: RTCDataChannel | null = null;
    private lastSignalId: number = 0;
    private pollInterval: any = null;
    private candidateBuffer: RTCIceCandidateInit[] = [];
    private receivedChunks: ArrayBuffer[] = [];
    private receivedSize: number = 0;
    private expectedSize: number = 0;
    private fileName: string = 'downloaded_file';

    public activeMode: ModeType = 'UNKNOWN';
    public onModeDetect: ModeDetectCallback | null = null;

    public onPhase: PhaseCallback | null = null;
    public onStatus: StatusCallback | null = null;
    public onMeta: MetaCallback | null = null;
    public onProgress: ProgressCallback | null = null;
    public onComplete: CompleteCallback | null = null;

    constructor(roomId: string) {
        this.clientToken = '';
        this.signalHost = 'https://signal.eqt.net.im';
        this.roomId = roomId;
    }

    public async initReceiver(): Promise<void> {
        if (this.onPhase) this.onPhase(1, 5, '正在加入公网信令房间...');

        try {
            const joinResp = await fetch(`${this.signalHost}/api/v1/p2p/room/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_id: this.roomId })
            });

            const joinResult: JoinRoomResponse = await joinResp.json();
            if (joinResult.code !== 200 || !joinResult.data) {
                throw new Error(joinResult.error || joinResult.message || '加入房间失败');
            }

            this.clientToken = joinResult.data.client_token;
            const iceServers: RTCIceServer[] = [
                { urls: 'stun:stun.miwifi.com:3478' },
                { urls: 'stun:stun.qq.com:3478' },
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'turn:103.232.92.220:3478', username: 'eqtuser', credential: 'eqtpass123456' },
                { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
            ];

            this.pc = new RTCPeerConnection({ iceServers });

            if (this.onPhase) this.onPhase(2, 5, '配置 ICE 穿透节点与加密通道...');

            const self = this;
            this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
                if (event.candidate) {
                    self.pushSignal('candidate', JSON.stringify(event.candidate));
                }
            };

            this.channel = this.pc.createDataChannel('eqt-p2p-data');
            this.channel.binaryType = 'arraybuffer';

            const triggerOpen = () => {
                if (self.onPhase) self.onPhase(5, 5, '物理通道贯通，元数据同步成功！');
                if (self.onStatus) self.onStatus('⚡ P2P 直连通道建立成功！', '#059669');
            };

            this.channel.onopen = triggerOpen;
            if (this.channel.readyState === 'open') triggerOpen();

            this.channel.onmessage = (e: MessageEvent) => this.handleDataChunk(e);

            this.pc.oniceconnectionstatechange = () => {
                const state = self.pc ? self.pc.iceConnectionState : '';
                if (state === 'connected' || state === 'completed') {
                    triggerOpen();
                }
            };

            this.pc.ondatachannel = (event: RTCDataChannelEvent) => {
                self.remoteDataChannel = event.channel;
                self.remoteDataChannel.binaryType = 'arraybuffer';
                self.remoteDataChannel.onmessage = (e: MessageEvent) => self.handleDataChunk(e);
                self.remoteDataChannel.onopen = triggerOpen;
                if (self.remoteDataChannel.readyState === 'open') triggerOpen();
            };

            const offer = await this.pc.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false
            });
            await this.pc.setLocalDescription(offer);

            await new Promise<void>((resolve) => {
                if (self.pc && self.pc.iceGatheringState === 'complete') {
                    resolve();
                } else if (self.pc) {
                    const checkState = () => {
                        if (self.pc && self.pc.iceGatheringState === 'complete') {
                            self.pc.removeEventListener('icegatheringstatechange', checkState);
                            resolve();
                        }
                    };
                    self.pc.addEventListener('icegatheringstatechange', checkState);
                    setTimeout(resolve, 1500);
                } else {
                    resolve();
                }
            });

            const fullSdp = (this.pc.localDescription && this.pc.localDescription.sdp) ? this.pc.localDescription.sdp : offer.sdp;

            if (this.onPhase) this.onPhase(3, 5, '已发送握手请求，等待电脑端响应...');
            await this.pushSignal('offer', { type: 'offer', sdp: fullSdp });

            if (this.onPhase) this.onPhase(4, 5, '正在与电脑端建立打洞连通...');
            if (this.onStatus) this.onStatus('📡 等待电脑端响应...', '#d97706');

            this.startPolling();
        } catch (err: any) {
            if (this.onPhase) this.onPhase(1, 5, '通道建立失败', true);
            if (this.onStatus) this.onStatus('❌ 通道异常: ' + (err.message || err), '#dc2626');
        }
    }

    public activeChannelType: string = 'Unknown';
    private lastLogTime: number = 0;
    private lastLogBytes: number = 0;

    private handleDataChunk(e: MessageEvent): void {
        if (this.activeMode !== 'UDP-DIRECT') {
            this.activeMode = 'UDP-DIRECT';
            console.log('[P2P Mode Detection] 确凿检测到 WebRTC DataChannel 原生 UDP 直连通道！');
            if (this.onModeDetect) this.onModeDetect('UDP-DIRECT', '⚡ P2P 原生 UDP 直连 (物理开通)');
        }
        if (typeof e.data === 'string') {
            try {
                const meta = JSON.parse(e.data);
                if (meta.type === 'meta') {
                    this.fileName = meta.name || this.fileName;
                    this.expectedSize = meta.size || 0;
                    if (this.onMeta) this.onMeta(this.fileName, this.expectedSize);
                }
            } catch (err) {}
        } else {
            let buffer: ArrayBuffer | null = null;
            if (e.data instanceof ArrayBuffer) {
                buffer = e.data;
            } else if (e.data instanceof Blob) {
                e.data.arrayBuffer().then((buf: ArrayBuffer) => {
                    this.processBuffer(buf);
                });
                return;
            }
            if (buffer) {
                this.processBuffer(buffer);
            }
        }
    }

    private processBuffer(buf: ArrayBuffer): void {
        if (!buf) return;
        this.receivedChunks.push(buf);
        this.receivedSize += buf.byteLength;

        const now = Date.now();
        if (now - this.lastLogTime >= 500) {
            const timeDiff = (now - this.lastLogTime) / 1000;
            const bytesDiff = this.receivedSize - this.lastLogBytes;
            const speedMBs = timeDiff > 0 ? ((bytesDiff / (1024 * 1024)) / timeDiff).toFixed(2) : '0.00';
            const doneMB = (this.receivedSize / (1024 * 1024)).toFixed(2);
            const totalMB = (this.expectedSize / (1024 * 1024)).toFixed(2);
            const percent = this.expectedSize > 0 ? Math.round((this.receivedSize / this.expectedSize) * 100) : 0;

            console.log(`[P2P Receiver SpeedTrace] ${doneMB} MB / ${totalMB} MB (${percent}%) | Mode: ${this.activeChannelType} | Speed: ${speedMBs} MB/s`);
            this.lastLogTime = now;
            this.lastLogBytes = this.receivedSize;
        }

        if (this.onProgress) this.onProgress(this.receivedSize, this.expectedSize);
        if (this.receivedSize >= this.expectedSize && this.expectedSize > 0) {
            const blob = new Blob(this.receivedChunks);
            console.log(`[P2P Receiver SpeedTrace] Transfer completed successfully! Total size: ${this.receivedSize} bytes.`);
            if (this.onComplete) this.onComplete(blob, this.fileName);
        }
    }

    public requestDownload(): void {
        this.receivedChunks = [];
        this.receivedSize = 0;
        const reqMsg = JSON.stringify({ type: 'request_download', action: 'request_download' });
        if (this.channel && this.channel.readyState === 'open') {
            try { this.channel.send(reqMsg); } catch (e) {}
        }
        if (this.remoteDataChannel && this.remoteDataChannel.readyState === 'open') {
            try { this.remoteDataChannel.send(reqMsg); } catch (e) {}
        }
        this.pushSignal('request_download', reqMsg);
    }

    public async pushSignal(type: string, payload: any): Promise<void> {
        if (!this.clientToken) return;
        try {
            await fetch(`${this.signalHost}/api/v1/p2p/signal/push`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Room-Token': this.clientToken
                },
                body: JSON.stringify({
                    room_id: this.roomId,
                    type: type,
                    payload: typeof payload === 'string' ? payload : JSON.stringify(payload)
                })
            });
        } catch (err) {}
    }

    private startPolling(): void {
        if (this.pollInterval) clearInterval(this.pollInterval);
        const self = this;
        this.pollInterval = setInterval(async () => {
            if (!self.clientToken || !self.roomId) return;
            try {
                const url = `${self.signalHost}/api/v1/p2p/signal/poll?room_id=${encodeURIComponent(self.roomId)}&since=${self.lastSignalId}`;
                const resp = await fetch(url, {
                    headers: { 'X-Room-Token': self.clientToken }
                });
                const res = await resp.json();
                if (res.code === 200 && res.data && res.data.signals) {
                    for (const item of res.data.signals as SignalMessage[]) {
                        self.lastSignalId = Math.max(self.lastSignalId, item.id);
                        await self.handleRemoteSignal(item);
                    }
                }
            } catch (err) {}
        }, 1000);
    }

    private async handleRemoteSignal(item: SignalMessage): Promise<void> {
        if (!this.pc) return;
        try {
            let raw: any = item.payload;
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch (e) {}
            }
            let sdpText: string = typeof raw === 'string' ? raw : (raw && raw.sdp ? raw.sdp : '');

            if (sdpText && (item.type === 'answer' || item.type === 'candidate' || item.type === 'offer' || (raw && raw.type === 'answer'))) {
                if (this.pc.signalingState === 'have-local-offer') {
                    console.log('[P2P Client] Setting remote answer SDP...');
                    await this.pc.setRemoteDescription(new RTCSessionDescription({
                        type: 'answer',
                        sdp: sdpText
                    }));
                    if (this.onPhase) this.onPhase(4, 5, '正在与电脑端建立打洞连通...');

                    if (this.candidateBuffer && this.candidateBuffer.length > 0) {
                        for (const candItem of this.candidateBuffer) {
                            try {
                                await this.pc.addIceCandidate(new RTCIceCandidate(candItem));
                            } catch (e) {}
                        }
                        this.candidateBuffer = [];
                    }
                }
            } else if (item.type === 'candidate' || (raw && raw.candidate)) {
                let candObj: any = (raw && raw.candidate) ? raw.candidate : raw;
                if (typeof candObj === 'string') {
                    try { candObj = JSON.parse(candObj); } catch (e) {}
                }
                if (typeof candObj === 'string') {
                    candObj = { candidate: candObj, sdpMid: '0', sdpMLineIndex: 0 };
                } else if (candObj && typeof candObj === 'object') {
                    candObj = {
                        candidate: candObj.candidate || '',
                        sdpMid: candObj.sdpMid !== undefined ? String(candObj.sdpMid) : '0',
                        sdpMLineIndex: candObj.sdpMLineIndex !== undefined ? Number(candObj.sdpMLineIndex) : 0
                    };
                }

                if (!this.pc.remoteDescription) {
                    if (!this.candidateBuffer) this.candidateBuffer = [];
                    this.candidateBuffer.push(candObj);
                } else {
                    try {
                        await this.pc.addIceCandidate(new RTCIceCandidate(candObj));
                    } catch (e) {}
                }
            } else if (item.type === 'meta' || (raw && raw.type === 'meta')) {
                const meta = (raw && raw.type === 'meta') ? raw : (typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload);
                this.fileName = meta.name || this.fileName;
                this.expectedSize = meta.size || 0;
                if (this.onPhase) this.onPhase(5, 5, '物理通道贯通，元数据同步成功！');
                if (this.onStatus) this.onStatus('⚡ P2P 直连通道建立成功！', '#059669');
                if (this.onMeta) this.onMeta(this.fileName, this.expectedSize);
            } else if (item.type === 'payload_chunk' || (raw && raw.type === 'payload_chunk')) {
                if (this.activeMode !== 'SIGNAL-FALLBACK') {
                    this.activeMode = 'SIGNAL-FALLBACK';
                    console.log('[P2P Mode Detection] 确凿检测到信令管道轮询兜底中转！');
                    if (this.onModeDetect) this.onModeDetect('SIGNAL-FALLBACK', '🐌 信令中转兜底 (HTTP轮询)');
                }
                const chunkData = (raw && raw.chunk) ? raw.chunk : (typeof item.payload === 'string' ? JSON.parse(item.payload).chunk : item.payload);
                if (chunkData) {
                    try {
                        const binaryStr = atob(chunkData);
                        const len = binaryStr.length;
                        const bytes = new Uint8Array(len);
                        for (let i = 0; i < len; i++) {
                            bytes[i] = binaryStr.charCodeAt(i);
                        }
                        this.processBuffer(bytes.buffer);
                    } catch(e) {}
                }
            }
        } catch (err) {}
    }
}
