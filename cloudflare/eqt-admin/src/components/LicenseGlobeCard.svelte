<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { adminFetch } from '../lib/api';

  interface LocationItem {
    country: string;
    region?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    active_count: number;
    latest_activated_at?: string;
  }

  interface CrossRegionArc {
    license_code: string;
    from_country: string;
    from_city?: string;
    from_lat?: number;
    from_lng?: number;
    to_country: string;
    to_city?: string;
    to_lat?: number;
    to_lng?: number;
  }

  interface LocationsResponse {
    success: boolean;
    locations: LocationItem[];
    total_active_devices: number;
    cross_region_arcs?: CrossRegionArc[];
  }

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
  let locations = $state<LocationItem[]>([]);
  let crossRegionArcs = $state<CrossRegionArc[]>([]);
  let totalActiveDevices = $state(0);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);

  let globeInstance: any = null;
  let isFallback2D = $state(false);
  let canvas2D: HTMLCanvasElement | null = null;
  let animFrameId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;

  export async function refreshData() {
    try {
      errorMsg = null;
      const res = await adminFetch<LocationsResponse>('/api/v1/admin/activation-locations');
      if (res && Array.isArray(res.locations)) {
        locations = res.locations;
        totalActiveDevices = res.total_active_devices || 0;
        crossRegionArcs = res.cross_region_arcs || [];
        renderGlobeData(locations, crossRegionArcs);
      }
    } catch (err: any) {
      errorMsg = err.message || '获取授权激活分布失败';
    } finally {
      loading = false;
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

  function getCoordForItem(item: LocationItem): { lat: number; lng: number; name: string } {
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
          // City-level Points & Rings
          .pointColor((d: any) => d.color || '#38bdf8')
          .pointAltitude((d: any) => d.altitude || 0.04)
          .pointRadius((d: any) => d.radius || 0.6)
          .ringsData([])
          .ringColor(() => (t: number) => `rgba(56,189,248,${1 - t})`)
          .ringMaxRadius(3)
          .ringPropagationSpeed(2)
          .ringRepeatPeriod(1200)
          // City-level Cross-Location Arcs
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
      const h = globeContainerRef.clientHeight || 320;
      globeInstance.width(w).height(h);
    }
  }

  function renderGlobeData(locList: LocationItem[], arcsList: CrossRegionArc[]) {
    if (isFallback2D) {
      return;
    }
    if (!globeInstance) return;

    const points: any[] = [];
    const rings: any[] = [];
    const arcs: any[] = [];

    locList.forEach((item) => {
      const coord = getCoordForItem(item);
      const count = item.active_count || 1;
      const radius = Math.min(0.5 + count * 0.2, 1.8);
      const altitude = Math.min(0.03 + count * 0.015, 0.12);
      const color = count > 5 ? '#a855f7' : (count > 2 ? '#22c55e' : '#38bdf8');

      points.push({
        lat: coord.lat,
        lng: coord.lng,
        radius,
        altitude,
        color,
        cityName: coord.name,
        count
      });

      rings.push({
        lat: coord.lat,
        lng: coord.lng,
        maxR: Math.min(2 + count * 0.5, 6),
        propagationSpeed: 1.5,
        repeatPeriod: 1500
      });
    });

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

      // Draw location points on 2D sphere
      const pointMap = new Map<string, { x: number; y: number; visible: boolean }>();

      locations.forEach((item, idx) => {
        const coord = getCoordForItem(item);
        const px = cx + Math.sin((coord.lng * Math.PI / 180) + angle) * radius * Math.cos(coord.lat * Math.PI / 180);
        const py = cy - Math.sin(coord.lat * Math.PI / 180) * radius;
        const visible = Math.cos((coord.lng * Math.PI / 180) + angle) > -0.2;

        const key = `${item.country}:${item.city || idx}`;
        pointMap.set(key, { x: px, y: py, visible });

        if (visible) {
          ctx.fillStyle = item.active_count > 5 ? '#a855f7' : (item.active_count > 2 ? '#22c55e' : '#38bdf8');
          ctx.beginPath();
          ctx.arc(px, py, Math.min(3 + item.active_count, 8), 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.font = '11px sans-serif';
          const label = item.city ? `${coord.name}` : `${coord.name}`;
          ctx.fillText(`${label} (${item.active_count})`, px + 10, py + 4);
        }
      });

      // Draw 2D arcs for same-key cross-location
      crossRegionArcs.forEach((arc) => {
        const k1 = `${arc.from_country}:${arc.from_city || ''}`;
        const k2 = `${arc.to_country}:${arc.to_city || ''}`;
        const p1 = pointMap.get(k1);
        const p2 = pointMap.get(k2);
        if (p1 && p2 && p1.visible && p2.visible) {
          ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2 - 30;
          ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
          ctx.stroke();
        }
      });

      animFrameId = requestAnimationFrame(animate);
    }
    animate();
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
        <h3>全球城市级授权激活分布视界</h3>
        <p class="subtitle">城市级节点精准打点；同 Key 跨城市/跨国激活自动绘制紫粉抛物线弧线，撤销/解绑即时熄灭</p>
      </div>
    </div>
    <div class="header-right">
      {#if crossRegionArcs.length > 0}
        <span class="badge badge-purple" title="存在同一 Key 在不同城市/国家被激活">
          ⚡ 跨城流光链路: {crossRegionArcs.length} 条
        </span>
      {/if}
      <span class="badge badge-info">在用活跃设备总数: {totalActiveDevices}</span>
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
          <span class="count-badge">{loc.active_count} 台</span>
        </div>
      {/each}
    </div>
  {:else if !loading}
    <div class="empty-bar">尚无生效中的客户端激活记录（所有已被撤销或未激活）</div>
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
  }

  .globe-wrapper {
    width: 100%;
    height: 320px !important;
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
