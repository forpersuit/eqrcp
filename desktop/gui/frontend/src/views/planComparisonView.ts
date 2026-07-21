import { t } from '../i18n';

export function renderPlanComparisonView(helpers: {
    hasPaidLicense: () => boolean;
}): string {
    const { hasPaidLicense } = helpers;
    const checkGreen = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:2px;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    const xRed = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:2px; opacity:0.6;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

    return `
        <div class="plan-comparison-panel" style="max-height: calc(100vh - 140px); overflow-y: auto; padding: 16px 8px 8px; box-sizing: border-box;">
            <style>
                .plan-card-premium {
                    transform: translateY(0);
                    will-change: transform, box-shadow;
                }
                .plan-card-premium:hover {
                    transform: translateY(-4px);
                }
                .plan-card-premium.featured:hover {
                    box-shadow: 0 16px 36px rgba(47, 158, 115, 0.14), 0 3px 10px rgba(47, 158, 115, 0.06) !important;
                }
            </style>
            <div class="plan-cards-container" style="display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-bottom: 20px;">
                <!-- 体验卡片 -->
                <div class="plan-card plan-card-premium" style="border: 1.2px solid var(--line); border-radius: 16px; padding: 24px; background: var(--bg-hover); display: flex; flex-direction: column; text-align: left; transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); box-sizing: border-box;">
                    <div style="margin-bottom: 16px; border-bottom: 1.2px solid var(--line); padding-bottom: 14px;">
                        <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: var(--text-secondary); letter-spacing: 0.08em; display: block; margin-bottom: 2px;">Free Tier</span>
                        <h3 style="font-size: 22px; margin: 4px 0; font-weight: 800; color: var(--text-primary);">${t('free_quota') || '体验版'}</h3>
                        <p style="font-size: 12px; color: var(--text-secondary); margin: 6px 0 12px; min-height: 32px; line-height: 1.5;">${t('free_tier_desc') || '局域网极速协作与传输体验版。'}</p>
                        <div style="font-size: 26px; font-weight: 900; color: var(--text-primary); margin-top: 14px;">¥0 <span style="font-size: 12px; font-weight: 500; color: var(--text-secondary);">${t('lifetime') || '永久'}</span></div>
                    </div>
                    <ul style="list-style: none; padding: 0; margin: 0 0 16px; font-size: 12.5px; display: flex; flex-direction: column; gap: 12px; flex-grow: 1; line-height: 1.5;">
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-primary);">
                            ${checkGreen} <span>${t('plan_feature_lan_transfer') || '局域网极速文件传输 (无网/离线可用)'}</span>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-primary);">
                            ${checkGreen} <span>${t('plan_feature_drag_and_drop') || '支持拖拽发送、历史保存、文件夹选择'}</span>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-secondary); opacity: 0.85;">
                            ${xRed} <span>${t('plan_feature_chat_free') || 'Chat 模式限制：每日限额满速。超额后强力限速及限额'}</span>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-secondary); opacity: 0.85;">
                            ${xRed} <span>${t('plan_feature_share_free') || 'Share 电脑发送限制：每日免费 5 次。超额后限制大小'}</span>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-secondary); opacity: 0.85;">
                            ${xRed} <span>${t('plan_feature_receive_free') || 'Receive 移动端上传限制：每日免费 5 次。超额后限额阻断'}</span>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-secondary); opacity: 0.85;">
                            ${xRed} <span>${t('plan_feature_future_upgrade') || '主板授权生命周期迁移支持'}</span>
                        </li>
                    </ul>
                </div>

                <!-- PLUS / PLUS U 付费卡片 -->
                <div class="plan-card plan-card-premium featured" style="border: 2px solid var(--accent); border-radius: 16px; padding: 24px; background: var(--bg); display: flex; flex-direction: column; text-align: left; position: relative; box-shadow: 0 10px 30px rgba(47, 158, 115, 0.08), 0 2px 8px rgba(47, 158, 115, 0.03); transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); box-sizing: border-box;">
                    <div style="position: absolute; top: -9px; right: 20px; background: linear-gradient(135deg, var(--accent) 0%, #34d399 100%); color: #fff; font-size: 9.5px; font-weight: 900; padding: 3px 10px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.06em; box-shadow: 0 4px 12px rgba(47, 158, 115, 0.2);">Recommended</div>
                    <div style="margin-bottom: 16px;">
                        <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: var(--accent); letter-spacing: 0.08em; display: block; margin-bottom: 2px;">Plus Upgrade</span>
                        <h3 style="font-size: 22px; margin: 4px 0; font-weight: 800; color: var(--text-primary);">PLUS / PLUS U</h3>
                        <p style="font-size: 12px; color: var(--text-secondary); margin: 6px 0 12px; min-height: 32px; line-height: 1.5;">${t('plan_plus_desc_short') || '解除局域网 Chat 及文件传输的全部大小与频率限制。'}</p>
                        
                        <!-- 价格区分小卡片 -->
                        <div style="display: flex; gap: 12px; margin: 14px 0 6px; box-sizing: border-box; width: 100%;">
                            <div style="flex: 1; background: var(--bg-hover); border: 1.2px solid var(--line); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; text-align: left;">
                                <div style="font-size: 10px; color: var(--text-secondary); font-weight: 800; letter-spacing: 0.02em;">${t('plus_annual_label') || 'PLUS (年度版)'}</div>
                                <div style="font-size: 18px; font-weight: 900; color: var(--accent);">$11.99 <span style="font-size: 11px; font-weight: 500; color: var(--text-secondary);">/ ${t('year_unit') || '年'}</span></div>
                            </div>
                            <div style="flex: 1; background: var(--bg-hover); border: 1.2px solid var(--line); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; text-align: left;">
                                <div style="font-size: 10px; color: var(--text-secondary); font-weight: 800; letter-spacing: 0.02em;">${t('plus_lifetime_label') || 'PLUS U (永久版)'}</div>
                                <div style="font-size: 18px; font-weight: 900; color: var(--text-primary);">$29.99 <span style="font-size: 11px; font-weight: 500; color: var(--text-secondary);">/ ${t('buyout_unit') || '买断'}</span></div>
                            </div>
                        </div>
                    </div>
                    <ul style="list-style: none; padding: 0; margin: 0 0 16px; font-size: 12.5px; display: flex; flex-direction: column; gap: 12px; flex-grow: 1; line-height: 1.5;">
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-primary);">
                            ${checkGreen} <strong>${t('plan_feature_chat_unlimit') || '无限量 Chat 时间（绝不限额）'}</strong>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-primary);">
                            ${checkGreen} <strong>${t('plan_feature_unlimit_transfer') || '高并发无限度极速发送与接收文件'}</strong>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-primary);">
                            ${checkGreen} <span>${t('plan_feature_device_bind') || '绑定当前主板与系统指纹，稳定可靠'}</span>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-primary);">
                            ${checkGreen} <span>${t('plan_feature_clock_check') || '本地密码学独立验签，支持离线脱机校验'}</span>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-primary);">
                            ${checkGreen} <span>${t('plan_feature_future_upgrade') || '终身免费主板授权升级与迁移支持'}</span>
                        </li>
                        <li style="display: flex; gap: 10px; align-items: flex-start; color: var(--text-primary);">
                            ${checkGreen} <span>${t('plan_feature_support') || '尊享专属技术支持通道'}</span>
                        </li>
                    </ul>
                    ${!hasPaidLicense() ? `
                        <button class="primary" id="buy-license-btn" style="width: 100%; padding: 10px 14px; font-weight: 700; margin-top: 14px; font-size: 13.5px; border-radius: 8px; border: none; background: linear-gradient(135deg, var(--accent) 0%, #34d399 100%); color: #fff; cursor: pointer; box-shadow: 0 4px 12px rgba(47, 158, 115, 0.15); transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                            ${t('buy_license_portal')}
                        </button>
                    ` : ''}
                </div>
            </div>

            <!-- 说明与跳转部分 -->
            <div style="background: var(--bg-hover); border-radius: 12px; padding: 14px 18px; font-size: 12px; color: var(--text-secondary); line-height: 1.6; text-align: left; border: 1.2px solid var(--line); display: flex; flex-direction: column; gap: 8px;">
                <div>💡 <strong>${t('plan_binding_note') || '设备绑定规则'}</strong>：${t('plan_binding_note_desc')}</div>
                <div>🎁 <strong>${t('free_tier_rules') || '额度与刷新'}</strong>：${t('free_tier_rules_desc')}</div>
            </div>
            
            <div style="margin-top: 18px; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                <button class="ghost" id="plan-back-to-about" style="padding: 10px 18px; font-weight: 600;">${t('btn_back_about') || '返回关于'}</button>
                <button class="primary" id="plan-go-redeem" style="padding: 10px 18px; font-weight: 600;">${t('redeem_title') || '兑换激活码'}</button>
            </div>
        </div>
    `;
}
