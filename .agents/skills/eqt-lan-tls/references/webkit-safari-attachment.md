# WebKit / Safari HTTPS 附件下载与内联媒体安全规范 (WebKit Safari Attachment & Media Spec)

本参考文档规定了在 LAN-TLS（HTTPS）环境下，移动端（iOS / iPadOS Safari、WebKit 内核）文件附件下载与内联媒体传输的安全沙箱基线。

---

## 1. WebKit / Safari 附件下载严格约束 (Strict Attachment Requirements)

### 1.1 缓存头冲突规避 (Cache-Control vs WebKit Sandbox)
- **底层成因**：在 HTTPS 协议下进行文件附件下载（`Content-Disposition: attachment`）时，iOS / iPadOS Safari 的底层下载沙箱（`NSURLSessionDownloadTask`）严格遵循 RFC 约束：如果服务端返回了 `Cache-Control: no-cache` 或 `no-store` 以及 `Pragma: no-cache`，WebKit 会认为该数据不可落盘暂存，直接中断网络连接并抛出系统级错误 **“无法下载此文件 / 无法下载，请重试”**。
- **正确配置**：必须使用 `Cache-Control: private, no-transform`，并彻底移除 `Pragma` 和 `Expires` 头。

### 1.2 显式 MIME Content-Type
- 严禁对附件下载返回空白或完全依赖自动嗅探。
- 对 `.zip` 强制返回 `Content-Type: application/zip`；
- 对常规文件优先通过扩展名映射，未识别类型回退使用 `application/octet-stream`，杜绝 Safari 因 MIME 缺失而拒绝保存。

### 1.3 Range 探测防误判
- Safari 在发起附件下载前通常会预发探测请求（如 `Range: bytes=0-1`）；
- 若分块请求完全交付成功，切勿在服务器日志或状态机中标记为“传输中断 (Transfer interrupted)”，防止前端轮询产生误报。

---

## 2. 内联多媒体传输与安全沙箱规范 (Inline Media Security & Zero-Job Isolation)

### 2.1 Stored-XSS 防护与白名单下发
- **不可信文件隔离**：不可信文件（如 `.svg`, `.html`, `.xml`, `.js` 等）严禁以内联方式（`Content-Disposition: inline`）下发。即使客户端携带 `?inline=1` 亦必须由服务端强制降级为 `attachment` 并应用私有缓存规则。
- **内联白名单**：仅放行安全栅格图（`png, jpg, jpeg, webp, gif, bmp, avif, ico`）。

### 2.2 CSP Sandbox 隔离
- 所有内联静态响应必须注入强安全标头：
  ```http
  Content-Security-Policy: default-src 'none'; sandbox
  X-Content-Type-Options: nosniff
  ```
- 效果：即使用户通过顶层窗口新标签页直接打开图片，浏览器也能完全剥离同源脚本执行权限与 DOM 访问权限，杜绝利用 SVG 载荷窃取 LocalStorage 或伪造请求。

### 2.3 被动加载零 Job 解耦 (Zero-Job Isolation)
- `<img>` 等内联流式请求属于被动资产加载，**严禁调用 Transfer Manager 创建并广播 Transfer Job**（`queued/started/completed`）；
- 数据流直接以 `io.Copy(w, reader)` 直出，避免多图加载或断线重连回放时引发全房间事件风暴与 UI 列表抖动。

### 2.4 统一带宽节流 (Unified Bandwidth Throttling)
- 内联媒体传输必须与常规下载统一挂载到带宽调度器（`bandwidth.Scheduler`）；
- 在受限（免费降级）会话下同样执行每写节流，杜绝攻击者通过图片内联或大图预览旁路绕过下载限速。

### 2.5 流就绪前置判定 (Rendezvous Readiness Before Header Commit)
- 在跨节点中继/对端流式代理模式下，必须等待发送端流建立就绪后才可发送 `WriteHeader(200)`；
- 严禁在尚未拿到有效数据流前提前提交 200 OK，防止超时阶段产生多余的 WriteHeader 异常或给客户端造成破图截断。
