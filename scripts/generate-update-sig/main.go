package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
)

const testPrivateKeySeedHex = "fc0993ec4a68da7e6f10be87959d8ecd7f227ddd4b9e65a7b925287b9b2ed12e"

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run scripts/generate-update-sig/main.go <path/to/binary>")
		os.Exit(1)
	}

	filePath := os.Args[1]
	file, err := os.Open(filePath)
	if err != nil {
		fmt.Printf("Error opening file %s: %v\n", filePath, err)
		os.Exit(1)
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		fmt.Printf("Error hashing file: %v\n", err)
		os.Exit(1)
	}
	hash := hasher.Sum(nil)

	seedHex := os.Getenv("UPDATE_SIGNING_PRIVATE_KEY")
	if seedHex == "" {
		seedHex = testPrivateKeySeedHex
	}
	seedBytes, err := hex.DecodeString(seedHex)
	if err != nil {
		fmt.Printf("Error decoding private key seed: %v\n", err)
		os.Exit(1)
	}

	privKey := ed25519.NewKeyFromSeed(seedBytes)
	sigRaw := ed25519.Sign(privKey, hash)
	sigHex := hex.EncodeToString(sigRaw)

	sigFilePath := filePath + ".sig"
	err = os.WriteFile(sigFilePath, []byte(sigHex), 0644)
	if err != nil {
		fmt.Printf("Error writing signature file %s: %v\n", sigFilePath, err)
		os.Exit(1)
	}

	fmt.Printf("Successfully signed %s\n", filePath)
	fmt.Printf("SHA256 Hash: %s\n", hex.EncodeToString(hash))
	fmt.Printf("Signature: %s\n", sigHex)
	fmt.Printf("Signature written to: %s\n", sigFilePath)
}
