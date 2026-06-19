# EQT UI 与授权状态验收验证规程

为了确保对 EQT 的每一处开发调整在交付前都能够得到完整、高置信度的验证，本项目建立了一套**模拟验收沙箱与自动化断言机制**。本项目严禁在未经过任何场景验证的情况下交付代码。

---

## 1. 模拟验收沙箱 (Simulation Sandbox)

对于 Chat UI 中的不同授权和时钟篡改状态，由于实际触发涉及系统时钟篡改、兑换码真实网络校验等繁琐人工步骤，直接测试代价高昂。为此，核心进程支持通过环境变量 `EQT_MOCK_STATUS` 直接激活**模拟沙箱状态**。

### 1.1 环境变量可选值及 UI 预期行为

| 环境变量 `EQT_MOCK_STATUS` | 模拟场景 | 胶囊 UI 颜色 | 胶囊文字 | 点击信息卡弹出内容 |
| :--- | :--- | :--- | :--- | :--- |
| `clock_tampered` | 时钟被回退锁定（违规异常） | 🔴 红色 (`danger`) | `PLUS U` | 时钟异常说明 + 解决方法 |
| `inconsistent_unpaid` | 授权码失效/未激活（不一致状态） | 🔴 红色 (`danger`) | `PLUS U` | 不一致说明 + 客户端网络重置指引 |
| `premium_active` | 付费激活状态（一致状态） | 🟢 绿色 (`paid`) | `PLUS U` | 付费成功信息（无限制） |
| `free_quota` | 体验版使用中 | ⚪ 默认 (`warning` / 正常) | 倒计时（如 `3:00`） | 免费时长剩余及体验规则 |
| `free_exceeded` | 体验版超额 | 🔴 红色 (`danger`) | `已超额` | 超额限制信息 + 引导模态窗 |

---

## 2. 可视化交互式验收控制台 (Interactive Sandbox Console)

为了免去频繁重启后端进程来核对多状态 UI 的繁琐流程，Chat UI 内置了**可视化验收控制台**。

### 2.1 启用方式
在打开的 Chat URL 后面加上参数 `?sandbox=1` 或 `?debug=1`。例如：
`http://127.0.0.1:8080/chat/test?sandbox=1`

### 2.2 预期行为
1. 页面右下角会渲染出一个极其精美的「🛠️ 验收测试控制台」悬浮窗。
2. 悬浮窗提供了 5 个一键切换按钮（PLUS U 激活、授权不一致、时钟异常锁定、体验额度内、额度超额）。
3. 点击任意按钮，前端会瞬时改变内部的 `limitState` 状态机并调用 UI 渲染刷新函数，允许您在几秒钟内以纯视觉交互方式 100% 核对所有状态及其文字提示（无需重启程序）。

---

## 3. 自动化集成测试 (Automated Integration Testing)

为了在代码库和 CI 级别确保上述 5 种授权限制在后端处理和页面交付时绝对可靠，本项目在 [server/chat_test.go](file:///home/yelon/develop/me/eqrcp/server/chat_test.go) 中编写了 `TestAcceptanceMockStates` 集成测试套件。

### 3.1 覆盖逻辑
- 针对 5 种模拟状态分别运行子测试。
- 启动临时 Mock Chat Server，模拟高并发 HTTP 客户端发起请求。
- 自动断言 HTTP 返回状态为 `200 OK` 且内容为合规的 HTML 模板页面。
- 提取并校验后端内存中 `limiterInstance.GetStatus()` 暴露的参数细节，确保逻辑判定与 mock 配置完全一致。

### 3.2 运行命令
在终端运行以下命令，即可在 0.1 秒内自动完成 5 种业务场景的交付状态回溯与健康检查：
```sh
go test -v ./server -run TestAcceptanceMockStates
```

---

## 4. 交付准则 (Delivery Readiness Checklist)

任何开发任务在宣布 DONE 之前，必须满足以下强制闭环流程：
- [ ] **1. 跑通单元测试**：Go 后端模块测试全部通过 (`go test ./...`)。
- [ ] **2. UI 交互测试通过**：启动服务并在 URL 加上 `?sandbox=1`，点击控制台按钮在浏览器或宿主环境上肉眼审核样式是否 100% 协调。
- [ ] **3. 产物部署一致**：通过 Windows 部署脚本将打包后的可执行程序同步到 Windows 宿主机的验收目录 `E:\developer\results` 下。
- [ ] **4. 提交验收单**：在向用户报告任务完成时，必须呈交包含上述步骤的《开发与验收报告》。
