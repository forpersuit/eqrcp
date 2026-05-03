# Chat Mode Phase 2 Integration Test Guide

## 测试环境准备

确保已构建最新版本：
```bash
go build -o eqrcp.exe .
```

## 测试步骤

### 1. 启动 Desktop Agent（后台模式）

```bash
./eqrcp.exe desktop agent-start -B
```

**预期输出：**
```
Desktop agent started in background.
Status: http://127.0.0.1:48176/
Log: C:\Users\<user>\AppData\Local\eqrcp\agent-*.log
```

### 2. 验证 Agent 运行状态

```bash
./eqrcp.exe desktop agent-status
```

**预期输出：**
```
Desktop agent status
- state: idle
- queued: 0
- version: <version>
- agent started: <timestamp>
- history: empty
```

### 3. 启动 Chat 会话

```bash
./eqrcp.exe desktop chat
```

**预期行为：**
- 浏览器自动打开聊天页面
- 终端显示 QR 码
- 可以用手机扫描 QR 码加入聊天

### 4. 在另一个终端查看 Agent 状态

```bash
./eqrcp.exe desktop agent-status
```

**预期输出（会话等待中）：**
```
Desktop agent status
- state: busy
- queued: 0
- version: <version>
- agent started: <timestamp>
- current:
  - #1 chat running
    qr page: http://127.0.0.1:<port>/chat/<random>
    chat: waiting (0 messages)
    started: <timestamp>
- history: empty
```

### 5. 发送消息

在浏览器或手机上发送几条消息。

### 6. 再次查看 Agent 状态

```bash
./eqrcp.exe desktop agent-status
```

**预期输出（会话活跃）：**
```
Desktop agent status
- state: busy
- current:
  - #1 chat running
    qr page: http://127.0.0.1:<port>/chat/<random>
    chat: active (5 messages)
    last activity: <timestamp>
    started: <timestamp>
```

### 7. 打开 Agent 状态页面

```bash
./eqrcp.exe desktop agent-open
```

**预期行为：**
- 浏览器打开 http://127.0.0.1:48176/
- 显示当前 chat 任务
- 显示消息计数
- 显示 "Open QR Page" 链接

### 8. 停止当前 Chat

```bash
./eqrcp.exe desktop agent-stop-current
```

**预期输出：**
```
Current desktop agent task stopped.
```

### 9. 查看历史记录

```bash
./eqrcp.exe desktop agent-status
```

**预期输出：**
```
Desktop agent status
- state: idle
- history:
  - #1 chat stopped
    chat: ended (5 messages)
    last activity: <timestamp>
    started: <timestamp>
    finished: <timestamp>
```

### 10. 从历史重复 Chat

在浏览器 agent 状态页面（http://127.0.0.1:48176/）：
1. 找到历史记录中的 chat 任务
2. 点击 "Transfer again" 按钮
3. 新的 chat 会话应该启动

### 11. 清理

停止 agent：
```bash
./eqrcp.exe desktop agent-stop
```

## 验证要点

### ✅ 功能验证
- [ ] Chat 任务可以通过 agent 启动
- [ ] Agent 状态正确显示 chat 会话信息
- [ ] 消息计数实时更新
- [ ] 最后活动时间正确记录
- [ ] Stop current 可以停止 chat 会话
- [ ] 历史记录保留 chat 会话详情
- [ ] Repeat 可以重新启动 chat 会话

### ✅ 状态转换验证
- [ ] waiting → active（发送第一条消息时）
- [ ] active → ended（停止会话时）
- [ ] running → completed（会话结束时）

### ✅ 显示验证
- [ ] 命令行状态显示 chat 字段
- [ ] 浏览器状态页面显示 chat 信息
- [ ] QR 页面链接可点击
- [ ] 历史记录格式正确

## 已知限制

1. Chat 会话不支持传输进度百分比（这是预期的，因为 chat 不是文件传输）
2. Chat 状态更新每 10 条消息触发一次（可配置）
3. 移动端重连需要 Page Visibility API 支持（Phase 1 已实现）

## 故障排查

### Agent 无法启动
```bash
# 检查是否已有 agent 运行
curl http://127.0.0.1:48176/health

# 如果有，先停止
./eqrcp.exe desktop agent-stop
```

### Chat 状态不更新
- 确保发送了消息（状态在第一条消息时更新）
- 检查 agent 日志文件
- 验证 agent 版本与 eqrcp 版本一致

### 浏览器不自动打开
- 检查 desktop settings 中的 browser 配置
- 手动访问 QR 页面 URL

## 成功标准

所有验证要点通过，且：
- 无崩溃或错误
- 状态转换符合预期
- 历史记录完整
- 可以重复启动 chat 会话
