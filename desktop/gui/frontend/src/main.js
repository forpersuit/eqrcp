import './style.css';
import './app.css';
import faviconURL from './assets/images/favicon.png';
import horizontalLogoURL from './assets/images/logo-horizontal.png';
import logoMarkURL from './assets/images/logo-mark.png';

import {ClipboardGetText, ClipboardSetText, EventsOn, OnFileDrop, LogInfo, LogError} from '../wailsjs/runtime/runtime';
import {
    AgentStatus,
    AppInfo,
    Chat,
    ChatSaveDirectory,
    ClearHistory,
    DownloadChatAttachment,
    OpenExternal,
    OpenFile,
    OpenPath,
    OpenURL,
    ReadSettings,
    Receive,
    RepeatTask,
    SaveChatAttachmentAs,
    SaveSettings,
    SelectFiles,
    SelectReceiveDirectory,
    SelectShareDirectory,
    RightClickIntegrationStatus,
    Share,
    SetRightClickIntegrationEnabled,
    SetStartupEnabled,
    SetPaidStatus,
    ActivateLicense,
    ResetLicense,
    StartupStatus,
    StopChat,
    StopCurrent,
} from '../wailsjs/go/main/App';

window.onerror = function(message, source, lineno, colno, error) {
    const errText = `[JS Error] ${message} at ${source}:${lineno}:${colno}`;
    console.error(errText, error);
    if (window.runtime && window.runtime.LogError) {
        window.runtime.LogError(errText);
    }
};

window.onunhandledrejection = function(event) {
    const errText = `[JS Promise Error] ${event.reason}`;
    console.error(errText);
    if (window.runtime && window.runtime.LogError) {
        window.runtime.LogError(errText);
    }
};

