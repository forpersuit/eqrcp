package protocol

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"eqt/pkg/crypto/e2ee"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	E2EEEnvelopeType = "e2ee_envelope"
	E2EEVersion      = 1
	DefaultTimeDrift = 30 * time.Second
	DefaultWindow    = 128
)

var (
	ErrReplayDetected = errors.New("e2ee: packet replay or out-of-window packet detected")
	ErrTimestampDrift = errors.New("e2ee: packet timestamp drift exceeded allowable threshold")
	ErrInvalidPayload = errors.New("e2ee: invalid or malformed e2ee envelope payload")
)

// E2EEEnvelope represents a secure, tamper-proof WebSocket or control-plane packet.
type E2EEEnvelope struct {
	Type       string `json:"type"`          // Must be "e2ee_envelope"
	Version    int    `json:"version"`       // Protocol version (1)
	Seq        uint64 `json:"seq"`           // Monotonically increasing sequence number
	Timestamp  int64  `json:"timestamp"`     // Unix timestamp in milliseconds
	Nonce      string `json:"nonce"`         // Base64-encoded 24-byte Nonce
	Ciphertext string `json:"ciphertext"`    // Base64-encoded Ciphertext + 16-byte Poly1305 Tag
	Tag        string `json:"tag,omitempty"` // Optional separate tag if not inlined
}

// BuildPacketAAD constructs the Additional Authenticated Data (AAD) for WebSocket packet encryption.
// Format: [Seq (8B BigEndian) | Timestamp (8B BigEndian)] = 16 bytes total.
func BuildPacketAAD(seq uint64, timestamp int64) []byte {
	aad := make([]byte, 16)
	binary.BigEndian.PutUint64(aad[:8], seq)
	binary.BigEndian.PutUint64(aad[8:], uint64(timestamp))
	return aad
}

// EncryptE2EEEnvelope encrypts a plaintext message into a Base64-encoded E2EEEnvelope.
func EncryptE2EEEnvelope(plaintext []byte, seq uint64, timestamp int64, key []byte) (*E2EEEnvelope, error) {
	if len(key) != e2ee.KeySize {
		return nil, e2ee.WrapOpError(e2ee.ErrCodeInvalidKeySize, "EncryptE2EEEnvelope", "invalid key size", e2ee.ErrInvalidKeySize)
	}

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, e2ee.WrapOpError(e2ee.ErrCodeUninitialized, "EncryptE2EEEnvelope", "failed to initialize XChaCha cipher", err)
	}

	nonce := make([]byte, e2ee.NonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, e2ee.WrapOpError(e2ee.ErrCodeNonceGeneration, "EncryptE2EEEnvelope", "failed to generate nonce", err)
	}

	aad := BuildPacketAAD(seq, timestamp)
	ciphertextWithTag := aead.Seal(nil, nonce, plaintext, aad)

	return &E2EEEnvelope{
		Type:       E2EEEnvelopeType,
		Version:    E2EEVersion,
		Seq:        seq,
		Timestamp:  timestamp,
		Nonce:      base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertextWithTag),
	}, nil
}

// DecryptE2EEEnvelope decrypts and verifies an E2EEEnvelope against the given key and AAD.
func DecryptE2EEEnvelope(env *E2EEEnvelope, key []byte) ([]byte, error) {
	if env == nil {
		return nil, e2ee.WrapOpError(e2ee.ErrCodeCorruptedPayload, "DecryptE2EEEnvelope", "envelope is nil", ErrInvalidPayload)
	}
	if env.Type != E2EEEnvelopeType {
		return nil, e2ee.WrapOpError(e2ee.ErrCodeCorruptedPayload, "DecryptE2EEEnvelope", fmt.Sprintf("invalid envelope type: %s", env.Type), ErrInvalidPayload)
	}
	if len(key) != e2ee.KeySize {
		return nil, e2ee.WrapOpError(e2ee.ErrCodeInvalidKeySize, "DecryptE2EEEnvelope", "invalid key size", e2ee.ErrInvalidKeySize)
	}

	nonce, err := base64.StdEncoding.DecodeString(env.Nonce)
	if err != nil || len(nonce) != e2ee.NonceSize {
		return nil, e2ee.WrapOpError(e2ee.ErrCodeCorruptedPayload, "DecryptE2EEEnvelope", "invalid base64 nonce or wrong size", ErrInvalidPayload)
	}

	ciphertextWithTag, err := base64.StdEncoding.DecodeString(env.Ciphertext)
	if err != nil || len(ciphertextWithTag) < e2ee.TagSize {
		return nil, e2ee.WrapOpError(e2ee.ErrCodeCiphertextTooShort, "DecryptE2EEEnvelope", "invalid base64 ciphertext or too short", ErrInvalidPayload)
	}

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, e2ee.WrapOpError(e2ee.ErrCodeUninitialized, "DecryptE2EEEnvelope", "failed to initialize XChaCha cipher", err)
	}

	aad := BuildPacketAAD(env.Seq, env.Timestamp)
	plaintext, err := aead.Open(nil, nonce, ciphertextWithTag, aad)
	if err != nil {
		return nil, e2ee.WrapPacketError(e2ee.ErrCodeAuthFailed, "DecryptE2EEEnvelope", env.Seq, "packet authentication failed (tampered ciphertext/tag or sequence mismatch)", e2ee.ErrAuthFailed)
	}

	return plaintext, nil
}

