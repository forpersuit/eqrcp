export function isImageFile(msg: { fileName?: string; mimeType?: string; type?: string } | null | undefined): boolean {
  if (!msg) return false;
  if (msg.type === 'image') return true;
  const mime = (msg.mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  const name = (msg.fileName || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(name);
}

export function getImageInlineUrl(token: string, messageId: string): string {
  if (!token || !messageId) return '';
  return `/chat-v2/${encodeURIComponent(token)}/files/${encodeURIComponent(messageId)}?inline=1`;
}
