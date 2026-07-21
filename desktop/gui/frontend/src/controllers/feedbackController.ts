import { state } from '../state';

export function buildDiagnostics(): string {
    const info = state.appInfo || {};
    const status = (state.status || {}) as Record<string, unknown>;
    const current = status.current as Record<string, unknown> | undefined;
    const history = (status.history || []) as unknown[];

    return [
        `product: ${String(info.product || 'EQT')} (${String(info.name || 'Easy QR Transfer')})`,
        `platform: ${[info.os, info.arch].filter(Boolean).join('/') || 'unknown'}`,
        `agent: embedded`,
        `cli: ${String(info.cliPath || 'not found')}`,
        `agent state: ${String(status.state || 'unknown')}`,
        `agent version: ${String(status.version || 'unknown')}`,
        `current task: ${current ? `${current.action} #${current.id} ${current.state}` : 'none'}`,
        `history count: ${history.length}`,
        `config: ${String(state.settings?.configPath || 'unknown')}`,
    ].join('\n');
}

export function collectFeedback(): { category: string; body: string } {
    const category = document.querySelector<HTMLSelectElement>('#feedback-category')?.value || 'Feedback';
    const contact = document.querySelector<HTMLInputElement>('#feedback-contact')?.value.trim() || '';
    const message = document.querySelector<HTMLTextAreaElement>('#feedback-message')?.value.trim() || '';
    const includeDiagnostics = Boolean(document.querySelector<HTMLInputElement>('#feedback-diagnostics')?.checked);
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

export function feedbackMailto(body?: string, category = 'Feedback'): string {
    const subject = encodeURIComponent(`EQT ${category}`);
    const encodedBody = encodeURIComponent(body || buildDiagnostics());
    return `mailto:jinxpeeter@outlook.com?subject=${subject}&body=${encodedBody}`;
}