const translations = {
    zh: {
        // Navigation / Tabs
        share: '分享文件',
        receive: '接收文件',
        chat: '局域网对话',
        settings: '软件设置',
        pro_tier: '高级版功能',

        // General
        working: '正在处理...',
        stop: '停止',
        running: '运行中',
        completed: '已完成',
        failed: '已失败',
        stopped: '已停止',
        no_tasks: '暂无已完成的任务',
        recent_history: '最近传输历史',
        clear: '清空',
        current_task: '当前任务',
        refresh: '刷新',
        choose: '选择',
        open_folder: '打开目录',

        // Share Page
        drag_drop_tips: '拖拽文件或文件夹到这里',
        or_click_to: '或者点击按钮进行选择',
        select_files: '选择文件',
        select_folder: '选择文件夹',
        selected_items: '已选择的文件/文件夹：',
        start_transfer: '开始分享',
        status_idle_tips: '配置好选项并启动传输服务。',
        drop_more_tips: '继续拖入文件，或手动选择。',
        items_ready: '个项已就绪',
        share_active: '分享服务已启动',
        open_in_browser: '浏览器中打开',
        target: '接收端设备',
        bytes: '传输流量',
        qr_page: '网页端链接',
        locked_list: '已锁定传输列表',
        waiting_qr: '正在等待生成二维码...',

        // Receive Page
        save_path: '保存目录',
        select_save_path: '更改目录',
        start_receive: '开始接收',
        status_receive_tips: '配置好保存目录并启动接收服务。',
        receive_dir: '接收保存目录',
        receive_active: '接收服务已启动',

        // Chat Page
        chat_limit_reached: '今日免费对话时长已用尽',
        upgrade_to_keep: '请升级以继续在今天使用对话功能。',
        start_chat: '开启对话',
        chat_running_tips: '局域网内的其他设备扫码后即可加入对话。',
        waiting_network_url: '正在等待网络地址就绪...',
        chat_history_save_path: '对话附件保存目录',
        remaining_duration: '今日剩余时长：',
        session_mode: '会话模式',
        chat_title: '局域网设备对话免流量聊天',
        starting_chat: '正在启动对话服务...',
        chat_status: '对话服务状态',
        scan_to_join: '扫码加入对话',
        copy_chat_url: '复制对话链接',
        devices: '已连接设备',
        connected: '已连接',
        desktop: '电脑端',
        remote: '移动端/其他设备',
        waiting_connection: '等待设备加入...',
        last_activity: '最后活动时间',
        no_active_chat: '当前无活动对话',
        chat_session: '局域网对话',

        // Settings Page
        lang_title: '界面语言',
        lang_desc: '选择软件界面的显示语言。',
        lang_pref: '首选语言',
        lang_zh: '简体中文',
        lang_en: 'English',

        sys_integration: '系统集成',
        sys_integration_desc: '本地桌面日常使用的便捷入口。',
        right_click_menu: 'Windows 右键菜单分享和接收',
        right_click_desc: '在资源管理器右键中添加分享所选文件或接收到此文件夹的菜单。',
        startup_title: '开机启动',
        startup_desc: '登录系统时自动在后台启动 EQT 传输服务。',
        
        chat_identity: '局域网对话设置',
        chat_identity_desc: '设置您在局域网对话中的身份信息和附件保存选项。',
        chat_sender: '对话昵称',
        chat_sender_desc: '在局域网对话中显示的昵称。',
        chat_avatar: '对话头像',
        chat_avatar_desc: '使用表情符号(Emoji)或 1-4 个英文字母。',
        chat_autosave: '自动保存对话附件',
        chat_autosave_desc: '接收到的附件按天分类保存，并自动清理 7 天前的文件。',

        window_settings: '窗口选项',
        window_settings_desc: '设置关闭 EQT 主窗口时的软件行为。',
        close_action: '关闭窗口动作',
        close_action_desc: '关闭窗口时保留在系统托盘可以实现极速启动与常驻传输。',
        keep_tray: '保留在系统托盘中',
        quit_app: '退出 EQT 软件',

        update_settings: '软件更新',
        update_settings_desc: '管理软件自动更新检查行为。',
        update_mode: '自动更新模式',
        update_mode_desc: '控制新版本的检测和自动下载行为。',
        update_off: '关闭自动更新',
        update_notify: '仅提醒有新版本',
        update_download: '自动下载新版本 (默认)',
        update_silent: '静默自动更新与安装',
        check_update: '检查新版本',
        manual_check_tips: '点击按钮手动检查更新。',
        manual_check_btn: '检查',

        adv_settings: '高级设置',
        net_interface: '网卡接口',
        net_interface_desc: '选择您的移动设备在局域网内可以访问的网卡适配器。',
        port_title: '服务端口',
        port_desc: '若无固定本地端口需求，建议保持 0 自动分配。',
        browser_fallback: '回退浏览器控制页面',
        browser_fallback_desc: '需要时为扫码任务提供备用的浏览器控制端页面。',
        update_check_interval: '更新检查频率',
        update_check_interval_desc: '选择软件自动检测新版本的频率。',
        hours_12: '12 小时',
        hours_24: '24 小时 (默认)',
        hours_48: '48 小时',

        // Receive page new
        save_dir: '设为默认目录',

        // About / Plan
        about_title: '关于 EQT',
        plan_label: '套餐计划',
        free_quota: '每日免费额度',
        redeemed_at: '激活于 {date}',
        paid_locked_clock: '付费版已锁定（时钟异常）',
        locked_rollback: '时钟回退锁定',
        locked_rollback_desc: '检测到系统时钟回退，已锁定付费功能。请将系统时间恢复同步，然后在下方的设置中重新激活。',
        license_locked_limit: '授权已锁定（已受限）',
        license_locked_server: '服务端付费判定未激活（不一致）',
        license_verify_failed: '授权校验未通过：',
        license_verify_failed_desc: '虽然本地有激活的 {tier}，但服务端判定未激活。请确保核心服务开启并连接；若仍异常，请在设置中重置授权并重新激活。',
        
        dev_options: '开发者选项',
        enable_debug_logs: '启用调试日志',
        enable_viewport_debug: '启用调试框 (Viewport Debug Box)',
        dev_logs_desc: '调试日志会记录 Chat 窗口的交互信息和网络日志。',
        dev_logs_path: '日志保存在：',
        btn_open_log_file: '打开日志文件',
        btn_open_log_dir: '打开日志目录',
        btn_exit_dev_mode: '退出开发者模式',
        
        plan_desc_title: '套餐版本说明',
        plan_plus_annual: 'Plus - $11.99 / 年：',
        plan_plus_annual_desc: '支持最大 2 台设备同时激活。解锁局域网 Chat 与大文件传输，高速稳定。',
        plan_plus_lifetime: 'Plus 终身 - $29.99：',
        plan_plus_lifetime_desc: '一次买断，终身可用，同样支持最大 2 台设备同时激活，解锁所有 PLUS 高级付费权益。',
        plan_binding_note: '激活绑定说明',
        plan_binding_note_desc: '激活采用“3选2”加权硬件指纹绑定模型。重装系统不更换硬件的情况下，重新激活不会消耗额度。离线环境下可通过恢复备份的 license.lic 自动验证。',
        tooltip_popover_comparsion: '点击查看 Plus 与 Plus 终身版套餐对比',
        
        // Feedback
        feedback_category: '反馈类别',
        feedback_bug: 'Bug 报告',
        feedback_transfer_fail: '传输失败',
        feedback_gui_issue: 'GUI 界面问题',
        feedback_feature_req: '新功能建议',
        feedback_license_issue: '购买或授权问题',
        feedback_other: '其他问题',
        feedback_contact: '联系邮箱',
        feedback_optional: '选填',
        feedback_message: '反馈内容',
        feedback_placeholder: '请详细描述您遇到的问题...',
        feedback_include_diag: '包含诊断信息',
        feedback_diag_note: '诊断信息会在发送前在下方显示。EQT 绝不会附带您的任何传输文件。',
        btn_open_email_draft: '发送',
        btn_copy_feedback: '复制反馈内容',
        
        // Add-ons
        redeem_title: '兑换激活码',
        close: '关闭',
        agent_idle: '服务处于空闲状态。',
        chat_unlocked: '{tier} 已激活。局域网对话已解锁。',
        chat_time_left: '今日免费对话剩余时间：{time}。',
        chat_time_used_up: '今日免费对话时长已用尽。请升级以继续在今天使用对话功能。',
        chat_0_00: '对话时间已用尽',
        about: '关于 EQT',
        feedback: '反馈建议',

        // Updates
        up_to_date: '已是最新版本。',
        check_updates_auto: '正在自动检查更新...',
        version_available: '新版本 {version} 已可用。',
        btn_download_now: '立即下载',
        new_version_go_settings: '新版本 {version} 已可用，请前往设置进行更新。',
        postponed_transfer: '新版本 {version} 已可用。将在传输结束后开始下载。',
        update_ready_restart: '版本 {version} 已下载完成。请重启软件以应用更新。',
        auto_check_failed: '自动更新检查失败：{err}',
        click_manual_check: '点击按钮手动检查更新。',
        btn_check: '检查更新',
        checking_updates: '正在检查更新...',
        btn_checking: '正在检查...',
        btn_retry: '重试',
        btn_install_restart: '重启并应用更新',
        btn_downloading: '正在下载...',
        downloading_progress: '正在下载：{percent}%',
        download_failed: '下载失败：{err}',
        install_failed: '安装失败：{err}',
        installing_updates: '正在准备安装更新...',
        btn_installing: '正在安装...',
        silent_ready: '后台静默更新已下载完成，将在下次启动时自动应用。',

        // Chat quota text translations
        chat_top_time: '对话 {time}',
        chat_top_used_up: '对话已用尽',

        btn_confirm: '确认',
        btn_reset: '重置',
        btn_activating: '激活中...',
        btn_checking: '正在检查...',
        btn_retry: '重试',
        btn_install_restart: '重启并应用更新',
        btn_downloading: '正在下载...',
        btn_installing: '正在安装...',
        redeem_no_paid_plan: '未激活付费方案',
        redeem_active_tier: '{tier} 已激活',
        redeem_desc: '输入有效的 EQT 激活码以在此设备上解锁付费版本。',
        device_limit: '设备限制：{activated} / {max}',
        upgrade_required: '需要升级',
        btn_draft_opened: '草稿已生成',
        feedback_draft_opened_notice: '已成功拉起系统默认邮件客户端并生成草稿。请在弹出的邮件窗口中点击发送。如果您的系统没有配置默认邮箱客户端，请点击下方的 “复制反馈内容” 手动发送至 jinxpeeter@outlook.com。',
        lang_ja: '日本語 (Japanese)',
        lang_ko: '한국어 (Korean)',
        lang_es: 'Español (Spanish)',
        lang_de: 'Deutsch (German)',
        lang_fr: 'Français (French)',
        up_to_date: 'Déjà à jour.',
        check_updates_auto: 'Recherche de mise à jour automatique...',
        version_available: 'La nouvelle version {version} est disponible.',
        btn_download_now: 'Télécharger maintenant',
        new_version_go_settings: 'La nouvelle version {version} est disponible. Allez dans les paramètres pour mettre à jour.',
        postponed_transfer: 'La nouvelle version {version} est disponible. Téléchargement reporté après la fin du transfert.',
        update_ready_restart: 'La version {version} a été téléchargée. Redémarrez pour appliquer la mise à jour.',
        auto_check_failed: 'Échec de la recherche de mise à jour automatique : {err}',
        click_manual_check: 'Cliquez sur le bouton pour rechercher des mises à jour manuellement.',
        checking_updates: 'Recherche de mises à jour...',
        btn_retry: 'Réessayer',
        btn_install_restart: 'Redémarrer pour appliquer',
        btn_downloading: 'Téléchargement...',
        downloading_progress: 'Téléchargement : {percent}%',
        download_failed: 'Échec du téléchargement : {err}',
        install_failed: 'Échec de l\'installation : {err}',
        installing_updates: 'Préparation de l\'installation de la mise à jour...',
        btn_installing: 'Installation...',
        silent_ready: 'Mise à jour silencieuse téléchargée. Elle s\'appliquera au prochain redémarrage.',
        manual_check_tips: 'Cliquez sur le bouton pour rechercher des mises à jour manuellement.',
        manual_check_btn: 'Vérifier',
        check_update: 'Rechercher des mises à jour',
        chat_unlocked: '{tier} actif. Chat déverrouillé.',
        chat_time_left: 'Temps de chat gratuit restant aujourd\'hui : {time}.',
        chat_time_used_up: 'Le temps de chat gratuit d\'aujourd\'hui est épuisé. Mettez à niveau pour continuer à chatter aujourd\'hui.',
        upgrade_required: 'Mise à niveau requise',
        redeem_desc: 'Entrez un code EQT valide pour déverrouiller une version payante sur cet appareil.',
        device_limit: 'Limite d\'appareils : {activated} / {max}',
        redeemed_at: 'Activé le {date}',
        paid_locked_clock: 'Payant verrouillé (erreur d\'horloge)',
        locked_rollback: 'Retour arrière de l\'horloge système détecté',
        locked_rollback_desc: 'Un retour arrière de l\'horloge système a été détecté. Les fonctionnalités payantes sont verrouillées. Synchronisez l\'horloge et réactivez dans les paramètres.',
        license_locked_limit: 'Licence verrouillée (limitée)',
        license_locked_server: 'Vérification du serveur inactive (incohérente)',
        license_verify_failed: 'Échec de la vérification de la licence :',
        license_verify_failed_desc: 'La licence locale pour {tier} est active, aber la vérification du serveur a échoué. Assurez-vous que le service fonctionne et réinitialisez l\'activation si nécessaire.',
    },
    en: {
        // Navigation / Tabs
        share: 'Share',
        receive: 'Receive',
        chat: 'Local Chat',
        settings: 'Settings',
        pro_tier: 'Pro Features',

        // General
        working: 'Working...',
        stop: 'Stop',
        running: 'Running',
        completed: 'Completed',
        failed: 'Failed',
        stopped: 'Stopped',
        no_tasks: 'No completed tasks yet.',
        recent_history: 'Recent history',
        clear: 'Clear',
        current_task: 'Current task',
        refresh: 'Refresh',
        choose: 'Choose',
        open_folder: 'Open Folder',

        // Share Page
        drag_drop_tips: 'Drag & drop files or folders here',
        or_click_to: 'or click buttons to choose',
        select_files: 'Select Files',
        select_folder: 'Select Folder',
        selected_items: 'Selected items:',
        start_transfer: 'Start transfer',
        status_idle_tips: 'Configure options and start the sharing service.',
        drop_more_tips: 'Drop more items here, or choose manually.',
        items_ready: 'item(s) ready',
        share_active: 'Share active',
        open_in_browser: 'Open in browser',
        target: 'Target',
        bytes: 'Bytes',
        qr_page: 'QR page',
        locked_list: 'Locked transfer list',
        waiting_qr: 'Waiting for QR...',

        // Receive Page
        save_path: 'Save Directory',
        select_save_path: 'Change Directory',
        start_receive: 'Start receive',
        status_receive_tips: 'Configure target directory and start receiving.',
        receive_dir: 'Receive directory',
        receive_active: 'Receive active',

        // Chat Page
        chat_limit_reached: 'Daily free chat limit reached',
        upgrade_to_keep: 'Upgrade to keep using chat today.',
        start_chat: 'Start chat',
        chat_running_tips: 'Other devices on the local network can scan QR to join.',
        waiting_network_url: 'Waiting for network URL...',
        chat_history_save_path: 'Autosave folder',
        remaining_duration: 'Chat remaining:',
        session_mode: 'Session mode',
        chat_title: 'Local chat with phones and nearby devices',
        starting_chat: 'Starting chat session...',
        chat_status: 'Chat Status',
        scan_to_join: 'Scan to Join Chat',
        copy_chat_url: 'Copy chat URL',
        devices: 'Devices',
        connected: 'Connected',
        desktop: 'Desktop',
        remote: 'Remote',
        waiting_connection: 'Waiting for connection...',
        last_activity: 'Last activity',
        no_active_chat: 'No active chat.',
        chat_session: 'Chat session',

        // Settings Page
        lang_title: 'Interface Language',
        lang_desc: 'Choose UI language for EQT.',
        lang_pref: 'Preferred Language',
        lang_zh: '简体中文 (Chinese)',
        lang_en: 'English',

        sys_integration: 'System Integration',
        sys_integration_desc: 'Native entry points for daily desktop use.',
        right_click_menu: 'Windows right-click share and receive',
        right_click_desc: 'Adds Explorer actions for sharing selected files and receiving into a folder.',
        startup_title: 'Start EQT at login',
        startup_desc: 'Starts the background transfer service when you sign in.',
        
        chat_identity: 'Chat Settings',
        chat_identity_desc: 'Identity and attachment handling for desktop chat sessions.',
        chat_sender: 'Chat profile name',
        chat_sender_desc: 'Your nickname in chat sessions.',
        chat_avatar: 'Chat avatar badge',
        chat_avatar_desc: 'Use an emoji or 1-4 initials.',
        chat_autosave: 'Auto-save chat attachments',
        chat_autosave_desc: 'Save received attachments by day and clean folders older than 7 days.',

        window_settings: 'Window',
        window_settings_desc: 'What happens when the EQT window is closed.',
        close_action: 'Close action',
        close_action_desc: 'Keeping EQT in the tray leaves the app ready for fast access.',
        keep_tray: 'Keep EQT in taskbar tray',
        quit_app: 'Quit EQT app',

        update_settings: 'Software Updates',
        update_settings_desc: 'Manage app update checking.',
        update_mode: 'Auto-update mode',
        update_mode_desc: 'Control update checks and download behavior.',
        update_off: 'Off',
        update_notify: 'Notify',
        update_download: 'Download (Default)',
        update_silent: 'Silent',
        check_update: 'Check for updates',
        manual_check_tips: 'Click button to manually check.',
        manual_check_btn: 'Check',

        adv_settings: 'Advanced Settings',
        net_interface: 'Network interface',
        net_interface_desc: 'Use the adapter your phone can reach on the local network.',
        port_title: 'Port',
        port_desc: 'Keep 0 unless you need a fixed local port.',
        browser_fallback: 'Browser fallback',
        browser_fallback_desc: 'Open browser control pages for QR tasks when useful.',
        update_check_interval: 'Update check interval',
        update_check_interval_desc: 'Choose how often to check for updates automatically.',
        hours_12: '12 Hours',
        hours_24: '24 Hours (Default)',
        hours_48: '48 Hours',

        // Receive page new
        save_dir: 'Set as Default',

        // About / Plan
        about_title: 'About EQT',
        plan_label: 'Plan',
        free_quota: 'Free daily quota',
        redeemed_at: 'Redeemed {date}',
        paid_locked_clock: 'PAID Locked (Clock Error)',
        locked_rollback: 'Clock rollback detected',
        locked_rollback_desc: 'System clock rollback detected. Paid features locked. Please synchronize your system clock and reactivate in settings.',
        license_locked_limit: 'License Locked (Limited)',
        license_locked_server: 'Server verification inactive (Inconsistent)',
        license_verify_failed: 'License verification failed:',
        license_verify_failed_desc: 'Local license for {tier} is active, but server verification returned inactive. Make sure core service is running; reset activation if issues persist.',
        
        dev_options: 'Developer Options',
        enable_debug_logs: 'Enable Debug Logs',
        enable_viewport_debug: 'Enable Viewport Debug Box',
        dev_logs_desc: 'Debug logs will save Chat viewport interactions and network requests.',
        dev_logs_path: 'Logs saved in:',
        btn_open_log_file: 'Open Log File',
        btn_open_log_dir: 'Open Log Dir',
        btn_exit_dev_mode: 'Exit Developer Mode',
        
        plan_desc_title: 'License Details',
        plan_plus_annual: 'Plus - $11.99 / yr:',
        plan_plus_annual_desc: 'Up to 2 concurrent devices. Unlock unlimited local chat and large files transfer, fast & stable.',
        plan_plus_lifetime: 'Plus Lifetime - $29.99:',
        plan_plus_lifetime_desc: 'One-time purchase, lifetime access. Up to 2 concurrent devices, unlock all Plus features.',
        plan_binding_note: 'Activation & Binding Note',
        plan_binding_note_desc: 'Binding is based on a "2 of 3" hardware fingerprint. Reinstalling OS on the same hardware does not consume additional activation slots. Supports offline validation using license.lic backup.',
        tooltip_popover_comparsion: 'Click to view Plus vs Plus Lifetime details',
        
        // Feedback
        feedback_category: 'Category',
        feedback_bug: 'Bug report',
        feedback_transfer_fail: 'Transfer failure',
        feedback_gui_issue: 'GUI issue',
        feedback_feature_req: 'Feature request',
        feedback_license_issue: 'Purchase or license issue',
        feedback_other: 'Other',
        feedback_contact: 'Contact email',
        feedback_optional: 'Optional',
        feedback_message: 'Message',
        feedback_placeholder: 'What happened?',
        feedback_include_diag: 'Include diagnostics',
        feedback_diag_note: 'Diagnostics are shown below before sending. EQT never attaches files being transferred.',
        btn_open_email_draft: 'Send',
        btn_copy_feedback: 'Copy feedback',
        
        // Add-ons
        redeem_title: 'Redeem code',
        close: 'Close',
        agent_idle: 'Agent is idle.',
        chat_unlocked: '{tier} active. Chat is unlocked.',
        chat_time_left: 'Daily free chat time left: {time}.',
        chat_time_used_up: 'Daily free chat time is used up. Upgrade to keep using chat today.',
        chat_0_00: 'Chat 0:00',
        about: 'About EQT',
        feedback: 'Feedback',

        // Updates
        up_to_date: 'Already up to date.',
        check_updates_auto: 'Checking updates automatically...',
        version_available: 'New version {version} is available.',
        btn_download_now: 'Download now',
        new_version_go_settings: 'New version {version} is available. Go to settings to update.',
        postponed_transfer: 'New version {version} is available. Download postponed until transfer finishes.',
        update_ready_restart: 'Version {version} has been downloaded. Restart to apply the update.',
        auto_check_failed: 'Auto update check failed: {err}',
        click_manual_check: 'Click button to manually check.',
        btn_check: 'Check',
        checking_updates: 'Checking updates...',
        btn_checking: 'Checking...',
        btn_retry: 'Retry',
        btn_install_restart: 'Restart to Apply',
        btn_downloading: 'Downloading...',
        downloading_progress: 'Downloading: {percent}%',
        download_failed: 'Download failed: {err}',
        install_failed: 'Installation failed: {err}',
        installing_updates: 'Preparing update installation...',
        btn_installing: 'Installing...',
        silent_ready: 'Silent update downloaded and ready. It will apply on next restart.',

        // Chat quota text translations
        chat_top_time: 'Chat {time}',
        chat_top_used_up: 'Chat 0:00',

        btn_confirm: 'Confirm',
        btn_reset: 'Reset',
        btn_activating: 'Activating...',
        btn_checking: 'Checking...',
        btn_retry: 'Retry',
        btn_install_restart: 'Restart to Apply',
        btn_downloading: 'Downloading...',
        btn_installing: 'Installing...',
        redeem_no_paid_plan: 'No paid plan active',
        redeem_active_tier: '{tier} active',
        redeem_desc: 'Enter a valid EQT code to unlock a paid tier on this device.',
        device_limit: 'Device Limit: {activated} / {max}',
        upgrade_required: 'Upgrade required',
        manual_check_tips: 'Click button to manually check.',
        manual_check_btn: 'Check',
        lang_ja: '日本語 (Japanese)',
        lang_ko: '한국어 (Korean)',
        lang_es: 'Español (Spanish)',
        lang_de: 'Deutsch (German)',
        lang_fr: 'Français (French)',
        btn_draft_opened: 'Draft Opened',
        feedback_draft_opened_notice: 'Mail client opened with draft. Please send it in your email app. If it didn\'t open, you can click "Copy feedback" below and manually email it to jinxpeeter@outlook.com.',
    },
    ja: {
        share: 'ファイル共有',
        receive: 'ファイル受信',
        chat: 'ローカルチャット',
        settings: '設定',
        close: '閉じる',
        working: '処理中...',
        stop: '停止',
        running: '実行中',
        completed: '完了',
        failed: '失敗',
        stopped: '停止済み',
        save_dir: 'デフォルトに設定',
        about_title: 'EQTについて',
        redeem_title: 'ライセンス認証',
        feedback: 'フィードバック',
        btn_check: '更新を確認',
        btn_checking: '確認中...',
        btn_confirm: '確認',
        btn_reset: 'リセット',
        btn_activating: '有効化中...',
        redeem_no_paid_plan: '有料プラン未有効',
        btn_open_email_draft: '送信',
        btn_draft_opened: '下書きを作成しました',
        feedback_draft_opened_notice: 'メールクライアントを起動しました。メールアプリで送信を完了してください。起動しない場合は「フィードバックをコピー」して直接 jinxpeeter@outlook.com 宛てにお送りください。',
        start_chat: 'チャットを開始',
        lang_zh: '简体中文 (Chinese)',
        lang_en: 'English',
        lang_ja: '日本語 (Japanese)',
        lang_ko: '한국어 (Korean)',
        lang_es: 'Español (Spanish)',
        lang_de: 'Deutsch (German)',
        lang_fr: 'Français (French)',
        up_to_date: 'すでに最新バージョンです。',
        check_updates_auto: 'アップデートを自動的に確認しています...',
        version_available: '新バージョン {version} が利用可能です。',
        btn_download_now: '今すぐダウンロード',
        new_version_go_settings: '新バージョン {version} が利用可能です。設定に移動して更新してください。',
        postponed_transfer: '新バージョン {version} が利用可能です。転送が完了するまでダウンロードを保留します。',
        update_ready_restart: 'バージョン {version} がダウンロードされました。再起動して更新を適用してください。',
        auto_check_failed: '自動アップデート確認に失敗しました: {err}',
        click_manual_check: 'ボタンをクリックして手動でアップデートを確認します。',
        checking_updates: 'アップデートを確認しています...',
        btn_retry: '再試行',
        btn_install_restart: '再起動して適用',
        btn_downloading: 'ダウンロード中...',
        downloading_progress: 'ダウンロード中: {percent}%',
        download_failed: 'ダウンロード失敗: {err}',
        install_failed: 'インストール失敗: {err}',
        installing_updates: 'アップデートのインストールを準備しています...',
        btn_installing: 'インストール中...',
        silent_ready: 'サイレントアップデートがダウンロードされ、準備が整いました。次回起動時に適用されます。',
        manual_check_tips: 'ボタンをクリックして手動でアップデートを確認します。',
        manual_check_btn: '確認',
        check_update: 'アップデートを確認',
        chat_unlocked: '{tier} が有効です。チャットが利用可能です。',
        chat_time_left: '本日の無料チャット残り時間: {time}。',
        chat_time_used_up: '本日の無料チャット時間は使い果たされました。本日チャットを使い続けるにはアップグレードしてください。',
        upgrade_required: 'アップグレードが必要',
        redeem_desc: 'このデバイスで有料プランを有効にするには、有効な EQT コードを入力してください。',
        device_limit: 'デバイス制限: {activated} / {max}',
        redeemed_at: '{date} に有効化済み',
        paid_locked_clock: '有料プランがロックされました（時計異常）',
        locked_rollback: 'システム時計の巻き戻しを検出',
        locked_rollback_desc: 'システム時計の巻き戻しを検出したため、有料機能をロックしました。システム時計を同期し、設定で再有効化してください。',
        license_locked_limit: 'ライセンスがロックされました（制限あり）',
        license_locked_server: 'サーバー確認が未有効（不一致）',
        license_verify_failed: 'ライセンス確認に失敗しました:',
        license_verify_failed_desc: 'ローカルの {tier} ライセンスは有効ですが、サーバー確認で無効と判定されました。コアサービスが実行されていることを確認し、問題が解決しない場合はアクティベーションをリセットしてください。',
    },
    ko: {
        share: '파일 공유',
        receive: '파일 수신',
        chat: '로컬 채팅',
        settings: '설정',
        close: '닫기',
        working: '처리 중...',
        stop: '중지',
        running: '실행 중',
        completed: '완료됨',
        failed: '실패함',
        stopped: '중지됨',
        save_dir: '기본 폴더로 설정',
        about_title: 'EQT 정보',
        redeem_title: '라이센스 활성화',
        feedback: '피드백',
        btn_check: '업데이트 확인',
        btn_checking: '확인 중...',
        btn_confirm: '확인',
        btn_reset: '초기화',
        btn_activating: '활성화 중...',
        redeem_no_paid_plan: '활성화된 요금제 없음',
        btn_open_email_draft: '보내기',
        btn_draft_opened: '임시 보관함에 저장됨',
        feedback_draft_opened_notice: '이메일 클라이언트가 시작되었습니다. 이메일 창에서 발송을 완료해 주세요. 시작되지 않을 경우 "피드백 복사"를 눌러 jinxpeeter@outlook.com으로 직접 발송할 수 있습니다.',
        start_chat: '채팅 시작',
        lang_zh: '简体中文 (Chinese)',
        lang_en: 'English',
        lang_ja: '日本語 (Japanese)',
        lang_ko: '한국어 (Korean)',
        lang_es: 'Español (Spanish)',
        lang_de: 'Deutsch (German)',
        lang_fr: 'Français (French)',
        up_to_date: '이미 최신 버전입니다.',
        check_updates_auto: '업데이트를 자동으로 확인하는 중...',
        version_available: '새 버전 {version}을 사용할 수 있습니다.',
        btn_download_now: '지금 다운로드',
        new_version_go_settings: '새 버전 {version}을 사용할 수 있습니다. 설정으로 이동하여 업데이트하십시오.',
        postponed_transfer: '새 버전 {version}을 사용할 수 있습니다. 전송이 완료될 때까지 다운로드가 보류됩니다.',
        update_ready_restart: '버전 {version} 다운로드가 완료되었습니다. 업데이트를 적용하려면 재시작하십시오.',
        auto_check_failed: '자동 업데이트 확인 실패: {err}',
        click_manual_check: '버튼을 클릭하여 수동으로 업데이트를 확인하십시오.',
        checking_updates: '업데이트 확인 중...',
        btn_retry: '재시도',
        btn_install_restart: '재시작하여 적용',
        btn_downloading: '다운로드 중...',
        downloading_progress: '다운로드 중: {percent}%',
        download_failed: '다운로드 실패: {err}',
        install_failed: '설치 실패: {err}',
        installing_updates: '업데이트 설치 준비 중...',
        btn_installing: '설치 중...',
        silent_ready: '백그라운드 업데이트 다운로드가 완료되었습니다. 다음 시작 시 적용됩니다.',
        manual_check_tips: '버튼을 클릭하여 수동으로 업데이트를 확인하십시오.',
        manual_check_btn: '확인',
        check_update: '업데이트 확인',
        chat_unlocked: '{tier} 활성화됨. 채팅이 잠금 해제되었습니다.',
        chat_time_left: '오늘 무료 채팅 남은 시간: {time}.',
        chat_time_used_up: '오늘 무료 채팅 시간이 모두 소모되었습니다. 계속하려면 업그레이드하십시오.',
        upgrade_required: '업그레이드 필요',
        redeem_desc: '이 기기에서 유효한 EQT 코드를 입력하여 유료 요금제를 사용하십시오.',
        device_limit: '기기 제한: {activated} / {max}',
        redeemed_at: '{date}에 활성화됨',
        paid_locked_clock: '유료 서비스 잠김 (시계 오류)',
        locked_rollback: '시스템 시계 되돌리기 감지됨',
        locked_rollback_desc: '시스템 시계 되돌리기가 감지되어 유료 기능이 잠겼습니다. 시스템 시계를 동기화하고 설정에서 다시 활성화하십시오.',
        license_locked_limit: '라이선스 잠김 (제한됨)',
        license_locked_server: '서버 확인 미활성 (불일치)',
        license_verify_failed: '라이선스 확인 실패:',
        license_verify_failed_desc: '로컬 {tier} 라이선스는 활성화되어 있으나 서버 확인에서 비활성으로 나타납니다. 코어 서비스가 실행 중인지 확인하고, 문제가 지속되면 활성화를 초기화하십시오.',
    },
    es: {
        share: 'Compartir',
        receive: 'Recibir',
        chat: 'Chat Local',
        settings: 'Ajustes',
        close: 'Cerrar',
        working: 'Procesando...',
        stop: 'Detener',
        running: 'Ejecutando',
        completed: 'Completado',
        failed: 'Fallado',
        stopped: 'Detenido',
        save_dir: 'Establecer predeterminado',
        about_title: 'Acerca de EQT',
        redeem_title: 'Activar código',
        feedback: 'Comentarios',
        btn_check: 'Buscar actualizaciones',
        btn_checking: 'Buscando...',
        btn_confirm: 'Confirmar',
        btn_reset: 'Restablecer',
        btn_activating: 'Activando...',
        redeem_no_paid_plan: 'Sin plan de pago activo',
        btn_open_email_draft: 'Enviar',
        btn_draft_opened: 'Borrador abierto',
        feedback_draft_opened_notice: 'Se ha abierto el cliente de correo. Confirme y envíe en la ventana emergente. Si no funciona, puede "Copiar comentarios" y enviarlos directamente a jinxpeeter@outlook.com.',
        start_chat: 'Iniciar chat',
        lang_zh: '简体中文 (Chinese)',
        lang_en: 'English',
        lang_ja: '日本語 (Japanese)',
        lang_ko: '한국어 (Korean)',
        lang_es: 'Español (Spanish)',
        lang_de: 'Deutsch (German)',
        lang_fr: 'Français (French)',
        up_to_date: 'Ya está actualizado.',
        check_updates_auto: 'Buscando actualizaciones automáticamente...',
        version_available: 'La nueva versión {version} está disponible.',
        btn_download_now: 'Descargar ahora',
        new_version_go_settings: 'La nueva versión {version} está disponible. Vaya a ajustes para actualizar.',
        postponed_transfer: 'La nueva versión {version} está disponible. Descarga pospuesta hasta que termine la transferencia.',
        update_ready_restart: 'La versión {version} ha sido descargada. Reinicie para aplicar la actualización.',
        auto_check_failed: 'Error al buscar actualizaciones automáticamente: {err}',
        click_manual_check: 'Haga clic en el botón para buscar actualizaciones manualmente.',
        checking_updates: 'Buscando actualizaciones...',
        btn_retry: 'Reintentar',
        btn_install_restart: 'Reiniciar para aplicar',
        btn_downloading: 'Descargando...',
        downloading_progress: 'Descargando: {percent}%',
        download_failed: 'Error al descargar: {err}',
        install_failed: 'Error al instalar: {err}',
        installing_updates: 'Preparando la instalación de la actualización...',
        btn_installing: 'Instalando...',
        silent_ready: 'Actualización silenciosa descargada. Se aplicará en el próximo reinicio.',
        manual_check_tips: 'Haga clic en el botón para buscar actualizaciones manualmente.',
        manual_check_btn: 'Buscar',
        check_update: 'Buscar actualizaciones',
        chat_unlocked: '{tier} activo. Chat desbloqueado.',
        chat_time_left: 'Tiempo libre de chat hoy: {time}.',
        chat_time_used_up: 'El tiempo libre de chat de hoy se ha agotado. Actualice para seguir chateando hoy.',
        upgrade_required: 'Se requiere actualizar',
        redeem_desc: 'Ingrese un código EQT válido para desbloquear un plan de pago en este dispositivo.',
        device_limit: 'Límite de dispositivos: {activated} / {max}',
        redeemed_at: 'Activado el {date}',
        paid_locked_clock: 'Pago bloqueado (error de reloj)',
        locked_rollback: 'Retroceso del reloj del sistema detectado',
        locked_rollback_desc: 'Se detectó un retroceso en el reloj del sistema. Las funciones de pago están bloqueadas. Sincronice el reloj y vuelva a activar en ajustes.',
        license_locked_limit: 'Licencia bloqueada (limitada)',
        license_locked_server: 'Verificación del servidor inactiva (inconsistente)',
        license_verify_failed: 'Error al verificar la licencia:',
        license_verify_failed_desc: 'La licencia local para {tier} está activa, pero la verificación del servidor falló. Asegúrese de que el servicio esté ejecutándose y restablezca la activación si el problema persiste.',
    },
    de: {
        share: 'Teilen',
        receive: 'Empfangen',
        chat: 'Lokaler Chat',
        settings: 'Einstellungen',
        close: 'Schließen',
        working: 'Verarbeitung...',
        stop: 'Stoppen',
        running: 'Laufend',
        completed: 'Abgeschlossen',
        failed: 'Fehlgeschlagen',
        stopped: 'Gestoppt',
        save_dir: 'Als Standard festlegen',
        about_title: 'Über EQT',
        redeem_title: 'Code einlösen',
        feedback: 'Feedback',
        btn_check: 'Nach Updates suchen',
        btn_checking: 'Suchen...',
        btn_confirm: 'Bestätigen',
        btn_reset: 'Zurücksetzen',
        btn_activating: 'Aktivieren...',
        redeem_no_paid_plan: 'Kein kostenpflichtiges Abo aktiv',
        btn_open_email_draft: 'Senden',
        btn_draft_opened: 'Entwurf geöffnet',
        feedback_draft_opened_notice: 'E-Mail-Client wurde geöffnet. Bitte im E-Mail-Fenster senden. Falls es nicht klappt, kopieren Sie das Feedback und senden Sie es direkt an jinxpeeter@outlook.com.',
        start_chat: 'Chat starten',
        lang_zh: '简体中文 (Chinese)',
        lang_en: 'English',
        lang_ja: '日本語 (Japanese)',
        lang_ko: '한국어 (Korean)',
        lang_es: 'Español (Spanish)',
        lang_de: 'Deutsch (German)',
        lang_fr: 'Français (French)',
        up_to_date: 'Bereits auf dem neuesten Stand.',
        check_updates_auto: 'Automatische Updatesuche...',
        version_available: 'Neue Version {version} ist verfügbar.',
        btn_download_now: 'Jetzt herunterladen',
        new_version_go_settings: 'Neue Version {version} ist verfügbar. Gehen Sie zu den Einstellungen, um das Update durchzuführen.',
        postponed_transfer: 'Neue Version {version} ist verfügbar. Herunterladen verschoben, bis die Übertragung beendet ist.',
        update_ready_restart: 'Version {version} wurde heruntergeladen. Starten Sie neu, um das Update anzuwenden.',
        auto_check_failed: 'Automatische Updatesuche fehlgeschlagen: {err}',
        click_manual_check: 'Klicken Sie auf die Schaltfläche, um manuell nach Updates zu suchen.',
        checking_updates: 'Suche nach Updates...',
        btn_retry: 'Wiederholen',
        btn_install_restart: 'Neu starten zum Anwenden',
        btn_downloading: 'Herunterladen...',
        downloading_progress: 'Herunterladen: {percent}%',
        download_failed: 'Herunterladen fehlgeschlagen: {err}',
        install_failed: 'Installation fehlgeschlagen: {err}',
        installing_updates: 'Update-Installation wird vorbereitet...',
        btn_installing: 'Installieren...',
        silent_ready: 'Stilles Update heruntergeladen. Es wird beim nächsten Neustart angewendet.',
        manual_check_tips: 'Klicken Sie auf die Schaltfläche, um manuell nach Updates zu suchen.',
        manual_check_btn: 'Prüfen',
        check_update: 'Nach Updates suchen',
        chat_unlocked: '{tier} aktiv. Chat freigeschaltet.',
        chat_time_left: 'Verbleibende kostenlose Chat-Zeit heute: {time}.',
        chat_time_used_up: 'Die kostenlose Chat-Zeit für heute ist abgelaufen. Aktualisieren Sie, um heute weiterzuchatten.',
        upgrade_required: 'Upgrade erforderlich',
        redeem_desc: 'Geben Sie einen gültigen EQT-Code ein, um eine kostenpflichtige Version auf diesem Gerät freizuschalten.',
        device_limit: 'Geräte-Limit: {activated} / {max}',
        redeemed_at: 'Aktiviert am {date}',
        paid_locked_clock: 'Zahlung gesperrt (Uhrzeitfehler)',
        locked_rollback: 'Systemzeit-Rückstellung erkannt',
        locked_rollback_desc: 'Die Systemzeit wurde zurückgesetzt. Kostenpflichtige Funktionen wurden gesperrt. Bitte synchronisieren Sie die Systemzeit und reaktivieren Sie diese in den Einstellungen.',
        license_locked_limit: 'Lizenz gesperrt (eingeschränkt)',
        license_locked_server: 'Serververifizierung inaktiv (inkonsistent)',
        license_verify_failed: 'Lizenzverifizierung fehlgeschlagen:',
        license_verify_failed_desc: 'Die lokale Lizenz für {tier} ist aktiv, aber die Serververifizierung ergab inaktiv. Stellen Sie sicher, dass der Kerndienst läuft, und setzen Sie die Aktivierung zurück, falls das Problem bestehen bleibt.',
    },
    fr: {
        share: 'Partager',
        receive: 'Recevoir',
        chat: 'Chat Local',
        settings: 'Paramètres',
        close: 'Fermer',
        working: 'Traitement...',
        stop: 'Arrêter',
        running: 'En cours',
        completed: 'Terminé',
        failed: 'Échoué',
        stopped: 'Arrêté',
        save_dir: 'Définir par défaut',
        about_title: 'À propos de EQT',
        redeem_title: 'Activer le code',
        feedback: 'Commentaires',
        btn_check: 'Rechercher les mises à jour',
        btn_checking: 'Recherche...',
        btn_confirm: 'Confirmer',
        btn_reset: 'Réinitialiser',
        btn_activating: 'Activation...',
        redeem_no_paid_plan: 'Aucun forfait payant actif',
        btn_open_email_draft: 'Envoyer',
        btn_draft_opened: 'Brouillon ouvert',
        feedback_draft_opened_notice: 'Le client de messagerie a été ouvert. Veuillez envoyer le message. Sinon, copiez les commentaires et envoyez-les directement à jinxpeeter@outlook.com.',
        start_chat: 'Démarrer le chat',
        lang_zh: '简体中文 (Chinese)',
        lang_en: 'English',
        lang_ja: '日本語 (Japanese)',
        lang_ko: '한국어 (Korean)',
        lang_es: 'Español (Spanish)',
        lang_de: 'Deutsch (German)',
        lang_fr: 'Français (French)',
    }
};

