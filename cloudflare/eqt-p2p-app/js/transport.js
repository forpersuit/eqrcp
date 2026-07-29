// EQT Unified WebRTC P2P Transport Adapter
window.EQTTransport = class EQTTransport {
    constructor(roomId, signalHost = 'https://signal.eqt.net.im') {
        this.roomId = roomId;
        this.signalHost = signalHost;
        this.clientToken = '';
        this.pc = null;
        this.channel = null;
        this.lastSignalId = 0;
        this.candidateBuffer = [];
        this.receivedChunks = [];
        this.expectedSize = 0;
        this.receivedSize = 0;
        this.fileName = 'downloaded_file';
        this.pollInterval = null;
        this.onStatus = null;
        this.onPhase = null; // New: 5-step phase lifecycle callback (step, total, msg, isError)
        this.onMeta = null;
        this.onProgress = null;
        this.onComplete = null;
    }

    async initReceiver() {
        if (!this.roomId || !window.RTCPeerConnection) return;
        const self = this;

        if (self.onPhase) self.onPhase(1, 5, '正在加入公网信令房间...');
        if (self.onStatus) self.onStatus('📡 正在加入公网 P2P 房间...', '#d97706');

        try {
            // 1. Join room via /api/v1/p2p/room/join
            const joinResp = await fetch(`${self.signalHost}/api/v1/p2p/room/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room_id: self.roomId })
            });

            const joinResult = await joinResp.json();
            if (joinResult.code !== 200 || !joinResult.data) {
                throw new Error(joinResult.error || joinResult.message || '加入房间失败');
            }

            self.clientToken = joinResult.data.client_token;
            const iceServers = joinResult.data.ice_servers || [{ urls: 'stun:stun.l.google.com:19302' }];

            // 2. Initialize PeerConnection
            if (self.onPhase) self.onPhase(2, 5, '正在生成加密 P2P 握手协议...');
            self.pc = new RTCPeerConnection({ iceServers });

            self.pc.onicecandidate = (event) => {
                if (event.candidate) {
                    self.pushSignal('candidate', JSON.stringify(event.candidate));
                }
            };

            let receivedChunks = [];
            let expectedSize = 0;
            let receivedSize = 0;
            let fileName = 'downloaded_file';

            // Create DataChannel before createOffer so Offer SDP contains application m-line & ice-ufrag
            self.channel = self.pc.createDataChannel('eqt-p2p-data');
            self.channel.binaryType = 'arraybuffer';
            
            const triggerOpen = () => {
                if (self.onPhase) self.onPhase(5, 5, '通道打通，正在同步元数据...');
                if (self.onStatus) self.onStatus('⚡ P2P 直连通道建立成功！', '#059669');
            };

            self.channel.onopen = triggerOpen;
            if (self.channel.readyState === 'open') triggerOpen();

            self.handleMessage = (e) => {
                if (typeof e.data === 'string') {
                    try {
                        const meta = JSON.parse(e.data);
                        if (meta.type === 'meta') {
                            self.fileName = meta.name || self.fileName;
                            self.expectedSize = meta.size || 0;
                            if (self.onMeta) self.onMeta(self.fileName, self.expectedSize);
                        }
                    } catch(err) {}
                } else {
                    if (e.data instanceof ArrayBuffer) {
                        self.receivedChunks.push(e.data);
                        self.receivedSize += e.data.byteLength;
                        if (self.onProgress) self.onProgress(self.receivedSize, self.expectedSize);
                        if (self.receivedSize >= self.expectedSize && self.expectedSize > 0) {
                            const blob = new Blob(self.receivedChunks);
                            if (self.onComplete) self.onComplete(blob, self.fileName);
                        }
                    } else if (e.data instanceof Blob) {
                        e.data.arrayBuffer().then(buf => {
                            self.receivedChunks.push(buf);
                            self.receivedSize += buf.byteLength;
                            if (self.onProgress) self.onProgress(self.receivedSize, self.expectedSize);
                            if (self.receivedSize >= self.expectedSize && self.expectedSize > 0) {
                                const blob = new Blob(self.receivedChunks);
                                if (self.onComplete) self.onComplete(blob, self.fileName);
                            }
                        });
                    }
                }
            };

            self.channel.onmessage = (e) => self.handleMessage(e);

            self.pc.oniceconnectionstatechange = () => {
                const state = self.pc ? self.pc.iceConnectionState : '';
                if (state === 'connected' || state === 'completed') {
                    triggerOpen();
                }
            };

            self.pc.ondatachannel = (event) => {
                const remoteChannel = event.channel;
                remoteChannel.binaryType = 'arraybuffer';
                remoteChannel.onmessage = (e) => self.handleMessage(e);
                remoteChannel.onopen = triggerOpen;
                if (remoteChannel.readyState === 'open') triggerOpen();
            };

            // 3. Create WebRTC Offer with explicit options to force m=application & ICE generation
            const offer = await self.pc.createOffer({
                offerToReceiveAudio: false,
                offerToReceiveVideo: false
            });
            await self.pc.setLocalDescription(offer);

            // Ensure complete SDP with ice-ufrag, ice-pwd, and candidates is gathered
            await new Promise((resolve) => {
                if (self.pc.iceGatheringState === 'complete') {
                    resolve();
                } else {
                    const checkState = () => {
                        if (self.pc.iceGatheringState === 'complete') {
                            self.pc.removeEventListener('icegatheringstatechange', checkState);
                            resolve();
                        }
                    };
                    self.pc.addEventListener('icegatheringstatechange', checkState);
                    setTimeout(resolve, 1500);
                }
            });
            
            const fullSdp = (self.pc.localDescription && self.pc.localDescription.sdp) ? self.pc.localDescription.sdp : offer.sdp;

            if (self.onPhase) self.onPhase(3, 5, '已发送握手请求，等待电脑端响应...');
            await self.pushSignal('offer', { type: 'offer', sdp: fullSdp });

            if (self.onPhase) self.onPhase(4, 5, '正在与电脑端建立打洞连通...');
            if (self.onStatus) self.onStatus('📡 等待电脑端响应...', '#d97706');

            // 4. Start polling for remote Answer & ICE Candidates
            self.startPolling();
        } catch (err) {
            if (self.onPhase) self.onPhase(1, 5, '通道建立失败', true);
            if (self.onStatus) self.onStatus('❌ 通道异常: ' + err.message, '#dc2626');
        }
    }

    requestDownload() {
        const reqMsg = JSON.stringify({ type: 'request_download' });
        if (this.channel && this.channel.readyState === 'open') {
            try { this.channel.send(reqMsg); } catch(e) {}
        }
        this.pushSignal('request_download', reqMsg);
    }


    async pushSignal(type, payload) {
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

    startPolling() {
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
                    for (const item of res.data.signals) {
                        self.lastSignalId = Math.max(self.lastSignalId, item.id);
                        await self.handleRemoteSignal(item);
                    }
                }
            } catch (err) {}
        }, 1000);
    }

    async handleRemoteSignal(item) {
        if (!this.pc) return;
        try {
            let raw = item.payload;
            if (typeof raw === 'string') {
                try { raw = JSON.parse(raw); } catch(e) {}
            }
            let sdpText = typeof raw === 'string' ? raw : (raw && raw.sdp ? raw.sdp : '');
            if (sdpText && (item.type === 'answer' || item.type === 'host' || item.type === 'sdp' || (raw && raw.type === 'answer'))) {
                if (this.pc.signalingState === 'have-local-offer') {
                    console.log('[P2P Client] Setting remote answer SDP...');
                    await this.pc.setRemoteDescription(new RTCSessionDescription({
                        type: 'answer',
                        sdp: sdpText
                    }));
                    if (this.onPhase) this.onPhase(4, 5, '正在与电脑端建立打洞连通...');

                    // Flush buffered remote ICE candidates collected before Answer
                    if (this.candidateBuffer && this.candidateBuffer.length > 0) {
                        console.log(`[P2P Client] Flushing ${this.candidateBuffer.length} buffered ICE candidates...`);
                        for (const candItem of this.candidateBuffer) {
                            try {
                                await this.pc.addIceCandidate(new RTCIceCandidate(candItem));
                            } catch(e) {
                                console.warn('[P2P Client] Error adding buffered candidate:', e);
                            }
                        }
                        this.candidateBuffer = [];
                    }
                }
            } else if (item.type === 'candidate' || (raw && raw.candidate)) {
                let candObj = (raw && raw.candidate) ? raw.candidate : raw;
                if (typeof candObj === 'string') {
                    try { candObj = JSON.parse(candObj); } catch(e) {}
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
                    console.log('[P2P Client] Buffering candidate received before Answer...');
                    if (!this.candidateBuffer) this.candidateBuffer = [];
                    this.candidateBuffer.push(candObj);
                } else {
                    try {
                        await this.pc.addIceCandidate(new RTCIceCandidate(candObj));
                    } catch(e) {
                        console.warn('[P2P Client] Error adding ICE candidate:', e);
                    }
                }
            } else if (item.type === 'meta' || (raw && raw.type === 'meta')) {
                const meta = (raw && raw.type === 'meta') ? raw : (typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload);
                this.fileName = meta.name || this.fileName;
                this.expectedSize = meta.size || 0;
                if (this.onPhase) this.onPhase(5, 5, '物理通道贯通，元数据同步成功！');
                if (this.onStatus) this.onStatus('⚡ P2P 直连通道建立成功！', '#059669');
                if (this.onMeta) this.onMeta(this.fileName, this.expectedSize);
            } else if (item.type === 'payload_chunk' || (raw && raw.type === 'payload_chunk')) {
                const chunkData = (raw && raw.chunk) ? raw.chunk : (typeof item.payload === 'string' ? JSON.parse(item.payload).chunk : item.payload);
                if (chunkData) {
                    const binaryStr = atob(chunkData);
                    const len = binaryStr.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) {
                        bytes[i] = binaryStr.charCodeAt(i);
                    }
                    this.receivedChunks.push(bytes.buffer);
                    this.receivedSize += bytes.byteLength;
                    if (this.onProgress) this.onProgress(this.receivedSize, this.expectedSize);
                    if (this.receivedSize >= this.expectedSize && this.expectedSize > 0) {
                        const blob = new Blob(this.receivedChunks);
                        if (this.onComplete) this.onComplete(blob, this.fileName);
                    }
                }
            }
        } catch (err) {
            console.error('[P2P Client] Error handling remote signal:', err);
        }
    }


    requestDownload() {
        this.receivedChunks = [];
        this.receivedSize = 0;
        const reqMsg = JSON.stringify({ type: 'request_download', action: 'request_download' });
        if (this.channel && this.channel.readyState === 'open') {
            try { this.channel.send(reqMsg); } catch(e) {}
        }
        this.pushSignal('request_download', reqMsg);
    }
};
