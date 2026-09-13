# 技能编写规范依据 (Skill Authoring Standard)

本文件是 `CLAUDE.md` **Rule 14 — Skill Authoring Standard** 的**依据与出处**。
Rule 14 正文只写祈使式硬规则（`CLAUDE.md` 每会话全量注入，必须省 context）；**为什么这么定、官方原文怎么写、哪些是本仓库自定**，全部收在本文件。

## 0. 证据分级约定

本文件逐条标注证据强度，**禁止把推断写成明文**（这是本项目 R36–R43 全部争议的共同形态：把推断写成明文）：

| 标注 | 含义 |
|---|---|
| **【明文】** | 官方文本逐字如此，且已由本文档第 4 节的命令**当场机器回读**过 |
| **【推断】** | 由【明文】推出，未直接读到该表述 |
| **【未验证】** | 来自二手转述、尚未自证；引用时须保留此标注 |
| **【house rule】** | 官方无此条，本仓库自定。**不得表述为「规范要求」** |

**负向断言义务**：任何「文档没有 X / 规范未规定 Y」的断言，必须附上**包含 X / Y 词元**的检索模式及其结果，否则只能表述为「在我使用的检索模式下未发现」。检索模式本身是证据的一部分。

## 1. 官方硬约束【明文】

来源：Agent Skills 规范 <https://agentskills.io/specification>（Anthropic 平台文档指向的权威文本）

| 约束 | 原文要点 |
|---|---|
| `name` 必填，1–64 字符 | `Max 64 characters. Lowercase letters, numbers, and hyphens only. Must not start or end with a hyphen.` |
| `name` **须与父目录同名** | `Must match the parent directory name` |
| `description` 必填，1–1024 字符 | `Max 1024 characters. Non-empty. Describes what the skill does and when to use it.` |
| 可选字段仅 `license` / `compatibility` / `metadata` / `allowed-tools` | 规范内各有独立章节 |

> **`description` 必须同时含「做什么」与「何时用」是规范明文**（`Describes what the skill does and when to use it`），不是本仓库的偏好。
>
> 跨客户端分发（claude.ai / Skills API）只允许上表字段。若用了 harness 专有 frontmatter 字段会导致打包失败 —— **【推断】**，未第一手复现打包报错，引用时保留此标注。

## 2. 官方建议【明文】（不强制，但违反有明确代价）

| 建议 | 出处原文 | 违反的代价 |
|---|---|---|
| `SKILL.md` 正文 **< 500 行** | best-practices：`Keep SKILL.md body under 500 lines for optimal performance` | 触发时全文入 context，行长即 token 成本 |
| 文件引用**只可一层深** | spec：`Keep file references one level deep from SKILL.md. Avoid deeply nested reference chains.` | 深层引用会遭遇部分读取（`head` 式预览）而静默丢信息 |
| reference **> 100 行**须顶部加 TOC | best-practices：`For reference files longer than 100 lines, include a table of contents at the top. This ensures Claude can see the full scope of available information even when previewing with partial reads.` | 部分读取时看不到全貌，漏读内容 |
| 路径**一律正斜杠**（含 Windows） | best-practices：`Always use forward slashes in file paths, even on Windows` | Windows 检出侧路径失配 |
| `description` 用**第三人称** | best-practices：`Always write in third person. The description is injected into the system prompt, and inconsistent point-of-view can cause discovery problems.` | 触发/发现失败 |
| **关键用例放最前** | Claude Code skills 文档：`Put the key use case first: the combined description and when_to_use text is truncated at 1,536 characters in the skill listing to reduce context usage.` | 超 1536 字符时**从后往前丢**，放后面的用例永不出现 |
| **避免时效性信息** | best-practices 章节标题：`Avoid time-sensitive information`（可容忍折叠进 "old patterns" 段） | 稳定层写入日期/版本后必然过期，且每次触发都消耗 token |

