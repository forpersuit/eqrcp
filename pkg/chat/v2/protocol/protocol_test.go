package protocol

import (
	"encoding/json"
	"testing"
	"time"
)

func TestCommandEnvelopeJSONShape(t *testing.T) {
	cmd := CommandEnvelope{
		Type:      CommandSendText,
		CommandID: "cmd-1",
		Client: ClientInfo{
			Token: "client-token",
			Label: "Phone",
			Theme: "theme-1",
			Join:  "join-1",
		},
		AfterSeq: 7,
		JoinSeq:  3,
		Text:     "hello",
	}

	data, err := json.Marshal(cmd)
	if err != nil {
		t.Fatal(err)
	}

	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}

	if got["type"] != string(CommandSendText) {
		t.Fatalf("type = %v, want %q", got["type"], CommandSendText)
	}
	if got["commandId"] != "cmd-1" {
		t.Fatalf("commandId = %v, want cmd-1", got["commandId"])
	}
	client, ok := got["client"].(map[string]any)
	if !ok {
		t.Fatalf("client payload missing or wrong type: %#v", got["client"])
	}
	if client["token"] != "client-token" || client["label"] != "Phone" {
		t.Fatalf("client payload = %#v", client)
	}
	if got["text"] != "hello" {
		t.Fatalf("text = %v, want hello", got["text"])
	}
}

func TestEventEnvelopeJSONShape(t *testing.T) {
	now := time.Date(2026, 7, 7, 11, 0, 0, 0, time.UTC)
	event := EventEnvelope{
		Type: EventTransferProgress,
		Seq:  42,
		Time: now,
		Transfer: &TransferEvent{
			ID:         "transfer-1",
			MessageID:  "message-1",
			ClientID:   "client-1",
			FileName:   "video.mp4",
			BytesDone:  512,
			BytesTotal: 1024,
			Percent:    50,
			State:      TransferRunning,
			UpdatedAt:  now,
		},
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}

	var decoded EventEnvelope
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Type != EventTransferProgress || decoded.Seq != 42 {
		t.Fatalf("decoded envelope = %#v", decoded)
	}
	if decoded.Transfer == nil {
		t.Fatal("transfer payload missing")
	}
	if decoded.Transfer.State != TransferRunning || decoded.Transfer.Percent != 50 {
		t.Fatalf("decoded transfer = %#v", decoded.Transfer)
	}
}
