export const zh = {
  nav: {
    title: "EQT DRM 管理后台",
    overview: "系统概览",
    licenses: "授权码管理",
    blacklist: "风控黑名单",
    health: "系统健康度",
    opsAudit: "审计日志",
    errorAudit: "异常跟踪",
    logout: "退出登录"
  },
  common: {
    confirm: "确认",
    cancel: "取消",
    save: "保存",
    delete: "删除",
    search: "搜索",
    filter: "筛选",
    loading: "加载中...",
    actions: "操作",
    status: "状态",
    created_at: "创建时间",
    updated_at: "更新时间",
    copy: "复制",
    copied: "已复制",
    success: "操作成功",
    failed: "操作失败"
  },
  login: {
    title: "EQT DRM 管理平台登录",
    subtitle: "管理员身份验证与令牌配置",
    tokenLabel: "Admin Secret Token",
    tokenPlaceholder: "请输入后台管理 Token",
    submit: "登录系统",
    invalidToken: "Token 验证失败，请检查输入。"
  },
  overview: {
    title: "系统概览",
    totalLicenses: "总授权数",
    activeDevices: "活跃设备数",
    totalRevenue: "预估总营收",
    recentActivations: "最近 24 小时激活",
    tierDistribution: "套餐类型分布",
    systemHealth: "核心服务健康状态"
  },
  licenses: {
    title: "授权码列表与生成",
    generateTitle: "生成新授权码",
    tier: "套餐类型",
    duration: "有效天数",
    durationPlaceholder: "如 365，留空或 0 为永久",
    buyerEmail: "买家邮箱",
    notes: "备注说明",
    generateBtn: "生成授权码",
    generating: "生成中...",
    tableHeaderCode: "授权码",
    tableHeaderTier: "套餐",
    tableHeaderBuyer: "买家",
    tableHeaderStatus: "状态",
    tableHeaderExpires: "到期时间",
    tableHeaderDevices: "设备激活数",
    revokeBtn: "吊销授权",
    revokeConfirm: "确定要吊销该授权码吗？关联设备将无法继续使用付费功能。"
  },
  blacklist: {
    title: "风控黑名单管理",
    addBtn: "添加黑名单",
    type: "黑名单类型",
    target: "目标标识 (邮箱/设备指纹)",
    reason: "封禁原因",
    tableHeaderTarget: "拦截目标",
    tableHeaderKind: "类型",
    tableHeaderReason: "拦截原因",
    unblockBtn: "解除封禁"
  },
  health: {
    title: "系统健康监控",
    dbStatus: "D1 数据库连接",
    workerStatus: "Cloudflare Worker 状态",
    syncRate: "在线照合成功率",
    avgLatency: "平均 API 时延"
  }
};

export type TranslationKeys = typeof zh;
