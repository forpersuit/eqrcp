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

## 2. 人工验收测试流程 (Manual Acceptance Testing)

在将构建产物部署到 Windows 验收目录 `E:\developer\results` 后，您可以通过如下命令拉起模拟调试服务，并直接用浏览器或手机扫码验证 UI：

```sh
# 1. 模拟不一致（红胶囊 + 弹出不一致说明卡片）场景
EQT_MOCK_STATUS=inconsistent_unpaid go run . send ./example.txt

# 2. 模拟时钟异常回滚场景
EQT_MOCK_STATUS=clock_tampered go run . send ./example.txt

# 3. 模拟正常 PLUS U 永久激活状态
EQT_MOCK_STATUS=premium_active go run . send ./example.txt
```

直接点击命令行输出的 Chat 网址，即可直观核对胶囊颜色、悬浮信息卡的诊断文字与设计语言是否契合。

---

## 3. 自动化集成测试 (Automated E2E Testing)

在 Go 后端对 `server/chat_test.go` 进行扩展，结合 Go 的 `html/template` 的解析输出，可以编写模拟断言测试。

通过启动带 mock 的 HTTP 服务，拉取对应的 HTML 内容并断言其内部的初始化状态属性是否匹配。

---

## 4. 交付准则 (Delivery Readiness Checklist)

任何开发任务的交付必须满足以下 checklists 才能标记为 DONE：
- [ ] 1. Go 后端模块测试全部通过 (`go test ./...`)。
- [ ] 2. 对应调整有配套 of Mock 调试参数。
- [ ] 3. 至少在一款模拟模式下运行并通过浏览器确认无渲染和事件绑定错误。
- [ ] 4. Windows 部署脚本已同步完毕最新的二进制包。
