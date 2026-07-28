# EQT Pro WAN 模式 STUN / TURN P2P 打洞与 Coturn 部署权威指南

本文档全面梳理 EQT 在公网（WAN）环境下的 WebRTC P2P 穿透原理（RFC 8445 / RFC 8656）、Symmetric NAT 打洞退路机制、Go Pion 后端与前端 JS 的 ICE 配置规范，以及生产级 `coturn` 服务器的自建与运维指南。

---

## 1. 第一性原理：WebRTC 打洞与 NAT 穿透分类

在公网环境传输文件或实时通信时，网络连通性取决于两端设备所在的 **NAT（网络地址转换）类型**。

```mermaid
graph TD
    A[客户端发起 P2P 连接] --> B{路由器 NAT 类型检测}
    B -->|Full Cone / Restricted Cone| C[STUN 服务器获取公网 IP:Port]
    C --> D[双向发送 UDP 报文物理直连打通 ⚡]
    B -->|Symmetric NAT 对称型 NAT| E[STUN 获取的端口变化 / 拒绝外网入站]
    E -->|仅配置 STUN| F[❌ 打洞失败 / 挂起在 Phase 4]
    E -->|配置 TURN 服务器| G[通过 TURN Relay 服务器物理中转打通 🚀]
```

### NAT 类型及打洞可能性

| NAT 类型 | 说明 | STUN 成功率 | 解决方案 |
| :--- | :--- | :--- | :--- |
| **Full Cone (全锥型)** | 端口完全开放，允许任意外网入站 | 100% | 仅需 STUN |
| **Restricted Cone (受限锥型)** | 仅允许已访问过的外网 IP 入站 | 100% | 仅需 STUN |
| **Port Restricted (端口受限锥型)** | 仅允许已访问过的 IP:Port 入站 | 90%+ | 交换 Candidate 后 UDP 互打 |
| **Symmetric NAT (对称型 NAT)** | 访问不同目标时动态映射全新公网端口 | **0%** | **必须使用 TURN 中转 (Relay)** |

> [!IMPORTANT]
> 移动运营商 4G/5G 蜂窝网络、公司企业内网防火墙以及部分家用路由器最常见的是 **Symmetric NAT**。在此类网络下，单纯依赖免费 STUN 100% 无法建立直连，必须提供带鉴权的 TURN 服务器作为流量中转保底。

---

## 2. Pion WebRTC (Go) & 前端 JS 的 ICE/TURN 配置规范

### 2.1 后端 Go (Pion WebRTC) 接入规范

在 `pkg/server/p2p/engine.go` 中，建立 `PeerConnection` 时必须注入包含 STUN 与 TURN 鉴权的 `ICEServer` 列表：

```go
package p2p

import (
	"github.com/pion/webrtc/v3"
)

func NewEngineWithTURN(stunServers []string, turnURL, turnUser, turnPass string) (*Engine, error) {
	iceServers := []webrtc.ICEServer{
		// 1. 公共 STUN 服务器
		{
			URLs: []string{
				"stun:stun.cloudflare.com:3478",
				"stun:stun.l.google.com:19302",
				"stun:stun.miwifi.com:3478",
			},
		},
	}

	// 2. TURN 服务器配置
	if turnURL != "" {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs: []string{
				turnURL + "?transport=udp",
				turnURL + "?transport=tcp",
			},
			Username:       turnUser,
			Credential:     turnPass,
			CredentialType: webrtc.ICECredentialTypePassword,
		})
	}

	config := webrtc.Configuration{
		ICEServers: iceServers,
	}

	// 初始化 Pion API 与 PeerConnection...
	return nil, nil
}
```

### 2.2 前端 JavaScript (`transport.js`) 接入规范

在客户端建立 `RTCPeerConnection` 时同步注入 TURN credentials：

```javascript
class EQTTransport {
    constructor(clientToken, options = {}) {
        this.clientToken = clientToken;
        const defaultIceServers = [
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.l.google.com:19302' }
        ];

        if (options.turnUrl) {
            defaultIceServers.push({
                urls: options.turnUrl,
                username: options.turnUsername || '',
                credential: options.turnPassword || ''
            });
        }

        this.pc = new RTCPeerConnection({
            iceServers: defaultIceServers
        });
    }
}
```

---

## 3. 开源 coturn 服务器自建与运维指南

`coturn` 是目前全球最成熟、遵循 RFC 8656 标准的开源 STUN/TURN 服务器。

### 3.1 环境准备
- 带固定公网 IP 的 VPS（例如 Ubuntu 22.04 / Debian 12）
- 开放 UDP/TCP 端口：`3478` (STUN/TURN), `5349` (TURNS TLS), `49152-65535` (UDP 媒体中转范围)

### 3.2 安装 coturn
```bash
sudo apt-get update
sudo apt-get install -y coturn
```

### 3.3 生产级配置文件 (`/etc/turnserver.conf`)

创建或修改 `/etc/turnserver.conf`：

```ini
# ==========================================
# EQT Production Coturn Configuration
# ==========================================

# 1. 监听端口与网卡
listening-port=3478
tls-listening-port=5349
listening-device=eth0
external-ip=YOUR_PUBLIC_SERVER_IP

# 2. UDP / TCP 转发动态端口范围
min-port=49152
max-port=65535

# 3. 域名 Realm 与安全鉴权机制
realm=eqt.net.im
fingerprint
lt-cred-mech

# 静态用户名与密码 (格式 user=username:password)
user=eqt_user:eqt_password_secure_123

# 4. 调试日志与资源安全约束
stale-nonce=600
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1

# 日志输出配置
log-file=/var/log/turnserver/turn.log
simple-log
```

### 3.4 启动与开机自启
```bash
# 允许系统服务启动
sudo sed -i 's/TURNSERVER_ENABLED=0/TURNSERVER_ENABLED=1/g' /etc/default/coturn

# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable coturn
sudo systemctl restart coturn

# 检查服务运行状态
sudo systemctl status coturn
```

---

## 4. 免费与低成本 TURN 服务方案对比

| 方案类型 | 代表产品 / 服务 | 优点 | 缺点 | 推荐度 |
| :--- | :--- | :--- | :--- | :--- |
| **自建 Coturn** | 云 VPS 自建 | 独享千兆/百流带宽，100% 隐私掌控，无并发限制 | 需自备带公网 IP 的 VPS | ⭐⭐⭐⭐⭐ (生产首选) |
| **Cloudflare Real-Time** | Cloudflare Calls / TURN | 全球边缘节点加速，网络延时极低 | 需 API 密钥集成 | ⭐⭐⭐⭐ |
| **Metered / OpenRelay** | Metered.ca (免费 50GB/月) | 免运维，开箱即用，每月 50GB 免费流量 | 依赖第三方免费额度 | ⭐⭐⭐ |

---

## 5. 常见问题排查 (Troubleshooting)

1. **终端显示 `Candidate pair failed`**：
   - 检查 VPS 防火墙（Security Group）是否开启了 UDP `49152-65535` 端口范围；
   - 确认 `/etc/turnserver.conf` 中的 `external-ip` 填写的为 VPS 的真实外网 IPv4。

2. **客户端报 `TURN auth failed`**：
   - 检查 `user=username:password` 格式是否规范，`realm` 域名是否匹配。
