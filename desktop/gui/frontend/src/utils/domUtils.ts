export function escapeHTML(str: string | undefined | null): string {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    })[char] || char);
}

export function escapeAttr(value: string | undefined | null): string {
    return escapeHTML(value).replace(/`/g, '&#096;');
}

export function formatBytes(bytes: number | undefined | null): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function cleanChatProfileName(name: string | undefined | null): string {
    if (!name) return 'Desktop';
    return String(name).trim().slice(0, 30);
}

export function cleanChatAvatar(avatar: string | undefined | null): string {
    if (!avatar) return '';
    return String(avatar).trim();
}
