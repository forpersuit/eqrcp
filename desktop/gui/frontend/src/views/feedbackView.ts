import { state } from '../state';
import { t } from '../i18n';

export function renderFeedbackView(helpers: {
    buildDiagnostics: () => string;
    feedbackMailto: (diagnostics: string) => string;
    escapeHTML: (val: unknown) => string;
    escapeAttr: (val: unknown) => string;
}): string {
    const { buildDiagnostics, feedbackMailto, escapeHTML, escapeAttr } = helpers;
    const diagnostics = buildDiagnostics();
    const mailto = feedbackMailto(diagnostics);
    return `
        <div class="feedback-panel">
            ${state.feedbackNotice ? `<div class="notice success compact" style="margin-bottom: 16px;">${escapeHTML(state.feedbackNotice)}</div>` : ''}
            ${state.feedbackError ? `<div class="notice error compact" style="margin-bottom: 16px;">${escapeHTML(state.feedbackError)}</div>` : ''}
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
            <input id="feedback-contact" type="email" placeholder="${t('feedback_optional')}" value="${escapeAttr(state.feedbackContact || '')}" />
            <label>${t('feedback_message')}</label>
            <textarea id="feedback-message" rows="5" placeholder="${t('feedback_placeholder')}">${escapeHTML(state.feedbackMessage || '')}</textarea>
            
            <label>${t('feedback_image')}</label>
            <div class="feedback-image-uploader">
                <input id="feedback-image-input" type="file" accept="image/*" style="display:none;" />
                <button class="ghost" id="btn-select-image" type="button">
                    <span style="font-size: 15px; margin-right: 6px;">📷</span> ${t('btn_select_image')}
                </button>
                <div id="feedback-image-preview-container" style="${state.feedbackImageBase64 ? 'display:block;' : 'display:none;'} margin-top: 8px; position: relative; width: fit-content;">
                    <img id="feedback-image-preview" src="${state.feedbackImageBase64 || ''}" style="max-width: 100%; max-height: 120px; border-radius: 6px; border: 1px solid var(--line);" />
                    <button id="btn-clear-image" type="button" style="position: absolute; top: -6px; right: -6px; background: var(--bg); border: 1px solid var(--line); border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text);">✕</button>
                </div>
            </div>

            <label class="check">
                <input id="feedback-diagnostics" type="checkbox" checked />
                ${t('feedback_include_diag')}
            </label>
            <div class="feedback-note">${t('feedback_diag_note')}</div>
            <pre class="diagnostics">${escapeHTML(diagnostics)}</pre>
            <div class="feedback-actions">
                <button class="primary" id="send-feedback" ${state.isSendingFeedback ? 'disabled' : ''} data-mailto="${escapeAttr(mailto)}">
                    ${state.isSendingFeedback ? t('btn_sending_feedback') : (state.feedbackSendResult === 'success' ? t('feedback_send_success_short') : (state.feedbackSendResult === 'failed' ? t('feedback_send_failed_short') : t('btn_send_feedback_now')))}
                </button>
                <button class="ghost" id="copy-feedback">${t('btn_copy_feedback')}</button>
            </div>
        </div>
    `;
}
