<script lang="ts">
  import { onMount } from 'svelte';
  import { adminFetch } from '../lib/api';
  import type { FeedbackItem, FeedbacksResponse } from '../lib/types';

  let feedbacks = $state<FeedbackItem[]>([]);
  let totalCount = $state(0);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let selectedCategory = $state<string>('all');
  let selectedStatus = $state<string>('all');
  let searchQuery = $state<string>('');
  let previewImage = $state<string | null>(null);

  let unreadCount = $derived(feedbacks.filter(f => f.status === 'unread').length);
  let bugCount = $derived(feedbacks.filter(f => f.category === 'bug').length);
  let featureCount = $derived(feedbacks.filter(f => f.category === 'feature').length);
  let imageCount = $derived(feedbacks.filter(f => Boolean(f.image_url)).length);

  let filteredFeedbacks = $derived(
    feedbacks.filter(item => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const contactMatch = item.contact?.toLowerCase().includes(q) || false;
      const msgMatch = item.message.toLowerCase().includes(q);
      const osMatch = item.client_os?.toLowerCase().includes(q) || false;
      const verMatch = item.client_version?.toLowerCase().includes(q) || false;
      return contactMatch || msgMatch || osMatch || verMatch;
    })
  );

  async function loadFeedbacks() {
    loading = true;
    errorMsg = null;
    try {
      const params: Record<string, string> = {
        limit: '100',
        offset: '0'
      };
      if (selectedCategory !== 'all') params.category = selectedCategory;
      if (selectedStatus !== 'all') params.status = selectedStatus;

      const res = await adminFetch<FeedbacksResponse>('/api/v1/admin/feedbacks', { params });
      if (res && Array.isArray(res.feedbacks)) {
        feedbacks = res.feedbacks;
        totalCount = res.total || res.feedbacks.length;
      }
    } catch (err: any) {
      errorMsg = err.message || '加载用户反馈列表失败';
    } finally {
      loading = false;
    }
  }

  async function updateStatus(item: FeedbackItem, newStatus: string) {
    try {
      await adminFetch(`/api/v1/admin/feedbacks/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      item.status = newStatus;
    } catch (err: any) {
      errorMsg = '更新反馈状态失败: ' + (err.message || '未知错误');
    }
  }

  async function deleteFeedback(id: number) {
    try {
      await adminFetch(`/api/v1/admin/feedbacks/${id}`, { method: 'DELETE' });
      feedbacks = feedbacks.filter(f => f.id !== id);
      totalCount = Math.max(0, totalCount - 1);
    } catch (err: any) {
      errorMsg = '删除失败: ' + (err.message || '未知错误');
    }
  }

  function getCategoryLabel(cat: string): { label: string; icon: string; class: string } {
    switch (cat) {
      case 'bug': return { label: 'Bug 报告', icon: '🐛', class: 'cat-bug' };
      case 'transfer': return { label: '传输故障', icon: '🚀', class: 'cat-transfer' };
      case 'gui': return { label: 'GUI 界面', icon: '🎨', class: 'cat-gui' };
      case 'feature': return { label: '功能建议', icon: '💡', class: 'cat-feature' };
      case 'license': return { label: '购买授权', icon: '🔑', class: 'cat-license' };
      default: return { label: '综合反馈', icon: '📝', class: 'cat-other' };
    }
  }

  function formatTime(isoStr: string): string {
    if (!isoStr) return '-';
    try {
      return new Date(isoStr).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return isoStr;
    }
  }

  onMount(() => {
    loadFeedbacks();
  });
</script>

<div class="page-container">
  <div class="header-section">
    <div>
      <h1 class="page-title">💬 客户端用户反馈中心</h1>
      <p class="page-subtitle">接收、审查与跟进桌面/移动端用户提交的意见、 Bug 报告及截图</p>
    </div>
    <button class="btn btn-primary" onclick={loadFeedbacks} disabled={loading}>
      {loading ? '加载中...' : '🔄 刷新反馈数据'}
    </button>
  </div>

  {#if errorMsg}
    <div class="alert alert-error">
      ⚠️ 错误: {errorMsg}
    </div>
  {/if}

  <!-- KPI Badges -->
  <div class="stats-grid">
    <div class="stat-card blue">
      <div class="stat-value">{totalCount}</div>
      <div class="stat-label">总反馈收件箱</div>
    </div>
    <div class="stat-card orange">
      <div class="stat-value">{unreadCount}</div>
      <div class="stat-label">未处理待跟进</div>
    </div>
    <div class="stat-card red">
      <div class="stat-value">{bugCount}</div>
      <div class="stat-label">Bug / 传输异常</div>
    </div>
    <div class="stat-card green">
      <div class="stat-value">{imageCount}</div>
      <div class="stat-label">附带截图反馈</div>
    </div>
  </div>

  <!-- Filters & Search -->
  <div class="card filter-card">
    <div class="filter-row">
      <div class="category-tabs">
        <button
          class="tab-item"
          class:active={selectedCategory === 'all'}
          onclick={() => { selectedCategory = 'all'; loadFeedbacks(); }}
        >
          全部类型
        </button>
        <button
          class="tab-item"
          class:active={selectedCategory === 'bug'}
          onclick={() => { selectedCategory = 'bug'; loadFeedbacks(); }}
        >
          🐛 Bug 报告
        </button>
        <button
          class="tab-item"
          class:active={selectedCategory === 'transfer'}
          onclick={() => { selectedCategory = 'transfer'; loadFeedbacks(); }}
        >
          🚀 传输故障
        </button>
        <button
          class="tab-item"
          class:active={selectedCategory === 'gui'}
          onclick={() => { selectedCategory = 'gui'; loadFeedbacks(); }}
        >
          🎨 GUI 界面
        </button>
        <button
          class="tab-item"
          class:active={selectedCategory === 'feature'}
          onclick={() => { selectedCategory = 'feature'; loadFeedbacks(); }}
        >
          💡 功能建议
        </button>
        <button
          class="tab-item"
          class:active={selectedCategory === 'license'}
          onclick={() => { selectedCategory = 'license'; loadFeedbacks(); }}
        >
          🔑 购买授权
        </button>
      </div>

      <div class="search-box">
        <input
          type="text"
          placeholder="🔍 搜索联系邮箱/消息内容/操作系统..."
          bind:value={searchQuery}
          class="search-input"
        />
      </div>
    </div>
  </div>

  <!-- Feedbacks List -->
  {#if loading && feedbacks.length === 0}
    <div class="loading-state">加载用户反馈记录中...</div>
  {:else if filteredFeedbacks.length === 0}
    <div class="card empty-card">
      <p>📬 暂无匹配的用户反馈数据</p>
    </div>
  {:else}
    <div class="feedback-list">
      {#each filteredFeedbacks as item (item.id)}
        {@const catInfo = getCategoryLabel(item.category)}
        <div class="card feedback-card" class:unread={item.status === 'unread'}>
          <div class="feedback-header">
            <div class="badge-group">
              <span class="badge {catInfo.class}">
                {catInfo.icon} {catInfo.label}
              </span>
              {#if item.status === 'unread'}
                <span class="badge badge-unread">● 待处理</span>
              {:else}
                <span class="badge badge-resolved">✓ 已解决</span>
              {/if}
            </div>

            <div class="feedback-meta">
              <span class="meta-time">⏰ {formatTime(item.timestamp || item.created_at)}</span>
              <span class="meta-id">#ID {item.id}</span>
            </div>
          </div>

          <div class="feedback-body">
            <p class="message-text">{item.message}</p>

            {#if item.image_url}
              <div class="image-attachment">
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <img
                  src={item.image_url}
                  alt="Feedback attachment"
                  class="thumbnail-img"
                  onclick={() => previewImage = item.image_url}
                />
                <span class="img-hint">📸 点击放大预览大图</span>
              </div>
            {/if}
          </div>

          <div class="feedback-footer">
            <div class="client-info">
              <span class="info-tag">📧 {item.contact || '匿名用户'}</span>
              {#if item.client_os}
                <span class="info-tag">💻 {item.client_os}</span>
              {/if}
              {#if item.client_version}
                <span class="info-tag">📦 v{item.client_version}</span>
              {/if}
            </div>

            <div class="action-buttons">
              {#if item.status === 'unread'}
                <button
                  class="btn btn-xs btn-success"
                  onclick={() => updateStatus(item, 'resolved')}
                >
                  ✓ 标记为已解决
                </button>
              {:else}
                <button
                  class="btn btn-xs btn-secondary"
                  onclick={() => updateStatus(item, 'unread')}
                >
                  ↩ 重置为未处理
                </button>
              {/if}

              <button
                class="btn btn-xs btn-danger"
                onclick={() => deleteFeedback(item.id)}
              >
                🗑️ 删除
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Image Modal -->
{#if previewImage}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={() => previewImage = null}>
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <button class="modal-close" onclick={() => previewImage = null}>✕</button>
      <img src={previewImage} alt="Full resolution screenshot" class="full-img" />
    </div>
  </div>
{/if}

<style>
  .page-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .header-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .page-title {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--text-primary);
  }

  .page-subtitle {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1.25rem;
  }

  .stat-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .stat-card.blue { border-top: 3px solid #38bdf8; }
  .stat-card.orange { border-top: 3px solid #f97316; }
  .stat-card.red { border-top: 3px solid #ef4444; }
  .stat-card.green { border-top: 3px solid #22c55e; }

  .stat-value {
    font-size: 2rem;
    font-weight: 800;
    color: var(--text-primary);
  }

  .stat-label {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .filter-card {
    padding: 1rem 1.25rem;
  }

  .filter-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .category-tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .tab-item {
    padding: 0.4rem 0.8rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab-item:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .tab-item.active {
    background: rgba(99, 102, 241, 0.2);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    font-weight: 600;
  }

  .search-input {
    padding: 0.5rem 0.9rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: 0.85rem;
    width: 280px;
  }

  .feedback-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .feedback-card {
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    transition: all 0.2s ease;
  }

  .feedback-card.unread {
    border-left: 4px solid #f97316;
  }

  .feedback-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .badge-group {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .badge {
    padding: 0.25rem 0.6rem;
    border-radius: 12px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .cat-bug { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
  .cat-transfer { background: rgba(249, 115, 22, 0.15); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.3); }
  .cat-gui { background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); }
  .cat-feature { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
  .cat-license { background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.3); }
  .cat-other { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3); }

  .badge-unread { background: rgba(249, 115, 22, 0.2); color: #f97316; }
  .badge-resolved { background: rgba(34, 197, 94, 0.15); color: #4ade80; }

  .feedback-meta {
    display: flex;
    gap: 1rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .message-text {
    font-size: 0.95rem;
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
  }

  .image-attachment {
    margin-top: 0.75rem;
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
  }

  .thumbnail-img {
    max-width: 200px;
    max-height: 120px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: transform 0.2s ease;
  }

  .thumbnail-img:hover {
    transform: scale(1.03);
    border-color: var(--accent-primary);
  }

  .img-hint {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .feedback-footer {
    padding-top: 0.75rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .client-info {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .info-tag {
    font-size: 0.8rem;
    background: rgba(255, 255, 255, 0.04);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    color: var(--text-secondary);
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .btn-xs {
    padding: 0.3rem 0.6rem;
    font-size: 0.8rem;
    border-radius: 4px;
    cursor: pointer;
    border: none;
  }

  .btn-success {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }
  .btn-success:hover { background: #22c55e; color: white; }

  .btn-secondary {
    background: rgba(148, 163, 184, 0.15);
    color: #cbd5e1;
    border: 1px solid rgba(148, 163, 184, 0.3);
  }

  .btn-danger {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .btn-danger:hover { background: #ef4444; color: white; }

  .loading-state, .empty-card {
    padding: 3rem;
    text-align: center;
    color: var(--text-secondary);
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .modal-content {
    position: relative;
    max-width: 90vw;
    max-height: 90vh;
  }

  .full-img {
    max-width: 100%;
    max-height: 85vh;
    border-radius: 8px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.5);
  }

  .modal-close {
    position: absolute;
    top: -12px;
    right: -12px;
    background: #ef4444;
    color: white;
    border: none;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    font-weight: bold;
    cursor: pointer;
  }
</style>
