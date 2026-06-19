package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// runCommand runs a CLI command and returns stdout trimmed.
func runCommand(name string, args ...string) string {
	var stdout bytes.Buffer
	cmd := exec.Command(name, args...)
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return ""
	}
	return strings.TrimSpace(stdout.String())
}

// hashValue returns SHA-256 of lowercase trimmed string, or empty string if input is empty or invalid.
func hashValue(val string) string {
	val = strings.TrimSpace(strings.ToLower(val))
	// Avoid placeholder values that represent query failures
	if val == "" || val == "unknown" || val == "none" || val == "to be filled by o.e.m." {
		return ""
	}
	h := sha256.New()
	h.Write([]byte(val))
	return hex.EncodeToString(h.Sum(nil))
}

// GetBoardUUID retrieves the motherboard UUID.
func GetBoardUUID() string {
	var raw string
	if runtime.GOOS == "windows" {
		// 1. Try powershell CIM instance
		raw = runCommand("powershell", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID")
		if raw == "" {
			// 2. Try wmic fallback
			out := runCommand("wmic", "path", "win32_computersystemproduct", "get", "uuid")
			lines := strings.Split(out, "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line != "" && !strings.EqualFold(line, "uuid") {
					raw = line
					break
				}
			}
		}
		if raw == "" {
			// 3. Try registry fallback MachineGuid
			out := runCommand("reg", "query", `HKLM\SOFTWARE\Microsoft\Cryptography`, "/v", "MachineGuid")
			// Parse registry output
			parts := strings.Fields(out)
			if len(parts) >= 3 {
				raw = parts[len(parts)-1]
			}
		}
	} else if runtime.GOOS == "linux" {
		// 1. Try reading standard DMI uuid
		if data, err := os.ReadFile("/sys/class/dmi/id/product_uuid"); err == nil {
			raw = string(data)
		}
		if raw == "" {
			// 2. Try /etc/machine-id
			if data, err := os.ReadFile("/etc/machine-id"); err == nil {
				raw = string(data)
			}
		}
		if raw == "" {
			// 3. Try DBus machine id
			if data, err := os.ReadFile("/var/lib/dbus/machine-id"); err == nil {
				raw = string(data)
			}
		}
	}
	return hashValue(raw)
}

// GetCPUSerial retrieves the CPU Processor ID / Serial.
func GetCPUSerial() string {
	var raw string
	if runtime.GOOS == "windows" {
		raw = runCommand("powershell", "-Command", "(Get-CimInstance Win32_Processor).ProcessorId")
		if raw == "" {
			out := runCommand("wmic", "cpu", "get", "processorid")
			lines := strings.Split(out, "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line != "" && !strings.EqualFold(line, "processorid") {
					raw = line
					break
				}
			}
		}
	} else if runtime.GOOS == "linux" {
		if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
			lines := strings.Split(string(data), "\n")
			for _, line := range lines {
				if strings.HasPrefix(strings.ToLower(line), "serial") {
					parts := strings.Split(line, ":")
					if len(parts) == 2 {
						raw = parts[1]
						break
					}
				}
			}
		}
	}
	return hashValue(raw)
}

// GetSystemDiskSerial retrieves the system physical disk SerialNumber.
func GetSystemDiskSerial() string {
	var raw string
	if runtime.GOOS == "windows" {
		// Try system drive physical disk serial via Powershell
		raw = runCommand("powershell", "-Command", "(Get-PhysicalDisk | Where-Object {$_.IsSystem -eq $true}).SerialNumber")
		if raw == "" {
			// Try wmic drive index 0
			out := runCommand("wmic", "diskdrive", "where", "index=0", "get", "serialnumber")
			lines := strings.Split(out, "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line != "" && !strings.EqualFold(line, "serialnumber") {
					raw = line
					break
				}
			}
		}
	} else if runtime.GOOS == "linux" {
		// Read serial for sda or nvme0n1. Find likely system disk block names
		sysBlock := "/sys/block"
		files, err := os.ReadDir(sysBlock)
		if err == nil {
			var candidateDisk string
			for _, f := range files {
				name := f.Name()
				if strings.HasPrefix(name, "sd") || strings.HasPrefix(name, "nvme") {
					candidateDisk = name
					// Read Serial if available
					serialPath := filepath.Join(sysBlock, candidateDisk, "device", "serial")
					if data, err := os.ReadFile(serialPath); err == nil {
						raw = string(data)
						break
					}
					// NVMe device serial fallback
					serialPath = filepath.Join(sysBlock, candidateDisk, "serial")
					if data, err := os.ReadFile(serialPath); err == nil {
						raw = string(data)
						break
					}
				}
			}
		}
		if raw == "" {
			// Fallback: search udevadm info if /dev/sda exists
			if _, err := os.Stat("/dev/sda"); err == nil {
				out := runCommand("udevadm", "info", "--query=property", "--name=/dev/sda")
				lines := strings.Split(out, "\n")
				for _, line := range lines {
					if strings.HasPrefix(line, "ID_SERIAL=") {
						raw = strings.TrimPrefix(line, "ID_SERIAL=")
						break
					}
				}
			}
		}
	}
	return hashValue(raw)
}

var (
	testBoardUUID  string
	testCPUSerial  string
	testDiskSerial string
)

// GetDeviceFingerprintHashes returns the current motherboard, CPU, and disk SHA-256 hashes.
func GetDeviceFingerprintHashes() (string, string, string) {
	uuid := GetBoardUUID()
	if testBoardUUID != "" {
		uuid = testBoardUUID
	}
	cpu := GetCPUSerial()
	if testCPUSerial != "" {
		cpu = testCPUSerial
	}
	disk := GetSystemDiskSerial()
	if testDiskSerial != "" {
		disk = testDiskSerial
	}
	return uuid, cpu, disk
}
