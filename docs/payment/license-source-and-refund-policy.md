# 授权来源、累加与退款开发方案

> **文档类型**：开发方案（行为契约 + 落地清单）  
> **目录归属**：`docs/payment/`（支付/授权商业规则 SSOT；Portal 契约见 `docs/portal/`，Admin 见 `docs/admin/`）  
> **关联实现**：`cloudflare/eqt-drm-api`、`cloudflare/eqt-website/portal.html`、`terms.html`、`refund.html`  
> **状态**：P0 已落地（source 门禁 / 退款门禁 / 年度黑名单 / 条款披露）；P1+ 见文末

---

## 1. 为什么放在 `docs/payment/`

| 候选目录 | 是否合适 | 原因 |
| :--- | :---: | :--- |
| **`docs/payment/`** | **是** | 来源、兑换窗、累加、退款、拒付吊销都属于「钱与权益」规则，与 `tier-design`、`paddle-payment`、`licensing-double-expiration` 同族 |
| `docs/portal/` | 否（仅交叉引用） | Portal 是用户自助台契约，不承载完整商业规则 |
| `docs/admin/` | 否 | Admin 是运维发码/吊销，不是用户商业政策 SSOT |
| 新建 `docs/code/` | **否** | 仓库无此惯例；实现细节应落在 payment 方案 + 代码注释 |

**维护规则**：改 `source` / 退款资格 / 黑名单阈值时，先改本文，再改 Worker 与条款页。

---

## 2. 第一性原理

1. **一码一来源**：活动赠送与真实购买的权利义务不同，必须可区分。  
2. **可退款 ⟺ 真实支付可逆**：仅 `source=purchase` 且存在合法 Paddle 交易可自助/渠道退款。  
3. **追溯主键是交易 ID**：盗刷/拒付按 `paddle_transaction_id` 吊销；邮箱是通知与风控锚点，不是吊销必要条件。  
4. **条款与代码一致**：黑名单、退款次数限制必须在 Terms / Refund Policy 中披露。

---

## 3. 数据模型

### 3.1 `licenses` 新增/约定字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `source` | TEXT | `purchase` \| `promo` \| `admin` \| `test` |
| `revoked_at` | TEXT ISO | 吊销时间；用于**滚动 365 天**滥用统计 |

**遗留行推断**（`source` 为空时）：

| 条件 | 推断 source |
| :--- | :--- |
| `paddle_transaction_id` 匹配 `txn_01…` | `purchase` |
| `paddle_transaction_id` 匹配 `txn_test_` / `txn_chrome_` / … | `test` |
| 其他 | `admin` |

### 3.2 来源行为矩阵

| source | 自助退款 | 兑换窗 (`expires_at` 作 redeem_by) | 同 tier 时长累加 | 自然失效 |
| :--- | :---: | :---: | :---: | :--- |
| **purchase** | 是（政策内） | 无强制兑换窗 | 年付 term 可累加；**终身同 tier 不可** | 权益到期 / 订阅停 / 退款吊销 |
| **promo** | **否** | **是**（过期未兑 → 不可激活） | **否** | 兑后 `duration_days` 到期 |
| **admin** | 否 | 可选（有 `expires_at`+`duration_days` 时按 promo 窗） | 默认否 | 按发码配置 |
| **test** | 仅本地吊销 | 随意 | 否 | 测试用 |

### 3.3 退款资格（代码 SSOT）

```text
refundable =
  status == active
  AND normalize(source) == purchase
  AND paddle_transaction_id 匹配真实 Paddle 形态 txn_01…
```

合成单号（`txn_test_*` 等）永不走 Paddle Adjustments；见既有 Portal 本地吊销路径。

---

## 4. 累加与终身

| 已有设备权益 | 再兑 | 行为 |
| :--- | :--- | :--- |
| 同 tier **终身** 已激活 | 任意同 tier | **拒绝**（`lifetime_already_owned`） |
| 同 tier **年付** 未过期 | 年付 purchase | 证书到期时间可叠加剩余（既有 activate 累加逻辑） |
| 任意付费 | **promo** | 不叠加；promo 独立时长；若已终身同 tier 则拒绝 |
| PRO 订阅（未来） | 叠码 | 不走码累加；走订阅续费 |

Pro 一阶（STUN / 失败中继流量）与激活码解耦：权益在 license，流量在独立计量（后续文档）。

---

## 5. 退款、盗刷与年度黑名单

### 5.0 状态 vs 原因（不是三套「退款状态」）

**授权生命周期 `status` 只有三类**（与 D1 一致）：

| status | 含义 |
| :--- | :--- |
| `active` | 可用 |
| `suspended` | 暂停（预留） |
| `revoked` | 已吊销，设备对账将 403 |

**退款 / 拒付不是第三种 status**，而是吊销的 **`revoke_reason`**（原因维度）：

| revoke_reason | 业务含义 | 典型触发 |
| :--- | :--- | :--- |
| `refund` | **退款**：买家或商户主动把钱退回原支付方式 | Portal 自助退款成功、Paddle Dashboard 退款、`transaction.refunded`、adjustment `action=refund` |
| `chargeback` | **拒付（退单）**：持卡人向银行争议交易，银行从商户侧扣回款项（常与盗刷相关） | Paddle `adjustment` 的 `action=chargeback`（或等价争议事件） |
| `subscription` | 订阅取消 / 欠费 / 暂停 | `subscription.canceled` / `past_due` / `paused` |
| `admin` | 运营人工吊销 | Admin `POST /revoke` |
| `test` | 测试夹具本地吊销 | `source=test` Portal 路径 |
| `expired` | （预留）过期作废 | 未来任务 |

