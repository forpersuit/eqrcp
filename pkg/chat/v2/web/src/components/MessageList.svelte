<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
  import { connState } from '../state/chatStore';
  import type { Message } from '../services/types';
  import { getThemeColors, getSenderThemeColors } from '../services/types';
  import { currentDevice, peers } from '../state/chatStore';

  const dispatch = createEventDispatcher();

  export let messages: Message[] = [];
  export let currentLang = 'zh';
  export let isMine: (msg: Message) => boolean;
  export let txState: Record<string, any> = {};
  export let isEmbedded = false;

  let recallConfirmingId: string | null = null;
  let confirmTimer: number | null = null;

  let tipCountdown = 5;
  let tipTimer: number | null = null;

  // Copy success indicator
  let copiedId: string | null = null;
  let copiedTimer: number | null = null;

  // Scroll to bottom logic
  let messagesEl: HTMLDivElement;
  let followLatest = true;
  let unreadSinceScroll = 0;
  let isNearBottomValue = true;
  let programmaticScroll = false;
  let programmaticScrollTimer: number | null = null;

  function handleCopy(messageId: string, text: string) {
    const doCopy = () => {
      copiedId = messageId;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => {
        copiedId = null;
      }, 2000);
      dispatch('systemNotice', currentLang === 'en' ? 'Text copied' : '文本已复制');
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        doCopy();
      }).catch(() => {
        if (fallbackCopyInternal(text)) {
          doCopy();
        } else {
          dispatch('systemNotice', currentLang === 'en' ? 'Copy failed' : '复制失败');
        }
      });
    } else {
      if (fallbackCopyInternal(text)) {
        doCopy();
      } else {
        dispatch('systemNotice', currentLang === 'en' ? 'Copy failed' : '复制失败');
      }
    }
  }

  function fallbackCopyInternal(text: string): boolean {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (e) {
      return false;
    }
  }

  function triggerRecall(messageId: string) {
    if (recallConfirmingId === messageId) {
      // Confirmed, trigger recall
      dispatch('recallMessage', messageId);
      clearConfirm();
    } else {
      // First click, show confirmation
      recallConfirmingId = messageId;
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = window.setTimeout(clearConfirm, 3000);
    }
  }

  function clearConfirm() {
    recallConfirmingId = null;
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  function handleFocusIn(e: FocusEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
      if (followLatest && messagesEl) {
        const scroll = () => {
          if (followLatest && messagesEl) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        };
        scroll();
        setTimeout(scroll, 50);
        setTimeout(scroll, 150);
        setTimeout(scroll, 300);
        setTimeout(scroll, 500);
      }
    }
  }

  function handleVisualViewportResize() {
    if (followLatest && messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function handleWindowResize() {
    if (followLatest && messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  onMount(() => {
    window.addEventListener('resize', handleWindowResize);
    document.addEventListener('focusin', handleFocusIn);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportResize);
    }
  });

  onDestroy(() => {
    window.removeEventListener('resize', handleWindowResize);
    document.removeEventListener('focusin', handleFocusIn);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', handleVisualViewportResize);
    }
    if (confirmTimer) clearTimeout(confirmTimer);
    if (copiedTimer) clearTimeout(copiedTimer);
    if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer);
    if (tipTimer) clearInterval(tipTimer);
  });

  function startTipCountdown() {
    tipCountdown = 5;
    if (tipTimer) clearInterval(tipTimer);
    tipTimer = window.setInterval(() => {
      tipCountdown -= 1;
      if (tipCountdown <= 0) {
        handleDismissTip();
      }
    }, 1000);
  }

  function handleDownload(messageId: string, filename: string, size: number, isPaid: boolean) {
    dispatch('startDownload', { messageId, filename, size, isPaid });
  }

  function handleCancel(txId: string) {
    dispatch('cancelDownload', txId);
  }

  function handleOpenFolder(msg: Message) {
    dispatch('openFolder', msg);
  }

  function formatBytes(bytes: number, decimals = 2) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Get dynamic identity from peers list if online, fallback to message properties
  function getSenderIdentity(msg: Message) {
    if (msg.senderId) {
      const found = $peers.find(p => p.peer === msg.senderId);
      if (found) {
        return {
          sender: found.label || msg.sender,
          avatar: found.avatar || msg.avatar || ''
        };
      }
    }
    return {
      sender: msg.sender,
      avatar: msg.avatar || ''
    };
  }

  function getMessageColors(msg: Message, mine: boolean) {
    if (mine && $currentDevice && $currentDevice.theme) {
      const colors = getThemeColors($currentDevice.theme);
      if (colors) return colors;
    }
    if (msg.theme) {
      const colors = getThemeColors(msg.theme);
      if (colors) return colors;
    }
    const identity = getSenderIdentity(msg);
    if (identity.sender) {
      return getSenderThemeColors(identity.sender);
    }
    return { bg: '#f1f5f9', border: '#cbd5e1', text: '#334155' };
  }

  // Scroll Helpers
  function isNearBottom(): boolean {
    if (!messagesEl) return true;
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  }

  function handleScroll() {
    if (!messagesEl) return;
    isNearBottomValue = isNearBottom();

    if (isNearBottomValue) {
      followLatest = true;
      unreadSinceScroll = 0;
    } else {
      if (!programmaticScroll) {
        followLatest = false;
      }
    }
  }

  function scrollToBottom() {
    if (!messagesEl) return;
    programmaticScroll = true;
    if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer);

    messagesEl.scrollTop = messagesEl.scrollHeight;
    isNearBottomValue = true;

    programmaticScrollTimer = window.setTimeout(() => {
      programmaticScroll = false;
      if (isNearBottom()) {
        followLatest = true;
        unreadSinceScroll = 0;
      }
    }, 200);
  }

  let prevMessageCount = 0;
  function handleNewMessages(currentMessages: Message[]) {
    if (prevMessageCount === 0) {
      prevMessageCount = currentMessages.length;
      setTimeout(scrollToBottom, 50);
      return;
    }

    if (currentMessages.length > prevMessageCount) {
      const addedCount = currentMessages.length - prevMessageCount;
      prevMessageCount = currentMessages.length;

      const lastMsg = currentMessages[currentMessages.length - 1];
      const sentByMe = isMine(lastMsg);

      if (sentByMe) {
        followLatest = true;
        unreadSinceScroll = 0;
        setTimeout(scrollToBottom, 50);
      } else {
        if (followLatest) {
          setTimeout(scrollToBottom, 50);
        } else {
          unreadSinceScroll += addedCount;
        }
      }
    } else {
      prevMessageCount = currentMessages.length;
    }
  }

  $: {
    if (messages && messages.length > 0) {
      handleNewMessages(messages);
    }
  }
  let completedMap: Record<string, boolean> = {};

  let showTipSystemMessage = false;

  $: {
    const hasBubbles = messages && messages.some(m => m.type !== 'system');
    if (hasBubbles) {
      if (typeof window !== 'undefined' && !window.localStorage.getItem('eqt_chat_bubble_tip_shown') && !showTipSystemMessage && !tipTimer) {
        showTipSystemMessage = true;
        startTipCountdown();
      }
    }
  }

  function handleDismissTip() {
    showTipSystemMessage = false;
    if (tipTimer) {
      clearInterval(tipTimer);
      tipTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('eqt_chat_bubble_tip_shown', 'true');
    }
  }

  // Context Menu State
  let showMenu = false;
  let activeMenuMessage: Message | null = null;
  let activeBubbleEl: HTMLElement | null = null;
  let activeMenuOptions: { label: string; action: () => void; danger?: boolean; confirmLabel?: string; disabled?: boolean }[] = [];
  
  let menuIsBelow = true;
  let arrowXPercent = 50;

  let confirmingIndex: number | null = null;
  let confirmTimeout: number | null = null;

  async function openMessageMenu(msg: Message, bubbleEl: HTMLElement) {
    if (msg.recalled) return; // 撤回消息不支持右键菜单/滑动
    activeMenuMessage = msg;
    activeBubbleEl = bubbleEl;
    confirmingIndex = null;
    if (confirmTimeout) clearTimeout(confirmTimeout);
    
    const mine = isMine(msg);
    const localPeer = $currentDevice?.peer || 'desktop';
    const dlTx = txState[msg.id] || Object.values(txState).find(t => t.messageId === msg.id && t.clientId === localPeer);
    const ulTx = txState['ul-' + msg.id];
    const isTxCompleted = (dlTx && dlTx.state === 'completed') || (mine && msg.downloaded) || completedMap[msg.id];
    const isDownloaded = isTxCompleted || (isEmbedded && !!msg.filePath);
    const tx = mine ? ulTx : (isTxCompleted ? null : dlTx);

    const options: any[] = [];

    // 1. Copy text
    if (msg.type === 'text') {
      options.push({
        label: currentLang === 'en' ? 'Copy' : '复制文本',
        action: () => {
          handleCopy(msg.id, msg.text || '');
          closeMenu();
        }
      });
    }

    // 2. File actions
    if (msg.type === 'file') {
      if (mine) {
        if (ulTx && ulTx.state === 'running') {
          options.push({
            label: currentLang === 'en' ? 'Cancel Upload' : '取消上传',
            danger: true,
            action: () => {
              handleCancel(ulTx.id);
              closeMenu();
            }
          });
        } else if (isEmbedded) {
          options.push({
            label: currentLang === 'en' ? 'Open in Folder' : '定位文件',
            action: () => {
              handleOpenFolder(msg);
              closeMenu();
            }
          });
        }
      } else {
        if (msg.uploading) {
          options.push({
            label: currentLang === 'en' ? 'Uploading...' : '对方上传中...',
            disabled: true,
            action: () => {}
          });
        } else if (isDownloaded) {
          options.push({
            label: isEmbedded ? (currentLang === 'en' ? 'Download' : '下载') : (currentLang === 'en' ? 'Downloaded (Redownload)' : '已下载 (重新下载)'),
            confirmLabel: isEmbedded ? undefined : (currentLang === 'en' ? 'Confirm Redownload' : '确认重新下载'),
            action: () => {
              handleDownload(msg.id, msg.fileName || '', msg.size || 0, false);
              closeMenu();
            }
          });
          if (isEmbedded && (msg.filePath || msg.fileName)) {
            options.push({
              label: currentLang === 'en' ? 'Open in Folder' : '定位文件',
              action: () => {
                handleOpenFolder(msg);
                closeMenu();
              }
            });
          }
        } else if (dlTx && dlTx.state === 'running') {
          options.push({
            label: currentLang === 'en' ? 'Cancel Download' : '取消下载',
            danger: true,
            action: () => {
              handleCancel(dlTx.id);
              closeMenu();
            }
          });
        } else if (dlTx && dlTx.state === 'failed') {
          options.push({
            label: currentLang === 'en' ? 'Retry Download' : '重试下载',
            action: () => {
              handleDownload(msg.id, msg.fileName || '', msg.size || 0, false);
              closeMenu();
            }
          });
        } else {
          options.push({
            label: currentLang === 'en' ? 'Download' : '下载文件',
            action: () => {
              handleDownload(msg.id, msg.fileName || '', msg.size || 0, false);
              closeMenu();
            }
          });
        }
      }
    }

    // 3. Recall
    if (mine) {
      if (!(msg.type === 'file' && ((tx && (tx.state === 'running' || tx.state === 'completed')) || msg.downloaded || msg.uploading))) {
        options.push({
          label: currentLang === 'en' ? 'Recall' : '撤回消息',
          confirmLabel: currentLang === 'en' ? 'Confirm Recall' : '确认撤回',
          danger: true,
          action: () => {
            dispatch('recallMessage', msg.id);
            closeMenu();
          }
        });
      }
    }

    if (options.length === 0) return;

    activeMenuOptions = options;
    showMenu = true;

    await tick();
    adjustMenuPosition();
  }

  function closeMenu() {
    showMenu = false;
    activeMenuMessage = null;
    activeBubbleEl = null;
    activeMenuOptions = [];
    confirmingIndex = null;
    if (confirmTimeout) {
      clearTimeout(confirmTimeout);
      confirmTimeout = null;
    }
  }

  function portal(node: HTMLElement) {
    if (typeof document === 'undefined') return;
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }

  function initResizeObserver(node: HTMLElement) {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      adjustMenuPosition();
    });
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
      }
    };
  }

  function adjustMenuPosition() {
    const menuEl = document.querySelector('.bubble-context-menu') as HTMLElement;
    if (!menuEl || !activeBubbleEl) return;
    
    // 使用 offsetWidth 和 offsetHeight，完全不受 CSS transform 缩放动画影响，测量绝对精准！
    const menuW = menuEl.offsetWidth;
    const menuH = menuEl.offsetHeight;
    const bubbleRect = activeBubbleEl.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    // 默认展示在下方
    let top = bubbleRect.bottom + 8;
    menuIsBelow = true;

    // 判断如果下方空间不够且上方空间足够，则显示在上方
    if (top + menuH > winH && bubbleRect.top - menuH - 8 > 0) {
      top = bubbleRect.top - menuH - 8;
      menuIsBelow = false;
    }

    // 水平居中对齐
    let left = bubbleRect.left + bubbleRect.width / 2 - menuW / 2;

    // 溢出屏幕左/右侧保护
    if (left + menuW > winW - 12) {
      left = winW - menuW - 12;
    }
    if (left < 12) {
      left = 12;
    }

    // 计算气泡中心点在菜单上的相对 X 坐标百分比（供小箭头对齐气泡中心）
    const bubbleCenterX = bubbleRect.left + bubbleRect.width / 2;
    const relativeX = bubbleCenterX - left;
    arrowXPercent = Math.max(10, Math.min(90, (relativeX / menuW) * 100));

    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  // 全局失焦关闭菜单
  function handleGlobalPointerDown(e: PointerEvent) {
    if (!showMenu) return;
    const target = e.target as HTMLElement;
    const menuEl = document.querySelector('.bubble-context-menu');
    if (menuEl && menuEl.contains(target)) return;
    if (target.closest('.bubble')) return; // 让气泡自带的处理器去处理切换
    closeMenu();
  }

  $: {
    if (showMenu) {
      if (typeof window !== 'undefined') {
        window.addEventListener('pointerdown', handleGlobalPointerDown, true);
      }
    } else {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
      }
    }
  }

  function swipeable(node: HTMLElement, msg: Message) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let isScrolling = false;
    let isSliding = false;
    let longPressTimer: number | null = null;
    let hasTriggeredLongPress = false;
    
    function handleTouchStart(e: TouchEvent) {
      if (msg.recalled) return;
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isScrolling = false;
      isSliding = false;
      hasTriggeredLongPress = false;
      
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = window.setTimeout(() => {
        hasTriggeredLongPress = true;
        openMessageMenu(msg, node);
        if (window.navigator && window.navigator.vibrate) {
          try { window.navigator.vibrate(50); } catch(ex) {}
        }
      }, 600);
    }
    
    function handleTouchMove(e: TouchEvent) {
      if (msg.recalled || e.touches.length !== 1 || hasTriggeredLongPress) return;
      currentX = e.touches[0].clientX;
      currentY = e.touches[0].clientY;
      
      const dx = currentX - startX;
      const dy = currentY - startY;
      
      if (!isScrolling && !isSliding) {
        if (Math.abs(dx) > Math.abs(dy) * 1.5) {
          isSliding = true;
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        } else if (Math.abs(dy) > Math.abs(dx) * 1.5) {
          isScrolling = true;
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        }
      }
      
      if (isSliding) {
        const mine = isMine(msg);
        const canSlide = (mine && dx < 0) || (!mine && dx > 0);
        if (canSlide) {
          if (e.cancelable) e.preventDefault();
          let offset = dx * 0.4;
          if (mine && offset < -80) offset = -80;
          if (!mine && offset > 80) offset = 80;
          
          node.style.transition = 'none';
          node.style.transform = `translateX(${offset}px)`;
        }
      }
    }
    
    function handleTouchEnd() {
      if (msg.recalled) return;
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      if (hasTriggeredLongPress) return;
      
      if (isSliding) {
        const dx = currentX - startX;
        const mine = isMine(msg);
        const canSlide = (mine && dx < 0) || (!mine && dx > 0);
        const absOffset = Math.abs(dx * 0.4);
        
        node.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        node.style.transform = '';
        
        if (canSlide && absOffset >= 35) {
          setTimeout(() => {
            openMessageMenu(msg, node);
          }, 50);
        }
      }
    }
    
    function handleTouchCancel() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      node.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      node.style.transform = '';
    }

    node.addEventListener('touchstart', handleTouchStart, { passive: true });
    node.addEventListener('touchmove', handleTouchMove, { passive: false });
    node.addEventListener('touchend', handleTouchEnd);
    node.addEventListener('touchcancel', handleTouchCancel);
    
    return {
      update(newMsg: Message) {
        msg = newMsg;
      },
      destroy() {
        node.removeEventListener('touchstart', handleTouchStart);
        node.removeEventListener('touchmove', handleTouchMove);
        node.removeEventListener('touchend', handleTouchEnd);
        node.removeEventListener('touchcancel', handleTouchCancel);
        if (longPressTimer) clearTimeout(longPressTimer);
      }
    };
  }
