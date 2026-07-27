<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { P2PConnection, P2PConnectionsResponse } from '../lib/types';

  let connections = $state<P2PConnection[]>([]);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let filterMode = $state<'all' | 'cross_border'>('all');
  let autoRefresh = $state(true);
  let timer: any = null;
  let globeContainerRef: HTMLDivElement | null = $state(null);

  let totalActive = $derived(connections.length);
  let crossBorderCount = $derived(connections.filter(c => c.is_cross_border).length);
  let domesticCount = $derived(totalActive - crossBorderCount);

  let filteredConnections = $derived(
    filterMode === 'cross_border' 
      ? connections.filter(c => c.is_cross_border)
      : connections
  );

  // Country Lat/Lon lookup dictionary for Geo IP
  const COUNTRY_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
    'CN': { lat: 35.8617, lng: 104.1954, name: '中国' },
    'US': { lat: 37.0902, lng: -95.7129, name: '美国' },
    'JP': { lat: 36.2048, lng: 138.2529, name: '日本' },
    'SG': { lat: 1.3521, lng: 103.8198, name: '新加坡' },
    'HK': { lat: 22.3193, lng: 114.1694, name: '香港' },
    'DE': { lat: 51.1657, lng: 10.4515, name: '德国' },
    'GB': { lat: 55.3781, lng: -3.4360, name: '英国' },
    'FR': { lat: 46.2276, lng: 2.2137, name: '法国' },
    'AU': { lat: -25.2744, lng: 133.7751, name: '澳大利亚' },
    'CA': { lat: 56.1304, lng: -106.3468, name: '加拿大' },
    'KR': { lat: 35.9078, lng: 127.7669, name: '韩国' }
  };

  let globeInstance: any = null;
  let isFallback2D = $state(false);
  let canvas2D: HTMLCanvasElement | null = null;
  let animFrameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;

  async function loadConnections() {
    try {
      errorMsg = null;
      const res = await adminFetch<P2PConnectionsResponse>('/api/v1/p2p/admin/connections');
      if (res && Array.isArray(res.connections)) {
        connections = [...res.connections];
        renderGlobeData(connections);
      }
    } catch (err: any) {
      errorMsg = err.message || '获取 P2P 会话失败';
    } finally {
      loading = false;
    }
  }

  async function destroyRoom(roomId: string) {
    try {
      await adminFetch(`/api/v1/p2p/admin/room?room_id=${roomId}`, { method: 'DELETE' });
      await loadConnections();
    } catch (err: any) {
      errorMsg = '销毁房间失败: ' + (err.message || '未知错误');
    }
  }

  function formatTime(timestampMs: number): string {
    if (!timestampMs) return '-';
    return new Date(timestampMs).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function formatRemaining(expiresAtMs: number): string {
    const diffSec = Math.floor((expiresAtMs - Date.now()) / 1000);
    if (diffSec <= 0) return '即将过期';
    const m = Math.floor(diffSec / 60);
    const s = diffSec % 60;
    return `${m}分${s}秒`;
  }

  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  function generateProceduralEarthTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#020617');
    grad.addColorStop(0.5, '#0b192e');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw latitude / longitude grid
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Vector Continent Outlines (Eurasia, Americas, Africa, Australia)
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 1.5;

    function drawPolygon(coords: [number, number][]) {
      if (coords.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(coords[0][0], coords[0][1]);
      for (let i = 1; i < coords.length; i++) {
        ctx.lineTo(coords[i][0], coords[i][1]);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Eurasia / Asia
    drawPolygon([[600, 100], [880, 120], [920, 220], [780, 260], [680, 240], [620, 160]]);
    // North America
    drawPolygon([[180, 100], [380, 110], [340, 220], [220, 230], [160, 170]]);
    // South America
    drawPolygon([[280, 250], [380, 270], [340, 420], [300, 440], [260, 320]]);
    // Africa
    drawPolygon([[480, 180], [600, 190], [580, 340], [520, 380], [460, 240]]);
    // Australia
    drawPolygon([[780, 330], [880, 340], [860, 420], [770, 410]]);

    return canvas.toDataURL();
  }

  async function initGlobeEngine() {
    if (!globeContainerRef) return;
    try {
      const loadPromise = loadScript('https://cdn.jsdelivr.net/npm/globe.gl@2.32.0/dist/globe.gl.min.js');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('CDN timeout')), 3000));
      await Promise.race([loadPromise, timeoutPromise]).catch(() => {});

      // @ts-ignore
      if (typeof window.Globe === 'function') {
        const origWarn = console.warn;
        console.warn = function (...args: any[]) {
          if (args[0] && typeof args[0] === 'string' && args[0].includes('useLegacyLights')) {
            return;
          }
          origWarn.apply(console, args);
        };

        // @ts-ignore
        globeInstance = window.Globe()
          (globeContainerRef)
          .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg')
          .bumpImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png')
          .backgroundColor('#020617')
          .showAtmosphere(true)
          .atmosphereColor('#38bdf8')
          .atmosphereAltitude(0.18)
          .arcColor((d: any) => d.is_cross_border ? ['#a855f7', '#ec4899'] : ['#38bdf8', '#22c55e'])
          .arcDashLength(0.4)
          .arcDashGap(0.2)
          .arcDashAnimateTime(1600)
          .arcStroke(1.4)
          .pointColor(() => '#38bdf8')
          .pointAltitude(0.03)
          .pointRadius(0.6)
          .labelsData(Object.values(COUNTRY_COORDS))
          .labelLat((d: any) => d.lat)
          .labelLng((d: any) => d.lng)
          .labelText((d: any) => d.name)
          .labelSize(0.6)
          .labelDotRadius(0.3)
          .labelColor(() => 'rgba(255, 255, 255, 0.7)');

        if (globeInstance.controls()) {
          globeInstance.controls().autoRotate = true;
          globeInstance.controls().autoRotateSpeed = 0.8;
        }

        handleGlobeResize();
        renderGlobeData(connections);
      } else {
        init2DFallback();
      }
    } catch (e) {
      console.warn("Globe.gl WebGL fallback to 2D:", e);
      init2DFallback();
    }
  }

  function handleGlobeResize() {
    if (globeInstance && globeContainerRef) {
      const w = globeContainerRef.clientWidth || 800;
      const h = globeContainerRef.clientHeight || 420;
      globeInstance.width(w).height(h);
    }
  }

  function renderGlobeData(conns: P2PConnection[]) {
    const activeList = Array.isArray(conns) ? conns : [];

    if (isFallback2D) {
      return;
    }

    if (!globeInstance) return;

    const arcs: any[] = [];
    const points: any[] = [];

    activeList.forEach((c: any) => {
      const hCoord = COUNTRY_COORDS[c.host?.country] || { lat: 35.8, lng: 104.1, name: '中国' };
      const cCoord = c.client ? (COUNTRY_COORDS[c.client.country] || { lat: 37.0, lng: -95.7, name: '美国' }) : null;

      points.push({ lat: hCoord.lat, lng: hCoord.lng, size: 0.8, color: '#38bdf8' });

      if (cCoord) {
        points.push({ lat: cCoord.lat, lng: cCoord.lng, size: 0.8, color: '#ec4899' });
        arcs.push({
          startLat: hCoord.lat,
          startLng: hCoord.lng,
          endLat: cCoord.lat,
          endLng: cCoord.lng,
          is_cross_border: !!c.is_cross_border
        });
      }
    });

    globeInstance.arcsData(arcs);
    globeInstance.pointsData(points);
  }

  function init2DFallback() {
    if (!globeContainerRef) return;
    isFallback2D = true;
    globeContainerRef.innerHTML = '';

    canvas2D = document.createElement('canvas');
    canvas2D.style.width = '100%';
    canvas2D.style.height = '100%';
    globeContainerRef.appendChild(canvas2D);
    const ctx = canvas2D.getContext('2d');
    if (!ctx) return;

    let angle = 0;

    function resize2D() {
      if (!canvas2D || !globeContainerRef) return;
      canvas2D.width = globeContainerRef.clientWidth || 800;
      canvas2D.height = globeContainerRef.clientHeight || 420;
    }
    resize2D();

    function animate() {
      if (!ctx || !canvas2D) return;
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, canvas2D.width, canvas2D.height);

      const cx = canvas2D.width / 2;
      const cy = canvas2D.height / 2;
      const radius = Math.min(cx, cy) * 0.65;

      const glow = ctx.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius * 1.2);
      glow.addColorStop(0, 'rgba(56, 189, 248, 0.08)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      angle += 0.006;
      for (let i = 0; i < 12; i++) {
        const lAngle = angle + (i * Math.PI / 6);
        const rx = Math.cos(lAngle) * radius;
        if (rx > 0) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(cx, cy, Math.abs(rx), radius, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const activeList = Array.isArray(connections) ? connections : [];
      activeList.forEach((c: any) => {
        const hCoord = COUNTRY_COORDS[c.host?.country] || { lat: 35.8, lng: 104.1, name: '中国' };
        const cCoord = c.client ? (COUNTRY_COORDS[c.client.country] || { lat: 37.0, lng: -95.7, name: '美国' }) : null;

        const hx = cx + Math.sin((hCoord.lng * Math.PI / 180) + angle) * radius * Math.cos(hCoord.lat * Math.PI / 180);
        const hy = cy - Math.sin(hCoord.lat * Math.PI / 180) * radius;

        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fill();

        if (cCoord) {
          const cx2 = cx + Math.sin((cCoord.lng * Math.PI / 180) + angle) * radius * Math.cos(cCoord.lat * Math.PI / 180);
          const cy2 = cy - Math.sin(cCoord.lat * Math.PI / 180) * radius;

          ctx.fillStyle = '#ec4899';
          ctx.beginPath();
          ctx.arc(cx2, cy2, 5, 0, Math.PI * 2);
          ctx.fill();

          const midX = (hx + cx2) / 2;
          const midY = Math.min(hy, cy2) - 40;
          ctx.strokeStyle = c.is_cross_border ? '#a855f7' : '#38bdf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.quadraticCurveTo(midX, midY, cx2, cy2);
          ctx.stroke();
        }
      });

      animFrameId = requestAnimationFrame(animate);
    }
    animate();
  }

  onMount(() => {
    loadConnections();
    timer = setInterval(() => {
      if (autoRefresh) loadConnections();
    }, 5000);

    initGlobeEngine();

    if (window.ResizeObserver && globeContainerRef) {
      resizeObserver = new ResizeObserver(() => handleGlobeResize());
      resizeObserver.observe(globeContainerRef);
    }
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (resizeObserver) resizeObserver.disconnect();
  });
</script>

<div class="page-container">
  <div class="header-section">
    <div>
      <h1 class="page-title">🚀 EQT Pro P2P 实时直连中心</h1>
      <p class="page-subtitle">独立 Cloudflare Worker (eqt-p2p-signal) 全球 3D WebRTC 广域网信令拓扑大屏</p>
    </div>
    <div class="action-bar">
      <label class="toggle-label">
        <input type="checkbox" bind:checked={autoRefresh} />
        实时轮询 (5s)
      </label>
      <button class="btn btn-primary" onclick={loadConnections} disabled={loading}>
        {loading ? '刷新中...' : '🔄 刷新会话'}
      </button>
    </div>
  </div>

  {#if errorMsg}
    <div class="alert alert-error">
      ⚠️ 错误: {errorMsg}
    </div>
  {/if}

  <!-- KPI Badges -->
  <div class="stats-grid">
    <div class="stat-card blue">
      <div class="stat-value">{totalActive}</div>
      <div class="stat-label">全球活跃 P2P 房间</div>
    </div>
    <div class="stat-card purple">
      <div class="stat-value">{crossBorderCount}</div>
      <div class="stat-label">跨国 P2P 传输会话</div>
    </div>
    <div class="stat-card green">
      <div class="stat-value">{domesticCount}</div>
      <div class="stat-label">同国 P2P 传输会话</div>
    </div>
    <div class="stat-card cyan">
      <div class="stat-value">OK</div>
      <div class="stat-label">Worker 节点 (signal.eqt.net.im)</div>
    </div>
  </div>

  <!-- Embedded 3D Globe Visualization Screen -->
  <div class="card globe-card">
    <div class="card-header">
      <h3>🌐 3D 实时拓扑与全球节点流动大屏</h3>
      <span class="badge badge-info">{isFallback2D ? '2D 高性能回退' : 'WebGL 硬件加速'}</span>
    </div>
    <div class="globe-wrapper" style="height: 420px;" bind:this={globeContainerRef}></div>
  </div>

  <!-- Active Rooms Table -->
  <div class="card">
    <div class="card-header flex-between">
      <h3>📋 活跃信令房间控制台 ({filteredConnections.length})</h3>
      <div class="filter-group">
        <button
          class="btn btn-sm"
          class:btn-active={filterMode === 'all'}
          onclick={() => filterMode = 'all'}
        >
          全部房间 ({totalActive})
        </button>
        <button
          class="btn btn-sm"
          class:btn-active={filterMode === 'cross_border'}
          onclick={() => filterMode = 'cross_border'}
        >
          仅跨国 ({crossBorderCount})
        </button>
      </div>
    </div>

    {#if loading && connections.length === 0}
      <div class="loading-state">加载 P2P 实时连接数据中...</div>
    {:else if filteredConnections.length === 0}
      <div class="empty-state">
        <p>📡 当前暂无活跃的 P2P 传输房间</p>
      </div>
    {:else}
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>房间 ID (Room)</th>
              <th>Host (发起方)</th>
              <th>Client (接收方)</th>
              <th>会话类型</th>
              <th>创建时间</th>
              <th>剩余租约</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredConnections as conn (conn.room_id)}
              <tr>
                <td><code class="code-badge">{conn.room_id}</code></td>
                <td>
                  <div class="node-info">
                    <span class="flag">{conn.host.country}</span>
                    <span>{conn.host.ip}</span>
                  </div>
                </td>
                <td>
                  {#if conn.client}
                    <div class="node-info">
                      <span class="flag">{conn.client.country}</span>
                      <span>{conn.client.ip}</span>
                    </div>
                  {:else}
                    <span class="text-muted">等待客户端加入...</span>
                  {/if}
                </td>
                <td>
                  {#if conn.is_cross_border}
                    <span class="badge badge-purple">🌐 跨国 P2P</span>
                  {:else}
                    <span class="badge badge-success">🏠 同国 P2P</span>
                  {/if}
                </td>
                <td>{formatTime(conn.created_at)}</td>
                <td>
                  <span class="timer-tag">{formatRemaining(conn.expires_at)}</span>
                </td>
                <td>
                  <button
                    class="btn btn-xs btn-danger"
                    onclick={() => destroyRoom(conn.room_id)}
                  >
                    💥 强制断开
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .page-container {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 1100px;
    margin: 0 auto;
    width: 100%;
  }

  .header-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .page-title {
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .page-subtitle {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-top: 0.2rem;
  }

  .action-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
  }

  .stat-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 0.85rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .stat-card.blue { border-top: 3px solid #38bdf8; }
  .stat-card.purple { border-top: 3px solid #a855f7; }
  .stat-card.green { border-top: 3px solid #22c55e; }
  .stat-card.cyan { border-top: 3px solid #06b6d4; }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--text-primary);
  }

  .stat-label {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .globe-card {
    padding: 0;
    overflow: hidden;
  }

  .card-header {
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .flex-between {
    justify-content: space-between;
  }

  .card-header h3 {
    font-size: 1rem;
    font-weight: 700;
    margin: 0;
  }

  .globe-wrapper {
    width: 100%;
    height: 420px !important;
    max-height: 50vh !important;
    background: #020617;
    position: relative;
    overflow: hidden;
  }

  .filter-group {
    display: flex;
    gap: 0.5rem;
  }

  .btn-sm {
    padding: 0.3rem 0.7rem;
    font-size: 0.75rem;
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .btn-sm.btn-active {
    background: rgba(99, 102, 241, 0.2);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    font-weight: 600;
  }

  .table-wrapper {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .data-table th,
  .data-table td {
    padding: 0.65rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
  }

  .data-table th {
    background: rgba(255, 255, 255, 0.02);
    color: var(--text-secondary);
    font-weight: 600;
  }

  .code-badge {
    font-family: monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    color: #38bdf8;
    font-weight: 600;
  }

  .node-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .flag {
    font-weight: 700;
    background: rgba(255, 255, 255, 0.1);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.75rem;
  }

  .badge {
    padding: 0.25rem 0.6rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .badge-purple { background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); }
  .badge-success { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
  .badge-info { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }

  .timer-tag {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }

  .text-muted {
    color: var(--text-secondary);
    font-style: italic;
  }

  .btn-xs {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border-radius: 4px;
  }

  .btn-danger {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
    cursor: pointer;
  }

  .btn-danger:hover {
    background: #ef4444;
    color: white;
  }

  .loading-state, .empty-state {
    padding: 3rem;
    text-align: center;
    color: var(--text-secondary);
  }

  .alert {
    padding: 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }

  .alert-error {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }
</style>
