/**
 * Clipboard utilities for Chat v2 image pasting and attachment extraction.
 */

import { isImageFile as isMediaImageFile } from './mediaPreview.ts';

export interface ClipboardItemLike {
  kind?: string;
  type?: string;
  getAsFile?: () => File | null;
}

export interface DataTransferLike {
  items?: ArrayLike<ClipboardItemLike>;
  files?: ArrayLike<File>;
}

export function isImageFile(file: { type?: string; name?: string }): boolean {
  return isMediaImageFile({ fileName: file.name, mimeType: file.type });
}

export function getImageExtension(mimeType?: string): string {
  if (!mimeType) return 'png';
  const lower = mimeType.toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('bmp')) return 'bmp';
  if (lower.includes('ico')) return 'ico';
  if (lower.includes('avif')) return 'avif';
  return 'png';
}

/**
 * Normalizes generic clipboard screenshot filenames (e.g. 'image.png', 'blob')
 * to unique timestamped names (e.g. 'image_20261120_143045.png') to avoid collisions.
 */
export function normalizeClipboardImageName(file: File, now = new Date()): File {
  const ext = getImageExtension(file.type);
  let name = file.name || '';

  const isGeneric = !name || name === 'image.png' || name === 'blob' || !name.includes('.');
  if (isGeneric) {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    name = `image_${timeStr}.${ext}`;
  }

  if (name !== file.name) {
    try {
      return new File([file], name, {
        type: file.type || `image/${ext}`,
        lastModified: file.lastModified || now.getTime()
      });
    } catch {
      return file;
    }
  }
  return file;
}

/**
 * Synchronously extracts image files from a paste event DataTransfer object.
 */
export function extractClipboardImages(clipboardData: DataTransferLike | null | undefined, now = new Date()): File[] {
  if (!clipboardData) return [];
  const results: File[] = [];

  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item && item.kind === 'file' && item.type && item.type.startsWith('image/')) {
        // Exclude svg if needed
        if (item.type.includes('svg')) continue;
        const file = item.getAsFile ? item.getAsFile() : null;
        if (file && isImageFile(file)) {
          results.push(normalizeClipboardImageName(file, now));
        }
      }
    }
  }

  // Fallback to files list if items did not yield any image
  if (results.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
    for (let j = 0; j < clipboardData.files.length; j++) {
      const file = clipboardData.files[j];
      if (file && isImageFile(file)) {
        results.push(normalizeClipboardImageName(file, now));
      }
    }
  }

  return results;
}

/**
 * Asynchronously reads image files via modern navigator.clipboard.read API (if available).
 */
export async function readClipboardImagesAsync(now = new Date()): Promise<File[]> {
  if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.read) {
    return [];
  }
  try {
    const items = await navigator.clipboard.read();
    const results: File[] = [];
    for (const item of items) {
      const imageType = item.types.find(t => t.startsWith('image/') && !t.includes('svg'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const ext = getImageExtension(imageType);
        const pad = (n: number) => n.toString().padStart(2, '0');
        const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const filename = `image_${timeStr}.${ext}`;
        const file = new File([blob], filename, { type: imageType, lastModified: now.getTime() });
        results.push(file);
      }
    }
    return results;
  } catch {
    return [];
  }
}