```text
status        = 机器能不能用（active / revoked …）
revoke_reason = 为什么不能用（refund / chargeback / …）
source        = 码从哪来（purchase / promo / …）
```

**拒付是什么（白话）**：

1. 有人用卡付了 EQT（可能是盗刷）。  
2. 真卡主在银行账单上不认这笔消费 → 向银行 **chargeback / 拒付**。  
3. 银行把钱从 Paddle/商户侧划走；Paddle 通知我们。  
4. 我们 **必须吊销** 对应 `paddle_transaction_id` 的授权码，否则等于白嫖。  
5. 这与「用户在 Portal 点申请退款」不同：拒付由银行发起，用户未必配合。

黑名单统计的是：**滚动 365 天内，purchase 类且 `revoke_reason ∈ {refund, chargeback}`（或遗留空原因）的吊销次数 ≥ 2**。

### 5.1 正常自助退款

Portal → `POST /api/v1/user/refund` → Paddle adjustment → `status=revoked` + `revoked_at` + `revoke_reason=refund` → 邮件 → 客户端 `/verify` 降级。

### 5.2 盗刷 / 银行拒付

不依赖用户点「申请退款」。路径：

```text
Paddle transaction.refunded  → revoke_reason=refund
Paddle adjustment chargeback → revoke_reason=chargeback
  → WHERE paddle_transaction_id = ?
  → status=revoked + revoked_at + revoke_reason
  → 设备对账 403
```

邮箱用于通知与审计；**吊销主键永远是交易 ID**。

### 5.3 滥用退款黑名单（滚动 365 天）

| 项 | 规则 |
| :--- | :--- |
| 窗口 | **过去 365 天**（`COALESCE(revoked_at, created_at)`） |
| 计数对象 | 仅 **purchase 类** 吊销（`source=purchase` 或遗留真 `txn_01…`） |
| 阈值 | 同一 `buyer_email_hash` **或** 同一设备指纹（3 选 2）累计 **≥ 2** 次 |
| 拦截点 | `/api/v1/activate`（及既有 verify 路径若调用） |
| 披露 | **Terms of Use** + **Refund Policy** + 结账前可链到退款政策 |

**不计入**：promo / admin / test 吊销、无支付痕迹的运维吊销。

---

## 6. API / UI 落点

| 位置 | 行为 |
| :--- | :--- |
| Paddle `transaction.completed` | `source=purchase` |
| Admin `POST /generate` | `source=admin\|promo`（默认 admin）；promo 建议带兑换窗+duration |
| Portal `GET /user/licenses` | 返回 `source`、`refundable` |
| Portal `POST /user/refund` | 非 refundable → 400 |
| Portal UI | 仅 `refundable` 显示「申请退款」 |
| Activate | promo 校验兑换窗；终身同 tier 拒兑；黑名单年度化 |

---

## 7. 条款披露（产品）

合适位置：

1. **`terms.html`** — 法律约束主文（接受条款即接受限制）  
2. **`refund.html`** — 退款政策细则（用户找退款时第一眼）  
3. **Pricing 结账** — 链到 Refund Policy（「支付即表示同意…」）  

文案要点（中英一致）：

- 14 天购买冷静期（仅付费订单）  
- 活动/赠送码不可退款  
- 滚动 365 天内，同一邮箱或设备因退款/拒付导致的授权吊销达到 2 次，可能拒绝后续激活  
- 盗刷/拒付由支付渠道处理，授权将随交易吊销

---

## 8. 实施清单

### P0（已完成）

- [x] 方案文档（本文）  
- [x] D1：`source`、`revoked_at` + 运行时 ensure  
- [x] 履约/发码写入 source；吊销写 revoked_at  
- [x] 退款门禁 + Portal `refundable`  
- [x] 黑名单滚动 365 天 + 仅 purchase  
- [x] promo 兑换窗；终身同 tier 拒兑  
- [x] Terms / Refund Policy 披露  
- [x] 部署 Worker + Pages  

### P1（本迭代）

- [x] 文档澄清：status ≠ 退款/拒付；`revoke_reason` 维度  
- [x] D1：`revoke_reason`；Webhook `transaction.refunded` / `adjustment.*` chargeback  
- [x] Admin UI：source=promo + 兑换窗/使用天数  
- [x] Pricing 结账 Modal 链到 Terms + Refund Policy  
- [ ] purchase 年付与 `duration_days`/`expires_at` 语义彻底分离（双重过期 SSOT，避免影响现网年付）  

### P2

- [ ] Pro 订阅与中继流量计量  
- [ ] 权益时间轴合并（多码 → 单 entitlement）  
- [ ] Admin 列表筛选 source / revoke_reason  

---

## 9. 验证要点

1. Paddle 购买码：`source=purchase`，Portal 可退款。  
2. Admin 默认码：`source=admin`，Portal **无**退款按钮；API 拒退。  
3. promo：过兑换窗激活 403；不过窗可兑；不可退。  
4. 同一邮箱 365 天内 2 次 purchase 吊销后，第三次激活被拒。  
5. 盗刷模拟：Webhook refunded → 码 revoked → verify 403。  
