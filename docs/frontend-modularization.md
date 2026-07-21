# 前端 main.ts 全量模块化拆分进度文档

## 概述
本文档记录 `desktop/gui/frontend/src/main.ts`（原 5,141 行）深层次模块化拆分的目标、步骤、进展与 DoD 验证标准。

## 目标 (Definition of Done)
1. `main.ts` 文件体积由 5,141 行降低至 1,115 行，仅作为主应用入口调度与事件流分发器。
2. 保持 TypeScript 严苛工程标准，全过程 `npx tsc --noEmit` **0 Error**（零报错）。
3. 前端 `npm run build` 打包成功，Go 后端 `go test ./...` 测试 100% 通过，无功能退化。

---

## 模块拆分阶段规划 (Task Checklist)

### Phase 1: 辅助模块与控制器剥离 (已完成)
- [x] `src/views/aboutView.ts` - 抽离 About 弹窗视图
- [x] `src/views/planComparisonView.ts` - 抽离方案对比弹窗视图
- [x] `src/views/feedbackView.ts` - 抽离用户反馈弹窗视图
- [x] `src/controllers/integrationController.ts` - 抽离系统集成（右键/自启）控制器
- [x] `src/controllers/chatController.ts` - 抽离 Chat 配额与 iframe 通信控制器
- [x] `src/controllers/updateController.ts` - 抽离自动更新控制器

### Phase 2: 工具集与纯函数剥离 (已完成)
- [x] `src/utils/domUtils.ts` - 抽离 `escapeHTML`, `escapeAttr`, `formatBytes`, `cleanChatProfileName` 等 HTML/DOM 工具函数
- [x] `src/utils/imageUtils.ts` - 抽离 `compressImageToWebP` 等图片处理工具函数
- [x] `src/views/icons.ts` - 抽离纯 SVG 图标与 Avatar/URL 辅助函数

### Phase 3: Redeem 兑换与授权控制剥离 (已完成)
- [x] `src/views/redeemView.ts` - 抽离兑换/激活码弹窗视图
- [x] `src/controllers/redeemController.ts` - 抽离卡密激活与 License 重置控制器

### Phase 4: History 历史记录模块剥离 (已完成)
- [x] `src/views/historyView.ts` - 抽离历史记录侧边栏面板视图与列表 DOM 构建
- [x] `src/controllers/historyController.ts` - 抽离历史记录搜索、收缩、清除与恢复控制器

### Phase 5: Share 发送传输模块剥离 (已完成)
- [x] `src/views/shareView.ts` - 抽离文件发送面板视图与二维码/链接 DOM
- [x] `src/controllers/shareController.ts` - 抽离发送传输动态进度刷新 (`updateShareTransferActiveUI`)

### Phase 6: Receive 接收传输模块剥离 (已完成)
- [x] `src/views/receiveView.ts` - 抽离接收文件面板视图与设备文件树 DOM
- [x] `src/controllers/receiveController.ts` - 抽离接收传输动态进度与文件展开刷新 (`updateReceiveTransferActiveUI`)

### Phase 7: Settings 设置模块剥离 (已完成)
- [x] `src/views/settingsView.ts` - 抽离设置面板视图
- [x] `src/controllers/settingsController.ts` - 抽离设置控件绑定、DOM 数据同步与保存

### Phase 8: 最终收尾与全量测试 (已完成)
- [x] `main.ts` 精简整理 (由 5,141 行降至 1,115 行)
- [x] `npx tsc --noEmit` 0 报错验证
- [x] `npm run build` 打包验证
- [x] `go test ./...` 单元与集成测试
- [x] Git commit & Smart Push 提交

