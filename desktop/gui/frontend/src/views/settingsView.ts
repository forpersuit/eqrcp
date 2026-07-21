import { state } from '../state';
import { t } from '../i18n';
import { allEmojis, culturalEmojis } from '../emojis.js';

export function renderSettingsView(helpers: {
    escapeHTML: (val: unknown) => string;
    escapeAttr: (val: unknown) => string;
    renderStatusBadge: (status: unknown) => string;
    renderSwitch: (id: string, checked?: boolean, disabled?: boolean) => string;
    renderAvatarMarkup: (avatar: string, fallback: string) => string;
    cleanChatAvatar: (avatar: string) => string;
    cleanChatProfileName: (name: string) => string;
    integrationStatusText: (status: unknown, fallback: string) => string;
    checkIcon: () => string;
    closeIcon: () => string;
    editIcon: () => string;
    openFolderIcon: () => string;
    getPortHelpText?: () => string;
}): string {
    if (!state.settings) {
        return '';
    }
    const {
        escapeHTML,
        escapeAttr,
        renderStatusBadge,
        renderSwitch,
        renderAvatarMarkup,
        cleanChatAvatar,
        cleanChatProfileName,
        integrationStatusText,
        checkIcon,
        closeIcon,
        editIcon,
        openFolderIcon,
    } = helpers;

    const options = (state.settings.interfaceOptions || []).map((option: any) => {
        let label = option.label || option.name;
        if (option.isRecommended) {
            label += t('likely_phone_lan') || ' (Recommended LAN)';
        }
        return `
            <option value="${escapeAttr(option.name)}" ${option.name === state.settings?.interface ? 'selected' : ''}>${escapeHTML(label)}</option>
        `;
    }).join('');

    const chatSender = String(state.settings.chatSender || '');
    const chatAvatar = String(state.settings.chatAvatar || '');
    const getPortHelpText = helpers.getPortHelpText || (() => '');

    return `
        <div class="settings-panel">

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('lang_title')}</h3>
                    <span>${t('lang_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('lang_pref')}</strong>
                        <span>${t('lang_desc')}</span>
                    </div>
                    <select id="settings-lang">
                        <option value="en" ${state.settings?.lang === 'en' ? 'selected' : ''}>${t('lang_en')}</option>
                        <option value="ja" ${state.settings?.lang === 'ja' ? 'selected' : ''}>${t('lang_ja')}</option>
                        <option value="ko" ${state.settings?.lang === 'ko' ? 'selected' : ''}>${t('lang_ko')}</option>
                        <option value="es" ${state.settings?.lang === 'es' ? 'selected' : ''}>${t('lang_es')}</option>
                        <option value="de" ${state.settings?.lang === 'de' ? 'selected' : ''}>${t('lang_de')}</option>
                        <option value="fr" ${state.settings?.lang === 'fr' ? 'selected' : ''}>${t('lang_fr')}</option>
                        <option value="zh" ${state.settings?.lang === 'zh' ? 'selected' : ''}>${t('lang_zh')}</option>
                    </select>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('show_history_title')}</strong>
                        <span>${t('show_history_desc')}</span>
                    </div>
                    <div class="setting-control-stack">
                        ${renderSwitch('settings-show-history', state.settings?.showHistory !== false)}
                    </div>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('update_settings')}</h3>
                    <span>${t('update_settings_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('update_mode')}</strong>
                        <span>${t('update_mode_desc')}</span>
                    </div>
                    <select id="settings-auto-update-mode">
                        <option value="off" ${state.settings?.autoUpdateMode === 'off' ? 'selected' : ''}>${t('update_off')}</option>
                        <option value="notify" ${state.settings?.autoUpdateMode === 'notify' ? 'selected' : ''}>${t('update_notify')}</option>
                        <option value="download" ${state.settings?.autoUpdateMode === 'download' ? 'selected' : ''}>${t('update_download')}</option>
                        <option value="silent" ${state.settings?.autoUpdateMode === 'silent' ? 'selected' : ''}>${t('update_silent')}</option>
                    </select>
                </div>

                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('check_update')}</strong>
                        <span id="update-check-status">${escapeHTML(state.updateStatusText || t('manual_check_tips'))}</span>
                    </div>
                    <button type="button" class="secondary" id="btn-manual-update-check" ${state.updateBtnDisabled ? 'disabled' : ''}>${escapeHTML(state.updateBtnText || t('manual_check_btn'))}</button>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('sys_integration')}</h3>
                    <span>${t('sys_integration_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('right_click_menu')}</strong>
                        <span id="right-click-status-text">${escapeHTML(integrationStatusText(state.rightClickIntegration, t('right_click_desc')))}</span>
                    </div>
                    <div class="setting-control-stack" id="right-click-control">
                        ${renderStatusBadge(state.rightClickIntegration)}
                        ${renderSwitch('settings-right-click', state.rightClickIntegration?.enabled, state.rightClickIntegration?.supported === false)}
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('startup_title')}</strong>
                        <span id="startup-status-text">${escapeHTML(integrationStatusText(state.startupIntegration, t('startup_desc')))}</span>
                    </div>
                    <div class="setting-control-stack" id="startup-control">
                        ${renderStatusBadge(state.startupIntegration)}
                        ${renderSwitch('settings-startup', state.startupIntegration?.enabled, state.startupIntegration?.supported === false)}
                    </div>
                </div>
            </section>

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('chat')}</h3>
                    <span>${t('chat_identity_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('chat_sender')}</strong>
                        <span>${t('chat_sender_desc')}</span>
                    </div>
                    ${state.isEditingChatSender ? `
                        <div class="chat-sender-edit-wrapper">
                            <input id="settings-chat-sender" type="text" maxlength="20" value="${escapeAttr(chatSender)}" placeholder="Desktop" />
                            <button type="button" class="icon-button save-chat-sender" title="${t('btn_confirm')}">${checkIcon()}</button>
                            <button type="button" class="icon-button cancel-chat-sender" title="${t('btn_reset')}">${closeIcon()}</button>
                        </div>
                    ` : `
                        <div class="chat-sender-static-wrapper">
                            <span class="chat-sender-static-text">${escapeHTML(chatSender || 'Desktop')}</span>
                            <button type="button" class="icon-button edit-chat-sender" title="${t('rename')}">${editIcon()}</button>
                        </div>
                    `}
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('chat_avatar')}</strong>
                        <span>${t('chat_avatar_desc')}</span>
                    </div>
                    <div class="avatar-setting-row">
                        <div class="avatar-preview-wrapper">
                            <span class="avatar-preview">${renderAvatarMarkup(chatAvatar, (cleanChatProfileName(chatSender).charAt(0) || 'D').toUpperCase())}</span>
                        </div>
                        <div class="avatar-inputs-stack" style="position: relative; z-index: 9;">
                            <div class="avatar-actions">
                                <button type="button" id="btn-avatar-upload" class="avatar-action-btn">${t('btn_upload_image')}</button>
                                <button type="button" id="btn-emoji-more" class="avatar-action-btn">${t('btn_emoji') || 'Emoji'}</button>
                                <input type="file" id="settings-avatar-file" accept="image/*" style="display:none;" />
                                ${chatAvatar.startsWith('data:image/') ? `
                                    <button type="button" id="btn-avatar-reset" class="avatar-action-btn reset-btn">${t('btn_reset')}</button>
                                ` : ''}
                            </div>
                            ${state.showEmojiPicker ? (() => {
                                const allCulturalEmojis = Object.values(culturalEmojis as Record<string, { emojis: string[] }>).flatMap(g => g.emojis);
                                const combined = [...allCulturalEmojis, ...allEmojis];
                                const uniqueEmojis = Array.from(new Set(combined));
                                return `
                                    <div class="emoji-picker-popover" id="emoji-picker-popover">
                                        <div class="emoji-picker-custom-row">
                                            <input type="text" id="emoji-picker-custom-input" placeholder="${escapeAttr(t('emoji_picker_custom_placeholder') || '自定义...')}" maxlength="8" />
                                            <button type="button" id="btn-emoji-picker-custom-submit" class="avatar-action-btn">${t('btn_confirm') || '确定'}</button>
                                        </div>
                                        <div class="emoji-picker-divider"></div>
                                        <div class="emoji-picker-scroll-area">
                                            <div class="emoji-picker-grid">
                                                ${uniqueEmojis.map(emoji => `
                                                    <button type="button" class="emoji-picker-item" data-emoji="${escapeAttr(emoji)}">${escapeHTML(emoji)}</button>
                                                `).join('')}
                                            </div>
                                        </div>
                                    </div>
                                `;
                            })() : ''}
                        </div>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('chat_autosave')}</strong>
                        <span>${t('chat_autosave_desc')}</span>
                    </div>
                    <div class="setting-control-stack">
                        ${renderSwitch('settings-chat-autosave', state.chatAutoSave)}
                        <button type="button" class="icon-button-mini path-link" id="open-chat-save" data-open-path="${escapeAttr(state.chatSaveDir || '')}" title="${t('open_folder')}" aria-label="${t('open_folder')}" style="padding: 4px; display: inline-flex; align-items: center; justify-content: center;">${openFolderIcon()}</button>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('chat_download_dir')}</strong>
                        <span>${t('chat_download_dir_desc')}</span>
                    </div>
                    <div class="setting-control-stack path-selector-wrapper" style="display: flex; gap: 8px; align-items: center; width: 220px; justify-content: flex-end;">
                        <input type="text" id="settings-chat-download-dir" value="${escapeAttr(state.settings.chatDownloadDir || '')}" placeholder="${escapeAttr(t('choose_folder'))}" style="font-size: 12px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; width: 140px; box-sizing: border-box;" readonly />
                        <button type="button" class="btn-mini secondary" id="btn-select-chat-download-dir" style="height: 26px; font-size: 11px; padding: 0 10px; border-radius: 6px; flex-shrink: 0;">${t('choose')}</button>
                    </div>
                </div>
            </section>

            <details class="settings-advanced-details" ${state.settingsAdvancedOpen ? 'open' : ''}>
                <summary class="settings-advanced-summary">${t('adv_settings')}</summary>
                <div class="settings-advanced-content">
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>${t('net_interface')}</strong>
                            <span>${t('net_interface_desc')}</span>
                        </div>
                        <select id="settings-interface">${options}</select>
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong class="setting-label-with-help" data-help="${escapeAttr(getPortHelpText())}" tabindex="0">${t('port_title')} <span aria-hidden="true">?</span></strong>
                            <span>${t('port_desc')}</span>
                        </div>
                        <input id="settings-port" type="number" min="0" max="65535" value="${Number(state.settings.port || 0)}" data-help="${escapeAttr(getPortHelpText())}" />
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>${t('browser_fallback')}</strong>
                            <span>${t('browser_fallback_desc')}</span>
                        </div>
                        ${renderSwitch('settings-browser', state.browserFallback)}
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>${t('update_check_interval')}</strong>
                            <span>${t('update_check_interval_desc')}</span>
                        </div>
                        <select id="settings-update-interval">
                            <option value="12" ${state.settings?.updateCheckIntervalHours === 12 ? 'selected' : ''}>${t('hours_12')}</option>
                            <option value="24" ${state.settings?.updateCheckIntervalHours === 24 || !state.settings?.updateCheckIntervalHours ? 'selected' : ''}>${t('hours_24')}</option>
                            <option value="48" ${state.settings?.updateCheckIntervalHours === 48 ? 'selected' : ''}>${t('hours_48')}</option>
                        </select>
                    </div>
                </div>
            </details>

            ${state.settings?.devMode ? `
            <details class="settings-advanced-details dev-details" style="margin-top: 16px; border-color: rgba(47, 158, 115, 0.3);" ${state.settingsDevOpen ? 'open' : ''}>
                <summary class="settings-advanced-summary dev-summary" style="color: var(--accent); font-weight: 700;">${t('dev_options') || '开发者选项'}</summary>
                <div class="settings-advanced-content">
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>${t('enable_debug_logs')}</strong>
                            <span>${t('dev_logs_desc')}</span>
                        </div>
                        <div class="setting-control-stack">
                            ${renderSwitch('dev-debug-log', Boolean(state.settings?.debugLog))}
                        </div>
                    </div>
                    <div class="setting-row">
                        <div class="setting-copy">
                            <strong>${t('enable_viewport_debug')}</strong>
                            <span>${t('enable_viewport_debug_desc')}</span>
                        </div>
                        <div class="setting-control-stack">
                            ${renderSwitch('dev-viewport-debug', Boolean(state.settings?.viewportDebug))}
                        </div>
                    </div>
                    
                    <div style="padding: 12px; background: var(--bg-hover); border: 1.2px solid var(--line); border-radius: 10px; margin: 8px 0 16px; box-sizing: border-box; width: 100%;">
                        <div style="font-weight: 800; font-size: 12.5px; color: var(--accent); margin-bottom: 8px;">${t('custom_log_dir')}</div>
                        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px; width: 100%;">
                            <input type="text" id="dev-log-dir" value="${escapeHTML(state.settings?.logDir || '')}" placeholder="${t('default_log_dir_placeholder')}" style="flex: 1; min-width: 0; padding: 6px 10px; font-size: 12px; background: var(--bg); color: var(--text-primary); border: 1.2px solid var(--line); border-radius: 6px; outline: none; box-sizing: border-box;" readonly />
                            <button type="button" id="dev-select-log-dir" class="ghost" style="padding: 6px 12px; font-size: 12px; height: 30px; border-radius: 6px; margin: 0; white-space: nowrap;">${t('btn_browse') || '选择...'}</button>
                        </div>
                        <div style="color: var(--text-secondary); font-size: 11px; line-height: 1.4; margin-bottom: 4px;">
                            ${t('dev_logs_path') || '当前实际路径：'} <strong style="word-break: break-all; color: var(--text-primary); font-family: monospace;">${escapeHTML(state.appInfo?.logPath || 'Temp directory')}</strong>
                        </div>
                        <div style="font-size: 11px; color: #ef4444; background: rgba(239, 68, 68, 0.05); border: 1.2px solid rgba(239, 68, 68, 0.15); border-radius: 8px; padding: 8px 12px; margin-top: 8px; line-height: 1.45; text-align: left;">
                            ⚠️ <strong>${t('privacy_warning_title')}</strong>：${t('privacy_warning_desc')}
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px; margin-bottom: 12px; width: 100%;">
                        <button type="button" class="ghost" id="dev-open-log" style="flex: 1; padding: 8px 12px; font-size: 12px; border-radius: 6px; font-weight: 600;">${t('btn_open_log_file')}</button>
                        <button type="button" class="ghost" id="dev-open-dir" style="flex: 1; padding: 8px 12px; font-size: 12px; border-radius: 6px; font-weight: 600;">${t('btn_open_log_dir')}</button>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 12px; width: 100%;">
                        <button type="button" class="ghost" id="dev-reset-quota" style="padding: 8px 10px; font-size: 11.5px; color: var(--accent); border-color: var(--accent); border-radius: 6px; font-weight: 600;">🔄 ${t('dev_reset_quota') || '重置每日计时'}</button>
                        <button type="button" class="ghost" id="dev-max-quota" style="padding: 8px 10px; font-size: 11.5px; color: #ef4444; border-color: #ef4444; border-radius: 6px; font-weight: 600;">⚡ ${t('dev_max_quota') || '快速达到10分钟'}</button>
                    </div>
                    
                    <button type="button" class="danger" id="dev-disable-mode" style="font-size: 12px; padding: 8px 12px; width: 100%; border-radius: 6px; font-weight: 700; display: block; text-align: center;">
                        ${t('btn_exit_dev_mode') || '退出开发者模式'}
                    </button>
                </div>
            </details>
            ` : ''}

            <section class="settings-section">
                <div class="settings-section-head">
                    <h3>${t('window_settings')}</h3>
                    <span>${t('window_settings_desc')}</span>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('close_action')}</strong>
                        <span>${t('close_action_desc')}</span>
                    </div>
                    <select id="settings-close-behavior">
                        <option value="tray" ${state.closeBehavior !== 'quit' ? 'selected' : ''}>${t('keep_tray')}</option>
                        <option value="quit" ${state.closeBehavior === 'quit' ? 'selected' : ''}>${(t as any)('direct_exit') || t('quit_app')}</option>
                    </select>
                </div>
            </section>
        </div>
    `;
}
