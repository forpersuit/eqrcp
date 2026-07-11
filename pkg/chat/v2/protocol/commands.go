package protocol

// CommandType identifies a client-to-server WebSocket command.
type CommandType string

const (
	CommandConnect        CommandType = "connect"
	CommandHeartbeat      CommandType = "heartbeat"
	CommandSendText       CommandType = "send_text"
	CommandRecallMessage  CommandType = "recall_message"
	CommandStartTransfer  CommandType = "start_transfer"
	CommandCancelTransfer CommandType = "cancel_transfer"
	CommandAck            CommandType = "ack"
	CommandLog            CommandType = "log"
	CommandReportProgress CommandType = "report_progress"
	CommandUpdateClient   CommandType = "update_client"
)

// ClientInfo describes a chat client at connection time.
type ClientInfo struct {
	Token     string `json:"token"`
	Label     string `json:"label,omitempty"`
	Avatar    string `json:"avatar,omitempty"`
	Theme     string `json:"theme,omitempty"`
	Peer      string `json:"peer,omitempty"`
	Join      string `json:"join,omitempty"`
	IsNewScan bool   `json:"isNewScan,omitempty"`
}

// CommandEnvelope is the stable JSON shape for client-to-server commands.
//
// Not every field is used by every command. Keeping one envelope makes the v2
// protocol easy to log, test, and evolve without reflection-heavy decoding.
type CommandEnvelope struct {
	Type       CommandType `json:"type"`
	CommandID  string      `json:"commandId,omitempty"`
	Client     ClientInfo  `json:"client,omitempty"`
	AfterSeq   int64       `json:"afterSeq,omitempty"`
	JoinSeq    int64       `json:"joinSeq,omitempty"`
	Text       string      `json:"text,omitempty"`
	MessageID  string      `json:"messageId,omitempty"`
	TransferID string      `json:"transferId,omitempty"`
	BytesDone  int64       `json:"bytesDone,omitempty"`
	BytesTotal int64       `json:"bytesTotal,omitempty"`
}
