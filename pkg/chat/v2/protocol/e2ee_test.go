package protocol

import (
	"bytes"
	"crypto/rand"
	"errors"
	"sync"
	"testing"
	"time"

	"eqt/pkg/crypto/e2ee"
)

func TestE2EEEnvelopeEncryptionDecryption(t *testing.T) {
	key := make([]byte, 32)
	_, _ = rand.Read(key)

	plaintext := []byte("Hello E2EE Chat Protocol!")
	seq := uint64(1001)
	ts := time.Now().UnixMilli()

	// 1. Encrypt
	env, err := EncryptE2EEEnvelope(plaintext, seq, ts, key)
	if err != nil {
		t.Fatalf("EncryptE2EEEnvelope failed: %v", err)
	}

	if env.Type != E2EEEnvelopeType || env.Version != E2EEVersion {
		t.Fatalf("Envelope metadata mismatch: %+v", env)
	}

	// 2. Decrypt
	decrypted, err := DecryptE2EEEnvelope(env, key)
	if err != nil {
		t.Fatalf("DecryptE2EEEnvelope failed: %v", err)
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Fatalf("Decrypted content mismatch: got %s, expected %s", string(decrypted), string(plaintext))
	}

	// 3. Tampered sequence (AAD mismatch)
	tamperedEnv := *env
	tamperedEnv.Seq = seq + 1
	_, err = DecryptE2EEEnvelope(&tamperedEnv, key)
	if err == nil || !errors.Is(err, e2ee.ErrAuthFailed) {
		t.Fatalf("Expected auth failure on tampered sequence, got: %v", err)
	}

	// 4. Tampered timestamp (AAD mismatch)
	tamperedEnv2 := *env
	tamperedEnv2.Timestamp = ts + 5000
	_, err = DecryptE2EEEnvelope(&tamperedEnv2, key)
	if err == nil || !errors.Is(err, e2ee.ErrAuthFailed) {
		t.Fatalf("Expected auth failure on tampered timestamp, got: %v", err)
	}

	// 5. Wrong key
	wrongKey := make([]byte, 32)
	wrongKey[0] ^= 0xff
	_, err = DecryptE2EEEnvelope(env, wrongKey)
	if err == nil || !errors.Is(err, e2ee.ErrAuthFailed) {
		t.Fatalf("Expected auth failure on wrong key, got: %v", err)
	}
}

func TestReplayFilter(t *testing.T) {
	now := time.Unix(1725105600, 0)
	nowMs := now.UnixMilli()

	rf := NewReplayFilter()
	rf.SetNowFunc(func() time.Time { return now })

	// 1. Initial packet
	if err := rf.CheckAndRecord(100, nowMs); err != nil {
		t.Fatalf("Initial packet failed: %v", err)
	}

	// 2. Duplicate packet (should fail)
	if err := rf.CheckAndRecord(100, nowMs); err == nil {
		t.Fatalf("Expected duplicate packet to be rejected")
	}

	// 3. Monotonically increasing packets
	if err := rf.CheckAndRecord(101, nowMs); err != nil {
		t.Fatalf("Seq 101 failed: %v", err)
	}
	if err := rf.CheckAndRecord(105, nowMs); err != nil {
		t.Fatalf("Seq 105 failed: %v", err)
	}

	// 4. Out-of-order packets within 128 window
	if err := rf.CheckAndRecord(103, nowMs); err != nil {
		t.Fatalf("Out-of-order seq 103 failed: %v", err)
	}
	if err := rf.CheckAndRecord(102, nowMs); err != nil {
		t.Fatalf("Out-of-order seq 102 failed: %v", err)
	}

	// 5. Replay of out-of-order packet (already received)
	if err := rf.CheckAndRecord(103, nowMs); err == nil {
		t.Fatalf("Expected replayed seq 103 to be rejected")
	}

	// 6. Packet older than 128-window threshold
	if err := rf.CheckAndRecord(300, nowMs); err != nil {
		t.Fatalf("Seq 300 failed: %v", err)
	}
	// Window is now [300-127, 300] = [173, 300]. Seq 104 is < 173 and must be rejected.
	if err := rf.CheckAndRecord(104, nowMs); err == nil {
		t.Fatalf("Expected seq 104 to be rejected as outside sliding window")
	}

	// 7. Timestamp drift > 30 seconds
	staleTs := nowMs - 31000 // 31 seconds in the past
	if err := rf.CheckAndRecord(305, staleTs); err == nil {
		t.Fatalf("Expected packet with 31s timestamp drift to be rejected")
	}

	futureTs := nowMs + 31000 // 31 seconds in the future
	if err := rf.CheckAndRecord(306, futureTs); err == nil {
		t.Fatalf("Expected packet with 31s future drift to be rejected")
	}
}

func TestReplayFilterConcurrency(t *testing.T) {
	now := time.Now()
	nowMs := now.UnixMilli()

	rf := NewReplayFilter()
	rf.SetNowFunc(func() time.Time { return now })

	var wg sync.WaitGroup
	for i := uint64(1); i <= 100; i++ {
		wg.Add(1)
		go func(seq uint64) {
			defer wg.Done()
			_ = rf.CheckAndRecord(seq, nowMs)
		}(i)
	}
	wg.Wait()

	// Any replay of 1..100 must now fail
	for i := uint64(1); i <= 100; i++ {
		if err := rf.CheckAndRecord(i, nowMs); err == nil {
			t.Fatalf("Expected duplicate seq %d to fail after concurrent run", i)
		}
	}
}
