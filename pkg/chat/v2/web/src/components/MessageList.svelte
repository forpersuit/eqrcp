<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount, beforeUpdate, afterUpdate, tick } from 'svelte';
  import { getTranslation } from '../lib/i18n';
  import { connState, historyHasMore, historyLoading } from '../state/chatStore';
  import type { Message } from '../services/types';
  import { getThemeColors, getSenderThemeColors } from '../services/types';
  import { currentDevice, peers, chatSessionStatus } from '../state/chatStore';
  import { isImageFile, getImageInlineUrl } from '../services/mediaPreview';

  const dispatch = createEventDispatcher();

  export let messages: Message[] = [];
  export let currentLang = 'zh';
  export let isMine: (msg: Message) => boolean;
  export let txState: Record<string, any> = {};
  export let isEmbedded = false;
  export let token = '';

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

  // Preserve viewport when older history is prepended
  let prevFirstId = '';
  let pendingScrollAdjust = false;
  let prevScrollHeight = 0;
  let prevScrollTop = 0;

  // Dynamic spacer to push scrollable area for context menu if near bottom
  let menuSpacerHeight = 0;

  // Multi-select batch download
  let selectionMode = false;
  let selectedIds = new Set<string>();

  function canMultiSelect(msg: Message): boolean {
    return (msg.type === 'file' || msg.type === 'image') && !isMine(msg) && !msg.uploading && !msg.recalled && !!msg.fileName;
  }
  function isSelected(msg: Message): boolean {
    return selectedIds.has(msg.id);
  }
  function enterSelectionMode(msg?: Message) {
    selectionMode = true;
    selectedIds = new Set(msg ? [msg.id] : []);
  }
  function exitSelectionMode() {
    selectionMode = false;
    selectedIds.clear();
  }
  function toggleSelect(msg: Message) {
    if (!canMultiSelect(msg)) return;
    const next = new Set(selectedIds);
    if (next.has(msg.id)) {
      next.delete(msg.id);
    } else {
      next.add(msg.id);
    }
    selectedIds = next;
  }
  function triggerBatchDownload() {
    if (selectedIds.size === 0) return;
    const selected = messages.filter(m => selectedIds.has(m.id) && canMultiSelect(m));
    if (selected.length === 0) return;
    dispatch('batchDownload', { messages: selected });
    exitSelectionMode();
  }

  beforeUpdate(() => {
    if (!messagesEl || messages.length === 0) return;
    const firstId = messages[0]?.id || '';
    if (prevFirstId && firstId && firstId !== prevFirstId) {
      pendingScrollAdjust = true;
      prevScrollHeight = messagesEl.scrollHeight;
      prevScrollTop = messagesEl.scrollTop;
    }
  });

  afterUpdate(() => {
    if (pendingScrollAdjust && messagesEl) {
      const delta = messagesEl.scrollHeight - prevScrollHeight;
      messagesEl.scrollTop = prevScrollTop + delta;
      pendingScrollAdjust = false;
      programmaticScroll = true;
      if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer);
      programmaticScrollTimer = window.setTimeout(() => {
        programmaticScroll = false;
      }, 80);
    }
    if (messages.length > 0) {
      prevFirstId = messages[0]?.id || '';
    }
  });

  function handleCopy(messageId: string, text: string) {
    const doCopy = () => {
      copiedId = messageId;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => {
        copiedId = null;
      }, 2000);
      dispatch('systemNotice', getTranslation('textCopied', currentLang));
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        doCopy();
      }).catch(() => {
        if (fallbackCopyInternal(text)) {
          doCopy();
        } else {
          dispatch('systemNotice', getTranslation('copyFailed', currentLang));
        }
      });
    } else {
      if (fallbackCopyInternal(text)) {
        doCopy();
      } else {
        dispatch('systemNotice', getTranslation('copyFailed', currentLang));
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
    if ($chatSessionStatus !== 'active') return;
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

    // Near top: request older history page (server-side pagination).
    if (
      !programmaticScroll &&
      messagesEl.scrollTop < 80 &&
      $historyHasMore &&
      !$historyLoading
    ) {
      dispatch('loadOlderHistory');
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
  
  let menuLeft = 0;
  let menuTop = 0;
  let menuWidth = 0;
  let menuPlacement: 'left' | 'right' | 'top' | 'bottom' = 'bottom';
  let arrowXPx = 0;
  let arrowYPx = 0;
  let lastClickPoint: { x: number; y: number } | null = null;

  let confirmingIndex: number | null = null;
  let confirmTimeout: number | null = null;

  async function openMessageMenu(msg: Message, bubbleEl: HTMLElement, clickPoint?: { clientX: number; clientY: number }) {
    if (msg.recalled) return; // 撤回消息不支持右键菜单/滑动
    if (selectionMode) return; // 选择模式下不弹右键菜单
    activeMenuMessage = msg;
    activeBubbleEl = bubbleEl;
    if (clickPoint) {
      lastClickPoint = { x: clickPoint.clientX, y: clickPoint.clientY };
    } else {
      const rect = bubbleEl.getBoundingClientRect();
      lastClickPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    confirmingIndex = null;
    if (confirmTimeout) clearTimeout(confirmTimeout);
    
    const mine = isMine(msg);
    const localPeer = $currentDevice?.peer || 'desktop';
    const dlTx = txState['dl-' + msg.id + '-' + localPeer] || txState[msg.id] || Object.values(txState).find(t => t.messageId === msg.id && (t.clientId === localPeer || (!mine && t.id.startsWith('dl-'))));
    const ulTx = txState['ul-' + msg.id];
    const isTxCompleted = (dlTx && dlTx.state === 'completed') || msg.downloaded || completedMap[msg.id];
    const isDownloaded = isTxCompleted || (isEmbedded && !!msg.filePath);
    const tx = mine ? ulTx : (isTxCompleted ? null : dlTx);

    const options: any[] = [];

    // 1. Copy text
    if (msg.type === 'text') {
      options.push({
        label: getTranslation('copyText', currentLang),
        action: () => {
          handleCopy(msg.id, msg.text || '');
          closeMenu();
        }
      });
    }

    // 2. File actions
    if (msg.type === 'file') {
      if (isImageFile(msg) && token && !msg.uploading && (!ulTx || ulTx.state !== 'running')) {
        options.push({
          label: getTranslation('viewOriginal', currentLang),
          action: () => {
            window.open(getImageInlineUrl(token, msg.id), '_blank', 'noopener,noreferrer');
            closeMenu();
          }
        });
      }
      if (mine) {
        if (ulTx && ulTx.state === 'running') {
          options.push({
            label: getTranslation('cancelUpload', currentLang),
            danger: true,
            action: () => {
              handleCancel(ulTx.id);
              closeMenu();
            }
          });
        } else if (isEmbedded) {
          options.push({
            label: getTranslation('openInFolder', currentLang),
            action: () => {
              handleOpenFolder(msg);
              closeMenu();
            }
          });
        }
      } else {
        if (canMultiSelect(msg)) {
          options.push({
            label: getTranslation('multiSelect', currentLang),
            action: () => {
              enterSelectionMode(msg);
              closeMenu();
            }
          });
        }
        if (msg.uploading) {
          options.push({
            label: getTranslation('peerUploading', currentLang),
            disabled: true,
            action: () => {}
          });
        } else if (isDownloaded) {
          options.push({
            label: isEmbedded ? getTranslation('download', currentLang) : getTranslation('redownload', currentLang),
            confirmLabel: isEmbedded ? undefined : getTranslation('confirmRedownload', currentLang),
            disabled: $chatSessionStatus !== 'active',
            action: () => {
              handleDownload(msg.id, msg.fileName || '', msg.size || 0, false);
              closeMenu();
            }
          });
          if (isEmbedded && (msg.filePath || msg.fileName)) {
            options.push({
              label: getTranslation('openInFolder', currentLang),
              action: () => {
                handleOpenFolder(msg);
                closeMenu();
              }
            });
          }
        } else if (dlTx && dlTx.state === 'running') {
          options.push({
            label: getTranslation('cancelDownload', currentLang),
            danger: true,
            action: () => {
              handleCancel(dlTx.id);
              closeMenu();
            }
          });
        } else if (dlTx && dlTx.state === 'failed') {
          options.push({
            label: getTranslation('retryDownload', currentLang),
            disabled: $chatSessionStatus !== 'active',
            action: () => {
              handleDownload(msg.id, msg.fileName || '', msg.size || 0, false);
              closeMenu();
            }
          });
        } else {
          options.push({
            label: getTranslation('downloadFile', currentLang),
            disabled: $chatSessionStatus !== 'active',
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
          label: getTranslation('recallMessage', currentLang),
          confirmLabel: getTranslation('confirmRecall', currentLang),
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
    lastClickPoint = null;
    activeMenuOptions = [];
    confirmingIndex = null;
    menuSpacerHeight = 0;
    menuLeft = 0;
    menuTop = 0;
    menuWidth = 0;
    if (confirmTimeout) {
      clearTimeout(confirmTimeout);
      confirmTimeout = null;
    }
  }

  function handleImagePreviewClick(e: MouseEvent, msg: Message) {
    if (selectionMode) {
      e.preventDefault();
      e.stopPropagation();
      if (canMultiSelect(msg)) {
        toggleSelect(msg);
      }
      return;
    }
    e.stopPropagation();
    if (token && msg.id) {
      window.open(getImageInlineUrl(token, msg.id), '_blank', 'noopener,noreferrer');
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

  // 缓存 canvas 实例以提高性能
  let canvasInstance: HTMLCanvasElement | null = null;
  function getTextWidth(text: string, font: string): number {
    if (!canvasInstance) {
      canvasInstance = document.createElement('canvas');
    }
    const context = canvasInstance.getContext('2d');
    if (context) {
      context.font = font;
      return context.measureText(text).width;
    }
    return 0;
  }

  function getElementFont(el: HTMLElement): string {
    const style = window.getComputedStyle(el);
    const fontWeight = style.fontWeight || '500';
    const fontSize = style.fontSize || '14px';
    const fontFamily = style.fontFamily || 'sans-serif';
    const fontStyle = style.fontStyle || 'normal';
    return `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
  }

  async function adjustMenuPosition(isRetry = false) {
    const menuEl = document.querySelector('.bubble-context-menu') as HTMLElement;
    if (!menuEl || !activeBubbleEl || !activeMenuMessage) return;
    
    // 1. 动态测量子项文本的最大实际宽度
    let maxTextW = 0;
    const items = menuEl.querySelectorAll('.menu-item');
    items.forEach(item => {
      const text = item.textContent?.trim() || '';
      const font = getElementFont(item as HTMLElement);
      const textW = getTextWidth(text, font);
      if (textW > maxTextW) {
        maxTextW = textW;
      }
    });

    // 2. 动态计算菜单宽度 (基于最长文字宽度 + 32px menu-item padding + 8px menu container padding + 2px border)
    const targetW = Math.max(100, Math.min(280, maxTextW + 42));
    menuWidth = targetW;
    menuEl.style.width = `${targetW}px`;

    const menuW = menuEl.offsetWidth || targetW;
    const menuH = menuEl.offsetHeight || (items.length * 36 + 8);

    const winW = window.innerWidth;
    const winH = window.innerHeight;

    // 3. 计算聊天历史视口 (messagesEl) 与底部 Input 输入框 (composer) 的准确边界
    const messagesRect = messagesEl ? messagesEl.getBoundingClientRect() : { top: 0, bottom: winH, left: 0, right: winW, width: winW, height: winH };
    const composerEl = document.querySelector('.composer-container, .composer, .message-composer') as HTMLElement;
    const composerTop = composerEl ? composerEl.getBoundingClientRect().top : messagesRect.bottom;

    const vMinTop = Math.max(8, messagesRect.top + 8);
    const vMaxBottom = Math.min(winH - 8, composerTop - 8);
    const vMinLeft = Math.max(8, messagesRect.left + 8);
    const vMaxRight = Math.min(winW - 8, messagesRect.right - 8);

    const bubbleRect = activeBubbleEl.getBoundingClientRect();
    const mine = isMine(activeMenuMessage);

    // 获取并规范化点击坐标（保证在气泡内或附近）
    let clickX = lastClickPoint ? lastClickPoint.x : (bubbleRect.left + bubbleRect.width / 2);
    let clickY = lastClickPoint ? lastClickPoint.y : (bubbleRect.top + bubbleRect.height / 2);

    clickX = Math.max(bubbleRect.left, Math.min(bubbleRect.right, clickX));
    clickY = Math.max(bubbleRect.top, Math.min(bubbleRect.bottom, clickY));

    // 4. 始终保持左右方向：发送方在左侧(placement-left)，接收方在右侧(placement-right)
    // 菜单箭头始终位于菜单的左右两侧，垂直精准对齐滑动的坐标 clickY
    const placement: 'left' | 'right' = mine ? 'left' : 'right';
    menuPlacement = placement;

    let left = 0;
    let top = 0;

    if (placement === 'left') {
      // 发送方：向左展开，空间足够放外侧，移动端窄屏/气泡占宽时显示在气泡内左侧 (带有视口左安全距离)
      const idealOuterLeft = bubbleRect.left - 8 - menuW;
      if (idealOuterLeft >= vMinLeft) {
        left = idealOuterLeft;
      } else {
        left = Math.max(vMinLeft, Math.min(bubbleRect.right - menuW - 12, bubbleRect.left + 12));
      }
    } else {
      // 接收方：向右展开，空间足够放外侧，移动端窄屏/气泡占宽时显示在气泡内右侧 (带有视口右安全距离)
      const idealOuterLeft = bubbleRect.right + 8;
      if (idealOuterLeft + menuW <= vMaxRight) {
        left = idealOuterLeft;
      } else {
        left = Math.min(vMaxRight - menuW, Math.max(bubbleRect.left + 12, bubbleRect.right - menuW - 12));
      }
    }

    // 垂直方向以点击/滑动处居中，并限制在视口安全范围内防遮挡
    const idealTop = clickY - menuH / 2;
    top = Math.max(vMinTop, Math.min(vMaxBottom - menuH, idealTop));

    // 箭头垂直对齐滑动/点击处（精准指向滑动的垂直高度，带有圆角保护）
    const rawArrowY = clickY - top;
    arrowYPx = Math.max(14, Math.min(menuH - 14, rawArrowY));

    menuLeft = left;
    menuTop = top;
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  // 全局失焦关闭菜单（点击任何非菜单区域立即关闭）
  function handleGlobalPointerDown(e: PointerEvent) {
    if (!showMenu) return;
    const target = e.target as HTMLElement;
    const menuEl = document.querySelector('.bubble-context-menu');
    if (menuEl && menuEl.contains(target)) return;
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
    
    function handleTouchStart(e: TouchEvent) {
      if (msg.recalled) return;
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentX = startX;
      currentY = startY;
      isScrolling = false;
      isSliding = false;
    }
    
    function handleTouchMove(e: TouchEvent) {
      if (msg.recalled || e.touches.length !== 1) return;
      currentX = e.touches[0].clientX;
      currentY = e.touches[0].clientY;
      
      const dx = currentX - startX;
      const dy = currentY - startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      
      if (!isScrolling && !isSliding) {
        if (absDx > 6 || absDy > 6) {
          if (absDx > absDy * 1.2) {
            isSliding = true;
          } else {
            isScrolling = true;
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
      
      if (isSliding) {
        const dx = currentX - startX;
        const mine = isMine(msg);
        const canSlide = (mine && dx < 0) || (!mine && dx > 0);
        const absOffset = Math.abs(dx * 0.4);
        
        node.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
        node.style.transform = '';
        
        if (canSlide && absOffset >= 20) {
          setTimeout(() => {
            openMessageMenu(msg, node, { clientX: currentX, clientY: currentY });
          }, 50);
        }
      }
      isSliding = false;
      isScrolling = false;
    }
    
    function handleTouchCancel() {
      node.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      node.style.transform = '';
      isSliding = false;
      isScrolling = false;
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
      }
    };
  }
</script>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && selectionMode) exitSelectionMode(); }} />

<div class="message-list-container" style="position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column;">
  <div bind:this={messagesEl} class="messages" on:scroll={handleScroll}>
    {#if $historyHasMore || $historyLoading}
      <div class="history-pager" role="status">
        {#if $historyLoading}
          {getTranslation('loadingHistory', currentLang)}
        {:else}
          {getTranslation('loadEarlierMessages', currentLang)}
        {/if}
      </div>
    {/if}
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
              font-family: var(--font-mono);
              line-height: 1;
              color: var(--accent-strong, #156f5a);
            ">{tipCountdown}</span>
          </div>
          <span>{getTranslation('desktopTip', currentLang)}</span>
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
    {#each messages as msg (msg.id)}
      {#if msg.type === 'system'}
        {@const colors = msg.theme ? getThemeColors(msg.theme) : null}
        {@const localPeer = $currentDevice?.peer || 'desktop'}
        {@const isMe = msg.senderId && msg.senderId === localPeer}
        {@const displayText = (() => {
          let text = msg.text || '';
          if (text === '{sender} 已加入会话') {
            text = getTranslation('sysJoined', currentLang);
          } else if (text === '{sender} 已重新连接') {
            text = getTranslation('sysReconnected', currentLang);
          } else if (text === '{oldSender} 修改用户名为 {sender}') {
            text = getTranslation('sysRenamed', currentLang);
          } else if (text === '{sender} 修改了头像') {
            text = getTranslation('sysChangedAvatar', currentLang);
          } else if (text === '已强制设备 {sender} 退出会话') {
            text = getTranslation('sysForcedExit', currentLang);
          } else if (text === '{sender} 已断开连接') {
            text = getTranslation('sysDisconnected', currentLang);
          } else if (text.startsWith('{sender} 通过 ') && text.endsWith(' 加入了会话')) {
            const platform = text.substring('{sender} 通过 '.length, text.length - ' 加入了会话'.length);
            text = getTranslation('sysJoinedVia', currentLang).replaceAll('{platform}', platform);
          }

          if (/今日免费 Chat 额度已用尽|Daily free chat quota exhausted|free limit/i.test(text)) {
            return getTranslation('quotaExhaustedBroadcast', currentLang);
          }

          const hasOldSender = text.includes('{oldSender}');
          if (text.includes('{sender}')) {
            const meText = getTranslation('me', currentLang) + ` (${msg.sender})`;
            // If the message contains {oldSender} (rename event), the subject is already {oldSender},
            // so the new target name {sender} should be rendered plainly without duplicate 'Me / 我'.
            const senderRepl = (isMe && !hasOldSender && msg.sender) ? meText : (msg.sender || '');
            text = text.replaceAll('{sender}', senderRepl);
          }
          if (hasOldSender) {
            const meText = getTranslation('me', currentLang) + ` (${msg.oldSender})`;
            const oldSenderRepl = isMe && msg.oldSender ? meText : (msg.oldSender || '');
            text = text.replaceAll('{oldSender}', oldSenderRepl);
          }
          return text;
        })()}
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
        {@const dlTx = txState['dl-' + msg.id + '-' + localPeer] || txState[msg.id] || Object.values(txState).find(t => t.messageId === msg.id && (t.clientId === localPeer || (!mine && t.id.startsWith('dl-'))))}
        {@const ulTx = txState['ul-' + msg.id]}
        {@const isTxCompleted = (dlTx && dlTx.state === 'completed') || msg.downloaded || completedMap[msg.id]}
        {@const _dummy = isTxCompleted ? (completedMap[msg.id] = true) : null}
        {@const isDownloaded = isTxCompleted || (isEmbedded && !!msg.filePath)}
        {@const tx = mine ? ulTx : (isTxCompleted ? null : dlTx)}
        {@const colors = getMessageColors(msg, mine)}
        {@const identity = getSenderIdentity(msg)}
        {@const isCancelledFile = (msg.type === 'file' || msg.type === 'image') && ((ulTx && ulTx.state === 'cancelled') || (dlTx && dlTx.state === 'cancelled'))}
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
              class:selecting={selectionMode && canMultiSelect(msg)}
              class:selected={selectionMode && canMultiSelect(msg) && selectedIds.has(msg.id)}
              use:swipeable={msg}
              on:contextmenu|preventDefault={(e) => openMessageMenu(msg, e.currentTarget, { clientX: e.clientX, clientY: e.clientY })}
              on:click={(e) => {
                if (selectionMode && canMultiSelect(msg)) {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleSelect(msg);
                }
              }}
              style="position: relative; overflow: hidden; transform: translateX(0px); transition: transform 0.25s ease;"
            >
              {#if selectionMode && canMultiSelect(msg)}
                <div class="multi-select-badge" class:checked={selectedIds.has(msg.id)} aria-hidden="true">
                  <svg class="check-icon" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              {/if}
              {#if (msg.type === 'file' || msg.type === 'image') && (mine || isEmbedded) && !isCancelledFile && !msg.recalled && (msg.uploading || (ulTx && ulTx.state === 'running'))}
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
                      {#if ulTx.processing || (ulTx.percent ?? 0) >= 99}
                        {getTranslation('savingAttachment', currentLang)}...
                      {:else}
                        {getTranslation('uploading', currentLang)} {ulTx.percent ?? 0}%
                      {/if}
                    {:else}
                      {getTranslation('preparing', currentLang)}...
                    {/if}
                  </span>
                  <div style="width: 80%; height: 5px; background: rgba(0, 0, 0, 0.08); border-radius: 3.5px; overflow: hidden; margin-top: 2px;">
                    <div style="width: {ulTx?.percent ?? 0}%; height: 100%; background: var(--accent-strong); transition: width 0.15s ease-out; border-radius: 3.5px;"></div>
                  </div>
                </div>
              {/if}
              {#if msg.recalled}
                <span class="text recalled">{mine ? getTranslation('recalledMsgYou', currentLang) : (identity.sender + ' ' + getTranslation('recalledMsgOther', currentLang))}</span>
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
                        {getTranslation('editAgain', currentLang)}
                      </button>
                    {:else if msg.type === 'file' || msg.type === 'image'}
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
                        {getTranslation('resend', currentLang)}
                      </button>
                    {/if}
                  </div>
                {/if}
              {:else if isCancelledFile}
                <span class="text recalled" style="font-style: italic; opacity: 0.85;">
                  {mine 
                    ? getTranslation('cancelSendYou', currentLang) 
                    : (identity.sender + ' ' + getTranslation('cancelSendOther', currentLang))}
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
                      {getTranslation('resend', currentLang)}
                    </button>
                  </div>
                {/if}
              {:else}
                {#if msg.type === 'text'}
                  <span class="text">{msg.text}</span>
                {:else if msg.type === 'file' || msg.type === 'image'}
                  <div class="bubble-content">
                    <div class="attachment-card file-attachment">
                      <div class="file-card">
                        {#if isImageFile(msg) && token && !msg.uploading && (!ulTx || ulTx.state !== 'running')}
                          <button
                            type="button"
                            class="file-icon file-icon-thumbnail"
                            on:click={(e) => handleImagePreviewClick(e, msg)}
                            title={getTranslation('viewOriginal', currentLang)}
                            aria-label={getTranslation('viewOriginal', currentLang)}
                          >
                            <span class="file-icon-fallback" aria-hidden="true">FILE</span>
                            <img
                              src={getImageInlineUrl(token, msg.id)}
                              alt={msg.fileName || 'image'}
                              class="file-thumbnail-img"
                              loading="lazy"
                              on:error={(e) => {
                                if (e.currentTarget instanceof HTMLElement) {
                                  e.currentTarget.style.display = 'none';
                                }
                              }}
                            />
                          </button>
                        {:else}
                          <div class="file-icon">FILE</div>
                        {/if}
                        <div class="file-details">
                          <div class="file-name" title={msg.fileName}>{msg.fileName}</div>
                          <div class="file-subtitle">
                            {formatBytes(msg.size || 0)}
                            {#if tx}
                              {#if tx.state === 'running'}
                                · {getTranslation('transferring', currentLang)} {tx.percent ?? 0}%
                              {:else if tx.state === 'completed'}
                                · {mine ? getTranslation('shared', currentLang) : getTranslation('downloaded', currentLang)}
                              {:else if tx.state === 'failed'}
                                · <span class="tx-error-text" title={tx.error || getTranslation('unknownError', currentLang)} style="color: #ef4444; cursor: help; text-decoration: underline dotted;">{getTranslation('transferFailed', currentLang)} ⚠️</span>
                              {:else if tx.state === 'cancelled'}
                                · <span style="color: var(--muted, #64748b);">{getTranslation('cancelled', currentLang)}</span>
                              {/if}
                            {:else}
                              {#if mine && msg.downloaded}
                                · {getTranslation('shared', currentLang)}
                              {:else if !mine && isDownloaded}
                                · {getTranslation('downloaded', currentLang)}
                              {/if}
                            {/if}
                          </div>
                        </div>
                      </div>
                      <!-- File actions live in long-press / swipe / right-click bubble menu only -->
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
        <strong>{getTranslation('startChatting', currentLang)}</strong>
        <span>{getTranslation('emptyTips', currentLang)}</span>
      </div>
    {/each}
    <div style="height: {menuSpacerHeight}px; min-height: 0px; flex-shrink: 0; transition: height 0.15s ease-out;" aria-hidden="true"></div>
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

  {#if selectionMode}
    <div class="multi-select-bar">
      <span class="multi-select-count">
        {getTranslation('selectedCount', currentLang).replace('{count}', String(selectedIds.size))}
      </span>
      <div class="multi-select-actions">
        <button class="multi-select-cancel" type="button" on:click={exitSelectionMode}>
          {getTranslation('batchDownloadCancel', currentLang)}
        </button>
        <button
          class="multi-select-download"
          type="button"
          disabled={selectedIds.size === 0}
          on:click={triggerBatchDownload}
        >
          {getTranslation('batchDownload', currentLang)}
        </button>
      </div>
    </div>
  {/if}
</div>

{#if showMenu}
  <div 
    class="bubble-context-menu placement-{menuPlacement}" 
    style="display: block; left: {menuLeft}px; top: {menuTop}px; {menuWidth > 0 ? `width: ${menuWidth}px;` : ''} --arrow-x: {arrowXPx}px; --arrow-y: {arrowYPx}px;"
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

  .bubble.selecting {
    cursor: pointer;
  }

  .bubble.selected {
    outline: 2px solid var(--accent-strong, #156f5a);
    outline-offset: -2px;
  }

  .multi-select-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 5;
    pointer-events: none;
    width: 20px;
    height: 20px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid var(--accent-strong, #156f5a);
    background: rgba(255, 255, 255, 0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .multi-select-badge .check-icon {
    display: none;
    width: 12px;
    height: 12px;
    stroke: #ffffff;
    stroke-width: 3.5;
    fill: none;
  }

  .multi-select-badge.checked {
    background: var(--accent-strong, #156f5a);
    border-color: var(--accent-strong, #156f5a);
  }

  .multi-select-badge.checked .check-icon {
    display: block;
  }

  .multi-select-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-top: 1px solid var(--line, rgba(21, 111, 90, 0.1));
    background: var(--accent-wash, rgba(21, 111, 90, 0.06));
    flex-shrink: 0;
  }

  .multi-select-count {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent-strong, #156f5a);
  }

  .multi-select-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .multi-select-cancel,
  .multi-select-download {
    border: none;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 7px 16px;
    transition: opacity 0.15s ease;
  }

  .multi-select-cancel {
    background: transparent;
    color: var(--muted, #64748b);
  }

  .multi-select-cancel:hover {
    color: var(--accent-strong, #156f5a);
  }

  .multi-select-download {
    background: var(--accent-strong, #156f5a);
    color: #ffffff;
  }

  .multi-select-download:hover {
    opacity: 0.9;
  }

  .multi-select-download:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .bubble-context-menu {
    position: fixed;
    z-index: 10000;
    width: max-content;
    max-width: 280px;
    min-width: 0;
    background: #ffffff;
    border: none;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.08);
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
  }

  /* 菜单在气泡左侧：箭头在菜单右侧指向气泡 (向右) */
  .bubble-context-menu.placement-left::after {
    top: var(--arrow-y, 50%);
    right: -6px;
    left: auto;
    bottom: auto;
    transform: translateY(-50%);
    border-width: 6px 0 6px 6px;
    border-color: transparent transparent transparent #ffffff;
  }
  :global(.dark) .bubble-context-menu.placement-left::after {
    border-color: transparent transparent transparent #0f172a;
  }

  /* 菜单在气泡右侧：箭头在菜单左侧指向气泡 (向左) */
  .bubble-context-menu.placement-right::after {
    top: var(--arrow-y, 50%);
    left: -6px;
    right: auto;
    bottom: auto;
    transform: translateY(-50%);
    border-width: 6px 6px 6px 0;
    border-color: transparent #ffffff transparent transparent;
  }
  :global(.dark) .bubble-context-menu.placement-right::after {
    border-color: transparent #0f172a transparent transparent;
  }

  /* 菜单在下方：箭头在菜单顶部指向上方 */
  .bubble-context-menu.placement-bottom::after {
    top: -6px;
    bottom: auto;
    left: var(--arrow-x, 50%);
    right: auto;
    transform: translateX(-50%);
    border-width: 0 6px 6px 6px;
    border-color: transparent transparent #ffffff transparent;
  }
  :global(.dark) .bubble-context-menu.placement-bottom::after {
    border-color: transparent transparent #0f172a transparent;
  }

  /* 菜单在上方：箭头在菜单底部指向下方 */
  .bubble-context-menu.placement-top::after {
    bottom: -6px;
    top: auto;
    left: var(--arrow-x, 50%);
    right: auto;
    transform: translateX(-50%);
    border-width: 6px 6px 0 6px;
    border-color: #ffffff transparent transparent transparent;
  }
  :global(.dark) .bubble-context-menu.placement-top::after {
    border-color: #0f172a transparent transparent transparent;
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
    background: #0f172a;
    border: none;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
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
