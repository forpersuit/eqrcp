package session

import (
	"context"
	"testing"
	"time"

	"eqt/pkg/chat/v2/protocol"
)

func TestMessageStoreMonotonicAndGetSince(t *testing.T) {
	store := NewMessageStore()

	e1 := store.Add(protocol.EventEnvelope{Type: protocol.EventHeartbeat})
	e2 := store.Add(protocol.EventEnvelope{Type: protocol.EventMessageAdded})
	e3 := store.Add(protocol.EventEnvelope{Type: protocol.EventPresenceChanged})

	if e1.Seq != 1 || e2.Seq != 2 || e3.Seq != 3 {
		t.Fatalf("seq numbers = %d, %d, %d; want 1, 2, 3", e1.Seq, e2.Seq, e3.Seq)
	}

	since1 := store.GetSince(1)
	if len(since1) != 2 {
		t.Fatalf("GetSince(1) len = %d, want 2", len(since1))
	}
	if since1[0].Seq != 2 || since1[1].Seq != 3 {
		t.Fatalf("GetSince(1) seqs = %d, %d; want 2, 3", since1[0].Seq, since1[1].Seq)
	}

	since3 := store.GetSince(3)
	if len(since3) != 0 {
		t.Fatalf("GetSince(3) len = %d, want 0", len(since3))
	}
}

// TestRegisterSamePeerKeepsSingleConnection enforces device identity:
// same peer may not hold multiple live sockets in one room.
func TestRegisterSamePeerKeepsSingleConnection(t *testing.T) {
	sess := NewSession("peer-slot-room")
	sess.DisableSystemMessages = true

	first := NewClient(protocol.ClientInfo{Label: "Phone", Peer: "peer-phone"}, nil)
	sess.Register(first, 0, 0)
	if sess.ClientsCount() != 1 {
		t.Fatalf("after first register count = %d, want 1", sess.ClientsCount())
	}

	second := NewClient(protocol.ClientInfo{Label: "Phone", Peer: "peer-phone"}, nil)
	sess.Register(second, 0, 0)
	if sess.ClientsCount() != 1 {
		t.Fatalf("after same-peer register count = %d, want 1", sess.ClientsCount())
	}
	if sess.GetClient(first.ID) != nil {
		t.Fatal("first connection should be removed from the session map")
	}
	if sess.GetClient(second.ID) == nil {
		t.Fatal("second connection should remain registered")
	}

	// Different peer must coexist.
	other := NewClient(protocol.ClientInfo{Label: "Desktop", Peer: "peer-desktop"}, nil)
	sess.Register(other, 0, 0)
	if sess.ClientsCount() != 2 {
		t.Fatalf("after different-peer register count = %d, want 2", sess.ClientsCount())
	}
}

func TestSessionHasRemoteClientIgnoresDesktopHost(t *testing.T) {
	sess := NewSession("remote-quota")
	sess.DisableSystemMessages = true

	if sess.HasRemoteClient() {
		t.Fatal("empty session must not report remote clients")
	}

	host := NewClient(protocol.ClientInfo{Label: "Host", Peer: "desktop"}, nil)
	sess.Register(host, 0, 0)
	if sess.HasRemoteClient() {
		t.Fatal("desktop host alone must not count as remote peer for free-tier timing")
	}

	phone := NewClient(protocol.ClientInfo{Label: "Phone", Peer: "mobile-1"}, nil)
	sess.Register(phone, 0, 0)
	if !sess.HasRemoteClient() {
		t.Fatal("phone peer must count as remote for free-tier timing")
	}

	sess.Unregister(phone)
	if sess.HasRemoteClient() {
		t.Fatal("after phone leaves, only desktop remains — no remote peer")
	}
}

