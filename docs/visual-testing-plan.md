# EQT 自动化视觉与交互测试方案 (Visual & Interaction Testing Plan)

在跨端软件系统（Wails 桌面端 + 浏览器/手机聊天端）的日常维护中，仅依靠传统单元测试（如 Golang 的 `go test`）和 DOM 结构检测，很容易遗漏由于 CSS 属性变化、布局挤压或拖动交互失效导致的**视觉效果退化 (Visual Regression)**。

为了让软件的“眼”和“手”能够自动验收，我们推荐并设计以下自动化视觉测试方案。

---

## 1. 核心技术选型

我们推荐将 **Playwright** + **Pixelmatch / Webview CDP** 作为底层测试引擎：

```mermaid
graph TD
    subgraph Test Runner (Node.js/Go)
        Runner[Playwright Runner]
    end
    subgraph Desktop Agent (Wails Host)
        Wails[Wails App with CDP Enable]
    end
    subgraph Mobile Chat Client (Browser)
        Browser[Mobile Browser Emulation]
    end
    
    Runner -->|CDP Session: localhost:port| Wails
    Runner -->|Automated Interaction & Page Emulation| Browser
    Browser -->|Generate Screenshot| Diff[Visual Diff / Pixelmatch]
    Wails -->|Generate Screenshot| Diff
    Diff -->|Compare Baseline vs Current| Report[JUnit / HTML Test Report]
```

* **Playwright**：比 Selenium / Cypress 启动速度更快，原生支持跨平台（Chromium/Firefox/WebKit）以及移动端视口（DPI, Touch events, Viewport Size）高保真模拟。并且支持通过 **Chrome DevTools Protocol (CDP)** 连接正在运行的本地应用程序。
* **Pixelmatch**：极速的纯 JS 像素级比对库，可识别出两个渲染图像之间的微小视觉差异并生成高对比度的 Diff 区域图片。
* **Appium (备选)**：若需要控制 Windows 物理窗口的系统级菜单（如系统托盘右键），可采用 WinAppDriver 进行底层模拟。

---

## 2. 移动聊天端：手势交互与视口比对

对于运行于移动浏览器上的聊天页面（`pages/chat.tmpl.html`），可以使用 Playwright 模拟移动设备并录制和重放真实的“眼+手”操作。

### 2.1 拖拽 Viewport Debug Box 实例 (JavaScript Playwright)

以下脚本模拟用户用手势拖动调试视口，并对拖拽后的视觉反馈进行截图断言：

```javascript
const { test, expect, devices } = require('@playwright/test');

test.use({
  ...devices['iPhone 14 Pro'], // 模拟真实手机物理屏幕、DPI 和触摸事件
  hasTouch: true
});

test('Drag Viewport Debug Box and assert visual layout', async ({ page }) => {
  // 1. 扫码加入并连接成功
  await page.goto('http://127.0.0.1:7052/chat/test?viewportDebug=1');
  await expect(page.locator('#viewport-debug')).toBeVisible();

  // 2. 捕获初始位置
  const debugBox = page.locator('#viewport-debug');
  const initialBoundingBox = await debugBox.boundingBox();
  
  // 3. 模拟手指按压、拖拽移动、放开
  await page.mouse.move(initialBoundingBox.x + 20, initialBoundingBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(initialBoundingBox.x + 120, initialBoundingBox.y + 100, { steps: 10 }); // 模拟平滑手势过程
  await page.mouse.up();

  // 4. 自动截图并与项目 Baseline 库进行视觉像素级比对 (Visual Regression Testing)
  // 如果当前界面的像素变动超出了 0.2 的视觉差异度阈值，或变动面积超出了 50 像素，测试将大声报错 (Fail Loud)
  await expect(page).toHaveScreenshot('viewport-debug-dragged.png', {
    maxDiffPixels: 50,
    threshold: 0.2
  });
});
```

---

## 3. Wails 桌面端：配置开关与实时跨端联动比对

