<script lang="ts">
  import { onMount } from 'svelte';
  import { state, type DesktopSettings } from '../state';
  import { t } from '../i18n';
  import { cleanChatProfileName, cleanChatAvatar } from '../utils/domUtils';
  import { allEmojis, culturalEmojis } from '../emojis.js';
  import {
    SaveSettings,
    ChatSaveDirectory,
    SelectReceiveDirectory,
    SetRightClickIntegrationEnabled,
    SetStartupEnabled,
    OpenFile,
    OpenPath,
    SelectLogDirectory,
    CheckForUpdates,
    DevSetUsedSeconds,
  } from '../../wailsjs/go/main/App';

  export let onClose: () => void = () => {};
  export let onSaveSuccess: () => void = () => {};

  let settings: DesktopSettings = JSON.parse(JSON.stringify(state.settings || {}));
  let isEditingSender = false;
  let senderInput = settings.chatSender || 'Desktop';
  let showEmojiPicker = false;
  let customEmojiInput = '';
  let advancedOpen = Boolean(state.settingsAdvancedOpen);
  let devOpen = Boolean(state.settingsDevOpen);
  let updateStatusText = state.updateStatusText || t('manual_check_tips');
  let isCheckingUpdate = false;

  const interfaceOptions = settings.interfaceOptions || [];

  function handleLangChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    settings.lang = val;
    saveCurrentSettings();
  }

  function handleShowHistoryChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    settings.showHistory = checked;
    saveCurrentSettings();
  }

  function handleCloseBehaviorChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    settings.closeBehavior = val;
    saveCurrentSettings();
  }

  function handleUpdateModeChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    settings.autoUpdateMode = val;
    saveCurrentSettings();
  }

  async function triggerManualUpdateCheck() {
    isCheckingUpdate = true;
    updateStatusText = t('checking_update') || 'Checking for updates...';
    try {
      const res = await CheckForUpdates();
      if (res && res.hasUpdate) {
        updateStatusText = `${t('update_available') || 'Update available:'} v${res.version}`;
      } else {
        updateStatusText = t('already_latest') || 'You are on the latest version.';
      }
    } catch (err: any) {
      updateStatusText = err?.message || String(err) || 'Update check failed';
    } finally {
      isCheckingUpdate = false;
    }
  }

  async function toggleRightClick(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    try {
      state.rightClickIntegration = await SetRightClickIntegrationEnabled(checked);
    } catch (err: any) {
      (e.target as HTMLInputElement).checked = !checked;
      state.error = err?.message || String(err);
    }
  }

  async function toggleStartup(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    try {
      state.startupIntegration = await SetStartupEnabled(checked);
    } catch (err: any) {
      (e.target as HTMLInputElement).checked = !checked;
      state.error = err?.message || String(err);
    }
  }

  async function selectChatDownloadDir() {
    try {
      const dir = await SelectReceiveDirectory();
      if (dir) {
        settings.chatDownloadDir = dir;
        await saveCurrentSettings();
      }
    } catch (err: any) {
      state.error = err?.message || String(err);
    }
  }

  async function openChatSaveDir() {
    try {
      const dir = settings.chatDownloadDir || (await ChatSaveDirectory());
      if (dir) {
        await OpenPath(dir);
      }
    } catch (err: any) {
      state.error = err?.message || String(err);
    }
  }

  function saveSenderName() {
    settings.chatSender = cleanChatProfileName(senderInput);
    isEditingSender = false;
    saveCurrentSettings();
  }

  function cancelSenderName() {
    senderInput = settings.chatSender || 'Desktop';
    isEditingSender = false;
  }

  function pickEmoji(emoji: string) {
    settings.chatAvatar = emoji;
    showEmojiPicker = false;
    saveCurrentSettings();
  }

  function submitCustomEmoji() {
    if (customEmojiInput.trim()) {
      settings.chatAvatar = cleanChatAvatar(customEmojiInput.trim());
      showEmojiPicker = false;
      customEmojiInput = '';
      saveCurrentSettings();
    }
  }

  function handleAvatarFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          settings.chatAvatar = String(evt.target.result);
          saveCurrentSettings();
        }
      };
      reader.readAsDataURL(file);
    }
  }

  function resetAvatar() {
    settings.chatAvatar = '';
    saveCurrentSettings();
  }

  async function saveCurrentSettings() {
    state.settings = await SaveSettings(settings as any);
    state.receiveDir = state.settings.output || '';
    state.browserFallback = Boolean(state.settings.browser);
    state.chatAutoSave = state.settings.chatAutoSave !== false;
    state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
    onSaveSuccess();
  }

  // Developer mode actions
  async function selectDevLogDir() {
    try {
      const dir = await SelectLogDirectory();
      if (dir) {
        settings.logDir = dir;
        await saveCurrentSettings();
      }
    } catch (err: any) {
      state.error = err?.message || String(err);
    }
  }

  async function openLogFile() {
    if (state.appInfo?.logPath) {
      await OpenFile(state.appInfo.logPath);
    }
  }

  async function openLogDir() {
    if (state.appInfo?.logPath) {
      const parent = state.appInfo.logPath.replace(/[\\/][^\\/]*$/, '');
      await OpenPath(parent);
    }
  }

  async function devResetQuota() {
    await DevSetUsedSeconds(0);
    state.notice = t('quota_reset_success') || 'Quota reset to 0';
  }

  async function devMaxQuota() {
    await DevSetUsedSeconds(600);
    state.notice = t('quota_max_success') || 'Quota set to 600s';
  }

  async function exitDevMode() {
    settings.devMode = false;
    await saveCurrentSettings();
  }

  onMount(() => {
    const allCulturalEmojis = Object.values(culturalEmojis as Record<string, { emojis: string[] }>).flatMap((g) => g.emojis);
    uniqueEmojiList = Array.from(new Set([...allCulturalEmojis, ...allEmojis]));
  });

  let uniqueEmojiList: string[] = [];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="overlay active" on:click|self={onClose} role="presentation">
  <div class="modal settings-modal">
    <header class="modal-header">
      <h2>{t('settings')}</h2>
      <button class="close-button" on:click={onClose} aria-label={t('btn_close')}>✕</button>
    </header>

    <div class="modal-body">
      <div class="settings-panel">
        <!-- 语言与外观 -->
        <section class="settings-section">
          <div class="settings-section-head">
            <h3>{t('lang_title')}</h3>
            <span>{t('lang_desc')}</span>
          </div>
          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('lang_pref')}</strong>
              <span>{t('lang_desc')}</span>
            </div>
            <select bind:value={settings.lang} on:change={handleLangChange}>
              <option value="zh">{t('lang_zh')}</option>
              <option value="en">{t('lang_en')}</option>
              <option value="ja">{t('lang_ja')}</option>
              <option value="ko">{t('lang_ko')}</option>
              <option value="es">{t('lang_es')}</option>
              <option value="de">{t('lang_de')}</option>
              <option value="fr">{t('lang_fr')}</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('show_history_title')}</strong>
              <span>{t('show_history_desc')}</span>
            </div>
            <label class="switch-toggle" for="svelte-show-history">
              <input
                type="checkbox"
                id="svelte-show-history"
                checked={settings.showHistory !== false}
                on:change={handleShowHistoryChange}
              />
              <span class="switch-slider"></span>
            </label>
          </div>
        </section>

        <!-- 软件更新 -->
        <section class="settings-section">
          <div class="settings-section-head">
            <h3>{t('update_settings')}</h3>
            <span>{t('update_settings_desc')}</span>
          </div>
          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('update_mode')}</strong>
              <span>{t('update_mode_desc')}</span>
            </div>
            <select bind:value={settings.autoUpdateMode} on:change={handleUpdateModeChange}>
              <option value="off">{t('update_off')}</option>
              <option value="notify">{t('update_notify')}</option>
              <option value="download">{t('update_download')}</option>
              <option value="silent">{t('update_silent')}</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('check_update')}</strong>
              <span>{updateStatusText}</span>
            </div>
            <button
              type="button"
              class="secondary"
              disabled={isCheckingUpdate}
              on:click={triggerManualUpdateCheck}
            >
              {isCheckingUpdate ? t('checking_update') || 'Checking...' : t('manual_check_btn')}
            </button>
          </div>
        </section>

        <!-- 系统集成 -->
        <section class="settings-section">
          <div class="settings-section-head">
            <h3>{t('sys_integration')}</h3>
            <span>{t('sys_integration_desc')}</span>
          </div>
          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('right_click_menu')}</strong>
              <span>{state.rightClickIntegration?.enabled ? t('integration_enabled') : t('right_click_desc')}</span>
            </div>
            <div class="setting-control-stack">
              <span class="badge {state.rightClickIntegration?.enabled ? 'active' : 'inactive'}">
                {state.rightClickIntegration?.enabled ? t('status_enabled') : t('status_disabled')}
              </span>
              <label class="switch-toggle" for="svelte-right-click">
                <input
                  type="checkbox"
                  id="svelte-right-click"
                  checked={Boolean(state.rightClickIntegration?.enabled)}
                  disabled={state.rightClickIntegration?.supported === false}
                  on:change={toggleRightClick}
                />
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('startup_title')}</strong>
              <span>{state.startupIntegration?.enabled ? t('integration_enabled') : t('startup_desc')}</span>
            </div>
            <div class="setting-control-stack">
              <span class="badge {state.startupIntegration?.enabled ? 'active' : 'inactive'}">
                {state.startupIntegration?.enabled ? t('status_enabled') : t('status_disabled')}
              </span>
              <label class="switch-toggle" for="svelte-startup">
                <input
                  type="checkbox"
                  id="svelte-startup"
                  checked={Boolean(state.startupIntegration?.enabled)}
                  disabled={state.startupIntegration?.supported === false}
                  on:change={toggleStartup}
                />
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>
        </section>

        <!-- Chat 模式设置与身份 -->
        <section class="settings-section">
          <div class="settings-section-head">
            <h3>{t('chat')}</h3>
            <span>{t('chat_identity_desc')}</span>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('chat_sender')}</strong>
              <span>{t('chat_sender_desc')}</span>
            </div>
            {#if isEditingSender}
              <div class="chat-sender-edit-wrapper">
                <input type="text" bind:value={senderInput} maxlength="20" placeholder="Desktop" />
                <button type="button" class="icon-button save-chat-sender" on:click={saveSenderName}>✓</button>
                <button type="button" class="icon-button cancel-chat-sender" on:click={cancelSenderName}>✕</button>
              </div>
            {:else}
              <div class="chat-sender-static-wrapper">
                <span class="chat-sender-static-text">{settings.chatSender || 'Desktop'}</span>
                <button type="button" class="icon-button edit-chat-sender" on:click={() => (isEditingSender = true)}>✏️</button>
              </div>
            {/if}
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('chat_avatar')}</strong>
              <span>{t('chat_avatar_desc')}</span>
            </div>
            <div class="avatar-setting-row">
              <div class="avatar-preview-wrapper">
                <span class="avatar-preview">
                  {#if settings.chatAvatar && settings.chatAvatar.startsWith('data:image/')}
                    <img src={settings.chatAvatar} alt="Avatar" />
                  {:else}
                    {settings.chatAvatar || (cleanChatProfileName(settings.chatSender).charAt(0) || 'D').toUpperCase()}
                  {/if}
                </span>
              </div>
              <div class="avatar-inputs-stack">
                <div class="avatar-actions">
                  <label class="avatar-action-btn">
                    <span>{t('btn_upload_image')}</span>
                    <input type="file" accept="image/*" on:change={handleAvatarFileUpload} hidden />
                  </label>
                  <button type="button" class="avatar-action-btn" on:click={() => (showEmojiPicker = !showEmojiPicker)}>
                    {t('btn_emoji') || 'Emoji'}
                  </button>
                  {#if settings.chatAvatar && settings.chatAvatar.startsWith('data:image/')}
                    <button type="button" class="avatar-action-btn reset-btn" on:click={resetAvatar}>{t('btn_reset')}</button>
                  {/if}
                </div>

                {#if showEmojiPicker}
                  <div class="emoji-picker-popover">
                    <div class="emoji-picker-custom-row">
                      <input type="text" bind:value={customEmojiInput} placeholder="Custom Emoji..." maxlength="8" />
                      <button type="button" class="avatar-action-btn" on:click={submitCustomEmoji}>{t('btn_confirm')}</button>
                    </div>
                    <div class="emoji-picker-divider"></div>
                    <div class="emoji-picker-scroll-area">
                      <div class="emoji-picker-grid">
                        {#each uniqueEmojiList as emoji}
                          <button type="button" class="emoji-picker-item" on:click={() => pickEmoji(emoji)}>{emoji}</button>
                        {/each}
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('chat_autosave')}</strong>
              <span>{t('chat_autosave_desc')}</span>
            </div>
            <div class="setting-control-stack">
              <label class="switch-toggle" for="svelte-chat-autosave">
                <input
                  type="checkbox"
                  id="svelte-chat-autosave"
                  bind:checked={settings.chatAutoSave}
                  on:change={saveCurrentSettings}
                />
                <span class="switch-slider"></span>
              </label>
              <button type="button" class="icon-button-mini" on:click={openChatSaveDir} title={t('open_folder')}>📁</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('chat_download_dir')}</strong>
              <span>{t('chat_download_dir_desc')}</span>
            </div>
            <div class="setting-control-stack path-selector-wrapper">
              <input type="text" readonly value={settings.chatDownloadDir || ''} placeholder={t('choose_folder')} />
              <button type="button" class="btn-mini secondary" on:click={selectChatDownloadDir}>{t('choose')}</button>
            </div>
          </div>
        </section>

        <!-- 高级设置 -->
        <details class="settings-advanced-details" bind:open={advancedOpen}>
          <summary class="settings-advanced-summary">{t('adv_settings')}</summary>
          <div class="settings-advanced-content">
            <div class="setting-row">
              <div class="setting-copy">
                <strong>{t('net_interface')}</strong>
                <span>{t('net_interface_desc')}</span>
              </div>
              <select bind:value={settings.interface} on:change={saveCurrentSettings}>
                {#each interfaceOptions as opt}
                  <option value={opt.name}>
                    {opt.label || opt.name} {opt.isRecommended ? t('likely_phone_lan') || '(Recommended)' : ''}
                  </option>
                {/each}
              </select>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <strong>{t('port_title')}</strong>
                <span>{t('port_desc')}</span>
              </div>
              <input type="number" min="0" max="65535" bind:value={settings.port} on:change={saveCurrentSettings} />
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <strong>{t('browser_fallback')}</strong>
                <span>{t('browser_fallback_desc')}</span>
              </div>
              <label class="switch-toggle" for="svelte-browser-fallback">
                <input
                  type="checkbox"
                  id="svelte-browser-fallback"
                  bind:checked={settings.browser}
                  on:change={saveCurrentSettings}
                />
                <span class="switch-slider"></span>
              </label>
            </div>

            <div class="setting-row">
              <div class="setting-copy">
                <strong>{t('update_check_interval')}</strong>
                <span>{t('update_check_interval_desc')}</span>
              </div>
              <select bind:value={settings.updateCheckIntervalHours} on:change={saveCurrentSettings}>
                <option value={12}>{t('hours_12')}</option>
                <option value={24}>{t('hours_24')}</option>
                <option value={48}>{t('hours_48')}</option>
              </select>
            </div>
          </div>
        </details>

        <!-- 开发者模式选项 -->
        {#if settings.devMode}
          <details class="settings-advanced-details dev-details" bind:open={devOpen}>
            <summary class="settings-advanced-summary dev-summary">{t('dev_options') || '开发者选项'}</summary>
            <div class="settings-advanced-content">
              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{t('enable_debug_logs')}</strong>
                  <span>{t('dev_logs_desc')}</span>
                </div>
                <label class="switch-toggle" for="svelte-dev-debug">
                  <input
                    type="checkbox"
                    id="svelte-dev-debug"
                    bind:checked={settings.debugLog}
                    on:change={saveCurrentSettings}
                  />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="setting-row">
                <div class="setting-copy">
                  <strong>{t('enable_viewport_debug')}</strong>
                  <span>{t('enable_viewport_debug_desc')}</span>
                </div>
                <label class="switch-toggle" for="svelte-dev-viewport">
                  <input
                    type="checkbox"
                    id="svelte-dev-viewport"
                    bind:checked={settings.viewportDebug}
                    on:change={saveCurrentSettings}
                  />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="dev-log-box">
                <div class="dev-log-title">{t('custom_log_dir')}</div>
                <div class="dev-log-row">
                  <input type="text" readonly value={settings.logDir || ''} placeholder={t('default_log_dir_placeholder')} />
                  <button type="button" class="ghost" on:click={selectDevLogDir}>{t('btn_browse') || '选择...'}</button>
                </div>
                <div class="dev-log-path">{t('dev_logs_path')} {state.appInfo?.logPath || 'Temp directory'}</div>
              </div>

              <div class="dev-action-grid">
                <button type="button" class="ghost" on:click={openLogFile}>{t('btn_open_log_file')}</button>
                <button type="button" class="ghost" on:click={openLogDir}>{t('btn_open_log_dir')}</button>
              </div>

              <div class="dev-action-grid">
                <button type="button" class="ghost" on:click={devResetQuota}>🔄 {t('dev_reset_quota') || '重置每日计时'}</button>
                <button type="button" class="ghost" on:click={devMaxQuota}>⚡ {t('dev_max_quota') || '快速达到10分钟'}</button>
              </div>

              <button type="button" class="danger btn-exit-dev" on:click={exitDevMode}>
                {t('btn_exit_dev_mode') || '退出开发者模式'}
              </button>
            </div>
          </details>
        {/if}

        <!-- 窗口设置 -->
        <section class="settings-section">
          <div class="settings-section-head">
            <h3>{t('window_settings')}</h3>
            <span>{t('window_settings_desc')}</span>
          </div>
          <div class="setting-row">
            <div class="setting-copy">
              <strong>{t('close_action')}</strong>
              <span>{t('close_action_desc')}</span>
            </div>
            <select bind:value={settings.closeBehavior} on:change={handleCloseBehaviorChange}>
              <option value="tray">{t('keep_tray')}</option>
              <option value="quit">{t('direct_exit') || t('quit_app')}</option>
            </select>
          </div>
        </section>
      </div>
    </div>
  </div>
</div>

<style>
  .settings-modal {
    max-width: 600px;
    width: 90vw;
  }
  .chat-sender-edit-wrapper {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .chat-sender-edit-wrapper input {
    padding: 4px 8px;
    font-size: 13px;
    border: 1px solid var(--line, #d8e0dd);
    border-radius: 6px;
  }
  .chat-sender-static-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .avatar-setting-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .avatar-preview {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent, #0f766e);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    overflow: hidden;
  }
  .avatar-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .avatar-actions {
    display: flex;
    gap: 8px;
  }
  .avatar-action-btn {
    padding: 4px 10px;
    font-size: 12px;
    border: 1px solid var(--line, #d8e0dd);
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
  }
  .emoji-picker-popover {
    position: absolute;
    top: 40px;
    right: 0;
    background: #fff;
    border: 1px solid var(--line, #d8e0dd);
    border-radius: 8px;
    padding: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
    z-index: 100;
    width: 260px;
  }
  .emoji-picker-custom-row {
    display: flex;
    gap: 6px;
  }
  .emoji-picker-custom-row input {
    flex: 1;
    padding: 4px 6px;
    font-size: 12px;
    border: 1px solid #d8e0dd;
    border-radius: 4px;
  }
  .emoji-picker-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
    max-height: 160px;
    overflow-y: auto;
    margin-top: 6px;
  }
  .emoji-picker-item {
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
  }
  .emoji-picker-item:hover {
    background: rgba(0, 0, 0, 0.05);
  }
  .path-selector-wrapper input {
    font-size: 12px;
    padding: 4px 8px;
    border: 1px solid var(--line, #d8e0dd);
    border-radius: 6px;
    width: 140px;
  }
  .dev-log-box {
    padding: 10px;
    background: var(--bg-hover, #f7faf9);
    border: 1px solid var(--line, #d8e0dd);
    border-radius: 8px;
    margin: 8px 0;
  }
  .dev-log-title {
    font-weight: 700;
    font-size: 12px;
    color: var(--accent, #0f766e);
    margin-bottom: 6px;
  }
  .dev-log-row {
    display: flex;
    gap: 6px;
  }
  .dev-log-row input {
    flex: 1;
    padding: 4px 8px;
    font-size: 12px;
    border: 1px solid #d8e0dd;
    border-radius: 4px;
  }
  .dev-log-path {
    font-size: 11px;
    color: #66736f;
    margin-top: 4px;
  }
  .dev-action-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }
  .btn-exit-dev {
    width: 100%;
    padding: 8px;
    font-size: 12px;
    font-weight: 700;
    border-radius: 6px;
  }
</style>