func TestSessionRegistrationAndPresence(t *testing.T) {
	sess := NewSession("test-room")
	sess.DisableSystemMessages = true

	c1 := NewClient(protocol.ClientInfo{
		Label: "User A",
		Peer:  "peer-a",
	}, nil)

	sess.Register(c1, 0, 0)

	if sess.ClientsCount() != 1 {
		t.Fatalf("clients count = %d, want 1", sess.ClientsCount())
	}

	// Capture the presence broadcasted by session.
	// Registering c1 triggers a presence changed event, which is stored in messageStore.
	events := sess.MessageStore.GetSince(0)
	if len(events) != 1 {
		t.Fatalf("events len = %d, want 1", len(events))
	}
	if events[0].Type != protocol.EventPresenceChanged {
		t.Fatalf("event type = %s, want %s", events[0].Type, protocol.EventPresenceChanged)
	}

	presence := events[0].Presence
	if presence == nil || len(presence.Devices) != 1 {
		t.Fatalf("presence devices = %v, want 1", presence)
	}
	if presence.Devices[0].Label != "User A" || presence.Devices[0].Peer != "peer-a" {
		t.Fatalf("device info = %v", presence.Devices[0])
	}
}

func TestSessionSendTextAndReplay(t *testing.T) {
	sess := NewSession("test-room")
	sess.DisableSystemMessages = true

	c1 := NewClient(protocol.ClientInfo{Label: "User A"}, nil)
	c2 := NewClient(protocol.ClientInfo{Label: "User B"}, nil)

	// Register c1
	sess.Register(c1, 0, 0)

	// Send text message from c1
	sess.SendText(c1, "hello world", "cmd-1")

	// Now register c2 with afterSeq = 1 (to receive the send_text message which has seq = 2)
	// Why seq = 2? Because c1's presence event was seq = 1.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		// Mock read from c2's sendChan to avoid blocking
		for {
			select {
			case <-c2.sendChan:
			case <-ctx.Done():
				return
			}
		}
	}()

	sess.Register(c2, 1, 0)

	events := sess.MessageStore.GetSince(1)
	if len(events) != 2 {
		t.Fatalf("events since 1 = %d, want 2", len(events))
	}
	if events[0].Type != protocol.EventMessageAdded || events[0].Message.Text != "hello world" {
		t.Fatalf("msg = %#v", events[0].Message)
	}
	if events[1].Type != protocol.EventPresenceChanged {
		t.Fatalf("expected presence changed event, got = %s", events[1].Type)
	}
}

// collectMessageTexts drains a client's outbound channel for wait and returns
// non-empty message texts seen (used by reconnect/history tests).
func collectMessageTexts(c *Client, wait time.Duration) map[string]bool {
	out := map[string]bool{}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case ev := <-c.sendChan:
			if ev.Message != nil && ev.Message.Text != "" {
				out[ev.Message.Text] = true
			}
		case <-timer.C:
			return out
		}
	}
}

