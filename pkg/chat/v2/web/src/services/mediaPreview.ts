export function isImageFile(msg: { fileName?: string; mimeType?: string; type?: string } | null | undefined): boolean {
  if (!msg) return false;
  const name = (msg.fileName || '').toLowerCase();
  const mime = (msg.mimeType || '').toLowerCase();

  // Strict SVG exclusion to eliminate stored XSS risks in inline previews / top-level navigation (F1')
  if (name.endsWith('.svg') || mime === 'image/svg+xml') {
    return false;
  }

  if (msg.type === 'image') return true;
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(name);
}

export function getImageInlineUrl(token: string, messageId: string): string {
  if (!token || !messageId) return '';
  return `/chat-v2/${encodeURIComponent(token)}/files/${encodeURIComponent(messageId)}?inline=1`;
}