function t(key, params) {
    const lang = (state && state.settings && state.settings.lang) || 'zh';
    let val = (translations[lang] && translations[lang][key]) || 
              (translations['en'] && translations['en'][key]) || 
              (translations['zh'] && translations['zh'][key]) || 
              key;
    if (params) {
        for (const k in params) {
            val = val.replace(`{${k}}`, params[k]);
        }
    }
    return val;
}

const state = {
    mode: 'share',
    sharePaths: [],
    receiveDir: '',
    chatSaveDir: '',
    status: null,
    settings: null,
    rightClickIntegration: null,
    startupIntegration: null,
    appInfo: null,
    activePanel: '',
    error: '',
    notice: '',
    busy: false,
    browserFallback: false,
    chatAutoSave: true,
    closeBehavior: 'tray',
    chatQROpen: false,
    chatQRPulseUntil: 0,
    chatQRPromptDismissed: false,
    lastChatDeviceCount: 0,
    activeChatTaskId: 0,
    activeChatSessionKey: '',
    chatQRPulseArmed: false,
    chatUsageDate: '',
    chatUsageMs: 0,
    chatUsageStartedAt: 0,
    chatQuotaNoticeShown: false,
    updateStatusText: '',
    updateBtnText: '',
    updateBtnDisabled: false,
    updateCheckRes: null,
    updateStage: 'idle',
    license: null,
    redeemMessage: '',
    redeemError: '',
    feedbackNotice: '',
    feedbackSent: false,
};

const agentEventsURL = 'http://127.0.0.1:48176/events';
const chatDailyFreeMs = 5 * 60 * 1000;
const chatUsageStorageKey = 'eqt.chat.dailyFreeUsage';
const licenseStorageKey = 'eqt.license.activation';
const redeemSecret = 'EQT-LOCAL-2026-V1';
const licenseTiers = {
    PLUS: 'EQT Plus',
    PRO: 'EQT Pro',
};
function getLicenseDisplayName(license) {
    if (!license || !license.tier) return 'No paid plan active';
    if (license.tier === 'PLUS' && license.codeDate === 'LIFETIME') {
        return 'EQT Plus U';
    }
    return licenseTiers[license.tier] || license.tier;
}
let agentEvents = null;
let agentEventsRetry = null;
let chatQRPulseTimer = null;
let chatUsageTimer = null;
const autoSavedAttachments = new Set();
const app = document.querySelector('#app');
const portHelpText = 'Port 0 chooses an available port automatically. Use a fixed port only when firewall rules, bookmarks, or device workflows need a stable address.';

function triggerChatQRPulse() {
    if (state.chatQRPromptDismissed) {
        return;
    }
    const now = Date.now();
    if (state.chatQRPulseUntil > now) {
        return;
    }
    const pulseDuration = 10000;
    state.chatQRPulseUntil = now + pulseDuration;
    if (chatQRPulseTimer) {
        window.clearTimeout(chatQRPulseTimer);
    }
    updateChatQRPulseButton();
    chatQRPulseTimer = window.setTimeout(() => {
        chatQRPulseTimer = null;
        state.chatQRPulseUntil = 0;
        updateChatQRPulseButton();
    }, pulseDuration);
}

function updateChatQRPulseButton() {
    const button = document.querySelector('.chat-qr-toggle-action');
    if (button) {
        const shouldPulse = !state.chatQRPromptDismissed && state.chatQRPulseUntil > Date.now();
        if (shouldPulse) {
            button.classList.add('qr-breathe');
        } else {
            button.classList.remove('qr-breathe');
        }
    }
}

function pulseChatFrameQR() {
    if (state.chatQRPromptDismissed || state.chatQRPulseUntil <= Date.now()) {
        return;
    }
    const frame = document.querySelector('#chat-iframe');
    if (!frame) { return; }
    const payload = {type: 'pulse-session-qr', until: state.chatQRPulseUntil};
    const post = () => {
        try {
            frame.contentWindow?.postMessage(payload, activeChatFrameOrigin() || '*');
        } catch {
            // The iframe can still be navigating; the load handler is the reliable path.
        }
    };
    frame.addEventListener('load', post, {once: true});
    window.setTimeout(post, 0);
}

function stopChatQRPulse() {
    state.chatQRPulseArmed = false;
    state.chatQRPromptDismissed = true;
    state.chatQRPulseUntil = 0;
    if (chatQRPulseTimer) {
        window.clearTimeout(chatQRPulseTimer);
        chatQRPulseTimer = null;
    }
    updateChatQRPulseButton();
}

// postMessage bridge: handle native operations requested by the chat iframe.
window.addEventListener('message', (e) => {
    if (!isTrustedChatFrameMessage(e)) { return; }
    if (!e.data || typeof e.data !== 'object') { return; }
    if (e.data.type === 'save-file') {
        const url = String(e.data.url || '');
        if (!isTrustedChatURL(url, e.origin)) { return; }
        SaveChatAttachmentAs(url, String(e.data.name || 'attachment')).catch(() => {});
    } else if (e.data.type === 'auto-save-file') {
        const url = String(e.data.url || '');
        const id = String(e.data.id || url);
        if (!state.chatAutoSave || autoSavedAttachments.has(id) || !isTrustedChatURL(url, e.origin)) { return; }
        autoSavedAttachments.add(id);
        DownloadChatAttachment(url, String(e.data.name || 'attachment'))
            .then((path) => {
                if (path) {
                    state.chatSaveDir = path.replace(/[\\/][^\\/]*$/, '');
                }
            })
            .catch(() => {
                autoSavedAttachments.delete(id);
            });
    } else if (e.data.type === 'open-file') {
        OpenFile(String(e.data.path || '')).catch(() => {});
    } else if (e.data.type === 'read-clipboard-text') {
        const requestId = String(e.data.requestId || '');
        if (!requestId) { return; }
        ClipboardGetText()
            .then((text) => {
                e.source?.postMessage({type: 'clipboard-text', requestId, text: String(text || '')}, e.origin);
            })
            .catch(() => {
                e.source?.postMessage({type: 'clipboard-text', requestId, text: '', error: 'clipboard unavailable'}, e.origin);
            });
    }
});

function activeChatFrameOrigin() {
    const frame = document.querySelector('#chat-iframe');
    if (!frame?.src) { return ''; }
    try { return new URL(frame.src).origin; } catch { return ''; }
}

function isTrustedChatFrameMessage(event) {
    const frame = document.querySelector('#chat-iframe');
    if (!frame || event.source !== frame.contentWindow) { return false; }
    const origin = activeChatFrameOrigin();
    return Boolean(origin && event.origin === origin);
}

function isTrustedChatURL(rawURL, origin) {
    try {
        const parsed = new URL(rawURL);
        return parsed.origin === origin && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
    } catch {
        return false;
    }
}

function render() {
    console.log('[Antigravity Debug] render() called, activePanel:', state.activePanel, 'stack:', new Error().stack);
    LogInfo('[Antigravity Debug] render() called, activePanel: ' + state.activePanel + ', stack: ' + new Error().stack);
    ensureFavicon();

    // 记录旧 modal 的滚动位置，防止全局重绘时弹窗回退到顶部
    let savedScrollTop = 0;
    const existingModal = document.querySelector('.overlay .modal');
    if (existingModal) {
        savedScrollTop = existingModal.scrollTop;
    }

    app.innerHTML = `
        <main class="shell">
            <header class="topbar">
                <nav class="mode-switch" aria-label="Transfer modes">
                    <button class="${state.mode === 'share' ? 'active' : ''}" data-mode="share">${t('share')}</button>
                    <button class="${state.mode === 'receive' ? 'active' : ''}" data-mode="receive">${t('receive')}</button>
                    <button class="${state.mode === 'chat' ? 'active' : ''}" data-mode="chat">${t('chat')}</button>
                </nav>
                <div class="top-actions" role="menubar" aria-label="Application menu">
                    <button class="menu-button" id="open-settings" title="${t('settings')}" aria-label="${t('settings')}">
                        <span class="menu-icon">${settingsIcon()}</span>
                    </button>
                    <button class="menu-button" id="open-about" title="${t('about')}" aria-label="${t('about')}">
                        <span class="menu-icon">${aboutIcon()}</span>
                    </button>
                    <button class="menu-button" id="open-feedback" title="${t('feedback')}" aria-label="${t('feedback')}">
                        <span class="menu-icon">${feedbackIcon()}</span>
                    </button>
                </div>
            </header>

            <section class="layout ${state.mode === 'chat' ? 'chat-layout' : ''}">
                <div class="workspace">
                    ${renderWorkspace()}
                    ${state.notice ? `<div class="notice success">${escapeHTML(state.notice)}</div>` : ''}
                    ${state.error ? `<div class="notice error">${escapeHTML(state.error)}</div>` : ''}
                </div>
                ${renderSide()}
            </section>
            ${renderPanel()}
        </main>
    `;
    bindEvents();

    // 还原滚动位置到新的 modal 上
    if (savedScrollTop > 0) {
        const newModalEl = document.querySelector('.overlay .modal');
        if (newModalEl) {
            newModalEl.scrollTop = savedScrollTop;
            setTimeout(() => {
                newModalEl.scrollTop = savedScrollTop;
            }, 0);
            setTimeout(() => {
                newModalEl.scrollTop = savedScrollTop;
            }, 50);
        }
    }

    pulseChatFrameQR();
}