</script>

<div class="message-list-container" style="position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column;">
  <div bind:this={messagesEl} class="messages" on:scroll={handleScroll}>
    {#if showTipSystemMessage}
      <div class="system-message tip-message" style="margin-bottom: 12px; display: flex; justify-content: center; width: 100%;">
        <span class="system-text" style="
          background: var(--accent-wash, rgba(21, 111, 90, 0.08)); 
          border: 1px solid var(--accent, #156f5a)33; 
          color: var(--accent-strong, #156f5a);
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px 8px 14px;
          border-radius: 999px;
          font-size: 12px;
          line-height: 1.4;
          box-shadow: 0 1px 2px rgba(0,0,0,0.02);
        ">
          <div class="countdown-circle-container" style="
            position: relative; 
            width: 14px; 
            height: 14px; 
            flex-shrink: 0; 
            display: flex; 
            align-items: center; 
            justify-content: center;
          ">
            <svg width="14" height="14" viewBox="0 0 20 20" style="transform: rotate(-90deg); width: 100%; height: 100%;">
              <circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--accent-strong, #156f5a)" stroke-width="2" style="opacity: 0.2;" />
              <circle 
                cx="10" 
                cy="10" 
                r="8.5" 
                fill="none" 
                stroke="var(--accent-strong, #156f5a)" 
                stroke-width="2" 
                stroke-dasharray="53.4" 
                stroke-dashoffset={53.4 * (1 - tipCountdown / 5)} 
                style="transition: stroke-dashoffset 1s linear;" 
              />
            </svg>
            <span style="
              position: absolute; 
              font-size: 8px; 
              font-weight: bold; 
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              line-height: 1;
              color: var(--accent-strong, #156f5a);
            ">{tipCountdown}</span>
          </div>
          <span>{currentLang === 'en' ? 'Tip: Swipe left/right on bubble (mobile) or right-click (desktop) to open context menu.' : '提示：移动端向左/右滑动气泡，或在桌面端右键点击气泡，可唤起操作菜单。'}</span>
          <button 
            type="button" 
            on:click={handleDismissTip} 
            style="
              background: transparent; 
              border: none; 
              color: var(--accent-strong, #156f5a); 
              cursor: pointer; 
              font-weight: bold; 
              margin-left: 6px; 
              padding: 0 4px;
              font-size: 14px;
              line-height: 1;
              opacity: 0.7;
            "
            on:mouseenter={(e) => e.currentTarget.style.opacity = '1'}
            on:mouseleave={(e) => e.currentTarget.style.opacity = '0.7'}
            title="Dismiss"
          >×</button>
        </span>
      </div>
    {/if}
    {#each messages.filter(m => !(m.type === 'file' && !isMine(m) && !isEmbedded && (m.uploading || !m.downloaded))) as msg (msg.id)}
      {#if msg.type === 'system'}
        {@const colors = msg.theme ? getThemeColors(msg.theme) : null}
        {@const myLabel = $currentDevice?.label}
        {@const displayText = myLabel && msg.text.includes(myLabel) ? msg.text.replaceAll(myLabel, `我(${myLabel})`) : msg.text}
        <div class="system-message">
          {#if colors}
            <span class="system-text" style="background: {colors.bg}; border-color: {colors.border}; color: {colors.text};">{displayText}</span>
          {:else}
            <span class="system-text">{displayText}</span>
          {/if}
        </div>
      {:else}
        {@const mine = isMine(msg)}
        {@const localPeer = $currentDevice?.peer || 'desktop'}
        {@const dlTx = txState[msg.id] || Object.values(txState).find(t => t.messageId === msg.id && t.clientId === localPeer)}
        {@const ulTx = txState['ul-' + msg.id]}
        {@const isTxCompleted = (dlTx && dlTx.state === 'completed') || (mine && msg.downloaded) || completedMap[msg.id]}
        {@const _dummy = isTxCompleted ? (completedMap[msg.id] = true) : null}
        {@const isDownloaded = isTxCompleted || (isEmbedded && !!msg.filePath)}
        {@const tx = mine ? ulTx : (isTxCompleted ? null : dlTx)}
        {@const colors = getMessageColors(msg, mine)}
        {@const identity = getSenderIdentity(msg)}
        {@const isCancelledFile = msg.type === 'file' && ((ulTx && ulTx.state === 'cancelled') || (dlTx && dlTx.state === 'cancelled'))}
        <div 
          class="message" 
          class:mine 
          class:recalled={msg.recalled || isCancelledFile}
          style="
            --accent: {colors.border};
            --accent-strong: {colors.text};
            --accent-wash: {colors.bg};
            --line: {colors.border}44;
          "
        >
          <div class="avatar-stack">
            <div class="message-avatar">
              {#if identity.avatar && identity.avatar.startsWith('data:image/')}
                <img src={identity.avatar} alt={identity.sender} style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%; display: block;" />
              {:else if identity.avatar}
                {identity.avatar}
              {:else}
                {identity.sender ? identity.sender.slice(0, 2).toUpperCase() : 'DE'}
              {/if}
            </div>
            <div class="bubble-time">
              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          </div>

          <div class="message-main">
            <div class="sender">{identity.sender}</div>
            <div 
              class="bubble" 
              use:swipeable={msg}
              on:contextmenu|preventDefault={(e) => openMessageMenu(msg, e.currentTarget)}
              style="position: relative; overflow: hidden; transform: translateX(0px); transition: transform 0.25s ease;"
            >
              {#if msg.type === 'file' && (mine || isEmbedded) && !isCancelledFile && !msg.recalled && (msg.uploading || (ulTx && ulTx.state === 'running'))}
                <div class="upload-mask" style="
                  position: absolute;
                  top: 0;
                  left: 0;
                  right: 0;
                  bottom: 0;
                  background: var(--accent-wash);
                  opacity: 0.96;
                  backdrop-filter: blur(1.5px);
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  z-index: 10;
                  padding: 8px 12px;
                  box-sizing: border-box;
                  text-align: center;
                ">
                  <span style="font-size: 13px; font-weight: 600; color: var(--accent-strong); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                    <svg class="icon-uploading-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="16 16" fill="none" />
                    </svg>
                    {#if ulTx && ulTx.state === 'running'}
                      {currentLang === 'en' ? 'Uploading' : '正在上传'} {ulTx.percent ?? 0}%
                    {:else}
                      {currentLang === 'en' ? 'Preparing' : '准备中'}...
                    {/if}
                  </span>
                  <div style="width: 80%; height: 5px; background: rgba(0, 0, 0, 0.08); border-radius: 3.5px; overflow: hidden; margin-top: 2px;">
                    <div style="width: {ulTx?.percent ?? 0}%; height: 100%; background: var(--accent-strong); transition: width 0.15s ease-out; border-radius: 3.5px;"></div>
                  </div>
                </div>
              {/if}
              {#if msg.recalled}
                <span class="text recalled">{mine ? (currentLang === 'en' ? 'You recalled a message' : '你撤回了一条消息') : (identity.sender + ' ' + (currentLang === 'en' ? 'recalled a message' : '撤回了一条消息'))}</span>
                {#if mine}
                  <div class="recalled-actions" style="margin-top: 6px; display: flex; gap: 8px; justify-content: flex-end;">
                    {#if msg.type === 'text'}
                      <button 
                        class="edit-recalled" 
                        type="button" 
                        on:click={() => dispatch('editAgain', msg.text || '')}
                        style="
                          background: var(--accent-wash, rgba(21, 111, 90, 0.06));
                          border: 1px solid var(--accent, #156f5a);
                          border-radius: 999px;
                          color: var(--accent-strong, #156f5a);
                          cursor: pointer;
                          font-size: 11px;
                          font-weight: 600;
                          padding: 3px 8px;
                        "
                      >
                        {currentLang === 'en' ? 'Edit again' : '重新编辑'}
                      </button>
                    {:else if msg.type === 'file'}
                      <button 
                        class="edit-recalled" 
                        type="button" 
                        on:click={() => dispatch('resendFile', { name: msg.fileName, size: msg.size })}
                        style="
                          background: var(--accent-wash, rgba(21, 111, 90, 0.06));
                          border: 1px solid var(--accent, #156f5a);
                          border-radius: 999px;
                          color: var(--accent-strong, #156f5a);
                          cursor: pointer;
                          font-size: 11px;
                          font-weight: 600;
                          padding: 3px 8px;
                        "
                      >
                        {currentLang === 'en' ? 'Resend' : '重新发送'}
                      </button>
                    {/if}
                  </div>
                {/if}
              {:else if isCancelledFile}
                <span class="text recalled" style="font-style: italic; opacity: 0.85;">
                  {mine 
                    ? (currentLang === 'en' ? 'You cancelled sending the file' : '你取消了文件发送') 
                    : (identity.sender + ' ' + (currentLang === 'en' ? 'cancelled the file transfer' : '对方取消了文件发送'))}
                </span>
                {#if mine}
                  <div class="recalled-actions" style="margin-top: 6px; display: flex; gap: 8px; justify-content: flex-end;">
                    <button 
                      class="edit-recalled" 
                      type="button" 
                      on:click={() => dispatch('resendFile', { name: msg.fileName, size: msg.size })}
                      style="
                        background: var(--accent-wash, rgba(21, 111, 90, 0.06));
                        border: 1px solid var(--accent, #156f5a);
                        border-radius: 999px;
                        color: var(--accent-strong, #156f5a);
                        cursor: pointer;
                        font-size: 11px;
                        font-weight: 600;
                        padding: 3px 8px;
                      "
                    >
                      {currentLang === 'en' ? 'Resend' : '重新发送'}
                    </button>
                  </div>
                {/if}
              {:else}
                {#if msg.type === 'text'}
                  <span class="text">{msg.text}</span>
                {:else if msg.type === 'file'}
                  <div class="bubble-content">
                    <div class="attachment-card file-attachment">
                      <div class="file-card">
                        <div class="file-icon">FILE</div>
                        <div class="file-details">
                          <div class="file-name" title={msg.fileName}>{msg.fileName}</div>
                          <div class="file-subtitle">
                            {formatBytes(msg.size || 0)}
                            {#if tx}
                              {#if tx.state === 'running'}
                                · {currentLang === 'en' ? 'Transferring' : '传输中'} {tx.percent ?? 0}%
                              {:else if tx.state === 'completed'}
                                · {mine ? (currentLang === 'en' ? 'Shared' : '已分享') : (currentLang === 'en' ? 'Downloaded' : '已下载')}
                              {:else if tx.state === 'failed'}
                                · <span class="tx-error-text" title={tx.error || (currentLang === 'en' ? 'Unknown error' : '未知传输错误')} style="color: #ef4444; cursor: help; text-decoration: underline dotted;">{currentLang === 'en' ? 'Failed' : '传输失败'} ⚠️</span>
                              {:else if tx.state === 'cancelled'}
                                · <span style="color: var(--muted, #64748b);">{currentLang === 'en' ? 'Cancelled' : '已取消'}</span>
                              {/if}
                            {:else}
                              {#if mine && msg.downloaded}
                                · {currentLang === 'en' ? 'Shared' : '已分享'}
                              {:else if !mine && isDownloaded}
                                · {currentLang === 'en' ? 'Downloaded' : '已下载'}
                              {/if}
                            {/if}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        </div>
      {/if}
    {:else}
      <div class="messages-empty">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-3.658A8.967 8.967 0 013 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>
        <strong>开始聊天吧！</strong>
        <span>向其他已连接设备发送文本或局限大文件。</span>
      </div>
    {/each}
  </div>

  <button class="scroll-arrow" class:visible={!followLatest && !isNearBottomValue} on:click={scrollToBottom} aria-label="Jump to latest message" title="Latest message">
    <svg viewBox="0 0 24 24">
      <polyline points="6 9 12 15 18 9" />
    </svg>
    {#if unreadSinceScroll > 0}
      <span class="scroll-arrow-badge">
        {unreadSinceScroll > 99 ? '99+' : unreadSinceScroll}
      </span>
    {/if}
  </button>
</div>

{#if showMenu}
  <div 
    class="bubble-context-menu" 
    class:above={!menuIsBelow}
    style="display: block; --arrow-x: {arrowXPercent}%;"
    use:portal
    use:initResizeObserver
  >
    {#each activeMenuOptions as option, index}
      {#if !option.disabled}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div 
          class="menu-item" 
          class:danger={option.danger}
          class:confirming={confirmingIndex === index}
          on:click={() => {
            if (option.confirmLabel) {
              if (confirmingIndex !== index) {
                confirmingIndex = index;
                if (confirmTimeout) clearTimeout(confirmTimeout);
                confirmTimeout = window.setTimeout(() => {
                  confirmingIndex = null;
                }, 3000);
              } else {
                option.action();
              }
            } else {
              option.action();
            }
          }}
        >
          {confirmingIndex === index ? option.confirmLabel : option.label}
        </div>
      {:else}
        <div class="menu-item disabled">
          {option.label}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  /* Rely on global app.css V1 classes */
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  :global(.icon-uploading-spin) {
    animation: spin 1.5s linear infinite;
  }

  .bubble-context-menu {
    position: fixed;
    z-index: 10000;
    width: max-content;
    max-width: 280px;
    min-width: 150px;
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(21, 111, 90, 0.15);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.02);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    animation: menu-fade-in 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .bubble-context-menu::after {
    content: '';
    position: absolute;
    width: 0;
    height: 0;
    border-style: solid;
    z-index: 10001;
    border-width: 0 6px 6px 6px;
    border-color: transparent transparent rgba(255, 255, 255, 0.85) transparent;
    top: -6px;
    left: var(--arrow-x, 50%);
    transform: translateX(-50%);
  }

  :global(.dark) .bubble-context-menu::after {
    border-color: transparent transparent rgba(15, 23, 42, 0.85) transparent;
  }

  .bubble-context-menu.above::after {
    border-width: 6px 6px 0 6px;
    border-color: rgba(255, 255, 255, 0.85) transparent transparent transparent;
    top: auto;
    bottom: -6px;
  }

  :global(.dark) .bubble-context-menu.above::after {
    border-color: rgba(15, 23, 42, 0.85) transparent transparent transparent;
  }

  @keyframes menu-fade-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .menu-item {
    font-size: 14px;
    font-weight: 500;
    color: #334155;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    user-select: none;
    transition: background 0.12s ease, color 0.12s ease;
    white-space: nowrap;
    text-align: left;
  }

  .menu-item:hover {
    background: rgba(21, 111, 90, 0.08);
    color: #156f5a;
  }

  .menu-item.danger {
    color: #ef4444;
  }

  .menu-item.danger:hover {
    background: #fef2f2;
    color: #dc2626;
  }

  .menu-item.confirming {
    background: #ef4444;
    color: #ffffff;
    font-weight: bold;
    animation: pulse-red 1.5s infinite;
  }

  @keyframes pulse-red {
    0% { opacity: 1; }
    50% { opacity: 0.85; }
    100% { opacity: 1; }
  }

  .menu-item.disabled {
    color: #94a3b8;
    cursor: not-allowed;
    background: transparent;
  }
  
  :global(.dark) .bubble-context-menu {
    background: rgba(15, 23, 42, 0.85);
    border-color: rgba(255, 255, 255, 0.1);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  }
  
  :global(.dark) .menu-item {
    color: #cbd5e1;
  }
  
  :global(.dark) .menu-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #34d399;
  }
  
  :global(.dark) .menu-item.danger:hover {
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
  }
</style>
