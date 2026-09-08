# 传输生命周期与状态机不变量契约测试重构方案

> **状态**：🎯 技术改造与测试加固方案（Design & Implementation Plan）  
> **文档密级**：工程质量保证核心方案  
> **关联架构指引**：[`docs/mechanism/core-architecture-and-engineering-guide.md`](../mechanism/core-architecture-and-engineering-guide.md)  
> **规划版本**：v1.36.67+  

---

## 一、 背景与核心问题定位

### 1. 痛点：假绿灯与被动的人肉测试
在以往的功能迭代中（例如 Tus 进度上报改造、ZIP 双通道隔离），多次出现**“新修改导致原有的 AutoStop 或进度条功能失效，但本地运行 `go test ./pkg/server ./cmd` 全绿通过，最终只能由用户在实际使用中手动测试才发现”**的严重被动局面。

### 2. 根因：内部算法白盒单测与外层 HTTP 契约测试的断层
经对测试体系的深度审计，定位到过去测试未报警的结构性根因：

1. **`client_state_test.go` 的定位与边界**：
   - 该文件专注于验证 `isAllActiveClientsFinished()` 内部多设备心跳超时、已完成忽略算法，直接调用生产方法断言其布尔返回值，是合法有效的**算法单元测试**；
   - 但在验证 AutoStop 触发时，部分早期用例直接在测试内部手动组织了触发代码（模拟 `ServeFile` 尾部动作），而非经由外层 HTTP 路由分发。
2. **致命断层（The Missing E2E Contract）**：
   - 当我们在 `handleTusUpload`（外层 HTTP Handler）中增加完成处理时，缺少一条从**“真实 HTTP POST `?done=true` -> Handler 内部门禁评估 -> 全局状态流转”**的端到端契约测试；
   - 结果：外层 Handler 内部即便出现了直接将全局状态置为 `"completed"` 的违例，底层的 `isAllActiveClientsFinished()` 内部算法依然运行良好，导致所有既有单元测试一路绿灯通行，形成了测试防御的真空地带。

---

## 二、 测试重构总体设计：黑盒状态机不变量契约

我们将彻底摒弃“在测试内部手写逻辑”，全面转向**“真实入口驱动 + 全局不变量断言”**的黑盒状态机契约测试框架。

