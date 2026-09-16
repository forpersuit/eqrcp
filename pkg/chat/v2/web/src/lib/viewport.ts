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
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
      );
    }
  }
}

/**
 * Schedule viewport normalization across immediate, animation-midpoint, and animation-finish ticks.
 */
export function scheduleViewportRestore(): void {
  if (!isTouchOrMobile()) return;
  restoreVisualViewport();
  setTimeout(restoreVisualViewport, 120);
  setTimeout(restoreVisualViewport, 320);
}
