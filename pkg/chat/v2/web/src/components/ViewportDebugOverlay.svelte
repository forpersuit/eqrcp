<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let enabled: boolean = false;

  let innerWidth = 0;
  let innerHeight = 0;
  let visualWidth = 0;
  let visualHeight = 0;
  let vvTop = 0;
  let scrollY = 0;
  let composerTop = 0;
  let composerBottom = 0;
  let overlap = 0;
  let statusText = 'OK';
  let dpr = 1;
  let orientation = '';
  let userAgent = '';

  function updateMetrics() {
    if (typeof window === 'undefined') return;
    innerWidth = window.innerWidth;
    innerHeight = window.innerHeight;
    scrollY = Math.round(window.scrollY);
    dpr = window.devicePixelRatio || 1;
    orientation = screen.orientation ? screen.orientation.type : (window.orientation !== undefined ? String(window.orientation) : 'N/A');
    userAgent = navigator.userAgent;

    if (window.visualViewport) {
      visualWidth = Math.round(window.visualViewport.width);
      visualHeight = Math.round(window.visualViewport.height);
      vvTop = Math.round(window.visualViewport.offsetTop);
    } else {
      visualWidth = innerWidth;
      visualHeight = innerHeight;
      vvTop = 0;
    }

    const composerEl = document.querySelector('.composer');
    if (composerEl) {
      const rect = composerEl.getBoundingClientRect();
      composerTop = Math.round(rect.top);
      composerBottom = Math.round(rect.bottom);
    }
    const keyboardTop = visualHeight + vvTop;
    overlap = composerBottom - keyboardTop;
    statusText = overlap > 1 ? `BLOCKED (-${overlap}px)` : `OK (gap: ${Math.abs(overlap)}px)`;
  }

  function handleMessage(e: MessageEvent) {
    if (e.data && e.data.type === 'set-viewport-debug') {
      enabled = Boolean(e.data.enabled);
    }
  }

  onMount(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('viewportDebug') === '1' || urlParams.get('viewportDebug') === 'true') {
      enabled = true;
    }

    updateMetrics();
    window.addEventListener('resize', updateMetrics);
    window.addEventListener('orientationchange', updateMetrics);
    window.addEventListener('scroll', updateMetrics);
    window.addEventListener('message', handleMessage);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateMetrics);
      window.visualViewport.addEventListener('scroll', updateMetrics);
    }
  });

  onDestroy(() => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('resize', updateMetrics);
    window.removeEventListener('orientationchange', updateMetrics);
    window.removeEventListener('scroll', updateMetrics);
    window.removeEventListener('message', handleMessage);

    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', updateMetrics);
      window.visualViewport.removeEventListener('scroll', updateMetrics);
    }
  });
</script>

{#if enabled}
  <div class="viewport-debug-overlay">
    <div class="viewport-badge">
      <div class="title">📐 Viewport Debug Box</div>
      <div class="metric">Inner: <strong>{innerWidth}x{innerHeight}</strong> (sY: {scrollY})</div>
      <div class="metric">Visual: <strong>{visualWidth}x{visualHeight}</strong> (top: {vvTop})</div>
      <div class="metric">Composer: <strong>{composerTop}~{composerBottom}</strong></div>
      <div class="metric">Status: <strong class:error-text={overlap > 1} class:success-text={overlap <= 1}>{statusText}</strong></div>
      <div class="metric">DPR: <strong>{dpr}</strong> | {orientation}</div>
    </div>
    <div class="viewport-grid"></div>
  </div>
{/if}

<style>
  .viewport-debug-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100dvh;
    pointer-events: none;
    z-index: 99999;
    box-sizing: border-box;
    border: 2px dashed rgba(239, 68, 68, 0.6);
  }

  .viewport-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(15, 23, 42, 0.88);
    color: #38bdf8;
    backdrop-filter: blur(8px);
    border: 1px solid rgba(56, 189, 248, 0.3);
    border-radius: 8px;
    padding: 6px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
  }

  .viewport-badge .title {
    font-weight: 700;
    color: #f43f5e;
    margin-bottom: 2px;
  }

  .viewport-badge strong {
    color: #facc15;
  }

  .viewport-badge strong.error-text {
    color: #ef4444 !important;
  }

  .viewport-badge strong.success-text {
    color: #10b981 !important;
  }

  .viewport-grid {
    width: 100%;
    height: 100%;
    background-size: 40px 40px;
    background-image: 
      linear-gradient(to right, rgba(56, 189, 248, 0.08) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(56, 189, 248, 0.08) 1px, transparent 1px);
  }
</style>
