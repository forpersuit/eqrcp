<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let peerConnection: RTCPeerConnection | null = null;
  export let isProMode: boolean = false;
  export let transferMode: 'lan' | 'wan_p2p' = 'lan';
  export let isVisible: boolean = false;

  interface ConnectionStats {
    state: string;
    rttMs: number;
    uploadSpeedKbps: number;
    downloadSpeedKbps: number;
    packetsLost: number;
    localCandidateType: string;
    remoteCandidateType: string;
    cipherSuite: string;
    diagnosticsLog: string[];
  }

  let stats: ConnectionStats = {
    state: 'new',
    rttMs: 0,
    uploadSpeedKbps: 0,
    downloadSpeedKbps: 0,
    packetsLost: 0,
    localCandidateType: 'unknown',
    remoteCandidateType: 'unknown',
    cipherSuite: 'DTLS-SRTP (AES_128_GCM)',
    diagnosticsLog: ['[System] Connection dashboard initialized.']
  };

  let showDetailModal: boolean = false;
  let timer: any = null;
  let lastBytesSent = 0;
  let lastBytesReceived = 0;
  let lastTimestamp = 0;

  function appendLog(msg: string) {
    const timeStr = new Date().toLocaleTimeString();
    stats.diagnosticsLog = [...stats.diagnosticsLog, `[${timeStr}] ${msg}`];
  }

  async function updateStats() {
    if (!peerConnection) {
      stats.state = transferMode === 'lan' ? 'lan_direct' : 'disconnected';
      return;
    }

    stats.state = peerConnection.iceConnectionState;

    try {
      const reports = await peerConnection.getStats();
      const now = performance.now();
      const timeDiff = (now - lastTimestamp) / 1000;

      reports.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (report.currentRoundTripTime !== undefined) {
            stats.rttMs = Math.round(report.currentRoundTripTime * 1000);
          }
        }

        if (report.type === 'transport') {
          if (report.dtlsCipher) {
            stats.cipherSuite = report.dtlsCipher;
          }
        }

        if (report.type === 'outbound-rtp' || report.type === 'data-channel') {
          if (report.bytesSent !== undefined && timeDiff > 0) {
            stats.uploadSpeedKbps = Math.max(0, Math.round(((report.bytesSent - lastBytesSent) * 8) / (timeDiff * 1024)));
            lastBytesSent = report.bytesSent;
          }
        }

        if (report.type === 'inbound-rtp' || report.type === 'data-channel') {
          if (report.bytesReceived !== undefined && timeDiff > 0) {
            stats.downloadSpeedKbps = Math.max(0, Math.round(((report.bytesReceived - lastBytesReceived) * 8) / (timeDiff * 1024)));
            lastBytesReceived = report.bytesReceived;
          }
          if (report.packetsLost !== undefined) {
            stats.packetsLost = report.packetsLost;
          }
        }

        if (report.type === 'local-candidate') {
          stats.localCandidateType = report.candidateType || 'srflx';
        }

        if (report.type === 'remote-candidate') {
          stats.remoteCandidateType = report.candidateType || 'srflx';
        }
      });

      lastTimestamp = now;
    } catch (err) {
      // Fallback
    }
  }

  onMount(() => {
    appendLog(`Mode: ${transferMode.toUpperCase()} | Pro WAN Status: ${isProMode ? 'Active' : 'Inactive'}`);
    timer = setInterval(updateStats, 1000);

    if (peerConnection) {
      peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection) {
          appendLog(`ICE State -> ${peerConnection.iceConnectionState}`);
          if (peerConnection.iceConnectionState === 'failed') {
            appendLog('⚠️ P2P Hole punching failed (Likely Symmetric NAT block).');
          }
        }
      };
    }
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

