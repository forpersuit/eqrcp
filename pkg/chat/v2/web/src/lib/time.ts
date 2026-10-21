export interface FormattedMessageTime {
  hm: string;
  sec: string;
  full: string;
}

/**
 * Format message timestamps into 24-hour hour-minute (hm), seconds (sec), and full representation.
 * When screen space is constrained (e.g. mobile), seconds can be omitted cleanly by hiding the .time-sec element.
 */
export function formatMessageTime(timestamp: number | string | Date): FormattedMessageTime {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) {
    return { hm: '', sec: '', full: '' };
  }
  const pad = (n: number) => n.toString().padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sec = `:${pad(d.getSeconds())}`;
  return {
    hm,
    sec,
    full: `${hm}${sec}`
  };
}
