// EQT Unified WebRTC P2P Transport Adapter
window.EQTTransport = class EQTTransport {
    constructor(token, signalHost = 'https://signal.eqt.net.im') {
        this.token = token;
        this.signalHost = signalHost;
        this.pc = null;
        this.channel = null;
        this.onStatus = null;
        this.onMeta = null;
        this.onProgress = null;
        this.onComplete = null;
    }

    initReceiver() {
        if (!this.token || !window.RTCPeerConnection) return;
        const self = this;
        this.pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                fetch(`${self.signalHost}/signal/push`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ room: self.token, sender: 'mobile', signal: { type: 'candidate', candidate: event.candidate } })
                }).catch(() => {});
            }
        };

        let receivedChunks = [];
        let expectedSize = 0;
        let receivedSize = 0;
        let fileName = 'downloaded_file';

        this.pc.ondatachannel = (event) => {
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

        this.pc.createOffer().then(offer => self.pc.setLocalDescription(offer)).then(() => {
            return fetch(`${self.signalHost}/signal/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ room: self.token, sender: 'mobile', signal: self.pc.localDescription })
            });
        }).then(() => {
            if (self.onStatus) self.onStatus('📡 等待电脑端响应...', '#d97706');
        }).catch(err => {
            if (self.onStatus) self.onStatus('❌ 通道异常: ' + err.message, '#dc2626');
        });
    }

    requestDownload() {
        if (this.channel && this.channel.readyState === 'open') {
            this.channel.send(JSON.stringify({ action: 'request_download' }));
        }
    }
};
