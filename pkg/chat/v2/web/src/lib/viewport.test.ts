import { isTouchOrMobile, restoreVisualViewport, pinLayoutScroll, focusWithoutNativeScroll } from './viewport.ts';

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

const mockElements: Record<string, any> = {
  '#app': { scrollTop: 10, scrollLeft: 0 },
  '.chat-viewport': { scrollTop: 15, scrollLeft: 0 },
  'main': { scrollTop: 25, scrollLeft: 0 },
  '.chat-shell': { scrollTop: 30, scrollLeft: 0 }
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
    if (selector.includes('viewport') && selector.includes('meta')) return mockMeta;
    if (mockElements[selector]) return mockElements[selector];
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
(globalThis as any).requestAnimationFrame = (cb: () => void) => cb();

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

// 3. Test pinLayoutScroll
mockWindow.scrollY = 80;
mockDoc.body.scrollTop = 50;
mockDoc.documentElement.scrollTop = 30;
mockElements['#app'].scrollTop = 20;
mockElements['.chat-viewport'].scrollTop = 35;
mockElements['main'].scrollTop = 40;
mockElements['.chat-shell'].scrollTop = 60;

pinLayoutScroll();

assert(mockWindow.scrollY === 0, 'pinLayoutScroll: window.scrollY should be 0');
assert(mockDoc.body.scrollTop === 0, 'pinLayoutScroll: document.body.scrollTop should be 0');
assert(mockDoc.documentElement.scrollTop === 0, 'pinLayoutScroll: document.documentElement.scrollTop should be 0');
assert(mockElements['#app'].scrollTop === 0, 'pinLayoutScroll: #app.scrollTop should be 0');
assert(mockElements['.chat-viewport'].scrollTop === 0, 'pinLayoutScroll: .chat-viewport.scrollTop should be 0');
assert(mockElements['main'].scrollTop === 0, 'pinLayoutScroll: main.scrollTop should be 0');
assert(mockElements['.chat-shell'].scrollTop === 0, 'pinLayoutScroll: .chat-shell.scrollTop should be 0');

// 4. Test extreme micro-screen exemption (< 240px)
mockWindow.visualViewport.height = 200;
mockWindow.scrollY = 120;
mockElements['main'].scrollTop = 80;

pinLayoutScroll(240); // Should be exempted
assert(mockWindow.scrollY === 120, 'pinLayoutScroll: should exempt when visualViewport.height < 240');
assert(mockElements['main'].scrollTop === 80, 'pinLayoutScroll: container scroll should be preserved on micro screen');

// 5. Test focusWithoutNativeScroll
mockWindow.visualViewport.height = 600;
const testState = {
  focused: false,
  preventScrollVal: undefined as boolean | undefined
};
const attrs: Record<string, string> = {};
const mockTextarea = {
  hasAttribute(name: string) { return name in attrs; },
  setAttribute(name: string, val: string) { attrs[name] = val; },
  removeAttribute(name: string) { delete attrs[name]; },
  focus(opts?: { preventScroll?: boolean }) {
    testState.focused = true;
    testState.preventScrollVal = opts?.preventScroll;
    assert(this.hasAttribute('readonly') === true, 'focus should be called while readonly is active to prevent scroll-into-view');
  }
} as any;

focusWithoutNativeScroll(mockTextarea);
assert(testState.focused === true, 'mockTextarea should be focused');
assert(testState.preventScrollVal === true, 'focus should pass preventScroll: true');
assert(mockTextarea.hasAttribute('readonly') === false, 'readonly should be cleared on next frame');

console.log('viewport.test.ts: all assertions passed');