// TestSessionColdStartReplaysFromJoinSeq verifies the mobile cold-start path:
// local UI is empty but after_seq watermark is high; client reconnects with
// afterSeq=joinSeq so Register rehydrates post-join chat history.
func TestSessionColdStartReplaysFromJoinSeq(t *testing.T) {
	sess := NewSession("cold-start-room")
	sess.DisableSystemMessages = true

	host := NewClient(protocol.ClientInfo{Label: "Host", Peer: "peer-host"}, nil)
	sess.Register(host, 0, 0)

	// Drain host channel so presence/broadcasts do not block.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	drain := func(c *Client) {
		go func() {
			for {
				select {
				case <-c.sendChan:
				case <-ctx.Done():
					return
				}
			}
		}()
	}
	drain(host)

	// Pre-join history that a later joiner must NOT receive.
	sess.SendText(host, "before-join-secret", "cmd-pre")

	joinBoundary := sess.MessageStore.CurrentSeq()

	mobile := NewClient(protocol.ClientInfo{Label: "Mobile", Peer: "peer-mobile"}, nil)
	// First join as brand-new: no pre-join history.
	sess.Register(mobile, 0, 0)
	drain(mobile)

	// Post-join conversation (what cold-start must restore).
	sess.SendText(host, "hello-after-join-1", "cmd-1")
	sess.SendText(host, "hello-after-join-2", "cmd-2")

	// Simulate mobile consuming up to the latest watermark, then process kill.
	lastSeq := sess.MessageStore.CurrentSeq()
	if lastSeq <= joinBoundary {
		t.Fatalf("expected post-join events, lastSeq=%d joinBoundary=%d", lastSeq, joinBoundary)
	}

	// Warm reconnect with high afterSeq: only events after lastSeq (none of the chat).
	warm := NewClient(protocol.ClientInfo{Label: "Mobile", Peer: "peer-mobile"}, nil)
	sess.Register(warm, lastSeq, joinBoundary)
	warmTexts := collectMessageTexts(warm, 30*time.Millisecond)
	if warmTexts["hello-after-join-1"] || warmTexts["hello-after-join-2"] {
		t.Fatalf("warm reconnect must not rehydrate consumed history: got %v", warmTexts)
	}

	// Cold-start reconnect: empty UI → client sends afterSeq=joinSeq.
	cold := NewClient(protocol.ClientInfo{Label: "Mobile", Peer: "peer-mobile"}, nil)
	sess.Register(cold, joinBoundary, joinBoundary)
	coldTexts := collectMessageTexts(cold, 30*time.Millisecond)

	if coldTexts["before-join-secret"] {
		t.Fatal("cold-start must not leak pre-join history")
	}
	if !coldTexts["hello-after-join-1"] || !coldTexts["hello-after-join-2"] {
		t.Fatalf("cold-start missing post-join history: got %v", coldTexts)
	}
}

func TestSessionRecallMessage(t *testing.T) {
	sess := NewSession("test-room")
	sess.DisableSystemMessages = true
	c1 := NewClient(protocol.ClientInfo{Label: "User A"}, nil)
	sess.Register(c1, 0, 0)

	// Send message
	sess.SendText(c1, "hello recall", "cmd-1")

	// Get message ID
	events := sess.MessageStore.GetSince(1) // since presence (seq 1)
	if len(events) < 1 || events[0].Message == nil {
		t.Fatalf("message not found in store")
	}
	msgID := events[0].Message.ID

	// Recall message (matching sender)
	sess.RecallMessage(c1.Peer, msgID, "cmd-2")

	// Verify recalled in message store
	eventsAfterRecall := sess.MessageStore.GetSince(1)
	if len(eventsAfterRecall) < 1 || eventsAfterRecall[0].Message == nil {
		t.Fatalf("message not found after recall")
	}
	if !eventsAfterRecall[0].Message.Recalled {
		t.Fatalf("expected message to be recalled")
	}

	// Verify that trying to recall someone else's message fails
	c2 := NewClient(protocol.ClientInfo{Label: "User B"}, nil)
	sess.Register(c2, 0, 0)

	// Send another message
	sess.SendText(c1, "hello recall 2", "cmd-3")
	events2 := sess.MessageStore.GetSince(int64(len(sess.MessageStore.events) - 1)) // get last
	if len(events2) < 1 || events2[0].Message == nil {
		t.Fatalf("message 2 not found")
	}
	msgID2 := events2[0].Message.ID

	// Try to recall message of c1 using c2.Peer
	sess.RecallMessage(c2.Peer, msgID2, "cmd-4")

	// Verify it remains not recalled
	eventsAfterRecall2 := sess.MessageStore.GetSince(int64(len(sess.MessageStore.events) - 2))

	for _, ev := range eventsAfterRecall2 {
		if ev.Message != nil && ev.Message.ID == msgID2 {
			if ev.Message.Recalled {
				t.Fatalf("should not have recalled message since sender mismatch")
			}
		}
	}
}