function renderWorkspace() {
    if (state.mode === 'share') {
        return renderShare();
    }
    if (state.mode === 'receive') {
        return renderReceive();
    }
    return renderChat();
}

function renderShare() {
    const activeTask = activeShareTask();
    if (activeTask) {
        return renderShareTransfer(activeTask);
    }
    const items = state.sharePaths.map((path, index) => `
        <li>
            <div>
                <strong>${escapeHTML(shortName(path))}</strong>
                <span>${escapeHTML(path)}</span>
            </div>
            <button class="icon-button remove-path" data-path-index="${index}" title="Remove">x</button>
        </li>
    `).join('');
    const hasItems = state.sharePaths.length > 0;
    return `
        <div class="dropzone">
            <div class="drop-target" style="--wails-drop-target: drop">
                <div class="drop-title">${t('drag_drop_tips')}</div>
                <div class="drop-subtitle">${hasItems ? `${state.sharePaths.length} ${t('items_ready')}` : t('or_click_to')}</div>
            </div>
            <div class="actions">
                <button type="button" id="choose-files">${t('select_files')}</button>
                <button type="button" id="choose-folder" class="secondary">${t('select_folder')}</button>
            </div>
        </div>
        ${hasItems ? `
            <ul class="path-list">${items}</ul>
            <div class="primary-row">
                <button class="primary" id="start-share" ${state.busy ? 'disabled' : ''}>${state.busy ? t('working') : t('start_transfer')}</button>
                <button class="ghost" id="clear-share">${t('clear')}</button>
            </div>
        ` : ''}
    `;
}

function renderSide() {
    if (state.mode === 'chat') {
        return '';
    }
    const current = state.status?.current;
    const history = state.status?.history || [];
    return `
        <aside class="side">
            <div class="panel">
                <div class="panel-head">
                    <h2>${t('current_task')}</h2>
                    <button class="ghost" id="refresh">${t('refresh')}</button>
                </div>
                ${renderCurrent(current)}
            </div>
            <div class="panel">
                <div class="panel-head">
                    <h2>${t('recent_history')}</h2>
                    <button class="ghost" id="clear-history" ${history.length ? '' : 'disabled'}>${t('clear')}</button>
                </div>
                ${renderHistory(history)}
            </div>
        </aside>
    `;
}

function renderShareTransfer(task) {
    const percent = task.transferPercent || 0;
    const qrImage = qrImageURL(task.pageUrl);
    const paths = task.paths || [];
    return `
        <div class="transfer-stage">
            <div class="transfer-head">
                <div>
                    <div class="eyebrow">${t('share_active')}</div>
                    <h2>${escapeHTML(task.transferState || task.state || 'Waiting')}</h2>
                </div>
                <button class="danger inline stop-current-action">${t('stop')}</button>
            </div>
            ${qrImage ? `
                <div class="qr-hero">
                    <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                    <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">${t('open_in_browser')}</button>
                </div>
            ` : `<div class="empty-state transfer-empty">${t('waiting_qr')}</div>`}
            <div class="progress transfer-progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>
            <dl class="transfer-details">
                <dt>${t('target')}</dt><dd>${escapeHTML(task.transferTarget || task.transferCurrent || 'Waiting')}</dd>
                <dt>${t('bytes')}</dt><dd>${formatBytes(task.bytesDone)}${task.bytesTotal ? ` / ${formatBytes(task.bytesTotal)}` : ''}</dd>
                <dt>${t('qr_page')}</dt><dd>${task.pageUrl ? escapeHTML(task.pageUrl) : 'Waiting'}</dd>
            </dl>
            <div class="locked-list">
                <strong>${t('locked_list')}</strong>
                <ul class="path-list locked">${paths.map((path) => `
                    <li>
                        <div>
                            <strong>${escapeHTML(shortName(path))}</strong>
                            <span>${escapeHTML(path)}</span>
                        </div>
                        <span class="item-status">${escapeHTML(shareItemStatus(task, path))}</span>
                    </li>
                `).join('')}</ul>
            </div>
            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
        </div>
    `;
}

function renderReceive() {
    const output = state.receiveDir || state.settings?.output || '';
    return `
        <div class="receive-box">
            <label>${t('receive_dir')}</label>
            <div class="directory-row">
                <input id="receive-dir" value="${escapeAttr(output)}" placeholder="Choose a folder" />
                <button id="choose-receive">${t('choose')}</button>
            </div>
        </div>
        <div class="primary-row">
            <button class="primary" id="start-receive" ${state.busy ? 'disabled' : ''}>${state.busy ? t('working') : t('start_receive')}</button>
            <button class="ghost" id="save-receive-dir">${t('save_dir')}</button>
        </div>
    `;
}

function renderChat() {
    const task = activeChatTask();
    const remaining = chatRemainingMs();
    const exhausted = !hasPaidLicense() && remaining <= 0;
    if (!task) {
        return `
            <div class="chat-start">
                <div>
                    <div class="eyebrow">${t('session_mode')}</div>
                    <h2>${t('chat_title')}</h2>
                    <p id="chat-quota-text">${chatQuotaText()}</p>
                </div>
                <button class="primary" id="start-chat" ${state.busy || exhausted ? 'disabled' : ''}>${chatStartButtonText()}</button>
            </div>
        `;
    }
    const chatUrl = task.pageUrl || '';
    if (!chatUrl) {
        return `
            <div class="chat-panel">
                <div class="chat-start">
                    <div>
                        <div class="eyebrow">${t('session_mode')}</div>
                        <h2>${t('starting_chat')}</h2>
                        <p>${t('waiting_network_url')}</p>
                    </div>
                </div>
            </div>
        `;
    }
    let src = chatUrl;
    if (state.settings?.viewportDebug) {
        try {
            const urlObj = new URL(src);
            urlObj.searchParams.set('viewportDebug', '1');
            src = urlObj.toString();
        } catch (e) {
            // Ignored
        }
    } else {
        try {
            const urlObj = new URL(src);
            urlObj.searchParams.delete('viewportDebug');
            src = urlObj.toString();
        } catch (e) {
            // Ignored
        }
    }
    return `
        <div class="chat-panel">
            <iframe class="chat-iframe" id="chat-iframe" src="${escapeAttr(src)}" allow="clipboard-read; clipboard-write" title="Chat"></iframe>
        </div>
    `;
}

function renderChatSide() {
    const task = activeChatTask();
    if (!task) {
        return `
            <aside class="side">
                <div class="panel chat-session-panel">
                    <div class="panel-head">
                        <h2>${t('chat_session')}</h2>
                        <button type="button" class="side-icon-button refresh-action" title="${t('refresh')}" aria-label="${t('refresh')}">${refreshIcon()}</button>
                    </div>
                    <div class="empty-state">${t('no_active_chat')}</div>
                </div>
            </aside>
        `;
    }
    return renderChatPanel(task);
}

function renderChatPanel(task) {
    const chatUrl = task.pageUrl || '';
    const chatState = task.chatState || task.state || 'running';
    const messageCount = task.chatMessageCount || 0;
    const lastActivity = task.chatLastActivity ? messageTime(task.chatLastActivity) : '';
    const deviceCount = chatDeviceCount(task);
    const qrImage = qrImageURL(chatUrl);
    const qrToggleLabel = state.chatQROpen ? 'Hide chat QR' : 'Show chat QR';
    const qrPulse = !state.chatQRPromptDismissed && state.chatQRPulseUntil > Date.now();
    const remoteDeviceCount = Math.max(0, deviceCount - 1);
    return `
        <aside class="side">
            <div class="panel chat-session-panel">
                <div class="panel-head">
                    <div>
                        <div class="panel-title-inline">
                            ${hasPaidLicense() ? `<span class="license-badge sidebar-badge">${escapeHTML(state.license.tier)}</span>` : ''}
                            <h2>${t('chat_status')}</h2>
                        </div>
                        <p class="side-note tight">${escapeHTML(chatStateLabel(chatState))}</p>
                    </div>
                    <div class="side-head-actions">
                        <button type="button" class="side-icon-button refresh-action" title="${t('refresh')}" aria-label="${t('refresh')}">${refreshIcon()}</button>
                        <button type="button" class="side-icon-button open-qr" data-open-url="${escapeAttr(chatUrl)}" title="${t('open_in_browser')}" aria-label="${t('open_in_browser')}" ${chatUrl ? '' : 'disabled'}>${browserIcon()}</button>
                        <button type="button" class="side-icon-button danger-icon stop-chat-action" title="${t('stop')}" aria-label="${t('stop')}">${stopIcon()}</button>
                    </div>
                </div>
                <div class="chat-count">${escapeHTML(String(messageCount))} message${messageCount === 1 ? '' : 's'}</div>
                ${lastActivity ? `<p class="side-note">${t('last_activity')}: ${escapeHTML(lastActivity)}</p>` : ''}
            </div>
            <div class="panel chat-session-panel chat-qr-panel ${state.chatQROpen ? 'expanded' : ''}">
                <div class="panel-head">
                    <h2>${t('scan_to_join')}</h2>
                    <button type="button" class="side-icon-button chat-qr-toggle-action ${qrPulse ? 'qr-breathe' : ''}" title="${qrToggleLabel}" aria-label="${qrToggleLabel}">${qrIcon()}</button>
                </div>
                ${state.chatQROpen ? `
                    <div class="chat-qr-content">
                        <div class="chat-qr-card chat-qr-card-large">
                            ${qrImage ? `<img src="${escapeAttr(qrImage)}" alt="Chat QR code">` : `<div class="empty-state">${t('waiting_qr')}</div>`}
                        </div>
                        <div class="chat-url-row">
                            <span>${escapeHTML(chatUrl || t('waiting_network_url'))}</span>
                            <button type="button" class="copy-chat-url-action" title="${t('copy_chat_url')}" aria-label="${t('copy_chat_url')}" ${chatUrl ? '' : 'disabled'}>${copyIcon()}</button>
                        </div>
                    </div>
                ` : `<p class="side-note">${state.settings?.lang === 'en' ? 'Expand when you need to invite another device.' : '展开以为其他设备扫码接入。'}</p>`}
            </div>
            <div class="panel chat-session-panel">
                <div class="panel-head">
                    <h2>${t('devices')}</h2>
                    <span class="side-count">${deviceCount}</span>
                </div>
                <div class="device-list compact">
                    <div class="device-row">
                        <span class="device-icon">${computerIcon()}</span>
                        <strong>${t('desktop')}</strong>
                        <span>${t('connected')}</span>
                    </div>
                    <div class="device-row">
                        <span class="device-icon">${phoneIcon()}</span>
                        <strong>${t('remote')}</strong>
                        <span>${remoteDeviceCount} ${t('connected')}</span>
                    </div>
                </div>
            </div>
        </aside>
    `;
}

function chatStateLabel(chatState) {
    if (chatState === 'active') {
        return t('connected');
    }
    if (chatState === 'waiting' || chatState === 'running') {
        return t('waiting_connection');
    }
    return titleCase(chatState || 'waiting');
}

function chatDeviceCount(task) {
    return task ? Math.max(1, Number(task.chatDeviceCount || 0)) : 0;
}

function renderPanel() {
    if (!state.activePanel) {
        return '';
    }
    const title = {
        settings: t('settings'),
        redeem: t('redeem_title'),
        about: t('about_title'),
        feedback: t('feedback'),
    }[state.activePanel] || '';
    return `
        <div class="overlay" role="presentation">
            <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
                <div class="modal-head">
                    <h2>${escapeHTML(title)}</h2>
                    <div class="modal-actions">
                        ${state.activePanel === 'settings' ? `<button class="tool-button" id="open-redeem-inline" title="${t('redeem_title')}" aria-label="${t('redeem_title')}">${giftIcon()}</button>` : ''}
                        <button class="tool-button" id="close-panel" title="${t('close')}" aria-label="${t('close')}">x</button>
                    </div>
                </div>
                ${state.activePanel === 'settings' ? renderSettingsPanel() : ''}
                ${state.activePanel === 'redeem' ? renderRedeemPanel() : ''}
                ${state.activePanel === 'about' ? renderAboutPanel() : ''}
                ${state.activePanel === 'feedback' ? renderFeedbackPanel() : ''}
            </section>
        </div>
    `;
}