> **纠错留痕（2026-09-14）**：曾有一版转述称「Anthropic 文档要求第三人称，而 agentskills.io 要求祈使句，二者冲突」。**第一手回读否证了「冲突」**：对 spec 页检索 `point of view|voice|person` 零命中 —— **规范对语态沉默**，不存在冲突，只有 best-practices 一处明文。**凡「相互冲突」的断言都必须先自证双方各自明文，否则即为虚构。**

**【未验证】**：有转述称 `SKILL.md` 另受「≤ 5000 tokens」约束。本次仅第一手确认了「< 500 行」，未读到 token 上限表述。

## 3. 官方机制事实【明文】

### 3.1 发现路径（决定技能能否被读到）

Claude Code 只从以下位置发现技能：

- `.claude/skills/<skill-name>/`（项目）
- `<subdir>/.claude/skills/`（嵌套子目录）
- `~/.claude/skills/`（个人）
- `/etc/claude-code/.claude/skills/`（企业）
- `<plugin>/skills/`（插件）

**`.agents/skills/` 不在发现路径内。**

> 负向断言自证：在 skills 文档页检索 `.agents/skills` → 零命中；再以更宽的词元 `.agents` 复检 → 仍零命中；而 `.claude/skills/`、`~/.claude/skills/`、`/etc/claude-code/.claude/skills/` 均有命中。
> **推论**：内容只放在 `.agents/skills/` 的技能，**对 Claude Code 而言从不作为技能存在** —— 既不会被 description 自动触发，也不会出现在 `/skills` 列表里。这正是本仓库技能长期腐化却无人察觉的结构性原因。

### 3.2 软链目录被支持（本仓库桥接方案的依据）

原件逐字：

> `Symlinked folders: a <skill-name> entry in the enterprise, personal, or project location can be a symlink to a directory elsewhere on disk. Claude Code reads SKILL.md from the target and loads the skill once even if several locations point at the same target.`

两点关键：
1. **文件夹级**软链被明文支持（企业/个人/项目三处皆可）。
2. `loads the skill once even if several locations point at the same target` —— 即**软链天然满足单一事实源**，不会因多处指向同一目标而重复加载。

**【未验证】**：文件级 `SKILL.md` 软链、`references/` 子目录软链**无文档依据，禁止使用**（这是我方保守选择，非官方禁止）。插件技能的软链行为另有规则（`handle symlinks differently`）。

### 3.3 热加载

> `Claude Code picks up the change within the current session, without a restart. If you create a top-level skills directory that didn't exist when the session started, restart Claude Code so it can watch the new directory.`

即：在**已存在**的技能目录内新增/修改技能，当前会话即生效；只有当会话启动时**顶层**技能目录尚不存在才需要重启。

会话内枚举手段：`/skills`、`/context`（看 Skills 行实际 token）、`/doctor`，或独立进程探针 `claude -p "List the skills you have available"`。

## 4. 本仓库自定规则【house rule】

以下**官方均无此条**，属本仓库选择；引用时**不得**表述为「规范要求」。

1. **单一事实源**：实现细节不得在技能内复述（复述即漂移）。技能写「规格来源：`path:line`」，不写机制的再实现。
   > 官方无「不得重复源码」条款。
2. **稳定层禁入审查留痕**：`SKILL.md` 不得出现日期、轮次、基线版本、「本轮更正」横幅；审查留痕入 `docs/`。
   > 官方只有「避免时效性信息」，**并未**规定审查留痕不得进入技能正文。措辞不得扩大。
   >
   > **可操作性判据（本条自证得出）**：单纯写「不得出现时效内容」无法套用 —— 账本头自称「162 条」「31 轮」也含数字与轮次。真正的判据是**该数字与谁同生命周期**：
   > - **本文件自身的清单**（该文件的条数、覆盖轮次）——**可留**。它与内容在同一 commit 内更新，不会漂移。
   > - **指向另一个文件的数字**——**禁止**。它所在的文件与它描述的对象**不同步**，改动一方必然漏改另一方。改写为「以该文件为准」。
   >
   > 实例（2026-09-14）：`SKILL.md` 曾写「159 条红线」「第 1 轮至第 30 轮」「633 passed assertions」「20 个测试套件」，四处均指向**别的**文件；其中计数已在 E14/E16 与 R42-1 中至少错三次。本仓库当轮把四处全部改为「以该文件为准」/删除。
