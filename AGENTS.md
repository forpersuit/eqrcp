# Universal Engineering Constitution & Project Profile

> **顶层规格权威来源**：[`docs/UNIVERSAL_ENGINEERING_CONSTITUTION.md`](docs/UNIVERSAL_ENGINEERING_CONSTITUTION.md)
> **初衷宣言 (The Prime Intent)**：
> **让委托变得安全且廉价：任何结论都带着可被第三方廉价核验的证据，任何行动都带着退路，任何裁判都独立于被裁判者。**
> 守护两样稀缺资源：**人类的注意力与信任**，以及**系统未来的修正自由（Optionality）**。
> 本宪法对抗的不是不可避免的错误，而是**被隐藏的错误、被放大的错误、以及被合理化的错误**。

---

# 【通用工程宪法 (Universal Engineering Constitution)】
*适用于任何语言、技术栈、架构与团队规模的软件工程。除人类签发带工单的 Waiver 外，不可违背。*
*执行层级标注：〔H〕= 机器门禁阻断；〔E〕= 必须附带可复核客观工件；〔J〕= Reviewer 主观审议。*

## 0. 元决策与仲裁公理 (Meta-Decisions)
- **[M1] 优先级铁律**：$\mathbf{\text{机器门禁 (G)} > \text{项目反射表 (R)} > \text{宪法硬不变量 (I)} > \text{初衷推断}}$。初衷仅用于无规则匹配的冷启动场景，绝对不得用于为违反门禁或反射规则开脱。〔H〕
- **[M2] 仲裁协议 (Lowest Future Cost)**：规则冲突时，以“本仓库未来维护成本最低（Optimize for Deletion）”为标尺裁决；必须列出 ≥2 个方案对比影响面，并在 Commit 中以 `Arbitration:` 留痕。〔E〕
- **[M3] 认知诚实声明**：未验证即写 `[未验证]`，严禁写“应该通过”；无法执行的检查显式说明原因。〔E〕
- **[M4] 规则生命周期与预算**：每条项目规则必须记录其事故出生事件；条数受预算约束，长期零触发者定期进入删除评审。〔E〕
- **[M5] 行动前显式声明**：非平凡变更前，必须显式陈述：`Touch set: [...] | 命中反射: [...] | 无匹配依据: [...]`。〔E〕

## 1. 架构拓扑硬不变量 (Architectural Invariants)
- **[I1] 单一领域所有权**：每个业务领域仅有一模块拥有其核心逻辑与数据事实。严禁使用局部 import 或动态注入规避循环依赖；出现循环说明归属错误，必须做领域重聚。〔H〕
- **[I2] 知识唯一 (DRY)**：同一业务知识（算法、阈值、规则）在系统内只有唯一的权威定义。同一知识第二次出现（Second-Use）时，必须按 [W3] 先重构切旧调用，严禁就地复制微调。〔H/E〕
- **[I3] 表现层零业务决策**：界面、模板、路由分发 Handler、CLI 外壳只做展示格式化与封闭枚举映射。
  *判别三问（任一为“是”即属业务逻辑，必须下沉领域层）*：
  1. 第二客户端测试：新增另一种客户端（CLI/API/移动端），这段逻辑是否需要重写并保持一致？
  2. 规则测试：是否对领域字段做比较运算（`==`, `>`, `<`）、阈值判断、权限判定或跨字段聚合推导？
  3. 后果测试：写错了后果只是显示难看，还是业务状态/金额/权限错误？
  业务层下发语义化纯值（如 `canRetry: bool`, `displayStatus: string`），表现层仅做只读呈现。〔H〕
- **[I4] 边界解析，内部可信**：外部输入仅在边界解析一次并转为强类型；内部不再重复防御校验。密钥与凭据严禁入库。〔H/E〕
- **[I5] 单向依赖方向**：高层策略依赖抽象，不依赖低层细节；领域核心层严禁依赖表现层、基础设施或具体框架。〔H〕
- **[I6] 显式状态机**：实体生命周期使用显式状态枚举与转移表定义，使非法状态在代码结构中不可表达。〔E/H〕
- **[I7] 错误向上传播与大声失败 (Fail Loud)**：错误必须被显式处理、包裹翻译或向上传播，严禁空 catch、忽略错误返回值或在错误分支返回默认兜底值。〔H〕
- **[I8] 并发生命周期与状态归属**：所有异步任务/协程/线程必须具有明确的生命周期所有者、超时控制、取消路径与错误上升通道；写操作需声明幂等性。〔H/E〕
- **[I9] 数据迁移可逆性**：数据结构变更必须遵循“扩展 $\rightarrow$ 迁移 $\rightarrow$ 收缩”向前向后兼容序列；不可逆操作必须显式打标并经人工双签。〔E〕