function renderSettingsPanel() {
    if (!state.settings) {
        return '';
    }
    const options = (state.settings.interfaceOptions || []).map((option) => `
        <option value="${escapeAttr(option.name)}" ${option.name === state.settings.interface ? 'selected' : ''}>${escapeHTML(option.label || option.name)}</option>
    `).join('');
    const chatSender = state.settings.chatSender || '';
    const chatAvatar = state.settings.chatAvatar || '';
    const chatAvatarPreview = cleanChatAvatar(chatAvatar) || (cleanChatProfileName(chatSender).charAt(0) || 'D').toUpperCase();
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
                        <option value="zh" ${state.settings?.lang === 'zh' ? 'selected' : ''}>${t('lang_zh')}</option>
                        <option value="en" ${state.settings?.lang === 'en' ? 'selected' : ''}>${t('lang_en')}</option>
                        <option value="ja" ${state.settings?.lang === 'ja' ? 'selected' : ''}>${t('lang_ja')}</option>
                        <option value="ko" ${state.settings?.lang === 'ko' ? 'selected' : ''}>${t('lang_ko')}</option>
                        <option value="es" ${state.settings?.lang === 'es' ? 'selected' : ''}>${t('lang_es')}</option>
                        <option value="de" ${state.settings?.lang === 'de' ? 'selected' : ''}>${t('lang_de')}</option>
                        <option value="fr" ${state.settings?.lang === 'fr' ? 'selected' : ''}>${t('lang_fr')}</option>
                    </select>
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
                    <input id="settings-chat-sender" type="text" maxlength="20" value="${escapeAttr(chatSender)}" placeholder="Desktop" />
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('chat_avatar')}</strong>
                        <span>${t('chat_avatar_desc')}</span>
                        <div class="avatar-presets">
                            <button type="button" class="avatar-preset-btn" data-avatar="🚀" title="Rocket">🚀</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="😎" title="Cool">😎</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="💻" title="Computer">💻</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="👍" title="Like">👍</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="🌟" title="Star">🌟</button>
                            <button type="button" class="avatar-preset-btn" data-avatar="🎨" title="Art">🎨</button>
                        </div>
                    </div>
                    <div class="avatar-setting-row">
                        <span class="avatar-preview">${escapeHTML(chatAvatarPreview)}</span>
                        <input id="settings-chat-avatar" maxlength="8" value="${escapeAttr(chatAvatar)}" placeholder="Emoji or initials" />
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-copy">
                        <strong>${t('chat_autosave')}</strong>
                        <span>${t('chat_autosave_desc')}</span>
                    </div>
                    <div class="setting-control-stack">
                        ${renderSwitch('settings-chat-autosave', state.chatAutoSave)}
                        <button type="button" class="icon-button-mini" id="open-chat-save" title="${t('open_folder')}" aria-label="${t('open_folder')}" style="padding: 4px; display: inline-flex; align-items: center; justify-content: center;">${openFolderIcon()}</button>
                    </div>
                </div>
            </section>

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
                        <option value="quit" ${state.closeBehavior === 'quit' ? 'selected' : ''}>${t('quit_app')}</option>
                    </select>
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
                            <strong class="setting-label-with-help" data-help="${escapeAttr(portHelpText)}" tabindex="0">${t('port_title')} <span aria-hidden="true">?</span></strong>
                            <span>${t('port_desc')}</span>
                        </div>
                        <input id="settings-port" type="number" min="0" max="65535" value="${Number(state.settings.port || 0)}" data-help="${escapeAttr(portHelpText)}" />
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
        </div>
    `;
}

function renderSwitch(id, checked, disabled = false) {
    return `
        <label class="switch" title="${disabled ? 'Not available on this platform' : ''}">
            <input id="${id}" type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
            <span></span>
        </label>
    `;
}

function renderChatQuotaPill() {
    if (hasPaidLicense()) {
        return '';
    }
    return `<span class="chat-quota-pill" id="top-chat-quota" title="Daily free chat time">${escapeHTML(chatQuotaTopText())}</span>`;
}

function renderStatusBadge(status) {
    if (!status) {
        return '<span class="setting-status muted">checking</span>';
    }
    if (status.supported === false) {
        return '<span class="setting-status muted">unsupported</span>';
    }
    if (status.needsRepair) {
        return '<span class="setting-status warning">repair</span>';
    }
    return '';
}

function integrationStatusText(status, fallback) {
    if (!status) {
        return 'Checking status...';
    }
    if (status.supported === false) {
        return 'Not available on this platform yet.';
    }
    if (status.needsRepair) {
        return 'Needs repair. Turn this off and on again to reinstall it.';
    }
    if (status.enabled) {
        return 'Enabled.';
    }
    return fallback;
}

function renderAboutPanel() {
    const info = state.appInfo || {};
    const license = state.license || loadLicense();
    let plan = license?.tier ? `${getLicenseDisplayName(license)} ${t('running')}` : t('free_quota');
    let planDetail = license?.redeemedAt ? `${t('redeemed_at', { date: new Date(license.redeemedAt).toLocaleDateString() })}` : chatQuotaText();
    
    let warningBox = '';
    const isPaid = state.status?.isPaid !== undefined ? state.status.isPaid : (license?.tier ? true : false);
    if (state.status?.clockTampered) {
        plan = t('paid_locked_clock');
        planDetail = t('locked_rollback');
        warningBox = `
            <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                <strong>⚠️ ${t('locked_rollback')}：</strong>
                ${t('locked_rollback_desc')}
            </div>
        `;
    } else if (license?.tier && !isPaid) {
        plan = `${getLicenseDisplayName(license)} ${t('license_locked_limit')}`;
        planDetail = t('license_locked_server');
        warningBox = `
            <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                <strong>⚠️ ${t('license_verify_failed')}</strong>
                ${t('license_verify_failed_desc', { tier: getLicenseDisplayName(license) })}
            </div>
        `;
    }
    
    let devSection = '';
    if (state.settings?.devMode) {
        devSection = `
            <div class="dev-section" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--line);">
                <h3 style="font-size: 14px; margin-bottom: 8px; color: var(--accent-strong);">${t('dev_options')}</h3>
                <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span>${t('enable_debug_logs')}</span>
                        <input type="checkbox" id="dev-debug-log" ${state.settings?.debugLog ? 'checked' : ''} />
                    </label>
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span>${t('enable_viewport_debug')}</span>
                        <input type="checkbox" id="dev-viewport-debug" ${state.settings?.viewportDebug ? 'checked' : ''} />
                    </label>
                    <div style="color: var(--muted); font-size: 11px; margin-top: -4px; line-height: 1.4;">
                        ${t('dev_logs_desc')}
                        <br>${t('dev_logs_path')} <strong style="word-break: break-all;">${escapeHTML(info.logPath || 'Temp directory')}</strong>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 6px;">
                        <button class="ghost" id="dev-open-log" style="flex: 1; padding: 4px 8px; font-size: 11px;">${t('btn_open_log_file')}</button>
                        <button class="ghost" id="dev-open-dir" style="flex: 1; padding: 4px 8px; font-size: 11px;">${t('btn_open_log_dir')}</button>
                    </div>
                    <button class="danger inline" id="dev-disable-mode" style="margin-top: 6px; font-size: 11px; padding: 4px 8px; width: 100%;">
                        ${t('btn_exit_dev_mode')}
                    </button>
                </div>
            </div>
        `;
    }

    let planPopover = `
        <div class="popover-backdrop" id="close-plan-popover-bg"></div>
        <div class="plan-popover">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--line); padding-bottom: 8px;">
                <strong style="color: var(--accent-strong); font-size: 14px; display: flex; align-items: center; gap: 4px;">
                    ${t('plan_desc_title')}
                </strong>
                <button class="tool-button" id="close-plan-popover" title="${t('close')}" aria-label="${t('close')}" style="border: none; background: transparent; cursor: pointer; font-size: 18px; color: var(--muted); padding: 4px; line-height: 1; display: flex; align-items: center; justify-content: center;">&times;</button>
            </div>
            <div style="font-size: 13px; line-height: 1.6; display: flex; flex-direction: column; gap: 10px; text-align: left;">
                <div>
                    <strong style="color: var(--ink);">${t('plan_plus_annual')}</strong>
                    ${t('plan_plus_annual_desc')}
                </div>
                <div>
                    <strong style="color: var(--ink);">${t('plan_plus_lifetime')}</strong>
                    ${t('plan_plus_lifetime_desc')}
                </div>
                <div style="margin-top: 4px; padding-top: 8px; border-top: 1px dashed var(--border); font-size: 12px; color: var(--muted); line-height: 1.5;">
                    💡 <strong>${t('plan_binding_note')}</strong>：${t('plan_binding_note_desc')}
                </div>
            </div>
        </div>
    `;

    return `
        <div class="about-panel">
            ${warningBox}
            <div class="about-hero">
                <img class="about-logo" src="${horizontalLogoURL}" alt="EQT Easy QR Transfer" style="cursor: pointer;">
                <div class="about-plan">
                    <div class="about-plan-left">
                        <span>${t('plan_label')}</span>
                        <strong>${escapeHTML(plan)}</strong>
                        <small>${escapeHTML(planDetail)}</small>
                    </div>
                    <button class="tool-button" id="toggle-plan-info" aria-label="${t('plan_desc_title')}" style="padding: 0; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; color: var(--accent-strong); flex-shrink: 0;">
                        <span class="plan-info-icon-wrapper" data-tooltip="${escapeAttr(t('tooltip_popover_comparsion'))}">
                            <span style="width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;">${diamondIcon()}</span>
                        </span>
                    </button>
                </div>
            </div>
            <dl>
                <dt>Product</dt><dd>${escapeHTML(info.product || 'EQT')} / ${escapeHTML(info.name || 'Easy QR Transfer')}</dd>
                <dt>Version</dt><dd>${escapeHTML(info.version || 'Unknown')}</dd>
                <dt>Platform</dt><dd>${escapeHTML([info.os, info.arch].filter(Boolean).join(' / ') || 'Unknown')}</dd>
                <dt>CLI</dt><dd>${escapeHTML(info.cliPath || 'Not found yet')}</dd>
                <dt>Legal</dt><dd>MIT license. Forked from qrcp.</dd>
            </dl>
            ${devSection}
            ${planPopover}
        </div>
    `;
}

function ensureFavicon() {
    let icon = document.querySelector('link[rel="icon"]');
    if (!icon) {
        icon = document.createElement('link');
        icon.rel = 'icon';
        document.head.appendChild(icon);
    }
    icon.type = 'image/png';
    icon.href = faviconURL;
}

function renderRedeemPanel() {
    const license = state.license || loadLicense();
    let active = license?.tier ? t('redeem_active_tier', { tier: getLicenseDisplayName(license) }) : t('redeem_no_paid_plan');
    
    let warningBox = '';
    const isPaid = state.status?.isPaid !== undefined ? state.status.isPaid : (license?.tier ? true : false);
    if (state.status?.clockTampered) {
        active = t('paid_locked_clock');
        warningBox = `
            <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                <strong>⚠️ ${t('locked_rollback')}：</strong>
                ${t('locked_rollback_desc')}
            </div>
        `;
    } else if (license?.tier && !isPaid) {
        active = t('license_locked_limit');
        warningBox = `
            <div class="notice error compact" style="margin-bottom: 16px; font-size: 13px; line-height: 1.4;">
                <strong>⚠️ ${t('license_verify_failed')}</strong>
                ${t('license_verify_failed_desc', { tier: getLicenseDisplayName(license) })}
            </div>
        `;
    }

    return `
        <div class="redeem-panel">
            ${warningBox}
            <div class="license-card">
                <strong>${escapeHTML(active)}</strong>
                <span>${license?.redeemedAt ? t('redeemed_at', { date: escapeHTML(new Date(license.redeemedAt).toLocaleString()) }) : t('redeem_desc')}</span>
                ${state.status?.maxDevices ? `<span style="font-size: 11px; margin-top: 4px; opacity: 0.85;">${t('device_limit', { activated: state.status.activatedDevices || 0, max: state.status.maxDevices })}</span>` : ''}
            </div>
            <label>
                ${t('redeem_title')}
                <input id="redeem-code" autocomplete="off" spellcheck="false" placeholder="EQT-PLUS-20260523-XXXX-CHECK" ${state.isActivating ? 'disabled' : ''} value="${escapeHTML(state.tempRedeemCode || '')}" />
            </label>
            <div class="redeem-actions">
                <button class="primary" id="confirm-redeem" ${state.isActivating ? 'disabled' : ''}>${state.isActivating ? t('btn_activating') : t('btn_confirm')}</button>
                <button class="ghost" id="reset-license" ${state.isActivating ? 'disabled' : ''}>${t('btn_reset')}</button>
            </div>
            ${!state.isActivating && state.redeemMessage ? `<div class="notice success compact">${escapeHTML(state.redeemMessage)}</div>` : ''}
            ${!state.isActivating && state.redeemError ? `<div class="notice error compact">${escapeHTML(state.redeemError)}</div>` : ''}
        </div>
    `;
}

function renderFeedbackPanel() {
    const diagnostics = buildDiagnostics();
    const mailto = feedbackMailto(diagnostics);
    return `
        <div class="feedback-panel">
            ${state.feedbackNotice ? `<div class="notice success compact" style="margin-bottom: 16px;">${escapeHTML(state.feedbackNotice)}</div>` : ''}
            <label>${t('feedback_category')}</label>
            <select id="feedback-category">
                <option value="bug">${t('feedback_bug')}</option>
                <option value="transfer">${t('feedback_transfer_fail')}</option>
                <option value="gui">${t('feedback_gui_issue')}</option>
                <option value="feature">${t('feedback_feature_req')}</option>
                <option value="license">${t('feedback_license_issue')}</option>
                <option value="other">${t('feedback_other')}</option>
            </select>
            <label>${t('feedback_contact')}</label>
            <input id="feedback-contact" type="email" placeholder="${t('feedback_optional')}" />
            <label>${t('feedback_message')}</label>
            <textarea id="feedback-message" rows="5" placeholder="${t('feedback_placeholder')}"></textarea>
            <label class="check">
                <input id="feedback-diagnostics" type="checkbox" checked />
                ${t('feedback_include_diag')}
            </label>
            <div class="feedback-note">${t('feedback_diag_note')}</div>
            <pre class="diagnostics">${escapeHTML(diagnostics)}</pre>
            <div class="feedback-actions">
                <button class="primary" id="send-feedback" ${state.feedbackSent ? 'disabled' : ''} data-mailto="${escapeAttr(mailto)}">${state.feedbackSent ? t('btn_draft_opened') : t('btn_open_email_draft')}</button>
                <button class="ghost" id="copy-feedback">${t('btn_copy_feedback')}</button>
            </div>
        </div>
    `;
}

function renderCurrent(task) {
    if (!task) {
        return `<div class="empty-state">${t('agent_idle')}</div>`;
    }
    const percent = task.transferPercent || 0;
    const qrImage = qrImageURL(task.pageUrl);
    const finished = isTerminal(task);
    return `
        <div class="task-card">
            <div class="task-title">${escapeHTML(titleCase(task.action))} #${task.id}</div>
            <div class="task-state ${finished ? 'done' : ''}">${escapeHTML(task.transferState || task.state)}</div>
            ${qrImage && !finished ? `
                <div class="qr-preview">
                    <img src="${escapeAttr(qrImage)}" alt="Transfer QR code" />
                    <button class="ghost open-qr" data-open-url="${escapeAttr(task.pageUrl)}">Open in browser</button>
                </div>
            ` : ''}
            <div class="progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>
            <dl>
                <dt>Target</dt><dd>${escapeHTML(task.transferTarget || task.transferCurrent || shortName(task.paths?.[0] || ''))}</dd>
                <dt>Archive</dt><dd>${escapeHTML(task.transferArchiveName || 'None')}</dd>
                <dt>Bytes</dt><dd>${formatBytes(task.bytesDone)}${task.bytesTotal ? ` / ${formatBytes(task.bytesTotal)}` : ''}</dd>
                <dt>QR page</dt><dd>${task.pageUrl ? escapeHTML(task.pageUrl) : 'Waiting'}</dd>
            </dl>
            ${renderSavedFiles(task.savedFiles)}
            ${task.error ? `<div class="notice error compact">${escapeHTML(task.error)}</div>` : ''}
            ${finished ? '' : '<button class="danger stop-current-action">Stop current</button>'}
        </div>
    `;
}

function renderSavedFiles(files) {
    if (!files || !files.length) {
        return '';
    }
    return `
        <div class="saved-files">
            <strong>Saved files</strong>
            <ul>${files.map((file) => `<li>${escapeHTML(file)}</li>`).join('')}</ul>
        </div>
    `;
}

function getStatusIcon(task) {
    const s = (task.transferState || task.state || '').toLowerCase();
    if (s.includes('fail') || s.includes('error')) return '❌';
    if (s.includes('stop') || s.includes('cancel')) return '🛑';
    if (s.includes('replace')) return '🔄';
    if (s.includes('complete') || s.includes('done') || s === 'idle') return '✅';
    return 'ℹ️';
}

function getContainingFolder(path) {
    if (!path) return '';
    return path.replace(/[\\/][^\\/]*$/, '') || path;
}

function openFileIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>`;
}

function openFolderIcon() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
    </svg>`;
}

function getTaskFolder(task) {
    if (task.action === 'receive') {
        if (task.paths && task.paths.length > 0) {
            return task.paths[0];
        }
        if (task.savedFiles && task.savedFiles.length > 0) {
            return getContainingFolder(task.savedFiles[0]);
        }
    } else {
        if (task.paths && task.paths.length > 0) {
            return getContainingFolder(task.paths[0]);
        }
    }
    return '';
}

function renderHistoryFiles(task) {
    let files = [];
    if (task.action === 'receive') {
        files = task.savedFiles || [];
        if (files.length === 0) {
            files = task.paths || [];
        }
    } else {
        files = task.paths || [];
    }

    if (files.length === 0) {
        return `<div class="history-empty-files">No files</div>`;
    }

    return `<div class="history-files-list">
        ${files.map((file) => {
            const name = shortName(file);
            return `
                <div class="history-file-row">
                    <div class="history-filename-wrapper">
                        <span class="file-icon-mini">📄</span>
                        <span class="history-filename" title="${escapeAttr(file)}">${escapeHTML(name)}</span>
                    </div>
                    <div class="history-file-actions">
                        <button class="icon-button-mini open-file-action" data-open-file="${escapeAttr(file)}" title="Open file: ${escapeAttr(file)}">
                            ${openFileIcon()}
                        </button>
                    </div>
                </div>
            `;
        }).join('')}
    </div>`;
}

function renderHistory(history) {
    if (!history.length) {
        return `<div class="empty-state">No completed tasks yet.</div>`;
    }
    return `<ol class="history">${history.slice(0, 8).map((task) => {
        const taskFolder = getTaskFolder(task);
        return `
        <li>
            <div class="history-item-left">
                <div class="history-title-row">
                    <strong class="history-title">${escapeHTML(titleCase(task.action))} #${task.id}</strong>
                    <span class="history-status-icon" title="${escapeAttr(task.state)}${task.transferState ? ` / ${escapeAttr(task.transferState)}` : ''}">
                        ${getStatusIcon(task)}
                    </span>
                    ${taskFolder ? `
                        <button class="icon-button-mini open-dir-action path-link" data-open-path="${escapeAttr(taskFolder)}" title="Open containing folder: ${escapeAttr(taskFolder)}" style="margin-left: 8px;">
                            ${openFolderIcon()}
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="history-item-right">
                ${renderHistoryFiles(task)}
            </div>
        </li>
        `;
    }).join('')}</ol>`;
}

function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            setMode(button.dataset.mode);
            clearMessages();
            render();
        });
    });
    document.querySelector('#refresh')?.addEventListener('click', refreshStatus);
    document.querySelectorAll('.refresh-action').forEach((button) => {
        button.addEventListener('click', refreshStatus);
    });
    document.querySelector('#open-settings')?.addEventListener('click', () => openPanel('settings'));
    document.querySelector('#open-about')?.addEventListener('click', () => openPanel('about'));
    document.querySelector('#open-feedback')?.addEventListener('click', () => openPanel('feedback'));
    document.querySelector('#choose-files')?.addEventListener('click', chooseFiles);
    document.querySelector('#choose-folder')?.addEventListener('click', chooseFolder);
    document.querySelector('#clear-share')?.addEventListener('click', () => {
        state.sharePaths = [];
        clearMessages();
        render();
    });
    document.querySelectorAll('.remove-path').forEach((button) => {
        button.addEventListener('click', removePath);
    });
    document.querySelector('#start-share')?.addEventListener('click', startShare);
    document.querySelector('#start-chat')?.addEventListener('click', startChat);
    document.querySelector('#choose-receive')?.addEventListener('click', chooseReceiveDirectory);
    document.querySelector('#start-receive')?.addEventListener('click', startReceive);
    document.querySelector('#save-receive-dir')?.addEventListener('click', saveSettings);
    bindPanelEvents();
    document.querySelectorAll('.stop-current-action').forEach((button) => {
        button.addEventListener('click', stopCurrent);
    });
    document.querySelectorAll('.stop-chat-action').forEach((button) => {
        button.addEventListener('click', stopChat);
    });
    document.querySelectorAll('.open-qr, .preview-button[data-open-url]').forEach((button) => {
        button.addEventListener('click', openQRPage);
    });
    document.querySelector('#clear-history')?.addEventListener('click', clearHistory);
    document.querySelectorAll('.repeat-task').forEach((button) => {
        button.addEventListener('click', repeatTask);
    });
    document.querySelectorAll('[data-save-url]').forEach((element) => {
        element.addEventListener('contextmenu', openChatContextMenu);
        element.addEventListener('click', saveAttachmentAsFromButton);
    });
    document.querySelector('#copy-chat-url')?.addEventListener('click', copyChatURL);
    document.querySelectorAll('.copy-chat-url-action').forEach((button) => {
        button.addEventListener('click', copyChatURL);
    });
    document.querySelectorAll('.chat-qr-toggle-action').forEach((button) => {
        button.addEventListener('click', toggleChatQR);
    });
    document.removeEventListener('pointerdown', closeChatQROnOutside);
    if (state.chatQROpen) {
        document.addEventListener('pointerdown', closeChatQROnOutside);
    }
}

