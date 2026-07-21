import { mount } from 'svelte';
import UploadApp from './lib/UploadApp.svelte';
import DownloadApp from './lib/DownloadApp.svelte';

export function mountUpload(target: HTMLElement, props: Record<string, unknown>) {
  return mount(UploadApp, { target, props });
}

export function mountDownload(target: HTMLElement, props: Record<string, unknown>) {
  return mount(DownloadApp, { target, props });
}
