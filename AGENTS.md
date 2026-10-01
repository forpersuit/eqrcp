# EQT Engineering Constitution & Repository Guidelines

> **初衷宣言 (The Prime Intent)**：
> **让委托变得安全且廉价：任何结论都带着可被第三方廉价核验的证据，任何行动都带着退路，任何裁判都独立于被裁判者。**
> 守护两样稀缺资源：**人类的注意力与信任**，以及**系统未来的修正自由（Optionality）**。
> 本宪法对抗的不是不可避免的错误，而是**被隐藏的错误、被放大的错误、以及被合理化的错误**。

---

## 0. 【M 元层】(Meta Layer - 决策程序与仲裁协议)
*严格 ≤30 行。作为规则的 Schema 与冷启动决策程序，而非空泛哲学。*

- **优先级铁律**：$\mathbf{G\text{ 门禁层} > R\text{ 反射层} > P\text{ 就近层} > M\text{ 元层}}$。元层绝对不得用于为违反反射规则与门禁开脱。
- **仲裁程序**：仅在“无匹配反射规则”或“两条规则冲突”时唤醒。以**本仓库未来维护成本最低（Lowest Future Cost）**为唯一裁决标尺；在 Commit 信息中以 `Arbitration:` 显式说明方案对比与裁决依据。
- **行动前显式工件**：在执行非琐碎变更前，思考与陈述中必须包含：
  `Touch set: [目标文件清单] | 命中反射: [规则编号] | 无匹配依据: [裁决理由]`
- **元不变量五条**：
  1. **声称不得超出证据 (Claim ≤ Evidence)**：每个结论标注认知状态，观测必有可复现产物。
  2. **裁判必须独立 (Independent Referee)**：做事者不得控制验证者；门禁文件受保护。
  3. **变量隔离与步骤正交 (Variable Isolation)**：观测、保真整理、改变行为分步进行，一次只引入一个可归因变化。
  4. **行动可撤销且力度匹配 (Reversibility & Proportionality)**：不可逆操作需人类复核；失败干预必须完整回滚而非叠加新补丁。
  5. **单一真源与无循环归属 (Single Source & Clean Topology)**：事实与责任归属唯一；出现循环即归属错误，必须做归属重聚而非打补丁。

---

## 1. 【R 反射层】(Global Reflex Layer - 全局硬反射规则)
*格式统一为：触发 $\rightarrow$ 动作 $\rightarrow$ 替代方案 / 违规后果。*

- **[R-1] WSL Git Push 代理反射**
  - **触发**：在 WSL 环境下执行代码推送（`git push` 到 GitHub）。
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
- **[R-7] 演进重构：堆叠两阶段提交反射 (Stacked Two-Phase Commits)**
  - **触发**：实现需求时需要第二次使用某个已有业务逻辑（Second Use）。
  - **动作**：禁止就地微调复制！必须拆分为**同一分支中的两个堆叠独立提交**：
    1. **Commit 1 (`Change-Type: refactor`)**：纯保真重构。用 `rg` 排查所有副本，提取到公共领域模块并替换所有旧调用。**门禁铁律：已有测试断言零修改，单测全绿，100% 行为保真。**
    2. **Commit 2 (`Change-Type: feature`)**：基于已稳定的抽象挂接新业务。
  - **熔断机制**：若 Commit 1 影响文件超过 5 个或跨领域，停止自作主张，升级由人类确认。

---

## 2. 【P 就近层】(Path-Scoped Layer - 领域与架构硬不变量)

### 2.1 前端领域与页面模板 (`desktop/gui/frontend/`, `pkg/pages/`)
- **[P-FE-1] 表现层零业务逻辑 (No Business Logic in Rendering)**
  - **规则**：HTML 模板、前端组件、路由 Handler 仅充当纯值映射（Data -> DOM/JSON），严禁做业务决策。
  - **判别三问**：(1) 第二客户端（如 CLI/移动端）是否需要重写这段逻辑？(2) 产品经理是否会写进需求文档？(3) 写错后果是显示难看还是状态/金额/权限错误？凡符合其一，立即下沉后端。
  - **表现层允许**：无状态纯函数格式化（时间、字节、货币）、语义枚举映射到样式、基于后端视图模型布尔值的显隐（`{#if vm.canEdit}`）。
  - **表现层禁止**：比较运算符（`==`, `!=`, `>`, `<`, `>=`, `<=`）、算术计算、多字段状态派生（`a && b || c`）。
- **[P-FE-2] 数据状态与渲染纯函数分离 (State-Template Separation)**
  - **规则**：渲染模板函数（以 `render` 开头）中禁止直接修改全局 `state`。状态变更由 Controller 或事件统一调度，渲染仅做 `Data -> DOM` 纯映射。
- **[P-FE-3] 标准声明式事件绑定 (Declarative Event Listeners)**
  - **规则**：严禁在 HTML 字符串中拼接内联的全局 `onclick="..."` 事件！必须使用标准 `addEventListener` 进行注册绑定。
