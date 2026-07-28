# EQT Pro v1 (公网 P2P 直传) 设计与开发总览

本目录为 **EQT Pro 付费计划 v1 (公网 P2P 通道)** 的核心技术架构设计、API 契约规范与开发进度文档汇编。

---

## 1. 第一性原理设计哲学

1. **绝对 0 中转带宽成本 (No Relay Rate Limit)**  
   Pro v1 **仅搭建 P2P 直连通道，不提供云端流量中转**。文件传输数据跑满客户端双方的公网上下行带宽，数据流 100% 零过云。
2. **轻量 Serverless 信令与物理隔离**  
   使用独立的 Cloudflare Worker（`cloudflare/eqt-p2p-signal`）承载身份鉴权与 SDP / ICE Candidate 交换。与现有 `eqt-drm-api` 彻底物理隔离，零业务耦合，且共享 Cloudflare 每日 10 万次免费请求额度。
3. **公共 STUN 免费拓扑**  
   利用全球分布式免费公共 STUN 节点（如 `stun:stun.cloudflare.com:3478` 与 `stun:stun.l.google.com:19302`）进行 NAT 反射地址探测，无物理 VPS 运行成本。
4. **端到端加密防护 (E2EE)**  
   基于 WebRTC DataChannel (DTLS-SRTP)，云端信令服务仅透传加密握手载荷，绝不出触及用户任何文件内容与明文数据。

---

## 2. 目录索引

- [架构与详细设计方案 (architecture-and-design.md)](file:///home/yelon/develop/me/eqrcp/docs/pro/architecture-and-design.md)
  - 模块交互序列图与 WebRTC 建立流程
  - Cloudflare Worker 信令服务端 API 契约
  - 独立 App 域名解耦 (`p.eqt.net.im`) 与按需动态模块化前端设计
  - 客户端 (Go/WebRTC/Wails/Web) 改造设计与打洞回退机制
  - 离线/在线 DRM 校验集成
- [STUN 打洞与 P2P 连通性真实测试报告 (stun-p2p-verification.md)](file:///home/yelon/develop/me/eqrcp/docs/pro/stun-p2p-verification.md)
  - 真实 STUN 探针与 srflx 候选地址提取结果
  - 双节点 DataChannel 纯直连传输验证
  - 信令服务器多端点自动容灾设计
- [开发进度与里程碑 (progress.md)](file:///home/yelon/develop/me/eqrcp/docs/pro/progress.md)
  - 分阶段开发 Milestone（Worker 信令、Go P2P 引擎、前端 UI）
  - Definition of Done (DoD) 与测试交付标准

---

## 3. 架构概要图

```
+-----------------------------------------------------------------------------------+
|                              Cloudflare Serverless 架构                           |
|                                                                                   |
|  +-----------------------------+                 +----------------------------+   |
|  |  eqt-p2p-signal Worker      |                 |  stun.cloudflare.com:3478   |   |
|  |  (信令交换 & D1 订阅校验)    |                 |  (公共 STUN NAT 探测)      |   |
|  +--------------+--------------+                 +-------------+--------------+   |
+-----------------|----------------------------------------------|------------------+
                  | 1. 鉴权 & 交换 SDP                            | 2. NAT 候选地址
                  v                                              v
       +--------------------+    3. WebRTC P2P 数据通道    +--------------------+
       |  客户端 A (PC 端)   |============================>|  客户端 B (移动端)  |
       +--------------------+      (传输流量 0 过云)       +--------------------+
```
