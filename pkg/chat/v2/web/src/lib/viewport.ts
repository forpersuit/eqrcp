/**
 * Viewport utility to prevent and restore iOS Safari auto-zoom / layout shifts.
 */

export function isTouchOrMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 820 || window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Restore visual viewport and scroll offsets on iOS / mobile web.
 * When keyboard dismisses or an input blurs, iOS WebKit may retain
 * residual window scroll offsets or visualViewport scale drift.
 */
export function restoreVisualViewport(): void {
  if (typeof window === 'undefined') return;

  // 1. Reset window and body scroll positions
  if (window.scrollY !== 0 || window.scrollX !== 0) {
    window.scrollTo(0, 0);
  }
  if (document.body && (document.body.scrollTop !== 0 || document.body.scrollLeft !== 0)) {
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
  }
  if (document.documentElement && (document.documentElement.scrollTop !== 0 || document.documentElement.scrollLeft !== 0)) {
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
  }

  // 2. Ensure viewport meta is strictly clamped to prevent and undo any zoom-in
  const vv = window.visualViewport;
  if (vv && (vv.scale > 1.01 || vv.scale < 0.99)) {
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      // Re-setting the content attribute triggers WebKit's viewport scale normalization
      meta.setAttribute(
        'content',
        'width=device-width, initial-scale=1.0, interactive-widget=resizes-content, viewport-fit=cover'
      );
    }
  }
}

/**
 * Pin layout containers and window scroll to (0, 0) to prevent native focus scroll
 * from pushing the header or outer shells out of view on mobile viewports.
 *
 * Exemption: When visual viewport height is critically low (< minHeightThreshold, e.g. 240px
 * in extreme landscape), pinning is gracefully bypassed to allow the user to view the composer.
 */
export function pinLayoutScroll(minHeightThreshold: number = 240): void {
  if (typeof window === 'undefined') return;

  const vv = window.visualViewport;
  if (vv && vv.height < minHeightThreshold) {
    return;
  }

  if (window.scrollY !== 0 || window.scrollX !== 0) {
    window.scrollTo(0, 0);
  }
  if (document.documentElement && (document.documentElement.scrollTop !== 0 || document.documentElement.scrollLeft !== 0)) {
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
  }
  if (document.body && (document.body.scrollTop !== 0 || document.body.scrollLeft !== 0)) {
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
  }

  const containerSelectors = ['#app', '.chat-viewport', 'main', '.chat-shell'];
  for (const sel of containerSelectors) {
    const el = document.querySelector(sel);
    if (el && (el.scrollTop !== 0 || el.scrollLeft !== 0)) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }
}

/**
 * Focus an element without triggering mobile browser aggressive native caret scroll-into-view.
 */
export function focusWithoutNativeScroll(el: HTMLElement | null): void {
  if (!el) return;
  if (!isTouchOrMobile()) {
    el.focus();
    return;
  }
  const wasReadonly = el.hasAttribute('readonly');
  if (!wasReadonly) {
    el.setAttribute('readonly', 'readonly');
  }
  el.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    if (!wasReadonly) {
      el.removeAttribute('readonly');
    }
  });
}

/**
 * Schedule viewport normalization across immediate, animation-midpoint, and animation-finish ticks.
 */
export function scheduleViewportRestore(): void {
  if (!isTouchOrMobile()) return;
  restoreVisualViewport();
  pinLayoutScroll();
  setTimeout(() => { restoreVisualViewport(); pinLayoutScroll(); }, 120);
  setTimeout(() => { restoreVisualViewport(); pinLayoutScroll(); }, 320);
}

