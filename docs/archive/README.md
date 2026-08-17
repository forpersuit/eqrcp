# EQT 顶层文档归档

本目录存放 **不再指导当前实现** 的顶层历史文档。

| 文档 | 原路径 | 归档原因 |
| :--- | :--- | :--- |
| [UIDesignV2_adaptation_2026-05-05.md](./UIDesignV2_adaptation_2026-05-05.md) | `docs/UIDesignV2_adaptation_2026-05-05.md` | UI V2 设计阶段适配计划，已被 `chat/v2-engineering-plan.md` 等 chat 子目录文档取代 |
| [UIDesignV2_describe.md](./UIDesignV2_describe.md) | `docs/UIDesignV2_describe.md` | 同上，UI V2 设计愿景稿 |
| [IMPORTANT_share_mechanism_doc.md](./IMPORTANT_share_mechanism_doc.md) | `docs/IMPORTANT_share_mechanism_doc.md` | Share/Receive 额度与 DRM 约束已被 `payment/plan-tier-features-and-copy.md` 权威取代 |
| [git-hooks-setup.md](./git-hooks-setup.md) | `docs/git-hooks-setup.md` | 描述旧 pre-commit hook（关进程→测试→构建 Wails→存 results）；现 hook 仅调用 `scripts/deploy-windows-results.sh`，`SKIP_WAILS_BUILD` 开关已移除 |
| [pre-commit-hook-summary.md](./pre-commit-hook-summary.md) | `docs/pre-commit-hook-summary.md` | 同上，与 git-hooks-setup 高度重复的旧 hook 总结 |
| [github-workflow-guide.md](./github-workflow-guide.md) | `docs/github-workflow-guide.md` | 零引用孤儿；「缺失 CI/CD」与实际 `.github/workflows/`（ci/release/deploy/deploy-test/d1-backup）冲突，CI 矩阵 Go 版本也已过时 |

**当前权威文档**见 [docs/index.md](../index.md)。

整理日期：2026-08-16（第二批：2026-08-17）