- **[P-FE-4] 模块化防膨胀 (Modularity & Separation)**
  - **规则**：禁止向 `main.js` 无限堆砌新功能，独立交互与模板必须拆分到 `src/` 子文件中。

### 2.2 后端领域与核心运行时 (Go 后端)
- **[P-BE-1] 非阻塞异步外部网络调用 (Non-blocking Asynchronous Operations)**
  - **规则**：客户端状态轮询 HTTP 请求（如 `/status`）或 Wails GUI 主线程中，绝对禁止同步阻塞网络 I/O。必须使用后台 goroutine 异步拉取并在内存中更新缓存。
- **[P-BE-2] 磁盘 I/O 隔离与内存缓存 (Memory Cache Isolation)**
  - **规则**：高频查询的数据（证书 `.lic`、配额限额）必须实施内存缓存。只在发生写入或重置时更新缓存。
- **[P-BE-3] 设备指纹匹配空值防呆 (Robust Fingerprint Matching)**
  - **规则**：硬件特征比对时，任何一方值为空字符串 `""` 直接跳过，不得视为匹配成功。至少需要 2 项有效非空指纹相匹配才算合法。
- **[P-BE-4] 单一领域所有权与无循环打补丁 (One Owning Module per Domain)**
  - **规则**：每个业务领域有且仅有一个拥有者模块。严禁在函数内编写局部 import 绕过循环依赖。一旦出现循环导入，唯一结论是分层职责归属错误，必须先做领域重聚。

---

## 3. 【G 门禁层】(Gate Layer - 物理门禁与交付闭环)
*Gates, Not Promises: 提示词的承诺保护不了代码，物理门禁才是真相。*

### 3.1 物理门禁实现 (Pre-commit & CI)
- **测谎仪门禁**：拦截新增压制标记（`//nolint`、`@ts-ignore`、`as any`）、拦截吞错（`_ = err`、空 catch）、拦截断言弱化与测试 skip/only。
- **表现层扫描**：扫描 HTML/模板中的内联 `onclick=` 与非法比较算式。
- **Windows 验收发布门禁**：通过 `scripts/install-hooks.sh` 安装 hook，每次提交前自动校验并构建 Windows 交付件（`scripts/deploy-windows-results.sh`）。

### 3.2 交付验收标准 (Rule 15 DoD - Definition of Done)
任务完成必须同时满足以下客观指标：
1. **编译与测试**：代码编译零警告，测试套件 100% 通过且零静默跳过。
2. **工作区整洁**：无临时调试文件，改动完成提交并推送。
3. **交付汇报三要素**：
   - **修改清单 (What was modified)**：修改文件列表及核心逻辑。
   - **验证证据 (How it was verified)**：明确列出执行的命令、真实退出码，并标注认知状态：
     - `[已物理验证]`：有实际执行输出与产物证明。
     - `[代码推演]`：基于静态调用栈分析（未具备运行环境）。
     - `[工程假设]`：因上下文限制所做的合理假设，提醒人类复核。
   - **技能沉淀声明 (Skills Consolidated)**：说明是否依据技能规范更新了 `.agents/skills/`，或给出明确的不需更新理由。

---

## 4. 仓库工程参考与工具索引 (Context & Tooling Index)

### 4.1 项目结构与模块划分 (Project Structure)
本仓库是从 qrcp 衍生出的 Go 跨平台命令行与桌面应用：
- `main.go` 为顶层入口；命令实现位于 `cmd/`。
- `server/` 负责核心传输逻辑；`body/` 负责载荷封装；`config/` 负责配置管理；`qr/` 负责二维码生成；`util/` 与 `logger/` 提供共享辅助。
- `pkg/pages/` 包含浏览器模板与静态前端资源；`desktop/gui/` 包含 Wails 桌面端实现及前端应用。
- `docs/` 保存设计与规划文档；`docs/img/` 保存静态资源；测试使用 Go 原生 `_test.go` 约定并就近组织。

### 4.2 构建与测试常用命令 (Build & Test Commands)
```sh
go test ./...
go test ./server ./cmd
go build -o eqt .
go run . send ./example.txt
go run . receive ./downloads
```
Windows 交付件打包（CLI + Launcher + GUI 三合一）：
```sh
scripts/deploy-windows-results.sh
# 或 CLI-only 快速构建：
GOOS=windows GOARCH=amd64 go build -o eqt.exe ./cmd/eqt
```
Git Hooks 安装：
```sh
scripts/install-hooks.sh
```

### 4.3 编码风格与提交规范 (Conventions & Commits)
- 提交前对修改的 Go 文件运行 `gofmt`。
- 标识符使用清晰的 Go 惯用法：导出标识符用 `CamelCase`，未导出用 `camelCase`，测试用 `TestNameBehavior`。
- 提交信息沿用祈使句动词开头，例如 `Add agent-level transfer repeat`、`Push transfer status updates to browser pages`。

