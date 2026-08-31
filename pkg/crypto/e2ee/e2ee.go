package e2ee

import (
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"runtime"

	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/hkdf"
)

const (
	// KeySize is the 256-bit key size for XChaCha20-Poly1305 and MasterKey.
	KeySize = chacha20poly1305.KeySize // 32 bytes

	// NonceSize is the 192-bit nonce size for XChaCha20-Poly1305.
	NonceSize = chacha20poly1305.NonceSizeX // 24 bytes

	// TagSize is the Poly1305 AEAD authentication tag size.
	TagSize = chacha20poly1305.Overhead // 16 bytes

	// ChunkHeaderSize is the size of the chunk metadata prefix: [ChunkIndex(4B) | Nonce(24B)]
	ChunkHeaderSize = 4 + NonceSize // 28 bytes

	// PacketHeaderSize is the size of the packet nonce prefix: [Nonce(24B)]
	PacketHeaderSize = NonceSize // 24 bytes

	// HKDF Context Labels according to RFC 5869 & Architecture Tenet 1
	HKDFInfoSend = "eqt-e2ee-v2-send"
	HKDFInfoRecv = "eqt-e2ee-v2-recv"
	HKDFInfoWS   = "eqt-e2ee-v2-ws"
	HKDFInfoAuth = "eqt-e2ee-v2-auth"
)

// DerivedKeys holds the four domain-separated 256-bit symmetric subkeys.
type DerivedKeys struct {
	MasterKey [KeySize]byte
	SendKey   [KeySize]byte
	RecvKey   [KeySize]byte
	WSKey     [KeySize]byte
	AuthKey   [KeySize]byte
}

// Zeroize securely wipes all key material in the DerivedKeys structure.
func (dk *DerivedKeys) Zeroize() {
	if dk == nil {
		return
	}
	Zeroize(dk.MasterKey[:])
	Zeroize(dk.SendKey[:])
	Zeroize(dk.RecvKey[:])
	Zeroize(dk.WSKey[:])
	Zeroize(dk.AuthKey[:])
}

// Zeroize securely clears a byte slice in place.
func Zeroize(buf []byte) {
	if len(buf) == 0 {
		return
	}
	clear(buf)
	runtime.KeepAlive(buf)
}

// GenerateMasterKey creates a cryptographically secure 256-bit master key.
func GenerateMasterKey() ([]byte, error) {
	key := make([]byte, KeySize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("e2ee: failed to generate master key: %w", err)
	}
	return key, nil
}

// DeriveKeys derives K_send, K_recv, K_ws, K_auth from a 32-byte MasterKey using HKDF-SHA256 (RFC 5869).
func DeriveKeys(masterKey []byte) (*DerivedKeys, error) {
	if len(masterKey) != KeySize {
		return nil, ErrInvalidKeySize
	}

	dk := &DerivedKeys{}
	copy(dk.MasterKey[:], masterKey)

	// Salt is nil (equivalent to 32 zero bytes in RFC 5869)
	prk := hkdf.Extract(sha256.New, masterKey, nil)

	// Derive K_send
	rSend := hkdf.Expand(sha256.New, prk, []byte(HKDFInfoSend))
	if _, err := io.ReadFull(rSend, dk.SendKey[:]); err != nil {
		dk.Zeroize()
		return nil, fmt.Errorf("e2ee: failed to derive K_send: %w", err)
	}

	// Derive K_recv
	rRecv := hkdf.Expand(sha256.New, prk, []byte(HKDFInfoRecv))
	if _, err := io.ReadFull(rRecv, dk.RecvKey[:]); err != nil {
		dk.Zeroize()
		return nil, fmt.Errorf("e2ee: failed to derive K_recv: %w", err)
	}

	// Derive K_ws
	rWS := hkdf.Expand(sha256.New, prk, []byte(HKDFInfoWS))
	if _, err := io.ReadFull(rWS, dk.WSKey[:]); err != nil {
		dk.Zeroize()
		return nil, fmt.Errorf("e2ee: failed to derive K_ws: %w", err)
	}

	// Derive K_auth
	rAuth := hkdf.Expand(sha256.New, prk, []byte(HKDFInfoAuth))
	if _, err := io.ReadFull(rAuth, dk.AuthKey[:]); err != nil {
		dk.Zeroize()
		return nil, fmt.Errorf("e2ee: failed to derive K_auth: %w", err)
	}

	return dk, nil
}

// BuildChunkAAD constructs the Associated Authenticated Data (AAD) for a specific chunk.
// Format: fileID || ChunkIndex(4B BigEndian)
func BuildChunkAAD(fileID string, chunkIndex uint32) []byte {
	aad := make([]byte, len(fileID)+4)
	copy(aad, fileID)
	binary.BigEndian.PutUint32(aad[len(fileID):], chunkIndex)
	return aad
}

