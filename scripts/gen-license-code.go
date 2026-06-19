package main

import (
	"fmt"
	"os"
	"strings"
)

const redeemSecret = "EQT-LOCAL-2026-V1"

func checksum(value string, length int) string {
	var hash uint32 = 2166136261
	for i := 0; i < len(value); i++ {
		hash ^= uint32(value[i])
		hash = hash * 16777619
	}
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	var result []byte
	val := hash
	for val > 0 {
		result = append(result, alphabet[val%36])
		val /= 36
	}
	// reverse result to get correct order
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	resStr := strings.ToUpper(string(result))
	for len(resStr) < length {
		resStr = "0" + resStr
	}
	if len(resStr) > length {
		resStr = resStr[len(resStr)-length:]
	}
	return resStr
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run scripts/gen-license-code.go <PLUS|PRO> [serial] [date|LIFETIME]")
		fmt.Println("Example (Plus Lifetime): go run scripts/gen-license-code.go PLUS ABC1234 LIFETIME")
		fmt.Println("Example (Plus Yearly):   go run scripts/gen-license-code.go PLUS ABC1234 20260619")
		os.Exit(1)
	}
	tier := strings.ToUpper(os.Args[1])
	if tier != "PLUS" && tier != "PRO" {
		fmt.Println("Error: Invalid tier. Must be PLUS or PRO.")
		os.Exit(1)
	}
	serial := "ABC1234"
	if len(os.Args) > 2 {
		serial = strings.ToUpper(os.Args[2])
	}
	date := "LIFETIME"
	if len(os.Args) > 3 {
		date = strings.ToUpper(os.Args[3])
	}
	codeBase := fmt.Sprintf("EQT-%s-%s-%s", tier, date, serial)
	check := checksum(codeBase+"-"+redeemSecret, 6)
	fmt.Printf("%s-%s\n", codeBase, check)
}