function bindPanelEvents() {
    document.querySelector('#open-redeem-inline')?.addEventListener('click', () => openPanel('redeem'));
    document.querySelector('#close-panel')?.addEventListener('click', closePanel);
    document.querySelector('.overlay')?.addEventListener('click', (event) => {
        if (event.target.classList.contains('overlay')) {
            closePanel();
        }
    });
    bindSettingsControls();
    document.querySelector('.open-docs')?.addEventListener('click', openExternal);
    document.querySelector('#send-feedback')?.addEventListener('click', sendFeedback);
    document.querySelector('#copy-feedback')?.addEventListener('click', copyFeedback);
    document.querySelector('#confirm-redeem')?.addEventListener('click', confirmRedeem);
    document.querySelector('#reset-license')?.addEventListener('click', resetLicense);
    document.querySelector('#toggle-plan-info')?.addEventListener('click', () => {
        document.querySelector('.plan-popover')?.classList.toggle('visible');
        document.querySelector('.popover-backdrop')?.classList.toggle('visible');
    });
    document.querySelector('#close-plan-popover')?.addEventListener('click', () => {
        document.querySelector('.plan-popover')?.classList.remove('visible');
        document.querySelector('.popover-backdrop')?.classList.remove('visible');
    });
    document.querySelector('#close-plan-popover-bg')?.addEventListener('click', () => {
        document.querySelector('.plan-popover')?.classList.remove('visible');
        document.querySelector('.popover-backdrop')?.classList.remove('visible');
    });

    // About logo click helper for dev mode
    let clickCount = 0;
    let clickTimer = null;
    document.querySelector('.about-logo')?.addEventListener('click', async () => {
        clickCount++;
        if (clickCount >= 5) {
            clickCount = 0;
            if (clickTimer) clearTimeout(clickTimer);
            if (!state.settings) state.settings = {};
            state.settings.devMode = !state.settings.devMode;
            if (state.settings.devMode) {
                state.settings.debugLog = true;
                state.settings.viewportDebug = true;
            }
            await saveSettingsData();
            state.notice = state.settings.devMode ? 'Developer Mode enabled!' : 'Developer Mode disabled.';
            render();
            openPanel('about');
        } else {
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => {
                clickCount = 0;
            }, 1500);
        }
    });

    // Dev mode controls
    document.querySelector('#dev-debug-log')?.addEventListener('change', async (event) => {
        if (!state.settings) state.settings = {};
        state.settings.debugLog = Boolean(event.currentTarget.checked);
        await saveSettingsData();
        state.notice = state.settings.debugLog ? 'Debug logs enabled.' : 'Debug logs disabled.';
        render();
        openPanel('about');
    });

    document.querySelector('#dev-viewport-debug')?.addEventListener('change', async (event) => {
        if (!state.settings) state.settings = {};
        state.settings.viewportDebug = Boolean(event.currentTarget.checked);
        await saveSettingsData();
        state.notice = state.settings.viewportDebug ? 'Viewport debug box enabled.' : 'Viewport debug box disabled.';
        render();
        openPanel('about');
    });

    document.querySelector('#dev-open-log')?.addEventListener('click', async () => {
        const logPath = state.appInfo?.logPath;
        if (logPath) {
            try {
                await OpenPath(logPath);
            } catch (error) {
                state.error = 'Failed to open log: ' + error;
                render();
            }
        }
    });

    document.querySelector('#dev-open-dir')?.addEventListener('click', async () => {
        const logPath = state.appInfo?.logPath;
        if (logPath) {
            try {
                const separator = logPath.includes('\\') ? '\\' : '/';
                const parts = logPath.split(separator);
                parts.pop();
                const logDir = parts.join(separator);
                await OpenPath(logDir);
            } catch (error) {
                state.error = 'Failed to open log directory: ' + error;
                render();
            }
        }
    });

    document.querySelector('#dev-disable-mode')?.addEventListener('click', async () => {
        if (!state.settings) state.settings = {};
        state.settings.devMode = false;
        state.settings.debugLog = false;
        state.settings.viewportDebug = false;
        await saveSettingsData();
        state.notice = 'Developer Mode disabled.';
        render();
        openPanel('about');
    });
}

function bindChatQRPanelEvents() {
    document.querySelectorAll('.refresh-action').forEach((button) => {
        button.addEventListener('click', refreshStatus);
    });
    document.querySelectorAll('.open-qr').forEach((button) => {
        button.addEventListener('click', openQRPage);
    });
    document.querySelectorAll('.stop-current-action').forEach((button) => {
        button.addEventListener('click', stopCurrent);
    });
    document.querySelectorAll('.chat-qr-toggle-action').forEach((button) => {
        button.addEventListener('click', toggleChatQR);
    });
    document.querySelectorAll('.copy-chat-url-action').forEach((button) => {
        button.addEventListener('click', copyChatURL);
    });
}

function syncAndSaveSettingsInBackground() {
    if (state.activePanel === 'settings') {
        syncSettingsFromDOM();
        saveSettingsData().catch(err => {
            console.error('Failed to auto-save settings in background:', err);
        });
    }
}

function openPanel(panel) {
    syncAndSaveSettingsInBackground();
    state.activePanel = panel;
    if (panel === 'redeem') {
        state.redeemMessage = '';
        state.redeemError = '';
    }
    if (panel === 'feedback') {
        state.feedbackNotice = '';
        state.feedbackSent = false;
    }
    if (panel === 'about') {
        state.showPlanInfoDetails = false;
    }
    clearMessages();
    updateMessagesSurface();
    syncPanelSurface();
}

function closePanel() {
    syncAndSaveSettingsInBackground();
    state.activePanel = '';
    render();
}

function syncManualUpdateCheckUI() {
    const statusEl = document.querySelector('#update-check-status');
    const btnEl = document.querySelector('#btn-manual-update-check');
    console.log('[Antigravity Debug] syncManualUpdateCheckUI called, statusEl:', statusEl, 'btnEl:', btnEl, 'updateStatusText:', state.updateStatusText, 'updateBtnText:', state.updateBtnText);
    LogInfo('[Antigravity Debug] syncManualUpdateCheckUI called, statusEl: ' + (statusEl ? 'found' : 'null') + ', btnEl: ' + (btnEl ? 'found' : 'null') + ', updateStatusText: ' + state.updateStatusText + ', updateBtnText: ' + state.updateBtnText);
    if (statusEl && btnEl) {
        statusEl.textContent = state.updateStatusText || t('manual_check_tips');
        btnEl.textContent = state.updateBtnText || t('manual_check_btn');
        btnEl.disabled = Boolean(state.updateBtnDisabled);
    } else {
        console.log('[Antigravity Debug] syncManualUpdateCheckUI fallback to syncPanelSurface');
        LogInfo('[Antigravity Debug] syncManualUpdateCheckUI fallback to syncPanelSurface');
        syncPanelSurface();
    }
}

function syncPanelSurface() {
    console.log('[Antigravity Debug] syncPanelSurface called, activePanel:', state.activePanel, 'stack:', new Error().stack);
    LogInfo('[Antigravity Debug] syncPanelSurface called, activePanel: ' + state.activePanel + ', stack: ' + new Error().stack);
    const existing = document.querySelector('.overlay');
    
    // 记录旧 modal 的滚动位置，防止重绘后面板回退到顶部
    let savedScrollTop = 0;
    if (existing) {
        const modalEl = existing.querySelector('.modal');
        if (modalEl) {
            savedScrollTop = modalEl.scrollTop;
        }
    }

    if (!state.activePanel) {
        existing?.remove();
        return;
    }
    const next = document.createElement('template');
    next.innerHTML = renderPanel().trim();
    const overlay = next.content.firstElementChild;
    if (!overlay) {
        return;
    }
    if (existing) {
        existing.replaceWith(overlay);
        
        // 还原滚动位置到新的 modal 上
        const newModalEl = overlay.querySelector('.modal');
        if (newModalEl && savedScrollTop > 0) {
            newModalEl.scrollTop = savedScrollTop;
            setTimeout(() => {
                newModalEl.scrollTop = savedScrollTop;
            }, 0);
            setTimeout(() => {
                newModalEl.scrollTop = savedScrollTop;
            }, 50);
        }
    } else {
        document.querySelector('.shell')?.appendChild(overlay);
    }
    bindPanelEvents();
}

async function chooseFiles() {
    await run(async () => {
        const paths = await SelectFiles();
        addSharePaths(paths || []);
    });
}

async function chooseFolder() {
    await run(async () => {
        const path = await SelectShareDirectory();
        addSharePaths(path ? [path] : []);
    });
}

async function chooseReceiveDirectory() {
    await run(async () => {
        const path = await SelectReceiveDirectory();
        if (path) {
            state.receiveDir = path;
            render();
        }
    });
}

async function startShare() {
    await run(async () => {
        await saveSettingsData();
        state.status = await Share(state.sharePaths);
        state.sharePaths = [];
        state.notice = 'Share task started.';
        render();
    });
}

async function startReceive() {
    await run(async () => {
        await saveSettingsData();
        state.status = await Receive(state.receiveDir);
        state.notice = 'Receive task started.';
        render();
    });
}

async function startChat() {
    if (!hasPaidLicense() && chatRemainingMs() <= 0) {
        console.warn('[Frontend] startChat: Daily free chat limit reached.');
        state.error = 'Daily free chat time is used up. Upgrade to keep using chat today.';
        render();
        return;
    }
    console.log('[Frontend] startChat: Requesting chat task start from Wails App.Chat()...');
    
    // 1. Transition immediately to the chat interface with a loading status for instant UI responsiveness
    setMode('chat');
    state.status = state.status || {};
    state.status.chat = {
        action: 'chat',
        state: 'running',
        pageUrl: ''
    };
    state.notice = '';
    render();

    // 2. Run settings saving and chat session startup asynchronously in the background
    run(async () => {
        await saveSettingsData();
        state.chatQRPulseArmed = true;
        state.chatQRPromptDismissed = false;
        
        const finalStatus = await Chat();
        console.log('[Frontend] startChat: Chat task started. Status response:', finalStatus);
        
        state.status = finalStatus;
        reconcileChatQRState(finalStatus);
        if (!state.chatQRPulseUntil) {
            triggerChatQRPulse();
        }
        if (state.chatAutoSave) {
            state.chatSaveDir = await ChatSaveDirectory();
            console.log('[Frontend] startChat: Chat autosave path set to:', state.chatSaveDir);
        }
        render();
    }, {busy: false});
}

async function openChatSaveDirectory() {
    await run(async () => {
        const dir = state.chatSaveDir || await ChatSaveDirectory();
        state.chatSaveDir = dir;
        await OpenPath(dir);
        state.notice = `Opened ${dir}`;
        render();
    }, {busy: false});
}

function copyChatURL() {
    const task = activeChatTask();
    if (!task?.pageUrl) {
        return;
    }
    if (navigator.clipboard) {
        navigator.clipboard.writeText(task.pageUrl);
    }
}

function toggleChatQR() {
    stopChatQRPulse();
    state.chatQROpen = !state.chatQROpen;
    updateChatQRPanel();
}

function closeChatQROnOutside(event) {
    if (event.target.closest('.chat-qr-panel')) {
        return;
    }
    state.chatQROpen = false;
    updateChatQRPanel();
}

function updateChatQRPanel() {
    const task = activeChatTask();
    if (!task) {
        render();
        return;
    }
    const existing = document.querySelector('.chat-qr-panel');
    if (!existing) {
        render();
        return;
    }
    const next = document.createElement('template');
    next.innerHTML = renderChatPanel(task).trim();
    const nextSide = next.content.firstElementChild;
    if (!nextSide) {
        return;
    }
    existing.closest('.side')?.replaceWith(nextSide);
    bindChatQRPanelEvents();
    document.removeEventListener('pointerdown', closeChatQROnOutside);
    if (state.chatQROpen) {
        document.addEventListener('pointerdown', closeChatQROnOutside);
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function handleAutoSaveSettings() {
    try {
        await saveSettingsData();
        if (state.error) {
            state.error = '';
            render();
        }
    } catch (e) {
        state.error = 'Failed to save settings: ' + (e.message || String(e));
        render();
    }
}

async function saveSettings() {
    await run(async () => {
        await saveSettingsData();
        if (state.mode === 'chat') {
            syncPanelSurface();
            showToast('Settings saved.');
        } else {
            state.notice = 'Settings saved.';
            render();
        }
    });
}

function syncSettingsFromDOM() {
    if (!state.settings) return;
    const receiveInput = document.querySelector('#receive-dir');
    const receiveBrowser = document.querySelector('#browser-open');
    const sideBrowser = document.querySelector('#settings-browser');
    const chatAutoSave = document.querySelector('#settings-chat-autosave');
    const closeBehavior = document.querySelector('#settings-close-behavior');
    const iface = document.querySelector('#settings-interface');
    const port = document.querySelector('#settings-port');
    const chatSender = document.querySelector('#settings-chat-sender');
    const chatAvatar = document.querySelector('#settings-chat-avatar');
    const autoUpdateMode = document.querySelector('#settings-auto-update-mode');
    const updateInterval = document.querySelector('#settings-update-interval');
    const lang = document.querySelector('#settings-lang');


    if (receiveInput) state.settings.output = receiveInput.value;
    if (receiveBrowser) state.settings.browser = receiveBrowser.checked;
    if (sideBrowser) state.settings.browser = sideBrowser.checked;
    if (chatAutoSave) state.settings.chatAutoSave = chatAutoSave.checked;
    if (closeBehavior) state.settings.closeBehavior = closeBehavior.value;
    if (iface) state.settings.interface = iface.value;
    if (port) state.settings.port = Number(port.value);
    if (chatSender) state.settings.chatSender = cleanChatProfileName(chatSender.value);
    if (chatAvatar) state.settings.chatAvatar = cleanChatAvatar(chatAvatar.value);
    if (autoUpdateMode) state.settings.autoUpdateMode = autoUpdateMode.value;
    if (updateInterval) state.settings.updateCheckIntervalHours = Number(updateInterval.value);
    if (lang) state.settings.lang = lang.value;


    state.receiveDir = state.settings.output || '';
    state.browserFallback = Boolean(state.settings.browser);
    state.chatAutoSave = state.settings.chatAutoSave !== false;
    state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
}

async function saveSettingsData() {
    syncSettingsFromDOM();
    const settings = {
        ...(state.settings || {}),
        devMode: Boolean(state.settings?.devMode ?? false),
        debugLog: Boolean(state.settings?.debugLog ?? false),
        viewportDebug: Boolean(state.settings?.viewportDebug ?? false),
    };
    state.settings = await SaveSettings(settings);
    state.receiveDir = state.settings.output;
    state.browserFallback = state.settings.browser;
    state.chatAutoSave = state.settings.chatAutoSave !== false;
    state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
    syncViewportDebugToChatFrame();
}

function syncViewportDebugToChatFrame() {
    const frame = document.querySelector('#chat-iframe');
    if (!frame) { return; }
    const enabled = Boolean(state.settings?.viewportDebug ?? false);
    const payload = {
        type: 'update-viewport-debug',
        enabled: enabled
    };
    const post = () => {
        try {
            frame.contentWindow?.postMessage(payload, activeChatFrameOrigin() || '*');
        } catch (e) {
            // Ignored
        }
    };
    frame.addEventListener('load', post, {once: true});
    window.setTimeout(post, 0);
}


async function toggleRightClickIntegration(event) {
    const enabled = Boolean(event.currentTarget?.checked);
    event.currentTarget.disabled = true;
    try {
        state.rightClickIntegration = await SetRightClickIntegrationEnabled(enabled);
        updateIntegrationRow('right-click');
    } catch (error) {
        state.error = error?.message || String(error);
        event.currentTarget.checked = !enabled;
        event.currentTarget.disabled = false;
        render();
    }
}

async function toggleStartupIntegration(event) {
    const enabled = Boolean(event.currentTarget?.checked);
    event.currentTarget.disabled = true;
    try {
        state.startupIntegration = await SetStartupEnabled(enabled);
        updateIntegrationRow('startup');
    } catch (error) {
        state.error = error?.message || String(error);
        event.currentTarget.checked = !enabled;
        event.currentTarget.disabled = false;
        render();
    }
}

function bindSettingsControls() {
    document.querySelector('#settings-right-click')?.addEventListener('change', toggleRightClickIntegration);
    document.querySelector('#settings-startup')?.addEventListener('change', toggleStartupIntegration);
    document.querySelectorAll('[data-help]').forEach(bindHelpTooltip);
    document.querySelector('#open-chat-save')?.addEventListener('click', openChatSaveDirectory);

    const avatarInput = document.querySelector('#settings-chat-avatar');
    if (avatarInput) {
        avatarInput.addEventListener('input', (event) => {
            const cleaned = cleanChatAvatar(event.target.value);
            if (event.target.value !== cleaned) {
                event.target.value = cleaned;
            }
            const previewEl = document.querySelector('.avatar-preview');
            if (previewEl) {
                previewEl.textContent = cleaned || (cleanChatProfileName(state.settings?.chatSender).charAt(0) || 'D').toUpperCase();
            }
            syncSettingsFromDOM();
        });
        avatarInput.addEventListener('change', async () => {
            syncSettingsFromDOM();
            await handleAutoSaveSettings();
        });
    }
    const chatSenderInput = document.querySelector('#settings-chat-sender');
    if (chatSenderInput) {
        chatSenderInput.addEventListener('input', (event) => {
            const cleaned = cleanChatProfileName(event.target.value);
            const previewEl = document.querySelector('.avatar-preview');
            if (previewEl) {
                const avatarVal = document.querySelector('#settings-chat-avatar')?.value || '';
                previewEl.textContent = cleanChatAvatar(avatarVal) || (cleaned.charAt(0) || 'D').toUpperCase();
            }
            syncSettingsFromDOM();
        });
    }

    document.querySelectorAll('.avatar-preset-btn').forEach(btn => {
        btn.addEventListener('click', (event) => {
            const presetVal = event.currentTarget.dataset.avatar;
            if (avatarInput && presetVal) {
                avatarInput.value = presetVal;
                avatarInput.dispatchEvent(new Event('input'));
                handleAutoSaveSettings();
            }
        });
    });

    const inputs = [
        '#settings-interface',
        '#settings-port',
        '#settings-browser',
        '#settings-chat-autosave',
        '#settings-close-behavior',
        '#settings-auto-update-mode',
        '#settings-update-interval',
        '#settings-lang',

        '#settings-chat-sender'
    ];
    inputs.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
            el.addEventListener('change', async () => {
                syncSettingsFromDOM();
                await handleAutoSaveSettings();
            });
            el.addEventListener('input', syncSettingsFromDOM);
        }
    });

    const advDetails = document.querySelector('.settings-advanced-details');
    if (advDetails) {
        advDetails.addEventListener('toggle', (event) => {
            state.settingsAdvancedOpen = event.currentTarget.open;
        });
    }

    document.querySelector('#btn-manual-update-check')?.addEventListener('click', runManualUpdateCheck);
}