难点在于：当用户在桌面 Wails 客户端（GUI 端）修改设置时，我们如何自动验证**移动端同时隐藏/显示**的联动反应？

### 3.1 跨进程 CDP 连接调试模式

Wails 打包时，可在启动代码中暴露远程调试端口，例如：
```go
// desktop/gui/main.go (或在启动选项中加入)
wails.Run(&options.App{
    Bind: []interface{}{app},
    Windows: &windows.Options{
        WebviewUserDataFolder: "...",
    },
    // 为开发和测试模式启用远程调试端口
    Debug: options.Debug{
        OpenInspectorOnStartup: false,
    },
})
```
启动应用时附带选项：`eqt-desktop.exe --remote-debugging-port=9222`。

### 3.2 跨端联动自动化验证流 (Playwright Integration)

测试脚本可以同时接管桌面端和移动浏览器，验证“手在 GUI 点，眼在手机看”的复合反馈：

```javascript
const { chromium, test, expect } = require('@playwright/test');

test('Cross-platform settings toggle validation', async () => {
  // 1. 通过 CDP 连接到已启动的本地 Wails 桌面端
  const desktopBrowser = await chromium.connectOverCDP('http://localhost:9222');
  const desktopContext = desktopBrowser.contexts()[0];
  const desktopPage = desktopContext.pages()[0];

  // 2. 打开移动浏览器窗口模拟手机端
  const mobileBrowser = await chromium.launch({ headless: false });
  const mobileContext = await mobileBrowser.newContext({
    viewport: { width: 390, height: 844 }, // 手机视口
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS ...'
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto('http://127.0.0.1:7052/chat/test');

  // 3. 验证手机端的 Viewport Box 初始状态为隐藏
  await expect(mobilePage.locator('#viewport-debug')).not.toHaveClass(/open/);

  // 4. 模拟手在桌面端 GUI：点击切换 "Enable Viewport Debug Box" 开关
  await desktopPage.click('#settings-btn');
  await desktopPage.check('input[name="viewportDebug"]'); // 点击勾选

  // 5. 模拟手机端在 5 秒轮询内收到通知并实时显示 Debug Box
  // 我们使用 Playwright 的 waitFor 机制（等待视觉 class 'open' 出现）
  const mobileDebugBox = mobilePage.locator('#viewport-debug');
  await expect(mobileDebugBox).toHaveClass(/open/, { timeout: 6000 });

  // 6. 进行终点视觉截图验收，验证手机端的渲染位置和内容是否无误
  await expect(mobilePage).toHaveScreenshot('mobile-viewport-box-enabled.png', {
    threshold: 0.1
  });

  // 7. 清理连接
  await mobileBrowser.close();
  await desktopBrowser.close();
});
```

---

## 4. 视觉测试的“降噪”最佳实践

视觉比对（Pixel Match）在不同操作系统硬件渲染、不同分辨率 DPI 下，极易因为微小的文字抗锯齿差异引起“视觉误报”。我们在落地时需严格遵循以下机制：

1. **设置忽略区域 (Ignore Regions)**：
   * 在截图比对时，对于不断变动的动态数据（例如 Viewport Box 里的视口大小数值、系统时钟），应在测试配置中忽略这些区域。
   * 示例：
     ```javascript
     await expect(page).toHaveScreenshot('chat.png', {
       mask: [page.locator('.dynamic-time'), page.locator('.viewport-metrics-text')]
     });
     ```
2. **感知相似度阈值**：
   * 合理设定感知差异阈值 `threshold`（从 0.0 到 1.0）。在日常开发中，一般设置 `threshold: 0.2` 可以完美过滤渲染边缘的微小色差，而只捕获结构性错位。
3. **隔离的容器测试环境**：
   * 在 CI（如 GitHub Actions）中跑测试时，由于 Linux headless 环境与 Windows 物理渲染器存在渲染机制上的差异，请确保 Baseline 截图是在**相同环境的 Docker 容器中生成并比对的**，以消除跨操作系统渲染平台带来的系统级像素噪点。
