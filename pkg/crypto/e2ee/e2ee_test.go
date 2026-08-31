package e2ee

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"io"
	"testing"
)

func TestKeyDerivation(t *testing.T) {
	masterKey, err := GenerateMasterKey()
	if err != nil {
		t.Fatalf("GenerateMasterKey failed: %v", err)
	}

	if len(masterKey) != KeySize {
		t.Fatalf("expected key size %d, got %d", KeySize, len(masterKey))
	}

	dk, err := DeriveKeys(masterKey)
	if err != nil {
		t.Fatalf("DeriveKeys failed: %v", err)
	}

	// Verify all keys are non-zero and distinct
	if bytes.Equal(dk.SendKey[:], dk.RecvKey[:]) {
		t.Errorf("SendKey and RecvKey must be distinct")
	}
	if bytes.Equal(dk.SendKey[:], dk.WSKey[:]) {
		t.Errorf("SendKey and WSKey must be distinct")
	}
	if bytes.Equal(dk.SendKey[:], dk.AuthKey[:]) {
		t.Errorf("SendKey and AuthKey must be distinct")
	}

	// Test zeroize
	dk.Zeroize()
	zeroKey := [KeySize]byte{}
	if !bytes.Equal(dk.MasterKey[:], zeroKey[:]) {
		t.Errorf("MasterKey not zeroed")
	}
	if !bytes.Equal(dk.SendKey[:], zeroKey[:]) {
		t.Errorf("SendKey not zeroed")
	}
	if !bytes.Equal(dk.RecvKey[:], zeroKey[:]) {
		t.Errorf("RecvKey not zeroed")
	}
	if !bytes.Equal(dk.WSKey[:], zeroKey[:]) {
		t.Errorf("WSKey not zeroed")
	}
	if !bytes.Equal(dk.AuthKey[:], zeroKey[:]) {
		t.Errorf("AuthKey not zeroed")
	}
}

func TestHKDFStandardVectors(t *testing.T) {
	// MasterKey: 0x01..0x20
	masterKey := []byte{
		0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
		0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
		0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
		0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
	}

	dk, err := DeriveKeys(masterKey)
	if err != nil {
		t.Fatalf("DeriveKeys failed: %v", err)
	}

	// Expected values matching JS test vector
	expectedSendHex := "a018f378a93cb3bf437192eab4a6b46513ec5cf1e9a5a7211f936689fd9feffd"
	expectedRecvHex := "d1b5aaec98f0f930c7b5f94d82a6f19a16a92007454f6b9a2f4f74ceba803825"
	expectedWSHex := "c2f31346f033615a4af3cdbd8e4e612fe591b75d21223c999b5d2158607c63f7"
	expectedAuthHex := "694274bd605eb866d866f5737fb9bc7d6778a09b4a586739581bcf7a73c7a496"

	if fmt.Sprintf("%x", dk.SendKey) != expectedSendHex {
		t.Errorf("SendKey vector mismatch: expected %s, got %x", expectedSendHex, dk.SendKey)
	}
	if fmt.Sprintf("%x", dk.RecvKey) != expectedRecvHex {
		t.Errorf("RecvKey vector mismatch: expected %s, got %x", expectedRecvHex, dk.RecvKey)
	}
	if fmt.Sprintf("%x", dk.WSKey) != expectedWSHex {
		t.Errorf("WSKey vector mismatch: expected %s, got %x", expectedWSHex, dk.WSKey)
	}
	if fmt.Sprintf("%x", dk.AuthKey) != expectedAuthHex {
		t.Errorf("AuthKey vector mismatch: expected %s, got %x", expectedAuthHex, dk.AuthKey)
	}
}

func TestChunkEncryptionDecryption(t *testing.T) {
	masterKey, err := GenerateMasterKey()
	if err != nil {
		t.Fatalf("GenerateMasterKey failed: %v", err)
	}

	dk, err := DeriveKeys(masterKey)
	if err != nil {
		t.Fatalf("DeriveKeys failed: %v", err)
	}

	fileID := "file-test-uuid-12345"
	chunkIndex := uint32(0)
	plaintext := []byte("Hello EQT E2EE End-to-End Encryption with XChaCha20-Poly1305!")

	// 1. Encrypt chunk
	envelope, err := EncryptChunk(plaintext, chunkIndex, dk.SendKey[:], fileID)
	if err != nil {
		t.Fatalf("EncryptChunk failed: %v", err)
	}

	expectedLen := ChunkHeaderSize + len(plaintext) + TagSize
	if len(envelope) != expectedLen {
		t.Fatalf("expected envelope length %d, got %d", expectedLen, len(envelope))
	}

	// 2. Decrypt chunk
	decrypted, err := DecryptChunk(envelope, chunkIndex, dk.SendKey[:], fileID)
	if err != nil {
		t.Fatalf("DecryptChunk failed: %v", err)
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Fatalf("decrypted plaintext mismatch: expected %s, got %s", plaintext, decrypted)
	}
}

