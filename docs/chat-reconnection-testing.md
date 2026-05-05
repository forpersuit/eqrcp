# Chat Mode Reconnection Testing Guide

## Overview

This document provides detailed testing procedures for chat mode reconnection
and join-bound synchronization behavior.

## Feature Summary

**Problem:** Mobile browsers suspend background tabs and close SSE connections when users switch apps, causing message sync failures. New devices can also join an existing chat and must not receive messages sent before their join time.

**Solution:** Implemented Page Visibility API + intelligent reconnection with:
- Automatic reconnection when page becomes visible
- SSE event sequence support for post-join message recovery
- Connection health verification
- Exponential backoff (1s → 30s)
- Visual connection status indicators
- Join-bound synchronization with `joinSeq` and `afterSeq`

## Prerequisites

- Built `eqrcp.exe` binary
- Desktop browser (Chrome, Firefox, or Edge)
- Mobile device with browser (iOS Safari or Android Chrome)
- Both devices on the same local network

## Test Setup

### 1. Start Chat Session

```bash
# Start chat with browser auto-open
eqrcp chat --browser

# Or start without browser (scan QR manually)
eqrcp chat
```

### 2. Connect Mobile Device

1. Scan the QR code displayed in terminal with mobile browser
2. Verify both desktop and mobile show "Connected as [Device Name]"
3. Send a test message from each device to confirm bidirectional sync

Important sync rule: a device receives messages and attachment events from its
own join point onward. It should recover missed messages while it was already
joined, but it should not receive earlier chat history when it joins late.

## Test Scenarios

### Scenario 1: Short Background Period (1 minute)

**Purpose:** Verify quick reconnection after brief app switching

**Steps:**
1. Send message from desktop: "Test 1 - Before background"
2. Verify message appears on mobile
3. Switch mobile browser to background (home screen or another app)
4. Wait 1 minute
5. Send message from desktop: "Test 1 - During background"
6. Switch mobile browser back to foreground
7. Observe reconnection behavior

**Expected Results:**
- Mobile shows "Reconnecting..." briefly
- Mobile shows "Connected as [Device Name]" within 2-3 seconds
- Message "Test 1 - During background" appears automatically
- No manual refresh required

**Pass Criteria:** ✅ All messages sync within 5 seconds of returning to foreground

---

### Scenario 2: Medium Background Period (5 minutes)

**Purpose:** Verify reconnection after typical multitasking delay

**Steps:**
1. Send message from desktop: "Test 2 - Before background"
2. Verify message appears on mobile
3. Switch mobile browser to background
4. Wait 5 minutes
5. Send 3 messages from desktop:
   - "Test 2 - Message 1"
   - "Test 2 - Message 2"
   - "Test 2 - Message 3"
6. Switch mobile browser back to foreground
7. Observe reconnection and message recovery

**Expected Results:**
- Mobile shows "Reconnecting..." or "Connection lost. Reconnecting..."
- Mobile reconnects within 5 seconds
- All 3 messages appear in correct order
- Connection status shows "Connected as [Device Name]"

**Pass Criteria:** ✅ All messages recovered, no duplicates, correct order

---

### Scenario 3: Long Background Period (10 minutes)

**Purpose:** Verify behavior after extended background time

**Steps:**
1. Send message from desktop: "Test 3 - Before long background"
2. Switch mobile browser to background
3. Wait 10 minutes
4. Send messages from desktop every 2 minutes:
   - "Test 3 - 2 min"
   - "Test 3 - 4 min"
   - "Test 3 - 6 min"
   - "Test 3 - 8 min"
   - "Test 3 - 10 min"
5. Switch mobile browser back to foreground
6. Observe reconnection

**Expected Results:**
- Mobile reconnects (may take up to 10 seconds)
- All 5 messages appear
- If reconnection fails, health check triggers and fetches all messages

**Pass Criteria:** ✅ All messages eventually appear (within 15 seconds)

---

### Scenario 4: Network Interruption

**Purpose:** Verify reconnection after network loss

**Steps:**
1. Establish chat session on mobile
2. Send message: "Test 4 - Before network loss"
3. Turn off WiFi on mobile device
4. Wait 30 seconds
5. Send message from desktop: "Test 4 - During network loss"
6. Turn WiFi back on
7. Observe reconnection

**Expected Results:**
- Mobile shows "Disconnected. Reconnecting..."
- After WiFi reconnects, mobile shows "Reconnecting..."
- Connection re-establishes within 5-10 seconds
- Message "Test 4 - During network loss" appears

**Pass Criteria:** ✅ Automatic reconnection without manual refresh

---

### Scenario 5: Network Switching (WiFi ↔ 4G)

**Purpose:** Verify reconnection when switching networks

**Steps:**
1. Connect mobile via WiFi
2. Send message: "Test 5 - On WiFi"
3. Switch mobile to 4G/5G (disable WiFi)
4. Wait for network switch to complete
5. Send message from desktop: "Test 5 - After switch"
6. Observe mobile behavior

**Expected Results:**
- Mobile detects connection loss
- Reconnects via 4G/5G
- New message appears

**Pass Criteria:** ✅ Seamless transition between networks

---

### Scenario 6: Multi-Device Synchronization

**Purpose:** Verify devices stay synchronized from their own join point

**Steps:**
1. Connect desktop browser
2. Connect mobile device 1
3. Send message from desktop: "Test 6 - Before mobile 2 joins"
4. Connect mobile device 2
5. Verify mobile device 2 does not receive "Test 6 - Before mobile 2 joins"
6. Send message from mobile 1: "Test 6 - From mobile 1"
7. Put mobile 1 in background for 2 minutes
8. Send message from mobile 2: "Test 6 - From mobile 2"
9. Send message from desktop: "Test 6 - While mobile 1 background"
10. Bring mobile 1 back to foreground

