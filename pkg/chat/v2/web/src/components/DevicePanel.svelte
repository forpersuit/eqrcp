<script lang="ts">
  import { peers, currentDevice, connState } from '../state/chatStore';
  import { getThemeColors } from '../services/theme';

  function getDeviceColor(theme?: string): string {
    const colors = getThemeColors(theme);
    return colors ? colors.border : 'rgba(255, 255, 255, 0.9)';
  }
</script>

<div class="device-panel">
  <div class="panel-header">
    <h2>在线设备 ({$peers.length})</h2>
    <div class="status-indicator {$connState}">
      <span class="dot"></span>
      <span class="status-text">
        {$connState === 'connected' ? '已连接' : $connState === 'connecting' ? '连接中' : '已断开'}
      </span>
    </div>
  </div>

  <div class="device-list">
    {#each $peers as device (device.id)}
      <div class="device-item" class:is-me={device.id === $currentDevice?.id}>
        <div class="avatar-wrapper">
          <div class="avatar" style="background: {getDeviceColor(device.theme)}; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            {#if device.avatar && device.avatar.startsWith('data:image/')}
              <img src={device.avatar} alt={device.label} style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" />
            {:else if device.avatar}
              {device.avatar}
            {:else}
              {device.label.substring(0, 2).toUpperCase()}
            {/if}
          </div>
          <span class="online-badge" style="background: {getDeviceColor(device.theme)};"></span>
        </div>
        <div class="device-info">
          <div class="device-name" style="color: {getDeviceColor(device.theme)}">
            {device.label}
            {#if device.id === $currentDevice?.id}
              <span class="me-tag">本机</span>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <div class="empty-state">
        <p>暂无其他设备</p>
      </div>
    {/each}
  </div>
</div>

<style>
  .device-panel {
    display: flex;
    flex-direction: column;
    width: 260px;
    height: 100%;
    background: rgba(14, 12, 21, 0.6);
    border-right: 1px solid rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
  }

  .panel-header {
    padding: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  h2 {
    margin: 0 0 8px 0;
    font-size: 1rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .status-indicator .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
    box-shadow: 0 0 8px #ef4444;
  }

  .status-indicator.connected .dot {
    background: #10b981;
    box-shadow: 0 0 8px #10b981;
  }

  .status-indicator.connecting .dot {
    background: #f59e0b;
    box-shadow: 0 0 8px #f59e0b;
    animation: pulse 1.5s infinite ease-in-out;
  }

  .device-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .device-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.02);
    transition: all 0.2s ease;
  }

  .device-item:hover {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.05);
  }

  .device-item.is-me {
    background: rgba(124, 58, 237, 0.08);
    border-color: rgba(124, 58, 237, 0.2);
  }

  .avatar-wrapper {
    position: relative;
  }

  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    font-weight: bold;
    color: #fff;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
  }

  .online-badge {
    position: absolute;
    bottom: -1px;
    right: -1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #10b981;
    border: 2px solid #0e0c15;
  }

  .device-info {
    flex: 1;
    min-width: 0;
  }

  .device-name {
    font-size: 0.85rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .me-tag {
    font-size: 0.65rem;
    padding: 1px 4px;
    border-radius: 4px;
    background: #7c3aed;
    color: #fff;
  }

  .device-sub {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .empty-state {
    padding: 20px;
    text-align: center;
    color: rgba(255, 255, 255, 0.3);
    font-size: 0.8rem;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }
</style>
