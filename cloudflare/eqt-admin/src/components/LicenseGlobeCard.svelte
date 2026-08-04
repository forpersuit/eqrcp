<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { LiveDeviceLocation, LiveDeviceArc, LiveDevicesResponse } from '../lib/types';

  const COUNTRY_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
    'CN': { lat: 35.8617, lng: 104.1954, name: '中国' },
    'US': { lat: 37.0902, lng: -95.7129, name: '美国' },
    'JP': { lat: 36.2048, lng: 138.2529, name: '日本' },
    'SG': { lat: 1.3521, lng: 103.8198, name: '新加坡' },
    'HK': { lat: 22.3193, lng: 114.1694, name: '香港' },
    'TW': { lat: 23.6978, lng: 120.9605, name: '中国台湾' },
    'DE': { lat: 51.1657, lng: 10.4515, name: '德国' },
    'GB': { lat: 55.3781, lng: -3.4360, name: '英国' },
    'FR': { lat: 46.2276, lng: 2.2137, name: '法国' },
    'AU': { lat: -25.2744, lng: 133.7751, name: '澳大利亚' },
    'CA': { lat: 56.1304, lng: -106.3468, name: '加拿大' },
    'KR': { lat: 35.9078, lng: 127.7669, name: '韩国' },
    'IN': { lat: 20.5937, lng: 78.9629, name: '印度' },
    'BR': { lat: -14.2350, lng: -51.9253, name: '巴西' },
    'RU': { lat: 61.5240, lng: 105.3188, name: '俄罗斯' },
    'NL': { lat: 52.1326, lng: 5.2913, name: '荷兰' },
    'SE': { lat: 60.1282, lng: 18.6435, name: '瑞典' },
    'CH': { lat: 46.8182, lng: 8.2275, name: '瑞士' }
  };

  let globeContainerRef: HTMLDivElement | null = $state(null);
  let locations = $state<LiveDeviceLocation[]>([]);
  let crossRegionArcs = $state<LiveDeviceArc[]>([]);
  let totalActiveDevices = $state(0);
  let totalPaidDevices = $state(0);
  let totalFreeDevices = $state(0);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);

  let activeWindow = $state<string>('1h');
  let showArcs = $state<boolean>(true);

  let globeInstance: any = null;
  let isFallback2D = $state(false);
  let canvas2D: HTMLCanvasElement | null = null;
  let animFrameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;

  // Monotonic request token — only the latest refreshData may apply its result,
  // so a slow older response can never overwrite a newer window's data.
  let loadSeq = 0;
  // §4.4: 环/光晕表示"最近 1h 内活跃"。窗口可到 7d，但只有 1h 内的点被视为"热"。
  const RECENT_ACTIVE_MS = 60 * 60 * 1000;

  function minutesSince(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 60000);
  }

  function recentLabel(item: LiveDeviceLocation): string {
    const mins = minutesSince(item.latest_seen_at);
    if (mins === null) return '未知';
    if (mins < 60) return `${mins} 分钟前`;
    return `${Math.floor(mins / 60)} 小时前`;
  }

  function isRecentlyActive(item: LiveDeviceLocation): boolean {
    const mins = minutesSince(item.latest_seen_at);
    return mins !== null && mins * 60000 <= RECENT_ACTIVE_MS;
  }

  function getColumnColor(item: LiveDeviceLocation): string {
    if (item.total_count === 0) return '#64748b';
    const paidRatio = item.paid_count / item.total_count;
    if (paidRatio >= 0.7) return '#f5b301';   // mostly paid → gold
    if (paidRatio >= 0.3) return '#22c55e';   // mixed → green
    if (item.paid_count > 0) return '#38bdf8'; // some paid → blue
    return '#64748b';                           // all free → gray
  }

  export async function refreshData() {
    const seq = ++loadSeq;
    try {
      loading = true; // disable window/refresh buttons during the request
      errorMsg = null;
      const params: Record<string, string> = { window: activeWindow };
      if (showArcs) params.arcs = '1';
      const res = await adminFetch<LiveDevicesResponse>('/api/v1/admin/devices/live', { params });
      if (seq !== loadSeq) return; // superseded by a newer request — drop stale result
      if (res && Array.isArray(res.locations)) {
        locations = res.locations;
        totalActiveDevices = res.total_active_devices || 0;
        totalPaidDevices = res.total_paid_devices || 0;
        totalFreeDevices = res.total_free_devices || 0;
        crossRegionArcs = res.cross_region_arcs || [];
        renderGlobeData(locations, crossRegionArcs);
      }
    } catch (err: any) {
      if (seq === loadSeq) errorMsg = err.message || '获取活跃设备分布失败';
    } finally {
      if (seq === loadSeq) loading = false;
    }
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

  function getCoordForItem(item: LiveDeviceLocation): { lat: number; lng: number; name: string } {
    if (typeof item.latitude === 'number' && typeof item.longitude === 'number') {
      const label = item.city ? `${item.city}` : (COUNTRY_COORDS[item.country?.toUpperCase()]?.name || item.country);
      return { lat: item.latitude, lng: item.longitude, name: label };
    }
    const countryCode = (item.country || '').toUpperCase();
    return COUNTRY_COORDS[countryCode] || { lat: 35.86, lng: 104.19, name: item.city || countryCode || '其他' };
  }

  async function initGlobeEngine() {
    if (!globeContainerRef) return;
    try {
      const loadPromise = loadScript('/vendor/globe.gl.min.js');
      // 同源自托管（public/vendor/），超时仅作保险：WebGL/脚本异常时才回落 2D。
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('script load timeout')), 3000));
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
          .globeImageUrl('/vendor/earth-night.jpg')
          .bumpImageUrl('/vendor/earth-topology.png')
          .backgroundColor('#020617')
          .showAtmosphere(true)
          .atmosphereColor('#38bdf8')
          .atmosphereAltitude(0.18)
          .pointColor((d: any) => d.color || '#38bdf8')
          .pointAltitude((d: any) => d.altitude || 0.05)
          .pointRadius((d: any) => d.radius || 0.6)
          .pointLabel((d: any) => `<div style="background:rgba(2,6,23,0.9);color:#f8fafc;padding:5px 10px;border-radius:6px;font-size:12px;border:1px solid rgba(56,189,248,0.4);box-shadow:0 4px 12px rgba(0,0,0,0.5);">🏙️ <b>${d.cityName}</b>: ${d.totalCount} 台设备<br/>💛 付费: ${d.paidCount} 台<br/>🩶 免费: ${d.freeCount} 台<br/>⏱ 最近活跃: ${d.recentLabel}</div>`)
          .ringsData([])
          .ringColor(() => (t: number) => `rgba(56,189,248,${1 - t})`)
          .ringMaxRadius(3.5)
          .ringPropagationSpeed(2)
          .ringRepeatPeriod(1200)
          .arcColor(() => ['#a855f7', '#ec4899'])
          .arcDashLength(0.4)
          .arcDashGap(0.2)
          .arcDashAnimateTime(1600)
          .arcStroke(1.5);

        if (globeInstance.controls()) {
          globeInstance.controls().autoRotate = true;
          globeInstance.controls().autoRotateSpeed = 0.8;
        }

        handleGlobeResize();
        renderGlobeData(locations, crossRegionArcs);
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

  function renderGlobeData(locList: LiveDeviceLocation[], arcsList: LiveDeviceArc[]) {
    if (isFallback2D) return;
    if (!globeInstance) return;

    const points: any[] = [];
    const rings: any[] = [];
    const arcs: any[] = [];

    locList.forEach((item) => {
      const coord = getCoordForItem(item);
      const count = item.total_count || 1;

      const altitude = Math.min(0.05 + count * 0.03, 0.38);
      const radius = Math.min(0.5 + count * 0.12, 1.6);
      const color = getColumnColor(item);

      points.push({
        lat: coord.lat,
        lng: coord.lng,
        radius,
        altitude,
        color,
        cityName: coord.name,
        totalCount: item.total_count,
        paidCount: item.paid_count,
        freeCount: item.free_count,
        recentLabel: recentLabel(item)
      });

      // §4.4: 环/光晕表示"最近 1h 内活跃"。宽窗口（7d）里陈旧的点不发脉冲，
      // 只有最近活跃的位置有光环——latest_seen_at 就是这个语义的数据源。
      if (isRecentlyActive(item)) {
        rings.push({
          lat: coord.lat,
          lng: coord.lng,
          maxR: Math.min(2.5 + count * 0.5, 6.5),
          propagationSpeed: 1.5,
          repeatPeriod: 1500
        });
      }
    });

    if (showArcs) {
      arcsList.forEach((arc) => {
        let startLat = arc.from_lat;
        let startLng = arc.from_lng;
        if (typeof startLat !== 'number' || typeof startLng !== 'number') {
          const c1 = COUNTRY_COORDS[arc.from_country?.toUpperCase()] || { lat: 35.86, lng: 104.19 };
          startLat = c1.lat;
          startLng = c1.lng;
        }

        let endLat = arc.to_lat;
        let endLng = arc.to_lng;
        if (typeof endLat !== 'number' || typeof endLng !== 'number') {
          const c2 = COUNTRY_COORDS[arc.to_country?.toUpperCase()] || { lat: 37.09, lng: -95.71 };
          endLat = c2.lat;
          endLng = c2.lng;
        }

        arcs.push({
          startLat,
          startLng,
          endLat,
          endLng,
          licenseCode: arc.license_code
        });
      });
    }

    globeInstance.pointsData(points);
    if (globeInstance.ringsData) {
      globeInstance.ringsData(rings);
    }
    if (globeInstance.arcsData) {
      globeInstance.arcsData(arcs);
    }
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
      canvas2D.height = globeContainerRef.clientHeight || 320;
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

      function project(lat: number, lng: number): { x: number; y: number; visible: boolean } {
        return {
          x: cx + Math.sin((lng * Math.PI / 180) + angle) * radius * Math.cos(lat * Math.PI / 180),
          y: cy - Math.sin(lat * Math.PI / 180) * radius,
          visible: Math.cos((lng * Math.PI / 180) + angle) > -0.2
        };
      }

      locations.forEach((item) => {
        const coord = getCoordForItem(item);
        const p = project(coord.lat, coord.lng);

        if (p.visible) {
          const colColor = getColumnColor(item);
          const colHeight = Math.min(12 + item.total_count * 3.5, 45);

          // §4.4 recent-activity halo: soft ring around dots active within the last 1h
          if (isRecentlyActive(item)) {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
            ctx.stroke();
          }

          ctx.strokeStyle = colColor;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x, p.y - colHeight);
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(p.x, p.y - colHeight, 3, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = colColor;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.min(3 + item.total_count * 0.5, 7), 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.font = '11px sans-serif';
          ctx.fillText(`${coord.name} (${item.total_count}台, 付费${item.paid_count})`, p.x + 8, p.y - colHeight + 4);
        }
      });

      if (showArcs) {
        crossRegionArcs.forEach((arc) => {
          // Project arc endpoints directly from their coords (same rows as the dots)
          // instead of string-matching pointMap keys — a location without a city would
          // otherwise never be found ("US:3" vs "US:") and the arc would silently vanish.
          let sLat = arc.from_lat;
          let sLng = arc.from_lng;
          if (typeof sLat !== 'number' || typeof sLng !== 'number') {
            const c1 = COUNTRY_COORDS[arc.from_country?.toUpperCase()] || { lat: 35.86, lng: 104.19 };
            sLat = c1.lat; sLng = c1.lng;
          }
          let eLat = arc.to_lat;
          let eLng = arc.to_lng;
          if (typeof eLat !== 'number' || typeof eLng !== 'number') {
            const c2 = COUNTRY_COORDS[arc.to_country?.toUpperCase()] || { lat: 37.09, lng: -95.71 };
            eLat = c2.lat; eLng = c2.lng;
          }
          const p1 = project(sLat, sLng);
          const p2 = project(eLat, eLng);
          if (p1.visible && p2.visible) {
            ctx.strokeStyle = 'rgba(168, 85, 247, 0.65)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2 - 30;
            ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
            ctx.stroke();
          }
        });
      }

      animFrameId = requestAnimationFrame(animate);
    }
    animate();
  }

  function handleWindowChange(window: string) {
    activeWindow = window;
    refreshData();
  }

  function handleArcsToggle() {
    showArcs = !showArcs;
    if (showArcs && crossRegionArcs.length === 0) {
      // Last fetch had arcs off (server skipped the raw scan) → backfill arc data
      refreshData();
    } else if (!isFallback2D) {
      renderGlobeData(locations, crossRegionArcs);
    }
  }

  onMount(async () => {
    await refreshData();
    initGlobeEngine();

    if (window.ResizeObserver && globeContainerRef) {
      resizeObserver = new ResizeObserver(() => handleGlobeResize());
      resizeObserver.observe(globeContainerRef);
    }
  });

  onDestroy(() => {
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
    if (resizeObserver) resizeObserver.disconnect();
    if (globeInstance && typeof globeInstance._destructor === 'function') {
      globeInstance._destructor();
    }
  });