**Expected Results:**
- Desktop and mobile 1 show messages sent after their joins
- Mobile 2 starts at its join point and does not show older messages
- Mobile 1 recovers missed post-join messages
- Message order is consistent for messages visible to each device

**Pass Criteria:** All devices show only their allowed post-join history, with no missing or duplicated post-join messages

---

### Scenario 7: Rapid Background/Foreground Switching

**Purpose:** Verify stability with frequent switching

**Steps:**
1. Establish chat session
2. Rapidly switch mobile browser:
   - Background → Foreground (wait 5s)
   - Background → Foreground (wait 5s)
   - Background → Foreground (wait 5s)
   - Repeat 5 times
3. Send message from desktop after each switch

**Expected Results:**
- No connection errors
- All messages appear
- No duplicate connections
- Reconnection delay increases with exponential backoff

**Pass Criteria:** ✅ Stable behavior, no crashes or hangs

---

### Scenario 8: Low Power Mode (iOS) / Battery Saver (Android)

**Purpose:** Verify behavior in power-saving modes

**Steps:**
1. Enable Low Power Mode (iOS) or Battery Saver (Android)
2. Establish chat session
3. Send message: "Test 8 - Power saving enabled"
4. Switch to background for 3 minutes
5. Send message from desktop: "Test 8 - During power saving"
6. Return to foreground

**Expected Results:**
- Reconnection may be slower (up to 15 seconds)
- Messages eventually sync
- Connection remains stable once established

**Pass Criteria:** ✅ Functional despite power restrictions

---

## Browser Console Monitoring

### Desktop Browser Console

Open Developer Tools (F12) and monitor console for:

```
Connected as Desktop.
Disconnected. Reconnecting...
Connected as Desktop.
```

### Mobile Browser Console (if accessible)

For debugging, use remote debugging:
- **iOS Safari:** Settings → Safari → Advanced → Web Inspector
- **Android Chrome:** chrome://inspect

Look for:
- EventSource connection status
- Reconnection attempts
- SSE event sequence, `joinSeq`, and cursor values
- Health check requests

---

## Connection Status Indicators

### Visual Indicators

| Status | Display | Meaning |
|--------|---------|---------|
| Connected | "Connected as [Name]" | Active SSE connection |
| Connecting | "Connecting..." | Initial connection attempt |
| Reconnecting | "Reconnecting..." | Attempting to restore connection |
| Disconnected | "Disconnected. Reconnecting..." | Connection lost, retry scheduled |
| Connection Lost | "Connection lost. Reconnecting..." | Health check failed, forcing reconnect |

### Network Tab Monitoring

In browser DevTools → Network tab, observe:
- `/chat/[path]/events` - SSE connection (should show "pending" when active)
- `/chat/[path]/health` - Health check requests (when verifying connection)
- `/chat/[path]/messages` - Post-join message fetch requests during recovery

---

## Troubleshooting

### Issue: Mobile doesn't reconnect after returning from background

**Possible Causes:**
- Browser killed the tab due to memory pressure
- Network changed and DNS resolution failed
- Server stopped or restarted

**Debug Steps:**
1. Check if page is still loaded (not blank)
2. Check browser console for errors
3. Try manual refresh
4. Verify server is still running
5. Check network connectivity

### Issue: Messages appear out of order

**Possible Causes:**
- Race condition during reconnection
- Multiple SSE connections active

**Debug Steps:**
1. Check browser console for multiple EventSource connections
2. Verify SSE reconnects and post-join event batches merge correctly
3. Check server logs for duplicate connections

### Issue: Reconnection takes too long

**Possible Causes:**
- Exponential backoff reached maximum delay
- Network latency
- Server overloaded

**Debug Steps:**
1. Check reconnection delay in console
2. Test network latency (ping server)
3. Verify server is responsive

---

## Success Criteria Summary

| Scenario | Pass Criteria |
|----------|---------------|
| 1. Short background (1 min) | Reconnect < 5s, all messages sync |
| 2. Medium background (5 min) | Reconnect < 5s, all messages in order |
| 3. Long background (10 min) | Reconnect < 15s, all messages recovered |
| 4. Network interruption | Auto-reconnect without refresh |
| 5. Network switching | Seamless transition |
| 6. Multi-device sync | Join-bound history across devices |
| 7. Rapid switching | Stable, no errors |
| 8. Power saving mode | Functional despite delays |

---

## Reporting Issues

When reporting issues, include:

1. **Device Information:**
   - OS and version (e.g., iOS 17.2, Android 14)
   - Browser and version (e.g., Safari 17, Chrome 120)
   - Device model

2. **Test Scenario:**
   - Which scenario failed
   - Steps to reproduce
   - Expected vs actual behavior

3. **Logs:**
   - Browser console output
   - Server terminal output
   - Network tab screenshots

4. **Timing:**
   - How long in background
   - Reconnection delay observed
   - Message sync delay

---

## Next Steps

After completing manual testing:

1. Document any failures or unexpected behavior
2. Test on additional devices/browsers if available
3. Consider Phase 2 enhancements:
   - Polling fallback for unstable networks
   - WebSocket migration for better mobile support
   - Optional persistent message history with explicit privacy controls

---

## Automated Testing

For CI/CD integration, consider:

```bash
# Run all chat-related tests
go test ./server -v -run "Chat"

# Run specific reconnection tests
go test ./server -v -run "TestChatHealth|TestChatMessagesSnapshot|TestChatPageMergesRecoveredSSEMessages"
```

Current test coverage:
- ✅ Message filtering logic
- ✅ Health endpoint
- ✅ SSE event sequence recovery
- ✅ Client-side reconnection code presence
- ⚠️ End-to-end reconnection (requires manual testing)