### 4.4 品牌图标与资源生成守则 (Project Skill Notes)
当修改产品品牌、Logo 或桌面图标时，检查每个构建和运行时表面：
- `docs/img/transparent.png` 是方标、托盘图标、favicon 和 App 图标的源图。
- `docs/img/logo-design-horizontal.png` 是横版品牌（如 About 面板）的源图。
- 源图改动后，执行：`go run ./scripts/icon-assets docs/img/transparent.png docs/img/logo-design-horizontal.png` 重新生成派生资源。
- `desktop/gui/build/appicon.png` 供给 Wails App 图标生成。
- `desktop/gui/build/windows/icon.ico` 供给 Windows 可执行文件与安装器图标。
- `desktop/gui/frontend/src/assets/images/logo-universal.png` 供给托盘和桌面前端。
- `pkg/pages/assets/` 下的 favicon 与 logo 通过服务路由供给浏览器模板；禁止将大体积 PNG 内联到 HTML。
- `desktop/gui/tray.go` 内嵌了 `logo-universal.png`；替换该文件后必须重新构建。

---

## 5. 15-Rule 执行律模板 (Execution Template)

### Rule 1 — Think Before Coding (思考先行)
明确陈述假设。遇到不确定性，停下询问而非猜测。出现歧义提供多种方案。存在更简路径时主动提出。

### Rule 2 — Simplicity First (最简可用)
用最小代码解决问题。不写投机性抽象，不添加未要求的功能。若资深工程师认为过于复杂，必须简化。

### Rule 3 — Surgical Changes (外科手术式修改)
只修改必须触碰的代码，清理自己留下的痕迹。不顺手格式化或修改无关相邻代码。

### Rule 4 — Goal-Driven Execution (目标驱动)
明确成功指标，独立循环直到验证通过。不机械按步就班，以达成最终确定性结果为准。

### Rule 5 — Use the Model Only for Judgment Calls (模型用于判断)
模型用于分类、草拟、总结、抽取；不用于确定性数据流转换、路由或重试。代码能回答的，交给代码。

### Rule 6 — Token Budgets Are Not Advisory (Token 预算纪律)
单次任务建议 4,000 tokens，会话建议 30,000 tokens。逼近预算时做总结并新开会话，严禁静默超限。

### Rule 7 — Surface Conflicts, Don't Average Them (暴露冲突)
若两种模式冲突，挑选一种并说明理由，不搞折中平均。

### Rule 8 — Read Before You Write (读后即写)
添加代码前阅读导出符号、直接调用者和共享工具库。理解代码结构原因，避免盲目添加。

### Rule 9 — Tests Verify Intent, Not Just Behavior (测试验证意图)
测试必须编码行为背后的“为什么”，而非仅仅是“是什么”。业务逻辑改变而无法击穿的测试是无效测试。

### Rule 10 — Checkpoint After Every Significant Step (检查点同步)
每完成关键步骤，总结已做内容、验证结果与剩余项。不从无法复述的状态继续。

### Rule 11 — Match the Codebase's Conventions (遵从现有惯例)
代码库惯例高于个人品味。若认为惯例有害，显式提出，严禁私自搞分叉风格。

### Rule 12 — Fail Loud (大声失败)
跳过任何步骤不能宣称“已完成”；跳过任何测试不能宣称“测试通过”。默认暴露不确定性，绝不隐藏。

### Rule 13 — Zero Tolerance for Regression (防止功能退化)
绝不牺牲既有功能来换取新特性。识别并保护修改区域的所有历史并发行为，运行回归验证。

### Rule 14 — Memory & Skill Consolidation (任务反思与技能固化)
- **触发与评估**：在每项任务结束时，评估是否有长期工程价值需要固化（如隐藏配置、环境陷阱、交互命令、构建工作流）。
- **固化规范**：
  - 新领域在 `.agents/skills/<skill-name>/SKILL.md` 定义新技能。
  - 现有领域更新对应技能文件，遵循渐进披露原则保持精炼。
  - 仅记录可复用的集成、排障与环境指南，严禁记录临时业务逻辑。
- **技能编写标准 (Skill Authoring Standard)**：
  1. **按需分层**：`SKILL.md` 只保留最小操作指令与避坑指南（< 500 行）；细节进 `references/`；确定性脚本进 `scripts/`。
  2. **禁入时效内容**：禁止日期、轮次、基线版本横幅，不复述外部文件的计数（复述必然漂移）。
  3. **单一事实源**：写“规格来源：`path:line`”，不写机制的重复实现。
  4. **description 唯一触发面**：第三人称，同时说明“做什么”与“何时用”，核心用例放最前。
  5. **自洽与改后回读**：计数、编号域必须自洽；修改后回读所有关联文件并校验 frontmatter。
- **落点与软链规范**：权威技能置于 `.agents/skills/<name>/`，并在 `.claude/skills/<name>` 建立目录级软链指向 `../../.agents/skills/<name>`。禁止在 `.claude/skills/` 内复制文件。
- **汇报义务**：在最终交付中明确声明更新了哪些技能，或给出无需更新的技术理由。

### Rule 15 — Definition of Done & Delivery Standards (交付标准)
参照本规范 3.2 节的客观标准，严格履行汇报三要素。
