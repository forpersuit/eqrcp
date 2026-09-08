# 传输状态投影架构设计 (Transfer Status Projection Architecture)

> **文档状态**：Roadmap 级长期架构规划（Future Design）  
> **归档日期**：2026-09-08  
> **关联审计**：`docs/bugs/2026-09-08-share-progress-regression-and-transfer-audit.md`

---

## 一、 背景与结构债诊断 (Problem Statement)

随着 EQT 业务场景的演进，系统内陆续支持了 **Share（分发下载）**、**Receive（上传接收）**、**Chat（即时通讯与附件）** 三种传输模式。在历次业务交付中，代码遵循各自场景按需扩展，形成了当前 `pkg/server/server.go` 的底层实现架构：

1. **10 把互斥锁共存**：
   - `statusMu`（全局单例状态）
   - `downloadedItemsMu` / `downloadedBytesMu`（Share 计数）
   - `clientMutex` / `clientStatesMu`（客户端会话状态与单项进度）
   - `expectedBytesMu`（预计总字节数）
   - `tusMu`（Tus 断点续传全局进度）
   - `clientSpeedTrackersMu`（客户端速率计算）
   - `clientSubDirsMu`（接收子目录隔离）
   - `lastHookTimeMu`（事件钩子节流）
2. **6 套并行记账模型**：
   - `transferStatus` 全局单例
   - `clientStates` 每设备会话状态
   - `clientProgress` 单项细粒度字节表
   - `downloadedItems / downloadedBytes` 总体完成量
   - `tusUploadsDone / tusUploadsTotal` Tus 分块完成量
   - `ChatStatusSnapshot` 独立消息与设备状态集

### 结构债代价
- **三级体验撕裂**：Share 模式支持逐块微秒级统计与 Range 切片；Receive 模式长期存在 Multipart 回退流式黑洞；Chat 模式大附件传输在桌面 GUI 呈全局盲区。
- **并发脆弱性**：状态模型相互独立，不同路径容易在锁的调用次序上产生交叠与竞态风险，导致维护成本与回归风险随着模式增加呈指数上升。

---

## 二、 核心架构思想：底层轻量物理隔离 + 输出层投影模式

针对上述结构债，若盲目推倒重来搞“大一统重构”（用一个全局大结构体与单一大互斥锁统管全部），将违背高并发网络服务的第一性原理，带来致命的锁竞争与性能暴跌。

本架构采用 **CQRS（读写分离）** 思想与 **Projection Pattern（状态投影模式）**：

```
                     ┌──────────────────────────────────────────────────────────┐
                     │              外部观测层 (Read / Cold Path)               │
                     │   Desktop GUI / Web Admin / REST /status / SSE Telemetry │
                     └────────────────────────────┬─────────────────────────────┘
                                                  │ 统一只读快照 (只读无锁/无副作用)
                                                  ▼
                     ┌──────────────────────────────────────────────────────────┐
                     │              统一快照投影层 (Projection Layer)           │
                     │          ToSnapshot() -> TransferStatusSnapshot          │
                     └──────▲─────────────────────▲──────────────────────▲──────┘
                            │                     │                      │
       单向状态映射         │                     │                      │
  (Read-Only Projection)    │                     │                      │
             ┌──────────────┴──────┐    ┌─────────┴──────────┐   ┌───────┴──────────────┐
             │      Share 领域     │    │    Receive 领域    │   │      Chat 领域       │
             ├─────────────────────┤    ├────────────────────┤   ├──────────────────────┤
【写路径     │ - Range Reader 流   │    │ - Tus Chunk 服务   │   │ - WebSocket 消息总线 │
  Hot Path】 │ - clientActiveItem  │    │ - FilesDeclared 门禁│  │ - 消息/设备路由      │
             │ - 原子字节累加器    │    │ - Multipart 流统计 │   │ - 子资源附件传输表   │
             └─────────────────────┘    └────────────────────┘   └──────────────────────┘
```

### 1. 写入路径（Hot Path / 高性能吞吐）：各通道物理轻量隔离
- **零全局锁干扰**：下载、上传、消息通道互不阻塞，维持高并发吞吐；
- **底层指标原子化**：高频流式计数器优先采用 `atomic.Int64` 或轻量局部互斥锁（如 `clientMutex`）；
- **主链路极致性能**：保证高频数据搬运过程达到 O(1) 复杂度、零内存分配。