function updateIntegrationRow(kind) {
    const config = kind === 'startup'
        ? {
            status: state.startupIntegration,
            text: '#startup-status-text',
            control: '#startup-control',
            switchId: 'settings-startup',
            fallback: 'Starts the background transfer service when you sign in.',
            handler: toggleStartupIntegration,
        }
        : {
            status: state.rightClickIntegration,
            text: '#right-click-status-text',
            control: '#right-click-control',
            switchId: 'settings-right-click',
            fallback: 'Adds Explorer actions for sharing selected files and receiving into a folder.',
            handler: toggleRightClickIntegration,
        };
    const text = document.querySelector(config.text);
    if (text) {
        text.textContent = integrationStatusText(config.status, config.fallback);
    }
    const control = document.querySelector(config.control);
    if (control) {
        control.innerHTML = `${renderStatusBadge(config.status)}${renderSwitch(config.switchId, config.status?.enabled, config.status?.supported === false)}`;
        document.querySelector(`#${config.switchId}`)?.addEventListener('change', config.handler);
    }
}

async function stopCurrent() {
    await run(async () => {
        await StopCurrent();
        state.notice = 'Current task stopped.';
        await loadStatusData();
    });
}

async function stopChat() {
    await run(async () => {
        await StopChat();
        state.notice = 'Chat stopped.';
        await loadStatusData();
    });
}

async function clearHistory() {
    await run(async () => {
        await ClearHistory();
        state.notice = 'History cleared.';
        await loadStatusData();
    });
}

async function repeatTask(event) {
    await run(async () => {
        const id = Number(event.currentTarget.dataset.taskId);
        state.status = await RepeatTask(id);
        state.notice = `Task #${id} repeated.`;
        render();
    });
}

async function openQRPage(event) {
    await run(async () => {
        const url = event.currentTarget.dataset.openUrl;
        if (url) {
            await OpenURL(url);
        }
    });
}

async function openPath(event) {
    await run(async () => {
        const path = event.currentTarget.dataset.openPath;
        if (path) {
            await OpenPath(path);
        }
    }, {busy: false});
}

async function openSavedFile(event) {
    await run(async () => {
        const path = event.currentTarget.dataset.openFile;
        if (path) {
            await OpenFile(path);
        }
    }, {busy: false});
}

function openChatContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const items = [];
    if (target.dataset.saveUrl) {
        items.push({label: 'Save as', action: () => saveAttachmentAs(target.dataset.saveUrl, target.dataset.saveName || 'attachment')});
    }
    if (items.length) {
        showContextMenu(items, event.clientX, event.clientY);
    }
}

async function saveAttachmentAs(url, name) {
    await run(async () => {
        await SaveChatAttachmentAs(url, name || 'attachment');
    }, {busy: false});
}

async function saveAttachmentAsFromButton(event) {
    event.stopPropagation();
    const target = event.currentTarget;
    await saveAttachmentAs(target.dataset.saveUrl, target.dataset.saveName || 'attachment');
}

function showContextMenu(items, x, y) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    items.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        button.addEventListener('click', () => {
            closeContextMenu();
            item.action();
        });
        menu.appendChild(button);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    window.setTimeout(() => {
        document.addEventListener('pointerdown', closeContextMenuOnOutside);
        document.addEventListener('keydown', closeContextMenuOnEscape);
    }, 0);
}

function bindHelpTooltip(element) {
    element.addEventListener('mouseenter', showHelpTooltip);
    element.addEventListener('focus', showHelpTooltip);
    element.addEventListener('mousemove', positionHelpTooltip);
    element.addEventListener('mouseleave', closeHelpTooltip);
    element.addEventListener('blur', closeHelpTooltip);
}

function showHelpTooltip(event) {
    closeHelpTooltip();
    const target = event.currentTarget;
    const text = target.dataset.help || '';
    if (!text) {
        return;
    }
    const tip = document.createElement('div');
    tip.className = 'help-tooltip';
    tip.textContent = text;
    document.body.appendChild(tip);
    positionHelpTooltip(event);
}

function positionHelpTooltip(event) {
    const tip = document.querySelector('.help-tooltip');
    if (!tip) {
        return;
    }
    const anchor = event.currentTarget?.getBoundingClientRect?.() || {left: event.clientX || 0, bottom: event.clientY || 0};
    const x = typeof event.clientX === 'number' && event.clientX > 0 ? event.clientX : anchor.left + 12;
    const y = typeof event.clientY === 'number' && event.clientY > 0 ? event.clientY : anchor.bottom;
    const margin = 8;
    tip.style.maxWidth = `${Math.max(180, Math.min(320, window.innerWidth - margin * 2))}px`;
    const rect = tip.getBoundingClientRect();
    const left = Math.min(Math.max(margin, x + 10), window.innerWidth - rect.width - margin);
    let top = y + 12;
    if (top + rect.height + margin > window.innerHeight) {
        top = Math.max(margin, y - rect.height - 12);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function closeHelpTooltip() {
    document.querySelector('.help-tooltip')?.remove();
}

function closeContextMenuOnOutside(event) {
    if (!event.target.closest('.context-menu')) {
        closeContextMenu();
    }
}

function closeContextMenuOnEscape(event) {
    if (event.key === 'Escape') {
        closeContextMenu();
    }
}

function closeContextMenu() {
    document.querySelector('.context-menu')?.remove();
    document.removeEventListener('pointerdown', closeContextMenuOnOutside);
    document.removeEventListener('keydown', closeContextMenuOnEscape);
}

function bindLongPress(element) {
    let timer = null;
    let point = {x: 0, y: 0};
    element.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }
        point = {x: event.clientX, y: event.clientY};
        timer = window.setTimeout(() => {
            openChatContextMenu({
                preventDefault() {},
                stopPropagation() {},
                currentTarget: element,
                clientX: point.x,
                clientY: point.y,
            });
            timer = null;
        }, 560);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((name) => {
        element.addEventListener(name, () => {
            if (timer) {
                window.clearTimeout(timer);
                timer = null;
            }
        });
    });
}

async function openExternal(event) {
    await run(async () => {
        const target = event.currentTarget.dataset.openExternal;
        if (target) {
            await OpenExternal(target);
        }
    }, {busy: false});
}

async function sendFeedback(event) {
    await run(async () => {
        const feedback = collectFeedback();
        const mailto = feedbackMailto(feedback.body, feedback.category);
        await OpenExternal(mailto || event.currentTarget.dataset.mailto);
        
        state.feedbackNotice = t('feedback_draft_opened_notice');
        state.feedbackSent = true;
        render();
        
        window.setTimeout(() => {
            state.feedbackSent = false;
            render();
        }, 3000);
    }, {busy: false});
}

async function copyFeedback(event) {
    await run(async () => {
        const feedback = collectFeedback();
        await ClipboardSetText(feedback.body);
        const button = event.currentTarget;
        const original = button.textContent;
        button.textContent = 'Copied';
        button.disabled = true;
        window.setTimeout(() => {
            button.textContent = original;
            button.disabled = false;
        }, 1600);
    }, {busy: false});
}

async function refreshStatus(shouldRender = true) {
    await run(async () => {
        await loadStatusData();
        if (shouldRender) {
            if (state.activePanel) {
                return;
            }
            render();
        }
    }, {busy: false});
}

async function loadSettings() {
    await run(async () => {
        loadChatUsage();
        state.license = loadLicense();
        if (state.license) {
            SetPaidStatus(true, state.license.redeemedAt || '', state.license.codeDate || '', state.license.tier || '').catch(function(e) {
                console.error('Failed to sync paid status to backend during init:', e);
            });
        } else {
            SetPaidStatus(false, '', '', '').catch(function(e) {
                console.error('Failed to sync paid status to backend during init:', e);
            });
        }
        state.appInfo = await AppInfo();
        state.settings = await ReadSettings();
        state.receiveDir = state.settings.output || '';
        state.browserFallback = Boolean(state.settings.browser);
        state.chatAutoSave = state.settings.chatAutoSave !== false;
        state.closeBehavior = state.settings.closeBehavior === 'quit' ? 'quit' : 'tray';
        
        // Prioritize loading history and main state to render the home screen instantly
        await loadStatusData();
        render();

        // Query integration status asynchronously in the background so it doesn't block startup
        loadIntegrationStatusData().then(() => {
            if (state.activePanel === 'settings') {
                render();
            }
        }).catch((e) => {
            console.error('Failed to load integration status in background:', e);
        });
    }, {busy: false});
}

async function loadIntegrationStatusData() {
    const [rightClick, startup] = await Promise.all([
        RightClickIntegrationStatus().catch((error) => ({
            supported: false,
            enabled: false,
            needsRepair: false,
            detail: String(error?.message || error),
        })),
        StartupStatus().catch((error) => ({
            supported: false,
            enabled: false,
            needsRepair: false,
            detail: String(error?.message || error),
        })),
    ]);
    state.rightClickIntegration = rightClick;
    state.startupIntegration = startup;
}

async function loadStatusData() {
    applyStatusData(await AgentStatus());
}

function applyStatusData(nextStatus) {
    const prevChatUrl = activeChatPageURL();
    const prevCurrentUrl = String(state.status?.current?.pageUrl || '');
    const prevBusy = state.busy;
    const prevMode = state.mode;
    const prevStatusState = state.status?.state || 'idle';

    state.status = nextStatus;
    reconcileChatQRState(state.status);

    const nextChatUrl = activeChatPageURL();
    const nextCurrentUrl = String(nextStatus?.current?.pageUrl || '');
    const nextBusy = state.busy;
    const nextMode = state.mode;
    const nextStatusState = nextStatus?.state || 'idle';

    if (prevStatusState === 'busy' && nextStatusState !== 'busy') {
        const updateMode = state.settings?.autoUpdateMode || 'download';
        if (state.updateStage === 'available' && (updateMode === 'download' || updateMode === 'silent')) {
            console.log('[AutoUpdate] Transfer finished, agent returned to idle. Resuming update download.');
            triggerDownloadUpdate().catch((e) => {
                console.error('[AutoUpdate] Failed to resume download:', e);
            });
        }
    }

    if (prevChatUrl !== nextChatUrl || prevCurrentUrl !== nextCurrentUrl || prevBusy !== nextBusy || prevMode !== nextMode) {
        if (state.activePanel) {
            return;
        }
        render();
    }
}

async function run(fn, options = {}) {
    const showBusy = options.busy !== false;
    state.error = '';
    if (showBusy) {
        state.busy = true;
        renderBusy();
    }
    try {
        await fn();
    } catch (error) {
        console.error('[Frontend] run: execution failed:', error);
        state.error = error?.message || String(error);
        render();
    } finally {
        if (showBusy) {
            state.busy = false;
            render();
        }
    }
}

function renderBusy() {
    const primary = document.querySelector('.primary');
    if (primary) {
        primary.disabled = true;
    }
}

function removePath(event) {
    const index = Number(event.currentTarget.dataset.pathIndex);
    state.sharePaths = state.sharePaths.filter((_, itemIndex) => itemIndex !== index);
    clearMessages();
    render();
}

function addSharePaths(paths) {
    const next = new Set(state.sharePaths);
    paths.filter(Boolean).forEach((path) => next.add(path));
    state.sharePaths = [...next];
    clearMessages();
    render();
}

let agentEventsSubscribed = false;

function connectAgentEvents() {
    if (agentEventsSubscribed) {
        return;
    }
    agentEventsSubscribed = true;
    EventsOn('agent-status', (nextStatus) => {
        try {
            const previousChatURL = activeChatPageURL();
            applyStatusData(nextStatus);
            if (canKeepChatFrame(previousChatURL)) {
                updateChatQuotaSurface();
                updateChatQRPulseButton();
                return;
            }
            if (state.activePanel) {
                return;
            }
            render();
        } catch (e) {
            console.error('[Frontend] Failed to process agent-status event:', e);
            refreshStatus(false);
        }
    });
}


function handleFileDrop(paths) {
    setMode('share');
    addSharePaths(paths || []);
}

function handleTrayCommand(command) {
    clearMessages();
    if (command === 'share') {
        setMode('share');
        state.activePanel = '';
        state.notice = 'Ready to share.';
        render();
        return;
    }
    if (command === 'receive') {
        setMode('receive');
        state.activePanel = '';
        state.notice = 'Ready to receive.';
        render();
        return;
    }
    if (command === 'chat') {
        setMode('chat');
        state.activePanel = '';
        state.notice = '';
        render();
        return;
    }
    if (command === 'settings' || command === 'about' || command === 'feedback') {
        state.activePanel = command;
        render();
        return;
    }
    if (command === 'refresh') {
        refreshStatus();
    }
}

function setMode(mode) {
    if (state.mode === mode) {
        if (mode === 'chat') {
            startChatUsage();
        }
        return;
    }
    if (state.mode === 'chat') {
        stopChatUsage();
    }
    state.mode = mode;
    if (mode === 'chat') {
        startChatUsage();
    }
}

function loadChatUsage() {
    const today = todayKey();
    state.chatUsageDate = today;
    state.chatUsageMs = 0;
    state.chatUsageStartedAt = 0;
    try {
        const saved = JSON.parse(window.localStorage.getItem(chatUsageStorageKey) || '{}');
        if (saved.date === today) {
            state.chatUsageMs = Math.max(0, Number(saved.usedMs || 0));
        }
    } catch {
        state.chatUsageMs = 0;
    }
}

function saveChatUsage() {
    window.localStorage.setItem(chatUsageStorageKey, JSON.stringify({
        date: todayKey(),
        usedMs: Math.min(chatDailyFreeMs, Math.max(0, Math.round(state.chatUsageMs))),
    }));
}

function startChatUsage() {
    rollChatUsageDay();
    if (hasPaidLicense() || state.chatUsageStartedAt || chatRemainingMs() <= 0) {
        return;
    }
    state.chatUsageStartedAt = Date.now();
    scheduleChatUsageTimer();
}

function stopChatUsage() {
    if (!state.chatUsageStartedAt) {
        return;
    }
    state.chatUsageMs = Math.min(chatDailyFreeMs, state.chatUsageMs + Date.now() - state.chatUsageStartedAt);
    state.chatUsageStartedAt = 0;
    saveChatUsage();
    clearChatUsageTimer();
}

function scheduleChatUsageTimer() {
    clearChatUsageTimer();
    chatUsageTimer = window.setInterval(async () => {
        saveChatUsageSnapshot();
        if (hasPaidLicense()) {
            clearChatUsageTimer();
            updateChatQuotaSurface();
            return;
        }
        if (state.mode === 'chat' && chatRemainingMs() <= 0) {
            clearChatUsageTimer();
            if (!state.chatQuotaNoticeShown) {
                state.chatQuotaNoticeShown = true;
                state.error = 'Daily free chat time is used up. Upgrade to keep using chat today.';
            }
            if (activeChatTask()) {
                try {
                    await StopChat();
                } catch {
                    // Quota state is local; a failed stop should not hide the upgrade prompt.
                }
            }
            render();
        } else if (state.mode === 'chat') {
            updateChatQuotaSurface();
        }
    }, 1000);
}

function updateChatQuotaSurface() {
    const top = document.querySelector('#top-chat-quota');
    if (top) {
        if (hasPaidLicense()) {
            top.remove();
        } else {
            top.textContent = chatQuotaTopText();
        }
    }
    const text = document.querySelector('#chat-quota-text');
    if (text) {
        text.textContent = chatQuotaText();
    }
    const button = document.querySelector('#start-chat');
    if (button) {
        const exhausted = !hasPaidLicense() && chatRemainingMs() <= 0;
        button.disabled = state.busy || exhausted;
        button.textContent = chatStartButtonText();
    }
}

function updateMessagesSurface() {
    const workspace = document.querySelector('.workspace');
    if (!workspace) {
        return;
    }
    workspace.querySelectorAll(':scope > .notice.success, :scope > .notice.error').forEach((node) => node.remove());
    if (state.notice) {
        workspace.insertAdjacentHTML('beforeend', `<div class="notice success">${escapeHTML(state.notice)}</div>`);
    }
    if (state.error) {
        workspace.insertAdjacentHTML('beforeend', `<div class="notice error">${escapeHTML(state.error)}</div>`);
    }
}

function clearChatUsageTimer() {
    if (chatUsageTimer) {
        window.clearInterval(chatUsageTimer);
        chatUsageTimer = null;
    }
}

function saveChatUsageSnapshot() {
    rollChatUsageDay();
    if (!state.chatUsageStartedAt) {
        saveChatUsage();
        return;
    }
    const usedMs = Math.min(chatDailyFreeMs, state.chatUsageMs + Date.now() - state.chatUsageStartedAt);
    window.localStorage.setItem(chatUsageStorageKey, JSON.stringify({
        date: todayKey(),
        usedMs: Math.round(usedMs),
    }));
}

function chatRemainingMs() {
    rollChatUsageDay();
    const activeMs = state.chatUsageStartedAt ? Date.now() - state.chatUsageStartedAt : 0;
    return Math.max(0, chatDailyFreeMs - state.chatUsageMs - activeMs);
}

function rollChatUsageDay() {
    const today = todayKey();
    if (state.chatUsageDate === today) {
        return;
    }
    state.chatUsageDate = today;
    state.chatUsageMs = 0;
    state.chatUsageStartedAt = 0;
    state.chatQuotaNoticeShown = false;
    saveChatUsage();
}

function todayKey() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function chatQuotaText() {
    if (hasPaidLicense()) {
        return t('chat_unlocked', { tier: licenseTiers[state.license.tier] || state.license.tier });
    }
    const remaining = chatRemainingMs();
    if (remaining <= 0) {
        return t('chat_time_used_up');
    }
    return t('chat_time_left', { time: formatDuration(remaining) });
}

function chatQuotaTopText() {
    if (hasPaidLicense()) {
        return `${licenseTiers[state.license.tier] || state.license.tier}`;
    }
    const remaining = chatRemainingMs();
    if (remaining <= 0) {
        return 'Chat 0:00';
    }
    return `Chat ${formatDuration(remaining)}`;
}

function chatStartButtonText() {
    if (state.busy) {
        return t('working');
    }
    if (!hasPaidLicense() && chatRemainingMs() <= 0) {
        return t('upgrade_required');
    }
    return t('start_chat');
}

function hasPaidLicense() {
    return Boolean(state.license?.tier && licenseTiers[state.license.tier]);
}

function loadLicense() {
    try {
        const saved = JSON.parse(window.localStorage.getItem(licenseStorageKey) || '{}');
        if (saved && saved.tier && licenseTiers[saved.tier]) {
            state.license = saved;
            return saved;
        }
    } catch {
        // Ignore malformed local activation state.
    }
    state.license = null;
    return null;
}

function saveLicense(license) {
    state.license = license;
    window.localStorage.setItem(licenseStorageKey, JSON.stringify(license));
}

function confirmRedeem() {
    const input = document.querySelector('#redeem-code');
    const code = String(input?.value || '').trim().toUpperCase();
    state.tempRedeemCode = code; // Save current input value so it's not cleared on re-render
    const result = validateRedeemCode(code);
    state.redeemMessage = '';
    state.redeemError = '';
    if (!result.ok) {
        state.redeemError = result.error;
        render();
        return;
    }
    
    state.isActivating = true;
    render();

    ActivateLicense(code).then(async function() {
        const redeemedAt = new Date().toISOString();
        saveLicense({
            tier: result.tier,
            codeHash: checksum(`${code}:stored`, 10),
            redeemedAt: redeemedAt,
            codeDate: result.codeDate,
        });
        state.redeemMessage = `${licenseTiers[result.tier]} activated successfully.`;
        state.tempRedeemCode = ''; // Clear on success
        stopChatUsage();
        await loadStatusData();
    }).catch(function(e) {
        state.redeemMessage = '';
        state.redeemError = e || 'Activation failed. Please check network and code validity.';
    }).finally(function() {
        state.isActivating = false;
        render();
    });
}

function resetLicense() {
    const button = document.querySelector('#reset-license');
    if (button) button.disabled = true;
    ResetLicense().then(async function() {
        window.localStorage.removeItem(licenseStorageKey);
        state.license = null;
        state.redeemMessage = 'Activation reset on this device.';
        state.redeemError = '';
        if (state.mode === 'chat') {
            startChatUsage();
        }
        await loadStatusData();
        render();
    }).catch(function(e) {
        state.redeemError = e || 'Failed to reset activation.';
        render();
    }).finally(function() {
        if (button) button.disabled = false;
    });
}

function validateRedeemCode(code) {
    const parts = code.split('-');
    if (parts.length < 3 || parts[0] !== 'EQT') {
        return {ok: false, error: 'Invalid code format.'};
    }
    const tier = parts[1];
    if (tier !== 'PLUS' && tier !== 'PRO') {
        return {ok: false, error: 'Unknown paid tier.'};
    }
    const date = parts[2];
    return {ok: true, tier: tier, codeDate: date};
}

function checksum(value, length) {
    let hash = 2166136261;
    for (const char of value) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36).toUpperCase().padStart(length, '0').slice(-length);
}