// ReplayFilter protects against out-of-order, stale, and duplicate replayed packets.
// Uses a 128-bit sliding window bitmap with timestamp drift tolerance.
type ReplayFilter struct {
	mu         sync.Mutex
	maxDriftMs int64
	maxSeq     uint64
	bitmap     [2]uint64 // 128-bit sliding window bitmap (bitmap[0]: 0..63, bitmap[1]: 64..127)
	hasInitial bool
	nowFunc    func() time.Time
}

// NewReplayFilter creates a ReplayFilter with default 30-second drift tolerance.
func NewReplayFilter() *ReplayFilter {
	return &ReplayFilter{
		maxDriftMs: DefaultTimeDrift.Milliseconds(),
		nowFunc:    time.Now,
	}
}

// SetNowFunc overrides the time source (useful for unit testing).
func (rf *ReplayFilter) SetNowFunc(fn func() time.Time) {
	rf.mu.Lock()
	defer rf.mu.Unlock()
	rf.nowFunc = fn
}

// CheckAndRecord verifies that the given sequence and timestamp are fresh, and records them.
func (rf *ReplayFilter) CheckAndRecord(seq uint64, timestamp int64) error {
	rf.mu.Lock()
	defer rf.mu.Unlock()

	nowMs := rf.nowFunc().UnixMilli()

	// 1. Timestamp Freshness Check
	diff := nowMs - timestamp
	if diff < 0 {
		diff = -diff
	}
	if diff > rf.maxDriftMs {
		return e2ee.WrapPacketError(e2ee.ErrCodeReplayDetected, "ReplayFilter", seq, fmt.Sprintf("timestamp drift %dms exceeds threshold %dms", diff, rf.maxDriftMs), ErrTimestampDrift)
	}

	// First packet initializes the baseline
	if !rf.hasInitial {
		rf.hasInitial = true
		rf.maxSeq = seq
		rf.bitmap[0] = 1 // Mark bit 0 (maxSeq)
		rf.bitmap[1] = 0
		return nil
	}

	// 2. Sequence Window Check
	if seq > rf.maxSeq {
		shift := seq - rf.maxSeq
		if shift >= 128 {
			// Shift exceeds full window, reset bitmap
			rf.bitmap[0] = 1
			rf.bitmap[1] = 0
		} else {
			// Shift the 128-bit bitmap by `shift` positions
			rf.shiftBitmap(shift)
			rf.setBit(0) // Mark current maxSeq (offset 0)
		}
		rf.maxSeq = seq
		return nil
	}

	// seq <= maxSeq: check if within the 128-packet window
	offset := rf.maxSeq - seq
	if offset >= 128 {
		return e2ee.WrapPacketError(e2ee.ErrCodeReplayDetected, "ReplayFilter", seq, fmt.Sprintf("seq %d too old (maxSeq: %d, window: 128)", seq, rf.maxSeq), ErrReplayDetected)
	}

	if rf.isBitSet(offset) {
		return e2ee.WrapPacketError(e2ee.ErrCodeReplayDetected, "ReplayFilter", seq, fmt.Sprintf("duplicate packet seq %d replayed", seq), ErrReplayDetected)
	}

	// Mark bit for this packet
	rf.setBit(offset)
	return nil
}

func (rf *ReplayFilter) shiftBitmap(shift uint64) {
	if shift >= 128 {
		rf.bitmap[0] = 0
		rf.bitmap[1] = 0
		return
	}
	if shift >= 64 {
		rf.bitmap[1] = rf.bitmap[0] << (shift - 64)
		rf.bitmap[0] = 0
	} else {
		rf.bitmap[1] = (rf.bitmap[1] << shift) | (rf.bitmap[0] >> (64 - shift))
		rf.bitmap[0] = rf.bitmap[0] << shift
	}
}

func (rf *ReplayFilter) setBit(offset uint64) {
	if offset < 64 {
		rf.bitmap[0] |= (uint64(1) << offset)
	} else if offset < 128 {
		rf.bitmap[1] |= (uint64(1) << (offset - 64))
	}
}

func (rf *ReplayFilter) isBitSet(offset uint64) bool {
	if offset < 64 {
		return (rf.bitmap[0] & (uint64(1) << offset)) != 0
	} else if offset < 128 {
		return (rf.bitmap[1] & (uint64(1) << (offset - 64))) != 0
	}
	return true
}
