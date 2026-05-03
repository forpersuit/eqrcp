# Chat Reconnection Hook执行顺序修复

## 问题背景

用户提出了关于chat模式和reconnection方案的疑问：
1. 是不是写了2套方案？
2. chat模式和方案2的关系是怎样的？
3. hook的执行顺序是否有问题？

## 架构澄清

### 不是2套，是共用1套方案2

**服务端（方案2实现）**：
```
server/chat.go
├── SSE snapshot支持
├── /chat/{path}/events - SSE事件流
├── /chat/{path}/messages - 消息列表
├── /chat/{path}/health - 健康检查
├── /chat/{path}/attachments - 附件管理
└── client-side merge - 消息恢复逻辑
```

**客户端（都使用同一套服务端API）**：
```
1. 浏览器页面（pages/Chat模板）
   └── 内嵌的reconnection逻辑（用于手机和桌面浏览器）

2. Wails GUI（desktop/gui/frontend/src/main.js）
   └── connectChatSSE() + visibilitychange handler（用于桌面应用）
```

### Chat模式和方案2的关系

- **方案2** 是底层的reconnection机制（SSE snapshot + Page Visibility API）
- **Chat模式** 是应用层功能，使用方案2提供的reconnection能力
- 两个客户端（浏览器和Wails GUI）都通过HTTP请求访问同一套服务端API

## 发现的Hook执行顺序问题

### 原始代码（有问题）

```javascript
document.addEventListener('visibilitychange', () => {
    chatIsPageVisible = !document.hidden;

    if (chatIsPageVisible && state.mode === 'chat') {
        const task = activeChatTask();
        if (!task?.pageUrl) {
            return;
        }

        const timeSinceLastMessage = Date.now() - chatLastMessageTimestamp;

        if (!chatEvents || chatEvents.readyState === EventSource.CLOSED) {
            // 问题1: 直接reconnect，没有先verify health
            chatReconnectDelay = 1000;
            connectChatSSE(task.pageUrl);
        } else if (chatEvents.readyState === EventSource.CONNECTING) {
            // Already connecting, wait
        } else if (timeSinceLastMessage > 30000) {
            // 问题2: 30秒阈值太大，可能10秒就断了
            verifyChatConnection(task.pageUrl);
        }
    } else {
        // Page became hidden, cancel reconnection attempts
        if (chatReconnectTimer) {
            clearTimeout(chatReconnectTimer);
            chatReconnectTimer = null;
        }
    }
});
```

### 问题分析

1. **执行顺序错误**：
   - 当连接已关闭时，直接调用 `connectChatSSE()` 重连
   - 应该先调用 `verifyChatConnection()` 检查健康状态，再决定如何重连

2. **时间阈值不合理**：
   - 30秒才触发health check太长
   - 实际场景中，10秒没有消息就可能表示连接有问题

3. **缺少统一的健康检查入口**：
   - 不同状态下的处理逻辑不一致
   - 应该统一通过 `verifyChatConnection()` 来处理

### 正确的执行顺序

```
页面visible
    ↓
检查连接状态
    ↓
调用 verifyChatConnection()
    ├── 发送 /health 请求
    ├── 获取最新消息
    └── 根据结果决定是否重连
```

### 修复后的代码

```javascript
document.addEventListener('visibilitychange', () => {
    chatIsPageVisible = !document.hidden;

    if (chatIsPageVisible && state.mode === 'chat') {
        const task = activeChatTask();
        if (!task?.pageUrl) {
            return;
        }

        const timeSinceLastMessage = Date.now() - chatLastMessageTimestamp;

        // 修复: 统一通过verifyChatConnection处理
        if (!chatEvents || chatEvents.readyState === EventSource.CLOSED) {
            // Connection is closed, verify health before reconnecting
            verifyChatConnection(task.pageUrl);
        } else if (chatEvents.readyState === EventSource.CONNECTING) {
            // Already connecting, wait
        } else if (timeSinceLastMessage > 10000) {
            // Connection looks open but no messages for 10s (reduced from 30s), verify health
            verifyChatConnection(task.pageUrl);
        }
    } else {
        // Page became hidden, cancel reconnection attempts
        if (chatReconnectTimer) {
            clearTimeout(chatReconnectTimer);
            chatReconnectTimer = null;
        }
    }
});
```

### verifyChatConnection() 的工作流程

```javascript
async function verifyChatConnection(pageUrl) {
    try {
        // 1. 验证连接健康状态
        const healthURL = pageUrl.replace(/\/$/, '') + '/health';
        const healthResponse = await fetch(healthURL, {cache: 'no-store'});
        if (!healthResponse.ok) {
            throw new Error('health check failed');
        }
        
        // 2. 获取最新消息
        await loadChatMessages(pageUrl);
        
        // 3. 重置延迟并重连SSE
        chatReconnectDelay = 1000;
        connectChatSSE(pageUrl);
    } catch {
        // 4. 如果health check失败，直接重连
        chatReconnectDelay = 1000;
        connectChatSSE(pageUrl);
    }
}
```

## 修复的好处

1. **统一的处理流程**：所有reconnection都通过 `verifyChatConnection()` 处理
2. **更快的响应**：10秒阈值比30秒更合理
3. **更可靠的恢复**：先verify health再reconnect，避免盲目重连
4. **更好的用户体验**：页面回到前台时能更快地恢复连接

## 测试建议

按照 `docs/chat-reconnection-testing.md` 中的测试场景重新测试：

1. **Scenario 1**: 短时间后台（1分钟）
2. **Scenario 2**: 中等时间后台（5分钟）
3. **Scenario 3**: 长时间后台（10分钟）
4. **Scenario 4**: 网络中断
5. **Scenario 7**: 快速切换前后台

重点关注：
- 重连速度是否更快
- 消息恢复是否更可靠
- 是否还有消息丢失

## 相关文件

- `desktop/gui/frontend/src/main.js` - Wails GUI的reconnection实现
- `server/chat.go` - 服务端SSE和health check实现
- `docs/chat-mode-development.md` - Chat模式开发文档
- `docs/chat-reconnection-testing.md` - Reconnection测试指南
