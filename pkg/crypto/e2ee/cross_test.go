package e2ee

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCrossLanguageInterop(t *testing.T) {
	// Check if node is available
	_, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node binary not found, skipping cross-language interop test")
	}

	masterKeyHex := "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
	masterKey, _ := hex.DecodeString(masterKeyHex)
	dk, err := DeriveKeys(masterKey)
	if err != nil {
		t.Fatalf("DeriveKeys failed: %v", err)
	}

	fileID := "cross-file-id-8899"
	chunkIndex := uint32(7)
	plaintext := []byte("Cross-language cryptographic interoperability test between Go and JS!")

	// 1. Go Encrypts -> JS Decrypts
	goEnvelope, err := EncryptChunk(plaintext, chunkIndex, dk.SendKey[:], fileID)
	if err != nil {
		t.Fatalf("Go EncryptChunk failed: %v", err)
	}
	goEnvelopeHex := hex.EncodeToString(goEnvelope)

	cryptoEnginePath, err := filepath.Abs("../../pages/assets/crypto-engine.js")
	if err != nil {
		t.Fatalf("failed to resolve crypto-engine.js path: %v", err)
	}

	jsDecryptScript := fmt.Sprintf(`
		const EQTCrypto = require('%s');
		const keys = EQTCrypto.deriveKeys('%s');
		const envelope = EQTCrypto.hexToBytes('%s');
		const decrypted = EQTCrypto.decryptChunk(envelope, %d, keys.kSend, '%s');
		process.stdout.write(EQTCrypto.bytesToString(decrypted));
	`, cryptoEnginePath, masterKeyHex, goEnvelopeHex, chunkIndex, fileID)

	cmd := exec.Command("node", "-e", jsDecryptScript)
	var out bytes.Buffer
	cmd.Stdout = &out
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		t.Fatalf("JS failed to decrypt Go envelope: %v\nstderr: %s", err, errBuf.String())
	}

	if out.String() != string(plaintext) {
		t.Fatalf("JS decrypted content mismatch: expected %s, got %s", plaintext, out.String())
	}

	// 2. JS Encrypts -> Go Decrypts
	jsEncryptScript := fmt.Sprintf(`
		const EQTCrypto = require('%s');
		const keys = EQTCrypto.deriveKeys('%s');
		const plaintext = EQTCrypto.stringToBytes('%s');
		const envelope = EQTCrypto.encryptChunk(plaintext, %d, keys.kRecv, '%s');
		process.stdout.write(EQTCrypto.bytesToHex(envelope));
	`, cryptoEnginePath, masterKeyHex, plaintext, chunkIndex, fileID)

	cmd2 := exec.Command("node", "-e", jsEncryptScript)
	var jsEncOut bytes.Buffer
	cmd2.Stdout = &jsEncOut
	var jsEncErr bytes.Buffer
	cmd2.Stderr = &jsEncErr

	if err := cmd2.Run(); err != nil {
		t.Fatalf("JS failed to encrypt chunk: %v\nstderr: %s", err, jsEncErr.String())
	}

	jsEnvelopeHex := strings.TrimSpace(jsEncOut.String())
	jsEnvelope, err := hex.DecodeString(jsEnvelopeHex)
	if err != nil {
		t.Fatalf("failed to decode hex envelope from JS: %v", err)
	}

	goDecrypted, err := DecryptChunk(jsEnvelope, chunkIndex, dk.RecvKey[:], fileID)
	if err != nil {
		t.Fatalf("Go failed to decrypt JS envelope: %v", err)
	}

	if !bytes.Equal(goDecrypted, plaintext) {
		t.Fatalf("Go decrypted content mismatch: expected %s, got %s", plaintext, goDecrypted)
	}
}
