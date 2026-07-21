# main.js 模块化重构与 TS 化演进计划与进度追踪

## 一、 重构背景与工程目标

目前 `desktop/gui/frontend/src/main.js` 巨无霸文件已膨胀至 6036 行，混杂了 DOM 校验、视图渲染、传输控制、自动更新、激活码兑换、用户反馈以及事件注册。

为了符合项目的 **Front-end & Go Engineering Best Practices (前端与 Go 后端开发最佳实践规则)** 以及 **Rule 16 — TypeScript Strict Engineering Standards (TypeScript 严格工程规范)**，计划将 `main.js` 拆分为高内聚、低耦合的 TypeScript 领域子模块，实现 **0 逻辑退化 (Zero Regression)**。

---

## 二、 目标架构设计

```
desktop/gui/frontend/src/
├── views/                      # 🎨 视图与 DOM 渲染层 (纯 View 渲染)
│   ├── settingsView.ts         # 设置弹窗视图模板 (renderSettingsPanel)
│   ├── aboutView.ts            # 关于、反馈与兑换弹窗视图 (renderAboutModal/renderLicenseModal)
│   └── emojiView.ts            # Emoji 选择器面板视图 (renderEmojiPicker)
│
├── controllers/                # ⚙️ 业务逻辑与控制器层
│   ├── updateController.ts     # 自动更新、阶段推进与红点增量补丁
│   ├── feedbackController.ts   # 用户反馈申报与图片上传
│   ├── licenseController.ts    # 激活码兑换与软件授权
│   └── integrationController.ts# 右键菜单与开机自启系统集成
│
├── utils/                      # 🛠️ 独立工具函数
│   └── domHelpers.ts           # 输入框防护 (shouldProtectActiveInput) 与 DOM 节点操作
│
├── state.ts                    # 🧠 (已完成) 强类型全局 AppState
├── dragdrop.ts                 # 🖐️ (已完成) 物理拖拽控制器
├── i18n.ts                     # 🌐 (已完成) 强类型多语言出口
└── main.ts                     # 🚀 应用统一初始化入口 (~300 行)
```

---

## 三、 拆分前后 27 项核心功能防护矩阵 (Feature Matrix)

| 序号 | 核心功能点 | 目标模块路径 | 逻辑与测试对齐要求 | 验证状态 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 焦点与打字防护 | `utils/domHelpers.ts` | 保护 active input 在心跳推送时不失焦 | [x] Step 1 完成 |
| 2 | 更新小红点就地修补 | `utils/domHelpers.ts` | `#open-settings` 增量 append/remove `.badge-dot` | [x] Step 1 完成 |
| 3 | 自动更新阶段控制 | `controllers/updateController.ts` | `updateStage` 推进与 `triggerDownloadUpdate` | [x] Step 2 完成 |
| 4 | 手动检查更新 UI | `controllers/updateController.ts` | `syncManualUpdateCheckUI` 局部文本更新 | [x] Step 2 完成 |
| 5 | 用户反馈与日志抓取 | `controllers/feedbackController.ts` | 反馈发送、Base64 图片处理 | [ ] Step 3 待执行 |
| 6 | 软件激活码兑换 | `controllers/licenseController.ts` | `RedeemLicense` 与授权提示 | [ ] Step 3 待执行 |
| 7 | 右键集成/开机自启 | `controllers/integrationController.ts` | `loadIntegrationStatusData` 检测与修复 | [ ] Step 3 待执行 |
| 8 | 设置弹窗渲染 | `views/settingsView.ts` | `renderSettingsPanel` 完整 DOM 输出 | [ ] Step 4 待执行 |
| 9 | 关于/兑换/反馈弹窗 | `views/aboutView.ts` | 弹窗视图渲染与 tab 切换 | [ ] Step 4 待执行 |
| 10 | Emoji 选择器 | `views/emojiView.ts` | `renderEmojiPicker` 分类与搜索 | [ ] Step 4 待执行 |
| 11 | 主入口挂载与组合 | `main.ts` | 事件组合注册与初始化 | [ ] Step 5 待执行 |

---

## 四、 5 阶段分步实施进度

- [x] **Step 1**: 剥离 `src/utils/domHelpers.ts` (防护打字焦点 `shouldProtectActiveInput`, 红点修补 `updateSettingsBadgeUI`)
- [x] **Step 2**: 剥离 `src/controllers/updateController.ts` (自动更新与阶段推进控制器)
- [x] **Step 3**: 剥离 `src/controllers/feedbackController.ts` 与 `src/controllers/licenseController.ts` (反馈与授权控制器)
- [x] **Step 4**: 剥离 `src/views/` 渲染模板 (Settings, About, Emoji Views)
- [x] **Step 5**: 升级 `main.js` 为 `main.ts` 入口并清理冗余桥接，完成全量校验与交付。

---

## 五、 测试验证标准

1. **静态类型检查与打包**：每次拆分后执行 `npm --prefix desktop/gui/frontend run build`，断言 Vite 编译 0 Warning / 0 Error。
2. **后端全套测试**：执行 `go test ./...`，确保 API 与传输逻辑无破损。
3. **物理二进制交付**：执行 `scripts/install-hooks.sh` 构建真实的 Windows 可执行文件并输出至结果目录。