## 2. 工作流与演进律 (Workflow & Change Disciplines)
- **[W1] 意图先行**：每次非平凡变更前，必须明确假设、非目标（Non-goals）与可证伪的验收条件。〔E〕
- **[W2] 外科手术式克制与 Touch Set**：$\text{Touch Set} = \text{实现意图的最小文件} + \text{去重逻辑的所有调用点}$。范围之外的瑕疵仅记录入待办，严禁在当前变更中顺手格式化或重命名无关代码。〔H〕
- **[W3] 堆叠两阶段变更法 (Stacked Two-Phase Commits)**：变更涉及复用已有逻辑时，严禁在单次不可验证的混合 Diff 中同时做重构与新业务，必须拆分为同一分支上的两个独立提交：
  1. **Commit 1 (`Change-Type: refactor`)**：纯保真重构，提取公共逻辑并全量切换旧调用。**门禁铁律：测试文件 Diff 必须为空，全量测试 100% 保持绿灯。**若缺乏测试，先以独立提交补齐特征测试（Characterization Test）。
  2. **Commit 2 (`Change-Type: feature`)**：基于稳定抽象接入新业务。
  *熔断机制*：Commit 1 影响文件超过阈值 $N$，必须停下向人类升级，并登记技术债务。〔H〕
- **[W4] 红绿测试优先**：修复缺陷前，必须先提供一个在当前代码上**稳定复现失败（Red）**的测试用例；修复后变绿（Green）。〔E〕
- **[W5] 单一意图提交**：每个提交对应单一意图，具备独立回滚能力。〔H〕
- **[W6] 最简可用形态 (Simplicity & YAGNI)**：不为“显得工程化”引入未被证明的抽象、过度分层或动态插件机制。〔J/E〕

## 3. 自动化门禁与交付律 (Gates, Not Promises & DoD)
- **[G1] 测谎仪三件套 (Anti-Cheating Meta-Gate)**：拦截反吞错（空 catch、`_ = err`）、反压制（新增 `nolint`, `ts-ignore`, `skip` 等需有效 Waiver）、反篡改裁判（禁止同 commit 修改代码与门禁/断言）。〔H〕
- **[G2] 差异棘轮机制 (Diff Ratchet)**：门禁只阻断本次 Diff 新增违规，存量记入基线；基线只降不升。〔H〕
- **[G3] 本地求快，CI 求真**：本地 hook 提供秒级反馈，权威门禁由独立 CI 重新构建执行，以 CI 结果为准。〔H〕
- **[G4] 作者 ≠ 验证者**：代码作者绝不充当验收裁判；验证由独立上下文或 CI 机械执行。〔E〕
- **[G5] 带期限的豁免契约 (Waivers)**：任何偏离硬规则必须具备工单、理由、责任人与过期时间。〔H〕
- **[G6] 机器证据链交付 (DoD Standard)**：交付汇报必须包含：修改清单（对照 Touch Set）、物理验证证据（命令与真实退出码）、排查工件（查询命中数归零）。〔E〕
- **[G7] 门禁报错必须可行动**：门禁报错必须包含违反规则、原因及推荐修正路径。〔H〕

---

# 【项目专属绑定表 (EQT Project Binding Profile)】
*本节依据通用宪法第五部分规范编写，绑定当前仓库的具体技术栈、物理路径与特异性反射。*

## 1. 技术栈与运行时声明 (Stack & Runtime)
- **后端**：Go 1.22+，原生标准库网络与 HTTP，自研 P2P/LAN-TLS/Chat 传输引擎。
- **桌面端**：Wails v2 跨平台桌面壳，Go 与前端双向绑定。
- **前端与模板**：Svelte 桌面端单页应用、Go 原生 HTML 模板（`pkg/pages/`）。
- **外部基础设施**：Cloudflare Workers / D1 DRM 授权中心。

## 2. 确定性命令映射 (Command Mappings)
- `test`: `go test ./...` 或 `go test ./server ./cmd`
- `build-cli`: `go build -o eqt .`
- `build-windows-acceptance`: `scripts/deploy-windows-results.sh`
- `gate`: `scripts/check-gates.sh`
- `hook-install`: `scripts/install-hooks.sh`

## 3. 领域拓扑地图 (Domain Topology Map)
- **业务领域与拥有者 (Domain -> Owning Module)**：
  - 文件传输与会话协议：`pkg/server/`、`pkg/chat/v2/`
  - 载荷打包与解包：`pkg/body/`
  - 配置与持久化：`pkg/config/`
  - 局域网 TLS 与证书：`pkg/cert/`
  - 二维码渲染：`pkg/qr/`