func TestTamperedCiphertext(t *testing.T) {
	masterKey, _ := GenerateMasterKey()
	dk, _ := DeriveKeys(masterKey)

	fileID := "file-tamper-test"
	chunkIndex := uint32(1)
	plaintext := []byte("Sensitive payload that must not be tampered")

	envelope, err := EncryptChunk(plaintext, chunkIndex, dk.SendKey[:], fileID)
	if err != nil {
		t.Fatalf("EncryptChunk failed: %v", err)
	}

	// Tamper 1 bit in the ciphertext portion
	tampered := append([]byte(nil), envelope...)
	tampered[len(tampered)-1] ^= 0x01

	// Decrypt must fail
	_, err = DecryptChunk(tampered, chunkIndex, dk.SendKey[:], fileID)
	if err == nil {
		t.Fatalf("expected decryption error on tampered ciphertext, but got nil")
	}
}

func TestTamperedChunkIndexAAD(t *testing.T) {
	masterKey, _ := GenerateMasterKey()
	dk, _ := DeriveKeys(masterKey)

	fileID := "file-aad-test"
	chunkIndex := uint32(5)
	plaintext := []byte("Chunk number 5 content")

	envelope, err := EncryptChunk(plaintext, chunkIndex, dk.SendKey[:], fileID)
	if err != nil {
		t.Fatalf("EncryptChunk failed: %v", err)
	}

	// Try to replay chunk 5 as chunk 2
	_, err = DecryptChunk(envelope, uint32(2), dk.SendKey[:], fileID)
	if err == nil {
		t.Fatalf("expected error when chunkIndex in AAD does not match, got nil")
	}

	// Try to decrypt under different fileID
	_, err = DecryptChunk(envelope, chunkIndex, dk.SendKey[:], "different-file-id")
	if err == nil {
		t.Fatalf("expected error when fileID in AAD does not match, got nil")
	}
}

func TestPacketEncryptionDecryption(t *testing.T) {
	masterKey, _ := GenerateMasterKey()
	dk, _ := DeriveKeys(masterKey)

	aad := []byte("seq:1001|timestamp:1725100000")
	plaintext := []byte(`{"type":"chat_msg","text":"Secret message over LAN"}`)

	envelope, err := EncryptPacket(plaintext, dk.WSKey[:], aad)
	if err != nil {
		t.Fatalf("EncryptPacket failed: %v", err)
	}

	expectedLen := PacketHeaderSize + len(plaintext) + TagSize
	if len(envelope) != expectedLen {
		t.Fatalf("expected envelope length %d, got %d", expectedLen, len(envelope))
	}

	// Decrypt with correct AAD
	decrypted, err := DecryptPacket(envelope, dk.WSKey[:], aad)
	if err != nil {
		t.Fatalf("DecryptPacket failed: %v", err)
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Fatalf("decrypted mismatch: expected %s, got %s", plaintext, decrypted)
	}

	// Decrypt with tampered AAD (e.g. replayed sequence number)
	tamperedAAD := []byte("seq:1002|timestamp:1725100000")
	_, err = DecryptPacket(envelope, dk.WSKey[:], tamperedAAD)
	if err == nil {
		t.Fatalf("expected authentication error on tampered AAD, got nil")
	}
}

func Benchmark4MBChunkEncryption(b *testing.B) {
	masterKey, _ := GenerateMasterKey()
	dk, _ := DeriveKeys(masterKey)
	fileID := "bench-file"

	chunk4MB := make([]byte, 4*1024*1024)
	_, _ = io.ReadFull(rand.Reader, chunk4MB)

	b.SetBytes(int64(len(chunk4MB)))
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := EncryptChunk(chunk4MB, uint32(i), dk.SendKey[:], fileID)
		if err != nil {
			b.Fatalf("EncryptChunk failed: %v", err)
		}
	}
}

func Benchmark4MBChunkDecryption(b *testing.B) {
	masterKey, _ := GenerateMasterKey()
	dk, _ := DeriveKeys(masterKey)
	fileID := "bench-file"

	chunk4MB := make([]byte, 4*1024*1024)
	_, _ = io.ReadFull(rand.Reader, chunk4MB)

	envelope, err := EncryptChunk(chunk4MB, 0, dk.SendKey[:], fileID)
	if err != nil {
		b.Fatalf("EncryptChunk failed: %v", err)
	}

	b.SetBytes(int64(len(chunk4MB)))
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := DecryptChunk(envelope, 0, dk.SendKey[:], fileID)
		if err != nil {
			b.Fatalf("DecryptChunk failed: %v", err)
		}
	}
}
