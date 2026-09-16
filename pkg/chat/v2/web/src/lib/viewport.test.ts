import { isTouchOrMobile, restoreVisualViewport } from './viewport.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 1. Test isTouchOrMobile in Node environment (no window)
assert(isTouchOrMobile() === false, 'should return false in SSR / non-browser context');

// 2. Test mock window in browser context
const mockMeta = {
  content: 'width=device-width, initial-scale=1.0',
  getAttribute(name: string) {
    return name === 'content' ? this.content : null;
  },
  setAttribute(name: string, val: string) {
    if (name === 'content') this.content = val;
  }
};

const mockWindow = {
  innerWidth: 375,
  scrollY: 45,
  scrollX: 10,
  scrollTo(x: number, y: number) {
    this.scrollX = x;
    this.scrollY = y;
  },
  matchMedia(query: string) {
    return { matches: query.includes('coarse') };
  },
  visualViewport: {
    scale: 1.25,
    width: 300,
    height: 600
  }
};

const mockDoc = {
  querySelector(selector: string) {
    if (selector.includes('viewport')) return mockMeta;
    return null;
  },
  body: {
    scrollTop: 20,
    scrollLeft: 5
  },
  documentElement: {
    scrollTop: 15,
    scrollLeft: 0
  }
};

// Install mocks into global
(globalThis as any).window = mockWindow;
(globalThis as any).document = mockDoc;

assert(isTouchOrMobile() === true, 'mobile width or coarse pointer should be detected as mobile');

restoreVisualViewport();

assert(mockWindow.scrollY === 0, 'window.scrollY should be reset to 0');
assert(mockWindow.scrollX === 0, 'window.scrollX should be reset to 0');
assert(mockDoc.body.scrollTop === 0, 'document.body.scrollTop should be reset to 0');
assert(mockDoc.documentElement.scrollTop === 0, 'document.documentElement.scrollTop should be reset to 0');
assert(
  mockMeta.content === 'width=device-width, initial-scale=1.0, interactive-widget=resizes-content, viewport-fit=cover',
  'viewport meta content should be updated to normalized value when visual scale deviated from 1.0'
);

console.log('viewport.test.ts: all assertions passed');
