# Chat Mode Phase 2 Implementation Plan

## Current Status

### Already Implemented ✅
1. `eqrcp desktop chat` command exists and works
2. Desktop agent accepts `chat` tasks via `/tasks` API
3. Task validation supports `chat` action (no paths required)
4. `runTask` method handles `chat` case
5. Notification labels support "Chat" action
6. Browser chat MVP with SSE, attachments, and mobile reconnection

### Gaps to Address

1. **Chat Session Lifecycle**
   - Chat sessions are long-lived, unlike one-shot transfers
   - Need explicit "active" vs "ended" states
   - Need user-initiated stop action

2. **Status Tracking**
   - Chat doesn't use `TransferStatusSnapshot` like share/receive
   - Agent status page shows chat as "running" but no session details
   - No message count or participant info

3. **History Display**
   - Chat history records show no meaningful details
   - Need session duration, message count, or participant count

## Implementation Tasks

### Task 1: Add Chat Session Status Hook
**File:** `server/chat.go`

Add a status hook mechanism similar to transfer status:
```go
type ChatStatusSnapshot struct {
    State        string    // "waiting", "active", "ended"
    MessageCount int
    StartedAt    time.Time
    LastActivity time.Time
}

func (s *Server) SetChatStatusHook(hook func(ChatStatusSnapshot)) {
    s.chatStatusHook = hook
}
```

Update chat session to call the hook when:
- Session starts (waiting)
- First message arrives (active)
- Session stops (ended)
- Periodic updates (every N messages)

### Task 2: Update Desktop Agent to Track Chat Status
**File:** `cmd/desktop_agent.go`

Add chat-specific fields to `desktopAgentTaskRecord`:
```go
type desktopAgentTaskRecord struct {
    // ... existing fields ...
    ChatState        string `json:"chatState,omitempty"`        // "waiting", "active", "ended"
    ChatMessageCount int    `json:"chatMessageCount,omitempty"`
    ChatLastActivity string `json:"chatLastActivity,omitempty"`
}
```

Add observer method:
```go
func (agent *desktopAgent) observeChatStatus(taskID int, status ChatStatusSnapshot) {
    agent.mu.Lock()
    defer agent.mu.Unlock()
    if agent.current == nil || agent.current.ID != taskID {
        return
    }
    agent.current.ChatState = status.State
    agent.current.ChatMessageCount = status.MessageCount
    if !status.LastActivity.IsZero() {
        agent.current.ChatLastActivity = status.LastActivity.Format(time.RFC3339)
    }
    agent.touchLocked()
}
```

### Task 3: Wire Chat Status in runTask
**File:** `cmd/desktop_agent.go`

In the `chat` case of `runTask`:
```go
case "chat":
    agent.setCurrentPageURL(srv.ChatURL)
    srv.SetChatStatusHook(func(status server.ChatStatusSnapshot) {
        agent.observeChatStatus(taskID, status)
    })
    // ... rest of chat setup
```

### Task 4: Update Agent Status Page Template
**File:** `cmd/desktop_agent.go` (template section)

Add chat-specific display in the Current and History tables:
- Show "Chat Session" instead of "Transfer" for chat tasks
- Display message count
- Display session state (waiting/active/ended)
- Show last activity time

### Task 5: Add Tests
**File:** `cmd/desktop_agent_test.go`

Add test:
```go
func TestDesktopAgentObservesChatStatus(t *testing.T) {
    agent := newDesktopAgent(application.Flags{})
    agent.busy = true
    agent.current = &desktopAgentTaskRecord{
        ID:        5,
        Action:    "chat",
        State:     "running",
        StartedAt: time.Now(),
    }

    agent.observeChatStatus(5, server.ChatStatusSnapshot{
        State:        "active",
        MessageCount: 12,
        LastActivity: time.Now(),
    })
    
    status := agent.snapshot()
    if status.Current.ChatState != "active" {
        t.Fatalf("ChatState = %q, want active", status.Current.ChatState)
    }
    if status.Current.ChatMessageCount != 12 {
        t.Fatalf("ChatMessageCount = %d, want 12", status.Current.ChatMessageCount)
    }
}
```

**File:** `server/chat_test.go` (new file)

Add test for chat status hook:
```go
func TestChatStatusHook(t *testing.T) {
    // Test that status hook is called on message events
}
```

### Task 6: Update Documentation
**File:** `docs/chat-mode-development.md`

Update Phase 2 status to "completed" and document:
- Chat status tracking
- Agent integration details
- How to monitor active chat sessions

## Testing Plan

1. **Unit Tests**
   - Chat status observer
   - Chat status hook invocation
   - Agent status display with chat fields

2. **Integration Tests**
   - Start chat via agent
   - Send messages and verify status updates
   - Stop chat and verify history

3. **Manual Testing**
   - `eqrcp desktop agent-start -B`
   - Submit chat task via launcher or API
   - Open agent status page
   - Verify chat session appears with message count
   - Send messages from desktop and mobile
   - Stop chat and verify history shows session details

## Success Criteria

- [ ] Chat tasks show meaningful status in agent page
- [ ] Message count updates in real-time
- [ ] Chat history shows session duration and message count
- [ ] Stop current works for active chat sessions
- [ ] Repeat works for chat history items
- [ ] All tests pass
- [ ] Documentation updated
