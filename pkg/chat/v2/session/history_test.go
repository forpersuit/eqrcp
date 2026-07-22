package session

import (
	"context"
	"fmt"
	"testing"
	"time"

	"eqt/pkg/chat/v2/protocol"
)

func TestSelectMessageHistoryPageNewestLimit(t *testing.T) {
	store := NewMessageStore()
	// Mix presence-like non-message events with messages.
	for i := 1; i <= 5; i++ {
		store.Add(protocol.EventEnvelope{Type: protocol.EventPresenceChanged})
		store.Add(protocol.EventEnvelope{
			Type: protocol.EventMessageAdded,
			Message: &protocol.Message{
				ID:   fmt.Sprintf("m-%d", i),
				Text: fmt.Sprintf("msg-%d", i),
				Type: protocol.MessageText,
			},
		})
	}

	// afterSeq=0, no ceiling: newest 3 of 5 messages
	page, hasMore := store.SelectMessageHistoryPage(0, 0, 3)
	if !hasMore {
		t.Fatal("expected hasMore for 5 messages with limit 3")
	}
	if len(page) != 3 {
		t.Fatalf("page len = %d, want 3", len(page))
	}
	if page[0].Message.Text != "msg-3" || page[2].Message.Text != "msg-5" {
		t.Fatalf("unexpected page texts: %s .. %s", page[0].Message.Text, page[2].Message.Text)
	}

	// Older page before oldest of previous page
	older, hasMore2 := store.SelectMessageHistoryPage(0, page[0].Seq, 3)
	if !hasMore2 {
		// only 2 messages left (msg-1, msg-2)
		if len(older) != 2 {
			t.Fatalf("older len = %d, want 2", len(older))
		}
	} else {
		t.Fatal("expected no further pages after second fetch of remaining 2")
	}
	if older[0].Message.Text != "msg-1" || older[1].Message.Text != "msg-2" {
		t.Fatalf("older texts = %s, %s", older[0].Message.Text, older[1].Message.Text)
	}

}

func TestSelectMessageHistoryPageRespectsJoinFloor(t *testing.T) {
	store := NewMessageStore()
	store.Add(protocol.EventEnvelope{
		Type:    protocol.EventMessageAdded,
		Message: &protocol.Message{ID: "pre", Text: "secret", Type: protocol.MessageText},
	})
	joinSeq := store.CurrentSeq()
	store.Add(protocol.EventEnvelope{
		Type:    protocol.EventMessageAdded,
		Message: &protocol.Message{ID: "post", Text: "visible", Type: protocol.MessageText},
	})

	page, hasMore := store.SelectMessageHistoryPage(joinSeq, 0, 10)
	if hasMore {
		t.Fatal("expected no more")
	}
	if len(page) != 1 || page[0].Message.Text != "visible" {
		t.Fatalf("page = %#v", page)
	}
}

func TestRegisterHistoryPageLimitAndLoadOlder(t *testing.T) {
	sess := NewSession("hist-room")
	sess.DisableSystemMessages = true

	host := NewClient(protocol.ClientInfo{Label: "Host", Peer: "peer-host"}, nil)
	sess.Register(host, 0, 0)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		for {
			select {
			case <-host.sendChan:
			case <-ctx.Done():
				return
			}
		}
	}()

	const total = DefaultHistoryPageSize + 30
	for i := 0; i < total; i++ {
		sess.SendText(host, fmt.Sprintf("m-%03d", i), fmt.Sprintf("cmd-%d", i))
	}

	mobile := NewClient(protocol.ClientInfo{Label: "Mobile", Peer: "peer-mobile"}, nil)
	// afterSeq=0, joinSeq=1 → replay from seq>1 (all host messages in this room).
	sess.Register(mobile, 0, 1)

	texts := map[string]bool{}
	var history *protocol.HistoryPage
	deadline := time.After(200 * time.Millisecond)
collect:
	for {
		select {
		case ev := <-mobile.sendChan:
			if ev.Type == protocol.EventMessageAdded && ev.Message != nil {
				texts[ev.Message.Text] = true
			}
			if ev.Type == protocol.EventHistoryPage && ev.History != nil {
				history = ev.History
			}
		case <-deadline:
			break collect
		}
	}

	if history == nil {
		t.Fatal("expected history_page after Register")
	}
	if !history.HasMore {
		t.Fatal("expected hasMore when total messages exceed page size")
	}
	if history.Count != DefaultHistoryPageSize {
		t.Fatalf("history.Count = %d, want %d", history.Count, DefaultHistoryPageSize)
	}
	// Newest message must be present
	if !texts[fmt.Sprintf("m-%03d", total-1)] {
		t.Fatalf("missing newest message in first page, got %d texts", len(texts))
	}
	// Oldest overall should not be in first page
	if texts["m-000"] {
		t.Fatal("first page should not include oldest message when truncated")
	}

	// Load older page
	mobile2 := NewClient(protocol.ClientInfo{Label: "Mobile", Peer: "peer-mobile"}, nil)
	// drain via collecting
	sess.Register(mobile2, sess.MessageStore.CurrentSeq(), 0) // warm, empty replay of messages
	// clear channel noise
	time.Sleep(20 * time.Millisecond)
	for {
		select {
		case <-mobile2.sendChan:
		default:
			goto load
		}
	}
load:
	sess.LoadHistory(mobile2, 0, history.OldestSeq, DefaultHistoryPageSize, "hist-1")
	olderTexts := map[string]bool{}
	var hist2 *protocol.HistoryPage
	deadline2 := time.After(200 * time.Millisecond)
collect2:
	for {
		select {
		case ev := <-mobile2.sendChan:
			if ev.Type == protocol.EventMessageAdded && ev.Message != nil {
				olderTexts[ev.Message.Text] = true
			}
			if ev.Type == protocol.EventHistoryPage && ev.History != nil {
				hist2 = ev.History
			}
		case <-deadline2:
			break collect2
		}
	}
	if hist2 == nil {
		t.Fatal("expected history_page for load_history")
	}
	if !olderTexts["m-000"] {
		t.Fatalf("older page missing m-000: %v", olderTexts)
	}
	if olderTexts[fmt.Sprintf("m-%03d", total-1)] {
		t.Fatal("older page should not re-include newest message")
	}
}

func TestNormalizeHistoryLimit(t *testing.T) {
	if NormalizeHistoryLimit(0) != DefaultHistoryPageSize {
		t.Fatalf("zero -> default")
	}
	if NormalizeHistoryLimit(-1) != DefaultHistoryPageSize {
		t.Fatalf("neg -> default")
	}
	if NormalizeHistoryLimit(MaxHistoryPageSize+50) != MaxHistoryPageSize {
		t.Fatalf("cap at max")
	}
	if NormalizeHistoryLimit(50) != 50 {
		t.Fatalf("passthrough")
	}
}