- **表现层与适配层路径**：
  - 浏览器端界面模板：`pkg/pages/`（继承通用宪法 [I3]，仅做纯值呈现）
  - 桌面端 GUI 界面：`desktop/gui/frontend/`（详见 [`desktop/gui/frontend/AGENTS.md`](desktop/gui/frontend/AGENTS.md)）
- **依赖方向硬约定**：底层 `pkg/` 严禁反向依赖 `cmd/` 或 `desktop/gui/`。

## 4. 门禁工具落地映射 (Gate Implementation Map)
- 宪法 [G1] 测谎仪 -> `scripts/check-gates.sh`（拦截 `//nolint`, `@ts-ignore`, `as any`, `_ = err`, 空 catch）。
- 宪法 [I3] 表现层扫描 -> `scripts/check-gates.sh`（拦截前端模板中的内联 `onclick=`）。
- 宪法 [G3] 预提交钩子 -> `.git/hooks/pre-commit`（由 `scripts/install-hooks.sh` 自动生成，执行门禁与 Windows 产物构建）。

## 5. 项目专属反射表 (Project Reflexes - 触发 $\rightarrow$ 动作 $\rightarrow$ 替代方案)
- **[R-1] WSL Git Push 代理反射**
  - **触发**：在 WSL 环境下向 GitHub 执行 `git push`。
  - **动作**：必须使用 `scripts/git-push-smart.sh`。
  - **违规后果**：直连网络超时 240s 挂死。该脚本若 `ping x.com` 通则直连，不通则自动走 Windows 宿主机代理（SSH 22 / ProxyCommand）。
- **[R-2] 代码检索工具反射**
  - **触发**：在终端检索代码或文本。
  - **动作**：必须使用 `rg`（ripgrep），严禁调用 `grep`。
- **[R-3] 变更交付闭环反射**
  - **触发**：完成一项功能修改或缺陷修复。
  - **动作**：本地自测全绿后，除非用户明确要求不推，必须执行 `git add`, `git commit`, 并使用 `scripts/git-push-smart.sh` 推送到远端。严禁遗留未跟踪调试脏文件。
- **[R-4] 功能版本自增反射**
  - **触发**：新增任何业务功能或特性（`feat`）。
  - **动作**：小版本号（patch/minor）必须 +1（同步更新 `pkg/version/version.go` 及相关版本映射）。
- **[R-5] 用户交互提示反射**
  - **触发**：向用户展示错误、警告、大小超限或引导提示。
  - **动作**：严禁使用浏览器原生 `alert()` 弹窗！
  - **替代方案**：使用应用内通知（如追加系统消息至聊天流、页面内通知栏或全局 Toast）。
- **[R-6] 沟通语言与第一性原理**
  - **触发**：与用户交流。
  - **动作**：强制使用中文；凡事追溯第一性原理，直击问题本质。
- **[R-7] 后端非阻塞异步调用反射**
  - **触发**：处理客户端状态轮询 HTTP 请求（如 `/status`）或 Wails GUI 主线程中。
  - **动作**：严禁同步阻塞式发起网络 HTTP 请求或进行高时延 I/O。必须使用后台 goroutine 异步拉取并在内存中更新缓存。
- **[R-8] 磁盘 I/O 隔离与内存缓存反射**
  - **触发**：高频查询数据（证书 `.lic`、配额限额）。
  - **动作**：必须实施内存只读缓存，仅在发生写入或重置时更新缓存。
- **[R-9] 设备指纹匹配防呆反射**
  - **触发**：硬件特征指纹比对。
  - **动作**：任何一方为空字符串 `""` 直接跳过比对，不得视作匹配成功；至少需要 2 项有效非空指纹相匹配才算合法。
- **[R-10] 品牌图标与资源生成守则**
  - **触发**：修改产品 Logo、品牌或桌面图标。
  - **动作**：修改源图 `docs/img/transparent.png` 和 `docs/img/logo-design-horizontal.png` 后，必须执行 `go run ./scripts/icon-assets docs/img/transparent.png docs/img/logo-design-horizontal.png` 重新生成衍生资源。

## 6. 参数与阈值 (Parameters)
- 爆炸半径熔断阈值 $N = 5$（重构影响文件超过 5 个必须向人类升级）。
- 单任务 Token 预算建议：4,000；会话预算建议：30,000。
- 交付必须遵循通用宪法 [G6] 的机器证据链汇报（改动清单 / 物理验证命令与退出码 / 技能沉淀声明）。