### 2. 读取路径（Cold Path / 外部观测）：只读单向投影
- 任何外部查询（桌面 GUI 轮询、`/status` API、运维遥测）均不直接穿透访问内部业务锁或裸字典；
- 各模式作为 `TransferEngine` 的实现者，提供幂等、无副作用的 `ToSnapshot()` 投影方法，一次性产出标准化快照对象。

---

## 三、 统一快照领域契约规范 (Domain Specification)

```go
package transfer

import "time"

// Mode 传输业务模式
type Mode string

const (
    ModeShare   Mode = "share"
    ModeReceive Mode = "receive"
    ModeChat    Mode = "chat"
)

// TransferStatusSnapshot 统一定义的只读外部状态快照
type TransferStatusSnapshot struct {
    // 1. 通用宏观指标
    Mode          Mode      `json:"mode"`             // share | receive | chat
    Active        bool      `json:"active"`           // 是否处于活跃会话中
    Completed     bool      `json:"completed"`        // 批次任务是否已完成
    BytesDone     int64     `json:"bytes_done"`       // 已完成物理字节
    BytesTotal    int64     `json:"bytes_total"`      // 计划总字节 (-1 表示流式未知)
    Percent       int       `json:"percent"`          // 综合进度百分比 (0-100)
    SpeedBytesSec int64     `json:"speed_bytes_sec"`  // 瞬时吞吐速率 (bytes/s)
    Timestamp     time.Time `json:"timestamp"`

    // 2. 对端参与情况
    PeerCount int           `json:"peer_count"`
    Peers     []PeerSummary `json:"peers,omitempty"`

    // 3. 各模式特化投影 (按需非空挂载)
    Share   *ShareSnapshot   `json:"share,omitempty"`
    Receive *ReceiveSnapshot `json:"receive,omitempty"`
    Chat    *ChatSnapshot    `json:"chat,omitempty"`
}

// TransferEngine 领域服务接口
type TransferEngine interface {
    // ToSnapshot 产出瞬时只读快照，要求非阻塞、微秒级返回
    ToSnapshot() TransferStatusSnapshot
}
```

---

## 四、 实施红线与能力边界约束 (Guardrails & Boundaries)

为了避免重构引入不可控的系统性风险，本方案确立**两条刚性红线**：

> [!CAUTION]
> ### 红线 1：演进阶段性约束（Non-interference Principle）
> 本架构属于 **Roadmap 级中长期规划**，严禁在日常缺陷修复或次要需求交付中“夹带局部大改”。重构必须立项于独立特性分支，并配置 Race Detector（竞态检测）100% 覆盖的端到端并发测试矩阵。

> [!WARNING]
> ### 红线 2：投影层的能力边界认知（Projection does not invent data）
> **投影层解决的是外部视图一致性与状态语义归一，绝无法凭空变出底层缺失的物理数据。**  
> 若底层数据源未进行物理度量（例如 Multipart 读取未在循环中累加字节、或 Chat 附件未挂载计数），上层无论如何优雅投影也只能得到 `0`。**底层的物理记账补齐始终是不可逾越的前提。**

---

## 五、 阶段性演进路线图 (Implementation Roadmap)

### Phase 1：契约与只读接口抽象（Non-breaking）
- 在独立包定义 `TransferStatusSnapshot` 与 `TransferEngine` 接口；
- 建立只读序列化契约与单测基准，不触动任何正在运行的核心代码。

### Phase 2：三模式逐项投影对接（Progressive Integration）
1. **Share 模式**：将已稳定的 `clientActiveItem` 与 `clientProgress` 转换为 `ShareSnapshot` 投影；
2. **Receive 模式**：基于已落地的 `FilesDeclared` 门禁与 Multipart 流式 Reader，实现统一的 `ReceiveSnapshot` 投影；
3. **Chat 模式**：将大附件传输任务以子资源维度并入 `ChatSnapshot`；将当前的 150ms 节流锁内 O(N) 消息全表扫描重构为**增量维护哈希表（`activeTransfers map[string]ChatActiveTransfer`）**，在附件上传/下载创建时 O(1) 注册、进度时就地更新、完成时 O(1) 移除，使锁持有时间彻底与历史总消息量 N 解耦，保持 O(k)（k 为并发在传数）常数级开销。

### Phase 3：API 入口收敛与底层锁精简（Consolidation）
- 将 `/status` 与 Wails 桌面端数据源全面重构为由 `ToSnapshot()` 驱动；
- 逐步下线冗余的全局单例与无用 map；
- 将现有的 10 把琐碎互斥锁，物理收敛为按模式通道严格隔离的 3-4 把清晰互斥锁，实现体系级消歧。