function clearMessages() {
    state.error = '';
    state.notice = '';
}

function isTerminal(task) {
    return ['completed', 'stopped', 'failed', 'replaced'].includes(task.transferState || task.state);
}

function activeShareTask() {
    const task = state.status?.current;
    if (!task || task.action !== 'share' || isTerminal(task)) {
        return null;
    }
    return task;
}

function activeChatTask() {
    const task = state.status?.chat || state.status?.current;
    if (!task || task.action !== 'chat' || isTerminal(task)) {
        return null;
    }
    return task;
}

function activeChatPageURL() {
    return String(activeChatTask()?.pageUrl || '');
}

function canKeepChatFrame(previousChatURL) {
    const currentChatURL = activeChatPageURL();
    return Boolean(
        state.mode === 'chat'
        && previousChatURL
        && currentChatURL
        && previousChatURL === currentChatURL
        && document.querySelector('#chat-iframe')
    );
}

function reconcileChatQRState(status) {
    const task = status?.chat || status?.current;
    if (!task || task.action !== 'chat' || isTerminal(task)) {
        state.activeChatTaskId = 0;
        state.activeChatSessionKey = '';
        state.chatQRPulseArmed = false;
        state.lastChatDeviceCount = 0;
        state.chatQROpen = false;
        state.chatQRPromptDismissed = false;
        state.chatQRPulseUntil = 0;
        return;
    }
    const deviceCount = chatDeviceCount(task);
    const sessionKey = chatSessionKey(task);
    const samePendingSession = state.activeChatSessionKey === `id:${task.id || 0}` && sessionKey.startsWith('url:');
    if (samePendingSession) {
        state.activeChatSessionKey = sessionKey;
    } else if (state.activeChatSessionKey !== sessionKey) {
        const shouldPulse = state.chatQRPulseArmed;
        state.chatQRPulseArmed = false;
        state.activeChatTaskId = task.id;
        state.activeChatSessionKey = sessionKey;
        state.lastChatDeviceCount = deviceCount;
        state.chatQROpen = false;
        state.chatQRPromptDismissed = !shouldPulse;
        if (shouldPulse) {
            triggerChatQRPulse();
        } else {
            state.chatQRPulseUntil = 0;
        }
        return;
    }
    state.chatQRPulseArmed = false;
    state.activeChatTaskId = task.id;
    if (deviceCount > 1 && state.lastChatDeviceCount <= 1) {
        state.chatQROpen = false;
    }
    state.lastChatDeviceCount = deviceCount;
}

function chatSessionKey(task) {
    const pageUrl = String(task?.pageUrl || '').trim();
    if (pageUrl) {
        return `url:${pageUrl}`;
    }
    return `id:${task?.id || 0}`;
}

function shareItemStatus(task, path) {
    const current = shortName(task.transferCurrent || '');
    if (current && current === shortName(path)) {
        const percent = task.transferPercent || 0;
        return percent ? `${percent}%` : 'Active';
    }
    if (task.transferState === 'waiting') {
        return 'Waiting';
    }
    return 'Locked';
}

function titleCase(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function formatBytes(value) {
    const size = Number(value || 0);
    if (!size) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let next = size;
    let unit = 0;
    while (next >= 1024 && unit < units.length - 1) {
        next /= 1024;
        unit += 1;
    }
    return `${next >= 10 || unit === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[unit]}`;
}

function messageTime(value) {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function refreshIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.8-4.2L4 9"></path><path d="M4 4v5h5"></path><path d="M4 13a8 8 0 0 0 14.8 4.2L20 15"></path><path d="M20 20v-5h-5"></path></svg>';
}

function stopIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
}

function copyIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path></svg>';
}

function browserIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a13 13 0 0 1 0 18"></path><path d="M12 3a13 13 0 0 0 0 18"></path></svg>';
}

function settingsIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z"></path><path d="M19.4 13.5a7.8 7.8 0 0 0 .1-1.5 7.8 7.8 0 0 0-.1-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.5-1.5L14 2h-4l-.5 2.5a8 8 0 0 0-2.5 1.5l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0-.1 1.5c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.5 1.5L10 22h4l.5-2.5a8 8 0 0 0 2.5-1.5l2.4 1 2-3.5z"></path></svg>';
}

function aboutIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 10v6"></path><path d="M12 7h.01"></path></svg>';
}

function feedbackIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4z"></path><path d="M8 9h8"></path><path d="M8 13h5"></path></svg>';
}

function giftIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12v8H4v-8"></path><path d="M2 7h20v5H2z"></path><path d="M12 7v13"></path><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5c0 1.4 1 2.5 1 2.5z"></path><path d="M12 7h3.5A2.5 2.5 0 1 0 13 4.5c0 1.4-1 2.5-1 2.5z"></path></svg>';
}

function diamondIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12l4 6-10 12L2 9z"></path><path d="M11 3 8 9l4 12 4-12-3-6"></path><path d="M2 9h20"></path></svg>';
}

function computerIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>';
}

function qrIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4z"></path><path d="M14 4h6v6h-6z"></path><path d="M4 14h6v6H4z"></path><path d="M14 14h2v2h-2z"></path><path d="M18 14h2v6h-4v-2h2z"></path><path d="M14 18h2v2h-2z"></path></svg>';
}

function folderIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>';
}

function chevronIcon(open) {
    return open
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
}

function linkIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"></path></svg>';
}

function phoneIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"></rect><path d="M11 18h2"></path></svg>';
}

function signalIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20v-3"></path><path d="M9 20v-6"></path><path d="M14 20v-9"></path><path d="M19 20V7"></path></svg>';
}

function shortName(path) {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || path || '';
}

function cleanChatProfileName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function cleanChatAvatar(value) {
    const text = String(value || '').trim();
    return Array.from(text).slice(0, 4).join('');
}

function qrImageURL(pageUrl) {
    if (!pageUrl) {
        return '';
    }
    try {
        const url = new URL(pageUrl);
        const cleanPath = url.pathname.replace(/\/$/, '');
        if (cleanPath.endsWith('/qr')) {
            url.pathname = `${cleanPath}/image`;
        } else if (cleanPath.includes('/chat/')) {
            url.pathname = `${cleanPath}/qr/image`;
        } else {
            url.pathname = '/qr/image';
        }
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

function buildDiagnostics() {
    const info = state.appInfo || {};
    const status = state.status || {};
    return [
        `product: ${info.product || 'EQT'} (${info.name || 'Easy QR Transfer'})`,
        `platform: ${[info.os, info.arch].filter(Boolean).join('/') || 'unknown'}`,
        `agent: embedded`,
        `cli: ${info.cliPath || 'not found'}`,
        `agent state: ${status.state || 'unknown'}`,
        `agent version: ${status.version || 'unknown'}`,
        `current task: ${status.current ? `${status.current.action} #${status.current.id} ${status.current.state}` : 'none'}`,
        `history count: ${(status.history || []).length}`,
        `config: ${state.settings?.configPath || 'unknown'}`,
    ].join('\n');
}

function collectFeedback() {
    const category = document.querySelector('#feedback-category')?.value || 'Feedback';
    const contact = document.querySelector('#feedback-contact')?.value.trim() || '';
    const message = document.querySelector('#feedback-message')?.value.trim() || '';
    const includeDiagnostics = Boolean(document.querySelector('#feedback-diagnostics')?.checked);
    const sections = [
        `Category: ${category}`,
        contact ? `Contact: ${contact}` : 'Contact: not provided',
        '',
        'Message:',
        message || '(No message provided)',
    ];
    if (includeDiagnostics) {
        sections.push('', 'Diagnostics:', buildDiagnostics());
    }
    return {
        category,
        body: sections.join('\n'),
    };
}

function feedbackMailto(body, category = 'Feedback') {
    const subject = encodeURIComponent(`EQT ${category}`);
    const encodedBody = encodeURIComponent(body || buildDiagnostics());
    return `mailto:jinxpeeter@outlook.com?subject=${subject}&body=${encodedBody}`;
}

function cleanLocalAddressError(err) {
    const msg = String(err?.message || err || '');
    if (msg.includes('127.0.0.1') || msg.includes('localhost')) {
        return 'Local service connection failed.';
    }
    return msg;
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    })[char]);
}

function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, '&#096;');
}

OnFileDrop((_x, _y, paths) => {
    handleFileDrop(paths);
}, true);

EventsOn('eqt:tray-command', handleTrayCommand);

window.addEventListener('beforeunload', stopChatUsage);

async function runAutoUpdateCheck() {
    const mode = state.settings?.autoUpdateMode || 'download';
    if (mode === 'off') {
        console.log('[AutoUpdate] Auto update mode is off, skipping check.');
        return;
    }

    if (state.updateStage !== 'idle') {
        console.log('[AutoUpdate] Update state is busy:', state.updateStage);
        return;
    }

    console.log('[AutoUpdate] Starting auto update check. Mode:', mode);
    state.updateStage = 'checking';
    state.updateStatusText = t('check_updates_auto');
    syncManualUpdateCheckUI();

    try {
        const checkRes = await window.go.main.App.CheckForUpdates();
        state.updateCheckRes = checkRes;

        if (!checkRes || !checkRes.new_version_available) {
            state.updateStage = 'idle';
            state.updateStatusText = t('up_to_date');
            syncManualUpdateCheckUI();
            return;
        }

        console.log('[AutoUpdate] New version available:', checkRes.version);
        if (mode === 'notify') {
            state.updateStage = 'available';
            state.updateStatusText = t('version_available', { version: checkRes.version });
            state.updateBtnText = t('btn_download_now');
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();

            state.notice = t('new_version_go_settings', { version: checkRes.version });
            updateMessagesSurface();
        } else {
            if (state.status?.state === 'busy') {
                console.log('[AutoUpdate] Agent is busy transferring. Postponing download.');
                state.updateStage = 'available';
                state.updateStatusText = t('postponed_transfer', { version: checkRes.version });
                syncManualUpdateCheckUI();
                return;
            }
            await triggerDownloadUpdate();
            if (state.updateStage === 'ready') {
                if (mode === 'download') {
                    state.notice = t('update_ready_restart', { version: checkRes.version });
                    updateMessagesSurface();
                } else if (mode === 'silent') {
                    console.log('[AutoUpdate] Silent update downloaded and ready. It will apply on next restart.');
                }
            }
        }
    } catch (err) {
        state.updateStage = 'idle';
        state.updateStatusText = t('auto_check_failed', { err: cleanLocalAddressError(err) });
        syncManualUpdateCheckUI();
        console.error('[AutoUpdate] Auto update check failed:', err);
    }
}

async function runManualUpdateCheck() {
    if (state.updateStage === 'checking' || state.updateStage === 'downloading' || state.updateStage === 'installing') {
        return;
    }

    // 同步最新的 DOM 值到内存配置中
    syncSettingsFromDOM();

    // 如果当前按钮是 Retry 状态（说明发生了本地连接失败），直接重置回 idle 重新触发检测与拉起
    if (state.updateBtnText === t('btn_retry')) {
        state.updateStage = 'idle';
        state.updateStatusText = t('click_manual_check');
        state.updateBtnText = t('btn_check');
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    }

    if (state.updateStage === 'idle') {
        state.updateStage = 'checking';
        state.updateStatusText = t('checking_updates');
        state.updateBtnText = t('btn_checking');
        state.updateBtnDisabled = true;
        syncManualUpdateCheckUI();

        try {
            const checkRes = await window.go.main.App.CheckForUpdates();
            state.updateCheckRes = checkRes;

            if (!checkRes || !checkRes.new_version_available) {
                state.updateStage = 'idle';
                state.updateStatusText = t('up_to_date');
                state.updateBtnText = t('btn_check');
                state.updateBtnDisabled = false;
                syncManualUpdateCheckUI();
                return;
            }

            const mode = state.settings?.autoUpdateMode || 'download';
            if (mode === 'off' || mode === 'notify') {
                state.updateStage = 'available';
                state.updateStatusText = t('version_available', { version: checkRes.version });
                state.updateBtnText = t('btn_download_now');
                state.updateBtnDisabled = false;
                syncManualUpdateCheckUI();
            } else {
                await triggerDownloadUpdate();
            }
        } catch (err) {
            state.updateStage = 'idle';
            const cleanedErr = cleanLocalAddressError(err);
            state.updateStatusText = t('download_failed', { err: cleanedErr });
            if (cleanedErr === 'Local service connection failed.') {
                state.updateBtnText = t('btn_retry');
            } else {
                state.updateBtnText = t('btn_check');
            }
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();
        }
        return;
    }

    if (state.updateStage === 'available') {
        await triggerDownloadUpdate();
        return;
    }

    if (state.updateStage === 'ready') {
        state.updateStage = 'installing';
        state.updateStatusText = t('installing_updates');
        state.updateBtnText = t('btn_installing');
        state.updateBtnDisabled = true;
        syncManualUpdateCheckUI();

        try {
            await window.go.main.App.InstallUpdate(state.updateCheckRes.asset_name);
        } catch (err) {
            state.updateStage = 'ready';
            const cleanedErr = cleanLocalAddressError(err);
            state.updateStatusText = t('install_failed', { err: cleanedErr });
            if (cleanedErr === 'Local service connection failed.') {
                state.updateBtnText = t('btn_retry');
            } else {
                state.updateBtnText = t('btn_install_restart');
            }
            state.updateBtnDisabled = false;
            syncManualUpdateCheckUI();
        }
        return;
    }
}

async function triggerDownloadUpdate() {
    const checkRes = state.updateCheckRes;
    if (!checkRes) return;

    state.updateStage = 'downloading';
    state.updateStatusText = t('btn_downloading');
    state.updateBtnText = t('btn_downloading');
    state.updateBtnDisabled = true;
    syncManualUpdateCheckUI();

    try {
        await window.go.main.App.DownloadUpdate(checkRes);
        state.updateStage = 'ready';
        state.updateStatusText = t('update_ready_restart', { version: checkRes.version });
        state.updateBtnText = t('btn_install_restart');
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    } catch (err) {
        state.updateStage = 'available';
        const cleanedErr = cleanLocalAddressError(err);
        state.updateStatusText = t('download_failed', { err: cleanedErr });
        if (cleanedErr === 'Local service connection failed.') {
            state.updateBtnText = t('btn_retry');
        } else {
            state.updateBtnText = t('btn_download_now');
        }
        state.updateBtnDisabled = false;
        syncManualUpdateCheckUI();
    }
}

loadChatUsage();
render();
loadSettings().then(() => {
    connectAgentEvents();
    window.setTimeout(runAutoUpdateCheck, 5000);
});

// Register one-time global event delegations for opening history files & folders
document.addEventListener('click', (event) => {
    const pathLink = event.target.closest('.path-link');
    if (pathLink) {
        const path = pathLink.dataset.openPath;
        if (path) {
            run(async () => {
                await OpenPath(path);
            }, {busy: false});
        }
        return;
    }

    const fileLink = event.target.closest('[data-open-file]');
    if (fileLink) {
        const file = fileLink.dataset.openFile;
        if (file) {
            run(async () => {
                await OpenFile(file);
            }, {busy: false});
        }
        return;
    }
});