3. **技能落点与桥接**：权威内容存放 `.agents/skills/<name>/`（跨客户端共享，供 Codex 等读取），并在 `.claude/skills/<name>` 建**目录级软链**指向 `../../.agents/skills/<name>`（相对路径，跨克隆可用）。**禁止在 `.claude/skills/` 内复制内容**。
   > 依据是 §3.2 的软链明文 + §3.1 的发现路径事实；「以 `.agents/` 为权威源」本身是 house rule。
4. **检出侧须 `core.symlinks=true`**。
   > **【推断】**：`core.symlinks` 未设置/为 `false` 时（Windows 侧默认），git 会把软链检出为**纯文本文件**，桥接失效且表现为「技能目录里有个同名纯文本文件」。未在 Windows 实机复现，故保留标注。
5. **`description` 客户端中立**：`.agents/skills/` 为跨客户端共享目录，`description` 与正文**不得出现具体客户端名称**（如 `Use when Codex needs to`）——同一份文本会同时被另一侧加载，写死一方即污染另一方的触发面。
   > 官方无「禁止提及客户端」条款；这是本仓库「一份内容跨客户端共享 + 双侧桥接」架构的必然要求。**【house rule】**
   >
   > 实例（2026-09-14）：`eqt-dev`、`eqt-drm`、`eqt-lan-tls` 三个技能的 description 均含 `Use when Codex needs to`。该缺陷在桥接前**不可见**（技能不在 Claude Code 发现路径内，无人读到）；桥接后立即显现于 Claude Code 的技能列表。

## 5. 如何重新自证本文件（可证伪义务）

```sh
export https_proxy=http://127.0.0.1:10808 http_proxy=http://127.0.0.1:10808   # WSL 直连被阻断时
cd /tmp
curl -sSL "https://code.claude.com/docs/en/skills" -o skills.html
curl -sSL "https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices" -o bp.html
curl -sSL "https://agentskills.io/specification" -o spec.html

rg -o '<li><strong>Symlinked folders.*?</li>' skills.html          # §3.2 软链明文
rg -c '\.agents' skills.html                                        # §3.1 负向断言（应为 0）
rg -o -i '[^<>]{0,200}(character budget|1%|1536)[^<>]{0,250}' skills.html  # §2 截断预算
rg -o 'Always write in third person[^<]{0,150}' bp.html             # §2 语态
rg -o -i 'time-sensitive' bp.html                                   # §2 时效性章节
rg -o 'Keep SKILL.md body under 500 lines[^<]{0,120}' bp.html       # §2 行数
rg -o -i 'forward slash[^<]{0,120}' bp.html                         # §2 正斜杠
rg -o -i 'over 100 lines|table of contents' bp.html | head -3       # §2 TOC
rg -o -i 'Must match the parent directory name|Max 64 characters|Max 1024 characters' spec.html  # §1
rg -o -i 'one level deep[^<]{0,120}' spec.html                      # §2 一层深
```

**URL 规范形式**：`docs.claude.com` 会重定向到 `code.claude.com`（Claude Code）与 `platform.claude.com`（平台/技能规范），引用请直接写重定向后的规范 URL。

## 6. 相关红线

- 【157】验证性断言须反向自证判别力 —— **扩展适用面**：不只管测试夹具，也管**文档检索**。本文件 §0 的「负向断言义务」即其文档侧落地。
- 【160】重构不是免于验证的。
- 【161】摘要层必须对实现可证伪。
- 【162】悬空引用即缺陷 —— 引用编号 / 路径 / **URL** 前必须机器回读其存在性。
