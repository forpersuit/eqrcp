# Chat QR Pulse 闪烁问题修复

## 问题描述

在GUI切换到Chat模式后，点击"Start chat"按钮，iframe中的EQT Chat标题栏右侧二维码按钮会呼吸动画最多10秒。但是10秒结束后，会触发整个页面的重新渲染（`render()`），导致iframe重新加载，产生页面闪烁。

## 根本原因

在 `desktop/gui/frontend/src/main.js` 的 `triggerChatQRPulse()` 函数中：

```javascript
chatQRPulseTimer = window.setTimeout(() => {
    chatQRPulseTimer = null;
    state.chatQRPulseUntil = 0;
    render();  // ← 这里调用render()导致整个页面重新渲染
}, pulseDuration);
```

10秒定时器结束时调用 `render()` 会：
1. 重新渲染整个应用的HTML结构
2. 重新创建iframe元素
3. iframe重新加载，导致页面闪烁

## 修复方案

创建一个新的轻量级函数 `updateChatQRPulseButton()`，只更新QR按钮的CSS类，而不重新渲染整个页面。

### 新增函数

```javascript
function updateChatQRPulseButton() {
    const button = document.querySelector('.chat-qr-toggle-action');
    if (button) {
        const shouldPulse = !state.chatQRPromptDismissed && state.chatQRPulseUntil > Date.now();
        if (shouldPulse) {
            button.classList.add('qr-breathe');
        } else {
            button.classList.remove('qr-breathe');
        }
    }
}
```

### 修改点

#### 1. `triggerChatQRPulse()` 函数

**修改前：**
```javascript
chatQRPulseTimer = window.setTimeout(() => {
    chatQRPulseTimer = null;
    state.chatQRPulseUntil = 0;
    render();  // 重新渲染整个页面
}, pulseDuration);
```

**修改后：**
```javascript
updateChatQRPulseButton();  // 启动时立即更新按钮状态
chatQRPulseTimer = window.setTimeout(() => {
    chatQRPulseTimer = null;
    state.chatQRPulseUntil = 0;
    updateChatQRPulseButton();  // 只更新按钮，不重新渲染页面
}, pulseDuration);
```

#### 2. `stopChatQRPulse()` 函数

**修改前：**
```javascript
function stopChatQRPulse() {
    state.chatQRPulseArmed = false;
    state.chatQRPromptDismissed = true;
    state.chatQRPulseUntil = 0;
    if (chatQRPulseTimer) {
        window.clearTimeout(chatQRPulseTimer);
        chatQRPulseTimer = null;
    }
    // 没有更新按钮状态
}
```

**修改后：**
```javascript
function stopChatQRPulse() {
    state.chatQRPulseArmed = false;
    state.chatQRPromptDismissed = true;
    state.chatQRPulseUntil = 0;
    if (chatQRPulseTimer) {
        window.clearTimeout(chatQRPulseTimer);
        chatQRPulseTimer = null;
    }
    updateChatQRPulseButton();  // 停止时立即移除呼吸动画
}
```

## 修复效果

### 修复前
- ✗ 10秒后调用 `render()` 重新渲染整个页面
- ✗ iframe重新创建和加载
- ✗ 页面闪烁，用户体验差

### 修复后
- ✓ 10秒后只更新QR按钮的CSS类
- ✓ iframe保持不变，不重新加载
- ✓ 无页面闪烁，用户体验流畅

## 工作流程

1. **用户点击"Start chat"按钮**
   - 设置 `state.chatQRPulseArmed = true`
   - 调用 `Chat()` 启动聊天会话
   - 调用 `render()` 渲染聊天界面（包括iframe）
   - 如果需要，调用 `triggerChatQRPulse()`

2. **`triggerChatQRPulse()` 启动呼吸动画**
   - 设置 `state.chatQRPulseUntil = now + 10000`
   - 调用 `updateChatQRPulseButton()` 添加 `qr-breathe` 类
   - 启动10秒定时器

3. **10秒后定时器触发**
   - 清除 `state.chatQRPulseUntil`
   - 调用 `updateChatQRPulseButton()` 移除 `qr-breathe` 类
   - **不调用 `render()`**，避免页面闪烁

4. **用户点击QR按钮**
   - 调用 `stopChatQRPulse()`
   - 设置 `state.chatQRPromptDismissed = true`
   - 调用 `updateChatQRPulseButton()` 立即移除呼吸动画
   - 终止所有后续呼吸动画的可能

## 技术细节

- **DOM操作**：使用 `querySelector` 和 `classList` API
- **性能**：只操作单个按钮元素，性能开销极小
- **兼容性**：使用标准DOM API，所有现代浏览器支持
- **状态管理**：保持状态驱动的设计，`updateChatQRPulseButton()` 根据状态决定按钮样式

## 回归测试

✅ **正常场景**：
- 点击"Start chat"按钮，QR按钮开始呼吸动画
- 10秒后呼吸动画停止，无页面闪烁
- iframe保持正常运行，聊天功能不受影响

✅ **用户交互场景**：
- 用户在10秒内点击QR按钮，呼吸动画立即停止
- 后续不再触发呼吸动画

✅ **边界场景**：
- 如果按钮不存在（页面未渲染），`updateChatQRPulseButton()` 安全返回
- 多次调用 `triggerChatQRPulse()` 不会产生多个定时器

## 文件修改

- **文件**：`desktop/gui/frontend/src/main.js`
- **新增函数**：`updateChatQRPulseButton()`
- **修改函数**：`triggerChatQRPulse()`, `stopChatQRPulse()`
- **修改类型**：性能优化，用户体验改进
- **向后兼容**：是