</script>

<div class="globe-card card">
  <div class="card-header flex-between">
    <div class="header-title">
      <span class="icon">🌍</span>
      <div>
        <h3>全球城市级活跃设备分布视界</h3>
        <p class="subtitle">城市打点与 3D 柱体高度表征活跃设备量；付费/免费双色区分；同一激活码的多台设备跨城/跨国绘制紫粉流光弧线</p>
      </div>
    </div>
    <div class="header-right">
      <div class="window-selector" role="group" aria-label="时间窗口">
        {#each ['1h', '12h', '24h', '7d'] as w}
          <button
            class="btn btn-xs window-btn"
            class:active={activeWindow === w}
            onclick={() => handleWindowChange(w)}
            disabled={loading}
          >{w}</button>
        {/each}
      </div>

      <label class="arcs-toggle" title="显示/隐藏跨区域弧线">
        <input type="checkbox" checked={showArcs} onchange={handleArcsToggle} />
        <span class="toggle-label">弧线</span>
      </label>

      {#if crossRegionArcs.length > 0}
        <span class="badge badge-purple" title="同一激活码绑定在多台设备上，且这些设备位于不同城市/国家">⚡ 跨城流光链路: {crossRegionArcs.length} 条</span>
      {/if}
      <span class="badge badge-info">活跃: {totalActiveDevices} 台 (付费 {totalPaidDevices} / 免费 {totalFreeDevices})</span>
      <button class="btn btn-xs btn-outline" onclick={refreshData} disabled={loading}>
        🔄 刷新点位
      </button>
    </div>
  </div>

  {#if errorMsg}
    <div class="alert alert-error">{errorMsg}</div>
  {/if}

  <div class="globe-wrapper" bind:this={globeContainerRef}></div>

  {#if locations.length > 0}
    <div class="locations-bar">
      {#each locations as loc}
        {@const countryName = COUNTRY_COORDS[loc.country?.toUpperCase()]?.name || loc.country}
        <div class="loc-chip">
          <span class="flag">{loc.country}</span>
          <span class="name">{loc.city ? `${countryName} · ${loc.city}` : countryName}</span>
          <span class="count-badge">{loc.total_count} 台</span>
          <span class="paid-badge">{loc.paid_count} 付费</span>
          <span class="free-badge">{loc.free_count} 免费</span>
        </div>
      {/each}
    </div>
  {:else if !loading}
    <div class="empty-bar">尚无区间内活跃设备记录</div>
  {/if}
</div>

<style>
  .globe-card {
    padding: 0;
    overflow: hidden;
    background: var(--bg-surface, #0f172a);
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    border-radius: var(--radius-md, 8px);
    margin-bottom: 1.25rem;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .card-header {
    padding: 0.85rem 1.25rem;
    border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(255, 255, 255, 0.02);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .header-title .icon {
    font-size: 1.4rem;
  }

  .header-title h3 {
    font-size: 1rem;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary, #f8fafc);
  }

  .subtitle {
    font-size: 0.75rem;
    color: var(--text-secondary, #94a3b8);
    margin-top: 0.15rem;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .window-selector {
    display: flex;
    gap: 2px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 2px;
  }

  .window-btn {
    padding: 0.25rem 0.5rem;
    font-size: 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-secondary, #94a3b8);
    font-family: monospace;
    font-weight: 600;
    transition: all 0.2s;
  }

  .window-btn:hover {
    color: var(--text-primary, #f8fafc);
    background: rgba(255, 255, 255, 0.08);
  }

  .window-btn.active {
    background: rgba(56, 189, 248, 0.2);
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.3);
  }

  .window-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .arcs-toggle {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--text-secondary, #94a3b8);
    user-select: none;
  }

  .arcs-toggle input[type="checkbox"] {
    accent-color: #a855f7;
    cursor: pointer;
  }

  .toggle-label {
    font-weight: 500;
  }

  .globe-wrapper {
    width: 100%;
    height: 420px !important;
    background: #020617;
    position: relative;
    overflow: hidden;
  }

  .locations-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    padding: 0.85rem 1.25rem;
    background: rgba(255, 255, 255, 0.015);
    border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
  }

  .loc-chip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    font-size: 0.8rem;
  }

  .flag {
    font-weight: 700;
    color: #38bdf8;
    font-family: monospace;
  }

  .name {
    color: var(--text-primary, #e2e8f0);
  }

  .count-badge {
    background: rgba(56, 189, 248, 0.15);
    color: #38bdf8;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.75rem;
  }

  .paid-badge {
    background: rgba(245, 179, 1, 0.15);
    color: #f5b301;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.7rem;
  }

  .free-badge {
    background: rgba(100, 116, 139, 0.2);
    color: #94a3b8;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.7rem;
  }

  .empty-bar {
    padding: 0.85rem 1.25rem;
    font-size: 0.85rem;
    color: var(--text-secondary, #94a3b8);
    text-align: center;
    background: rgba(255, 255, 255, 0.01);
  }

  .badge {
    padding: 0.25rem 0.6rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .badge-purple {
    background: rgba(168, 85, 247, 0.2);
    color: #c084fc;
    border: 1px solid rgba(168, 85, 247, 0.3);
  }

  .badge-info {
    background: rgba(56, 189, 248, 0.15);
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.3);
  }

  .btn-xs {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-outline {
    background: transparent;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.2));
    color: var(--text-secondary, #cbd5e1);
  }

  .btn-outline:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary, #ffffff);
  }

  .alert-error {
    padding: 0.5rem 1rem;
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    font-size: 0.8rem;
  }
</style>
