package protocol

import "time"

// EventType identifies a server-to-client event.
type EventType string

const (
	EventHello             EventType = "hello"
	EventHeartbeat         EventType = "heartbeat"
	EventMessageAdded      EventType = "message_added"
	EventMessageRecalled   EventType = "message_recalled"
	EventPresenceChanged   EventType = "presence_changed"
	EventTransferQueued    EventType = "transfer_queued"
	EventTransferStarted   EventType = "transfer_started"
	EventTransferProgress  EventType = "transfer_progress"
	EventTransferCompleted EventType = "transfer_completed"
	EventTransferFailed    EventType = "transfer_failed"
	EventTransferCancelled EventType = "transfer_cancelled"
	EventError             EventType = "error"
	EventRequestFileData   EventType = "request_file_data"
)

// MessageType identifies a chat message payload type.
type MessageType string

const (
	MessageText   MessageType = "text"
	MessageFile   MessageType = "file"
	MessageImage  MessageType = "image"
	MessageVideo  MessageType = "video"
	MessageAudio  MessageType = "audio"
	MessageSystem MessageType = "system"
)

// Message is the v2 protocol message representation.
type Message struct {
	ID        string      `json:"id"`
	SenderID  string      `json:"senderId,omitempty"`
	Sender    string      `json:"sender"`
	Avatar    string      `json:"avatar,omitempty"`
	Theme     string      `json:"theme,omitempty"`
	Type      MessageType `json:"type"`
	Text      string      `json:"text,omitempty"`
	FileName  string      `json:"fileName,omitempty"`
	Size      int64       `json:"size,omitempty"`
	MimeType  string      `json:"mimeType,omitempty"`
	URL       string      `json:"url,omitempty"`
	FilePath  string      `json:"filePath,omitempty"`
	Recalled  bool        `json:"recalled,omitempty"`
	Downloaded bool        `json:"downloaded,omitempty"`
	Uploading  bool        `json:"uploading,omitempty"`
	CreatedAt time.Time   `json:"createdAt"`
}

// PresenceEvent describes current device presence after a connect/disconnect
// or device metadata change.
type PresenceEvent struct {
	Devices []Device `json:"devices"`
}

// Device describes one visible chat participant.
type Device struct {
	ID       string    `json:"id"`
	Label    string    `json:"label"`
	Avatar   string    `json:"avatar,omitempty"`
	Theme    string    `json:"theme,omitempty"`
	Peer     string    `json:"peer,omitempty"`
	LastSeen time.Time `json:"lastSeen"`
}

// TransferState is the lifecycle state for a data-plane job.
type TransferState string

const (
	TransferQueued    TransferState = "queued"
	TransferRunning   TransferState = "running"
	TransferCompleted TransferState = "completed"
	TransferFailed    TransferState = "failed"
	TransferCancelled TransferState = "cancelled"
)

// TransferEvent reports server-side state for one transfer job.
type TransferEvent struct {
	ID         string        `json:"id"`
	MessageID  string        `json:"messageId,omitempty"`
	ClientID   string        `json:"clientId,omitempty"`
	FileName   string        `json:"fileName,omitempty"`
	BytesDone  int64         `json:"bytesDone,omitempty"`
	BytesTotal int64         `json:"bytesTotal,omitempty"`
	Percent    int           `json:"percent,omitempty"`
	State      TransferState `json:"state"`
	Error      string        `json:"error,omitempty"`
	UpdatedAt  time.Time     `json:"updatedAt"`
}

// EventEnvelope is the stable JSON shape for server-to-client events.
type EventEnvelope struct {
	Type      EventType      `json:"type"`
	Seq       int64          `json:"seq,omitempty"`
	Time      time.Time      `json:"time"`
	CommandID string         `json:"commandId,omitempty"`
	Message   *Message       `json:"message,omitempty"`
	Presence  *PresenceEvent `json:"presence,omitempty"`
	Transfer  *TransferEvent `json:"transfer,omitempty"`
	Error     *ErrorPayload  `json:"error,omitempty"`
}