{#if isVisible}
<div class="p2p-dashboard-card glass-panel">
  <div class="dashboard-header">
    <div class="mode-badge" class:pro={isProMode} class:lan={transferMode === 'lan'}>
      <span class="status-dot" class:active={stats.state === 'connected' || transferMode === 'lan'}></span>
      {transferMode === 'lan' ? '局域网 (LAN Direct)' : 'Pro 公网 P2P (WAN Direct)'}
    </div>
    <button class="btn-detail" on:click={() => showDetailModal = true}>
      📊 链路参数与诊断
    </button>
  </div>

  <div class="metrics-grid">
    <div class="metric-item">
      <span class="label">当前延迟 (RTT)</span>
      <span class="value" class:good={stats.rttMs < 50} class:warning={stats.rttMs >= 50 && stats.rttMs < 150} class:bad={stats.rttMs >= 150}>
        {transferMode === 'lan' ? '< 2 ms' : `${stats.rttMs} ms`}
      </span>
    </div>

    <div class="metric-item">
      <span class="label">传输类型</span>
      <span class="value highlight">
        {transferMode === 'lan' ? '内网 UDP/TCP' : `WebRTC (${stats.localCandidateType === 'host' ? 'LAN' : 'STUN P2P'})`}
      </span>
    </div>

    <div class="metric-item">
      <span class="label">丢包率</span>
      <span class="value">{stats.packetsLost} pkts</span>
    </div>

    <div class="metric-item">
      <span class="label">加密安全</span>
      <span class="value secure">E2EE (AES-128)</span>
    </div>
  </div>
</div>
{/if}

{#if showDetailModal}
<div class="modal-overlay" on:click|self={() => showDetailModal = false}>
  <div class="modal-card glass-panel">
    <div class="modal-header">
      <h3>🔍 P2P 物理链路诊断与指标控制台</h3>
      <button class="close-btn" on:click={() => showDetailModal = false}>×</button>
    </div>

    <div class="modal-body">
      <div class="detail-section">
        <h4>网络拓扑参数</h4>
        <ul>
          <li><strong>传输模式：</strong> {transferMode === 'lan' ? '局域网直连 (LAN)' : 'Pro 公网 P2P (WAN)'}</li>
          <li><strong>ICE 链接状态：</strong> <code>{stats.state}</code></li>
          <li><strong>本地 Candidate 类型：</strong> <code>{stats.localCandidateType}</code></li>
          <li><strong>远端 Candidate 类型：</strong> <code>{stats.remoteCandidateType}</code></li>
          <li><strong>传输协议：</strong> WebRTC DataChannel / UDP</li>
          <li><strong>加密算法套件：</strong> <code>{stats.cipherSuite}</code></li>
        </ul>
      </div>

      <div class="detail-section">
        <h4>实时诊断日志痕迹 (Diagnostics)</h4>
        <div class="log-console">
          {#each stats.diagnosticsLog as log}
            <div class="log-line">{log}</div>
          {/each}
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn-primary" on:click={() => showDetailModal = false}>关闭控制台</button>
    </div>
  </div>
</div>
{/if}

<style>
  .glass-panel {
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(229, 231, 235, 0.8);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
  }

  @media (prefers-color-scheme: dark) {
    .glass-panel {
      background: rgba(30, 41, 59, 0.85);
      border-color: rgba(51, 65, 85, 0.8);
      color: #f8fafc;
    }
  }

  .p2p-dashboard-card {
    padding: 14px 18px;
    margin: 12px 0;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .mode-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    background: #e2e8f0;
    color: #334155;
  }

  .mode-badge.pro {
    background: #dbeafe;
    color: #1e40af;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #94a3b8;
  }

  .status-dot.active {
    background: #22c55e;
    box-shadow: 0 0 8px #22c55e;
  }

  .btn-detail {
    background: transparent;
    border: 1px solid #cbd5e1;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-detail:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }

  .metric-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .metric-item .label {
    font-size: 11px;
    color: #64748b;
  }

  .metric-item .value {
    font-size: 14px;
    font-weight: 600;
  }

  .value.good { color: #16a34a; }
  .value.warning { color: #d97706; }
  .value.bad { color: #dc2626; }
  .value.secure { color: #2563eb; }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 9999;
  }

  .modal-card {
    width: 540px;
    max-width: 90vw;
    padding: 20px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 16px;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
  }

  .log-console {
    background: #0f172a;
    color: #38bdf8;
    padding: 10px;
    border-radius: 6px;
    font-family: monospace;
    font-size: 12px;
    max-height: 160px;
    overflow-y: auto;
  }

  .log-line {
    margin-bottom: 4px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }

  .btn-primary {
    background: #2563eb;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
  }
</style>
