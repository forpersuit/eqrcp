/**
 * Tests for mediaPreview image detection and inline URLs.
 * Run: node --experimental-strip-types src/services/mediaPreview.test.ts
 */

import { isImageFile, getImageInlineUrl } from './mediaPreview.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 1. isImageFile tests
assert(isImageFile(null) === false, 'null message is not image');
assert(isImageFile(undefined) === false, 'undefined message is not image');
assert(isImageFile({ type: 'text' }) === false, 'text message is not image');
assert(isImageFile({ type: 'file', fileName: 'archive.zip' }) === false, 'zip is not image');
assert(isImageFile({ type: 'file', fileName: 'document.pdf' }) === false, 'pdf is not image');

assert(isImageFile({ type: 'image' }) === true, 'type image is image');
assert(isImageFile({ type: 'file', fileName: 'photo.PNG' }) === true, 'png uppercase is image');
assert(isImageFile({ type: 'file', fileName: 'pic.jpeg' }) === true, 'jpeg is image');
assert(isImageFile({ type: 'file', fileName: 'banner.webp' }) === true, 'webp is image');
assert(isImageFile({ type: 'file', fileName: 'animation.gif' }) === true, 'gif is image');
assert(isImageFile({ type: 'file', fileName: 'vector.svg' }) === true, 'svg is image');
assert(isImageFile({ type: 'file', mimeType: 'image/avif' }) === true, 'image mimeType is image');

// 2. getImageInlineUrl tests
assert(getImageInlineUrl('', '123') === '', 'empty token returns empty url');
assert(getImageInlineUrl('token1', '') === '', 'empty messageId returns empty url');
assert(
  getImageInlineUrl('abc-123', 'msg-456') === '/chat-v2/abc-123/files/msg-456?inline=1',
  'valid token and messageId produces inline url'
);

console.log('mediaPreview.test.ts: all assertions passed');