```
                       ┌──────────────────────────────────────┐
                       │     测试驱动器 (Test Runner)          │
                       │   参数化表驱动 (Table-Driven Matrix)  │
                       └──────────────────┬───────────────────┘
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   │ 发起纯真实 HTTP 行为流                        │
                   │ • Send: GET /send/...                       │
                   │ • Receive: POST/PATCH ?done=true            │
                   │ • Chat: WebSocket / Tus / HTTP Range        │
                   ▼                                             ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           核心服务实例 Server.mux.ServeHTTP                         │
│   (经历完全真实的 Context 检查、URL 解析、互斥锁竞争、内存状态机推进与 Hook 广播)    │
└─────────────────────────────────────────┬─────────────────────────────────────────┘
                                          │
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                             刚性系统不变量检查器 (Invariant Checker)                 │
│                                                                                   │
│  [断言 1: KeepAlive 防退] 当 KeepAlive=true 且 autoStop=false:                    │
│                          • srv.status.State 严格禁止变成 "completed"               │
│                          • srv.stopChannel 严格禁止收到任何退出脉冲                │
│                                                                                   │
│  [断言 2: AutoStop 收敛]  当 autoStop=true 且所有活跃设备传完:                    │
│                          • srv.status.State 必须收敛为 "completed"                 │
│                          • srv.stopChannel 必须在安全宽限期后收到退出信号          │
│                                                                                   │
│  [断言 3: 桌面 Agent 一致] 验证 statusHook 广播出的快照与桌面端生命周期严格对称   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、 全模式状态机不变量矩阵设计（The Test Matrix）

测试框架将采用 Go 表驱动测试（Table-Driven），覆盖以下全正交状态组合：

### 1. 维度定义
- **模式（Mode）**：
  1. `Send`（单文件、多文件打包 ZIP、单个文件夹）；
  2. `Receive-Tus`（标准断点续传完成、多文件连续完成）；
  3. `Receive-Multipart`（低端浏览器流式上传）；
  4. `Chat`（文本消息、附件上传完成）。
- **生命周期开关（Flags）**：
  1. `KeepAlive`: `{true, false}`
  2. `AutoStop`: `{true, false}`
- **客户端行为（Client Scenarios）**：
  1. `SingleClientDone`：单设备正常完成；
  2. `MultiClientPartial`：多设备部分完成（设备 A 完成，设备 B 仍在传输）；
  3. `MultiClientAllDone`：多设备全部完成；
  4. `ClientHeartbeatTimeout`：某设备传了一半后息屏掉线（超时摘除）。

### 2. 状态机预期流转矩阵表

| 模式 | KeepAlive | AutoStop | 客户端动作 | 预期全局状态 (State) | 预期 stopChannel 行为 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Receive-Tus** | `true` | `false` | Client 1 发送 `?done=true` | `"waiting"` | ❌ 绝不触发（常驻等待） |
| **Receive-Tus** | `true` | `true` | Client 1 发送 `?done=true` | `"completed"` | ✅ 优雅退出触发 |
| **Receive-Tus** | `false` | `false` | Client 1 发送 `?done=true` | `"completed"` | ✅ 优雅退出触发 |
| **Receive-Tus** | `true` | `true` | Client 1 传完，Client 2 进行中 | `"active"` / `"waiting"` | ❌ 绝不触发（等待 Client 2） |
| **Send** | `true` | `false` | Client 1 下载全部完成 | `"waiting"` | ❌ 绝不触发（常驻等待） |
| **Send** | `true` | `true` | Client 1 下载全部完成 | `"completed"` | ✅ 优雅退出触发 |
| **Send** | `true` | `true` | 传完后动态开启 `SetAutoStop(true)` | `"waiting"` | ❌ 忽略此前已完成的设备 |

---

## 四、 具体实施路线图与改造清单

### 第一阶段（Phase 1）：紧急缺陷防护落地（✅ 已完成）
- **交付内容**：在 [`pkg/server/receive_progress_gate_test.go`](../../pkg/server/receive_progress_gate_test.go) 中编写并合入 `TestReceiveTusDoneAutoStopBehavior`；
- **防护效果**：首次引入真实 `srv.mux.ServeHTTP` 请求 Tus `?done=true`，锁定 `autoStop=false` 时全局状态保持 `waiting` 的铁律，0.3 秒内阻断违规提交。

### 第二阶段（Phase 2）：历史用例分层治理与外层 HTTP 契约补齐
- **改造目标**：对 [`pkg/server/client_state_test.go`](../../pkg/server/client_state_test.go) 中的核心用例进行分层治理：
  - **保留并巩固算法层测试**：保留针对 `isAllActiveClientsFinished` 内部心跳、忽略列表重置等底层算法的断言；
  - **外层契约补齐**：对早期直接在用例内部手工模拟退出的片段，升级为统一基于 `srv.mux.ServeHTTP` 的真实 HTTP 请求驱动，直接验证外部请求触发状态机变迁与 `<-srv.stopChannel` 的全链路闭环。

### 第三阶段（Phase 3）：全量矩阵自动化测试用例落地
- **新建测试文件**：`pkg/server/lifecycle_matrix_test.go`
- **代码结构规范**：
  ```go
  type LifecycleTestCase struct {
      Name           string
      Mode           string // send, receive-tus, receive-multipart
      KeepAlive      bool
      AutoStop       bool
      Actions        func(srv *Server)
      ExpectedState  string
      ExpectShutdown bool
  }
  ```
- **性能基准**：矩阵 24+ 个用例并行执行耗时必须控制在 **3 秒以内**，确保开发体验零负担。

### 第四阶段（Phase 4）：CI 与 Pre-commit 硬性质量卡点
- 在现有的 `scripts/install-hooks.sh` 与 `git commit` pre-commit 钩子中，确保强制执行 `go test ./pkg/server -run 'Test(Receive|Lifecycle|AutoStop)'`；
- 只要有任何不变量断言失败，物理阻断提交并直接在控制台高亮输出违例的状态机流转，杜绝坏代码流入主分支。

---

## 五、 总结与学习建议

1. **写测试不是“证明代码写了什么”，而是“保护系统不应该变成什么”**；
2. **永远用系统最外层的公开协议（HTTP Request / Public API）去驱动内部状态**，切忌在单测里手抄业务逻辑自娱自乐；
3. 将复杂的多条件组合（KeepAlive × AutoStop × 多设备）全面**表格化（Table-Driven）**，让边界条件无所遁形。