// EncryptChunk encrypts a 4MB (or trailing) plaintext chunk with XChaCha20-Poly1305.
// Envelope Format: [ChunkIndex(4B) | Nonce(24B) | Ciphertext | Tag(16B)]
func EncryptChunk(plaintext []byte, chunkIndex uint32, key []byte, fileID string) ([]byte, error) {
	if len(key) != KeySize {
		return nil, ErrInvalidKeySize
	}

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, fmt.Errorf("e2ee: failed to initialize XChaCha20-Poly1305: %w", err)
	}

	nonce := make([]byte, NonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("e2ee: failed to generate nonce: %w", err)
	}

	aad := BuildChunkAAD(fileID, chunkIndex)

	// Output buffer: [ChunkIndex(4B) | Nonce(24B) | Ciphertext + Tag]
	out := make([]byte, ChunkHeaderSize+len(plaintext)+TagSize)
	binary.BigEndian.PutUint32(out[:4], chunkIndex)
	copy(out[4:ChunkHeaderSize], nonce)

	// aead.Seal appends ciphertext+tag to out[:ChunkHeaderSize]
	ciphertext := aead.Seal(out[:ChunkHeaderSize], nonce, plaintext, aad)
	return ciphertext, nil
}

// DecryptChunk decrypts and authenticates a chunk envelope with XChaCha20-Poly1305.
// Envelope Format: [ChunkIndex(4B) | Nonce(24B) | Ciphertext | Tag(16B)]
func DecryptChunk(envelope []byte, expectedChunkIndex uint32, key []byte, fileID string) ([]byte, error) {
	if len(key) != KeySize {
		return nil, WrapChunkError(ErrCodeInvalidKeySize, "DecryptChunk", fileID, expectedChunkIndex, "invalid key size", ErrInvalidKeySize)
	}
	if len(envelope) < ChunkHeaderSize+TagSize {
		return nil, WrapChunkError(ErrCodeCiphertextTooShort, "DecryptChunk", fileID, expectedChunkIndex, "envelope too short", ErrCiphertextTooShort)
	}

	actualChunkIndex := binary.BigEndian.Uint32(envelope[:4])
	if actualChunkIndex != expectedChunkIndex {
		return nil, WrapChunkError(ErrCodeChunkIndexMismatch, "DecryptChunk", fileID, expectedChunkIndex, fmt.Sprintf("expected chunk %d, got %d", expectedChunkIndex, actualChunkIndex), ErrChunkIndexMismatch)
	}

	nonce := envelope[4:ChunkHeaderSize]
	ciphertextWithTag := envelope[ChunkHeaderSize:]

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, WrapChunkError(ErrCodeUninitialized, "DecryptChunk", fileID, expectedChunkIndex, "failed to initialize XChaCha20 cipher", err)
	}

	aad := BuildChunkAAD(fileID, expectedChunkIndex)

	plaintext, err := aead.Open(nil, nonce, ciphertextWithTag, aad)
	if err != nil {
		return nil, WrapChunkError(ErrCodeAuthFailed, "DecryptChunk", fileID, expectedChunkIndex, "AEAD authentication verification failed (tampered ciphertext/tag/aad or wrong key)", ErrAuthFailed)
	}

	return plaintext, nil
}

// EncryptPacket encrypts a single payload packet (for WebSocket frames or small attachments <= 20MB).
// Envelope Format: [Nonce(24B) | Ciphertext | Tag(16B)]
func EncryptPacket(plaintext []byte, key []byte, aad []byte) ([]byte, error) {
	if len(key) != KeySize {
		return nil, WrapOpError(ErrCodeInvalidKeySize, "EncryptPacket", "invalid key size", ErrInvalidKeySize)
	}

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, WrapOpError(ErrCodeUninitialized, "EncryptPacket", "failed to initialize XChaCha20 cipher", err)
	}

	nonce := make([]byte, NonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, WrapOpError(ErrCodeNonceGeneration, "EncryptPacket", "failed to generate nonce", err)
	}

	// Output buffer: [Nonce(24B) | Ciphertext + Tag]
	out := make([]byte, PacketHeaderSize+len(plaintext)+TagSize)
	copy(out[:PacketHeaderSize], nonce)

	ciphertext := aead.Seal(out[:PacketHeaderSize], nonce, plaintext, aad)
	return ciphertext, nil
}

// DecryptPacket decrypts and authenticates a single payload packet.
// Envelope Format: [Nonce(24B) | Ciphertext | Tag(16B)]
func DecryptPacket(envelope []byte, key []byte, aad []byte) ([]byte, error) {
	if len(key) != KeySize {
		return nil, WrapOpError(ErrCodeInvalidKeySize, "DecryptPacket", "invalid key size", ErrInvalidKeySize)
	}
	if len(envelope) < PacketHeaderSize+TagSize {
		return nil, WrapOpError(ErrCodeCiphertextTooShort, "DecryptPacket", "envelope too short", ErrCiphertextTooShort)
	}

	nonce := envelope[:PacketHeaderSize]
	ciphertextWithTag := envelope[PacketHeaderSize:]

	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, WrapOpError(ErrCodeUninitialized, "DecryptPacket", "failed to initialize XChaCha20 cipher", err)
	}

	plaintext, err := aead.Open(nil, nonce, ciphertextWithTag, aad)
	if err != nil {
		return nil, WrapOpError(ErrCodeAuthFailed, "DecryptPacket", "packet authentication verification failed", ErrAuthFailed)
	}

	return plaintext, nil
}

// NewXChaChaCipher returns a cipher.AEAD instance with the given 32-byte key.
func NewXChaChaCipher(key []byte) (cipher.AEAD, error) {
	if len(key) != KeySize {
		return nil, ErrInvalidKeySize
	}
	return chacha20poly1305.NewX(key)
}
