---
name: stitch-mcp
description: Guide for utilizing Google AI Stitch MCP for landing page design, screen generation, timeout recovery, and Cloudflare Pages i18n deployment.
---

# Google AI Stitch MCP Design System & Deployment Guide

本指南指导后续 Agent 如何高效使用 Google AI Stitch MCP 服务器设计精美产品落地页、解决生成超时问题及部署包含地理位置国际化的 Cloudflare Pages。

---

## 1. 项目与设计系统创建 (Project & Design System)

- **项目创建**：使用 `create_project` 初始化项目。
- **应用 Design Tokens**：通过 `create_design_system` 定义统一主题（如圆角风格、字体、暗色 HSL 调色板），并调用 `update_design_system` 应用到项目。
- **美学一致性**：调用 Stitch 提示词生成界面时，始终传入 `designSystem` ID 以保持 UI 风格统一。

---

## 2. 屏幕生成超时解决机制 (First Principles Timeout Recovery)

`generate_screen_from_text` 工具属于重度任务，在网络抖动时容易遇到 HTTP 超时或 `unexpected EOF` 报错。**但云端生成任务仍在后台异步继续执行**。

### 异步恢复标准工作流：
1. **触发生成**：调用 `generate_screen_from_text`。若遇到超时或报错，**切勿判定为彻底失败**。
2. **异步轮询**：不重复发送重度生成指令，改调用 `list_screens` 轮询当前项目屏幕列表。
3. **轮询模式**：
   - 间隔 30 秒。
   - 运行 `list_screens`。
   - 检索目标生成的屏幕。
   - 若未就绪，重试（最多 10 次）。
4. **直链获取**：`get_screen` 在大尺寸设计时也可能超时。可直接提取 `list_screens` 返回元数据中的 `htmlCode.downloadUrl`，使用 `read_url_content` 工具拉取页面代码。

---

## 3. Cloudflare Pages 静态目录与 GEO i18n 中间件

- **静态资产目录**：网站静态文件统一放置在 `cloudflare/eqt-website` 目录中。
- **中间件配置**：Cloudflare Pages Functions 中间件 (`_middleware.js`) 必须存放在 `cloudflare/eqt-website/functions/` 目录中，Wrangler 部署时会自动编译该子目录。
- **Cookie 与 LocalStorage 结合**：
  - 中间件截获 `CF-IPCountry` 标头写入初始 Cookie `eqt-lang=zh`（针对 CN, HK, TW, MO 等中文地区）或 `eqt-lang=en`。
  - 前端脚本优先读取 `localStorage`（用户显式设置），其次回退至 `eqt-lang` Cookie，最后回退至 `navigator.language`。
  - 手动切换语种时必须同时写入 `localStorage` 与长效 `eqt-lang` Cookie（如 365 天），防止后续访问被中间件覆盖。
