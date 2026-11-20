/**
 * Contract tests for clipboard image extraction & normalization.
 * Run: node --experimental-strip-types src/services/clipboard.test.ts
 */

import {
  isImageFile,
  normalizeClipboardImageName,
  extractClipboardImages,
  type DataTransferLike
} from './clipboard.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 1. isImageFile
assert(isImageFile({ type: 'image/png', name: 'test' }) === true, 'image/png should be recognized as image');
assert(isImageFile({ type: 'image/jpeg', name: 'photo' }) === true, 'image/jpeg should be recognized as image');
assert(isImageFile({ type: 'image/webp', name: 'pic' }) === true, 'image/webp should be recognized as image');
assert(isImageFile({ type: 'text/plain', name: 'doc.txt' }) === false, 'text/plain should not be image');
assert(isImageFile({ type: '', name: 'photo.jpg' }) === true, 'photo.jpg extension fallback should work');
assert(isImageFile({ type: '', name: 'notes.pdf' }) === false, 'notes.pdf should not be image');
assert(isImageFile({ type: 'image/svg+xml', name: 'icon.svg' }) === false, 'svg should be excluded for XSS safety');

// 2. normalizeClipboardImageName
const fixedDate = new Date(2026, 10, 20, 14, 30, 45); // 2026-11-20 14:30:45
const blob = new Blob(['dummy content'], { type: 'image/png' });

const genericFile = new File([blob], 'image.png', { type: 'image/png' });
const normalizedGeneric = normalizeClipboardImageName(genericFile, fixedDate);
assert(
  normalizedGeneric.name === 'image_20261120_143045.png',
  `expected image_20261120_143045.png, got ${normalizedGeneric.name}`
);

const blobFile = new File([blob], 'blob', { type: 'image/jpeg' });
const normalizedBlob = normalizeClipboardImageName(blobFile, fixedDate);
assert(
  normalizedBlob.name === 'image_20261120_143045.jpg',
  `expected image_20261120_143045.jpg, got ${normalizedBlob.name}`
);

const customFile = new File([blob], 'design-mockup.png', { type: 'image/png' });
const normalizedCustom = normalizeClipboardImageName(customFile, fixedDate);
assert(
  normalizedCustom.name === 'design-mockup.png',
  `custom filename should be preserved, got ${normalizedCustom.name}`
);

// 3. extractClipboardImages from DataTransfer mock
// Mock 3.1: Clipboard with image in items
const mockClipboardWithItem: DataTransferLike = {
  items: [
    {
      kind: 'file',
      type: 'image/png',
      getAsFile: () => new File([blob], 'image.png', { type: 'image/png' })
    },
    {
      kind: 'string',
      type: 'text/plain',
      getAsFile: () => null
    }
  ]
};
const extractedFromItems = extractClipboardImages(mockClipboardWithItem, fixedDate);
assert(extractedFromItems.length === 1, `expected 1 image, got ${extractedFromItems.length}`);
assert(extractedFromItems[0].name === 'image_20261120_143045.png', 'extracted image should be normalized');

// Mock 3.2: Clipboard with only text
const mockClipboardTextOnly: DataTransferLike = {
  items: [
    {
      kind: 'string',
      type: 'text/plain',
      getAsFile: () => null
    }
  ]
};
const extractedFromText = extractClipboardImages(mockClipboardTextOnly, fixedDate);
assert(extractedFromText.length === 0, `expected 0 images from text paste, got ${extractedFromText.length}`);

// Mock 3.3: Clipboard with fallback files array
const mockClipboardWithFiles: DataTransferLike = {
  files: [
    new File([blob], 'photo.webp', { type: 'image/webp' }),
    new File([new Blob(['text'])], 'doc.txt', { type: 'text/plain' })
  ]
};
const extractedFromFiles = extractClipboardImages(mockClipboardWithFiles, fixedDate);
assert(extractedFromFiles.length === 1, `expected 1 image from files fallback, got ${extractedFromFiles.length}`);
assert(extractedFromFiles[0].name === 'photo.webp', `expected photo.webp, got ${extractedFromFiles[0].name}`);

// Mock 3.4: SVG exclusion in extractClipboardImages
const mockClipboardSvg: DataTransferLike = {
  items: [
    {
      kind: 'file',
      type: 'image/svg+xml',
      getAsFile: () => new File([blob], 'evil.svg', { type: 'image/svg+xml' })
    }
  ]
};
assert(extractClipboardImages(mockClipboardSvg, fixedDate).length === 0, 'svg should be ignored in extraction');

// Mock 3.5: Null or empty clipboard
assert(extractClipboardImages(null).length === 0, 'null clipboard should return empty array');
const emptyClipboard: DataTransferLike = {};
assert(extractClipboardImages(emptyClipboard).length === 0, 'empty clipboard should return empty array');

console.log('clipboard.test.ts: all assertions passed');
