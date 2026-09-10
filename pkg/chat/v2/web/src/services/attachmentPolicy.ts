import type { Message, TransferEvent } from './types';

/**
 * attachmentPolicy.ts
 * 
 * 聊天文件气泡生命周期判定策略 (First Principle: Bubble Retention Guarantee).
 *
 * 核心原则:
 * 除非发送方撤回消息，或者发送方在自身上传过程中取消了发送，其他任何情况
 * (如接收方关闭保存文件对话框、接收方取消下载、网络中断导致下载失败、批量下载取消等)，
 * 绝对不可自动移除气泡及其内容 (文件名、大小、缩略图等)，必须完整保留在消息流中，
 * 供用户随时重新下载或查看。
 */

/**
 * 解析客户端下载传输 ID (Transfer ID Contract).
 * 统一 Wails 宿主桥接、App.svelte 消息监听及测试之间的契约规范。
 */
export function resolveDownloadTransferId(messageId: string, peer = 'desktop'): string {
  return 'dl-' + messageId + '-' + (peer || 'desktop');
}

/**
 * 判定文件消息是否属于“发送方取消了发送”的状态。
 * 注意：接收方下载任务状态绝不参与此判定，签名中不包含任何下载状态参数。
 * 
 * @param msg 消息对象
 * @param mine 当前客户端是否为发送者
 * @param ulTx 发送方的上传传输状态 (ul- 开头)
 */
export function isFileSendCancelled(
  msg: Message,
  mine: boolean,
  ulTx?: TransferEvent | { state?: string }
): boolean {
  if (msg.type !== 'file' && msg.type !== 'image') {
    return false;
  }

  // 已经撤回的消息由 msg.recalled 单独处理
  if (msg.recalled) {
    return false;
  }

  // 核心守则: 接收方下载任务 dlTx 的 cancelled 或 failed 属于单向消费行为，
  // 绝不可将文件卡片判定为取消发送，不可隐藏文件气泡！
  
  // 只有当上传任务存在且明确处于 cancelled 状态时：
  if (ulTx && ulTx.state === 'cancelled') {
    // 若当前客户端是发送方，且该文件处于 uploading 状态时被取消，判定为取消发送
    if (mine) {
      return !!msg.uploading;
    }
    // 若当前客户端是接收方，且收到广播确认发送方的上传已取消，判定为取消发送
    return true;
  }

  return false;
}
