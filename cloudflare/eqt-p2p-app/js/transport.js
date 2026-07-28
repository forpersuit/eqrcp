// EQT Unified WebRTC P2P Transport Adapter
window.EQTTransport = class EQTTransport {
    constructor(roomId, signalHost = 'https://signal.eqt.net.im') {
        this.roomId = roomId;
        this.signalHost = signalHost;
        this.clientToken = '';
        this.pc = null;
        this.channel = null;
        this.lastSignalId = 0;
        this.pollInterval = null;
        this.onStatus = null;
        this.onMeta = null;
        this.onProgress = null;
        this.onComplete = null;
    }

    async initReceiver() {
        if (!this.roomId || !window.RTCPeerConnection) return;
        const self = this;

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

            self.pc.ondatachannel = (event) => {
                self.channel = event.channel;
                self.channel.onopen = () => {
                    if (self.onStatus) self.onStatus('⚡ P2P 直连通道建立成功！', '#059669');
                };

                self.channel.onmessage = (e) => {
                    if (typeof e.data === 'string') {
                        try {
                            const meta = JSON.parse(e.data);
                            if (meta.type === 'meta') {
                                fileName = meta.name || fileName;
                                expectedSize = meta.size || 0;
                                if (self.onMeta) self.onMeta(fileName, expectedSize);
                            }
                        } catch(err) {}
                    } else if (e.data instanceof ArrayBuffer) {
                        receivedChunks.push(e.data);
                        receivedSize += e.data.byteLength;
                        if (self.onProgress) self.onProgress(receivedSize, expectedSize);
                        
                        if (receivedSize >= expectedSize && expectedSize > 0) {
                            const blob = new Blob(receivedChunks);
                            if (self.onComplete) self.onComplete(blob, fileName);
                        }
                    }
                };
            };

            // 3. Create WebRTC Offer and push signal
            const offer = await self.pc.createOffer();
            await self.pc.setLocalDescription(offer);
            await self.pushSignal('sdp', JSON.stringify(self.pc.localDescription));

            if (self.onStatus) self.onStatus('📡 等待电脑端响应...', '#d97706');

            // 4. Start polling for remote Answer & ICE Candidates
            self.startPolling();
        } catch (err) {
            if (self.onStatus) self.onStatus('❌ 通道异常: ' + err.message, '#dc2626');
        }
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
                    payload: payload
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
            const raw = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
            if (item.type === 'sdp' || raw.type === 'answer' || raw.type === 'offer') {
                if (this.pc.signalingState !== 'stable') {
                    await this.pc.setRemoteDescription(new RTCSessionDescription(raw));
                }
            } else if (item.type === 'candidate' || raw.candidate) {
                const cand = raw.candidate || raw;
                await this.pc.addIceCandidate(new RTCIceCandidate(cand));
            }
        } catch (err) {}
    }

    requestDownload() {
        if (this.channel && this.channel.readyState === 'open') {
            this.channel.send(JSON.stringify({ action: 'request_download' }));
        }
    }
};
