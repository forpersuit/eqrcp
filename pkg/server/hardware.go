package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

var hideWindowAttr *syscall.SysProcAttr

// runCommand runs a CLI command and returns stdout trimmed.
func runCommand(name string, args ...string) string {
	var stdout bytes.Buffer
	cmd := exec.Command(name, args...)
	cmd.Stdout = &stdout
	if hideWindowAttr != nil {
		cmd.SysProcAttr = hideWindowAttr
	}
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

	fingerprintMu     sync.Mutex
	cachedUUID        string
	cachedCPU         string
	cachedDisk        string
	hasCached         bool
	precomputeStarted bool
)

// PrecomputeDeviceFingerprints concurrently fetches and caches the motherboard, CPU, and disk fingerprints in background
func PrecomputeDeviceFingerprints() {
	go func() {
		fingerprintMu.Lock()
		if hasCached {
			fingerprintMu.Unlock()
			return
		}
		precomputeStarted = true
		fingerprintMu.Unlock()

		log.Println("[DRM] Start async precomputing device hardware fingerprints...")
		startTime := time.Now()

		uuidChan := make(chan string, 1)
		cpuChan := make(chan string, 1)
		diskChan := make(chan string, 1)

		go func() {
			t := time.Now()
			uuid := GetBoardUUID()
			log.Printf("[DRM] Retrieve Motherboard UUID finished in %v (empty: %t)", time.Since(t), uuid == "")
			uuidChan <- uuid
		}()
		go func() {
			t := time.Now()
			cpu := GetCPUSerial()
			log.Printf("[DRM] Retrieve CPU Serial finished in %v (empty: %t)", time.Since(t), cpu == "")
			cpuChan <- cpu
		}()
		go func() {
			t := time.Now()
			disk := GetSystemDiskSerial()
			log.Printf("[DRM] Retrieve Disk Serial finished in %v (empty: %t)", time.Since(t), disk == "")
			diskChan <- disk
		}()

		uuid := <-uuidChan
		cpu := <-cpuChan
		disk := <-diskChan

		fingerprintMu.Lock()
		cachedUUID = uuid
		cachedCPU = cpu
		cachedDisk = disk
		hasCached = true
		fingerprintMu.Unlock()

		log.Printf("[DRM] Device hardware fingerprints cached successfully in %v.", time.Since(startTime))

		// 默默在后台触发本地证书校验，完全避免主线程阻塞
		log.Println("[DRM] Background local license verification started...")
		verified := VerifyLocalLicense()
		log.Printf("[DRM] Background local license verification completed. Verified ok: %t, Paid Status: %t, Tier: %s", verified, GetPaidStatus(), GetLicenseTier())
		// Process start: always force one online reconciliation when a local certificate exists.
		// Online status is authoritative for unbind/revoke; the 12h throttle only applies to later background syncs.
		// Offline 7-day lease remains the fallback only when the network call fails.
		if _, ok := GetLocalLicenseInfo(); ok {
			log.Println("[DRM] Startup online license reconciliation (forced, online is SSOT)...")
			if err := ForceOnlineLicenseSync(); err != nil {
				log.Printf("[DRM] Startup online license reconciliation finished with: %v (paid=%t tier=%s)", err, GetPaidStatus(), GetLicenseTier())
			} else {
				log.Printf("[DRM] Startup online license reconciliation succeeded. Paid Status: %t, Tier: %s", GetPaidStatus(), GetLicenseTier())
			}
		} else if verified {
			// Defensive: verified without readable cert should not happen; keep legacy non-force path.
			StartOnlineLicenseSync()
		}
	}()
}

// GetDeviceFingerprintHashes returns the current motherboard, CPU, and disk SHA-256 hashes.
func GetDeviceFingerprintHashes() (string, string, string) {
	if testBoardUUID != "" || testCPUSerial != "" || testDiskSerial != "" {
		return testBoardUUID, testCPUSerial, testDiskSerial
	}

	fingerprintMu.Lock()
	defer fingerprintMu.Unlock()

	uuid := cachedUUID
	cpu := cachedCPU
	disk := cachedDisk

	if !hasCached {
		if precomputeStarted {
			// If background precomputation is started, return immediately with empty values
			// to avoid blocking the main thread during startup window loading.
			// Verification will trigger again asynchronously once background compute completes.
			log.Println("[DRM] Fingerprints not ready yet. Returning empty hashes to avoid blocking caller thread...")
			return "", "", ""
		}
		log.Println("[DRM] Warning: Sync retrieve fingerprints (precompute not started). Block waiting...")
		uuid = GetBoardUUID()
		cpu = GetCPUSerial()
		disk = GetSystemDiskSerial()
		cachedUUID = uuid
		cachedCPU = cpu
		cachedDisk = disk
		hasCached = true
	}

	if testBoardUUID != "" {
		uuid = testBoardUUID
	}
	if testCPUSerial != "" {
		cpu = testCPUSerial
	}
	if testDiskSerial != "" {
		disk = testDiskSerial
	}
	return uuid, cpu, disk
}

// GetDeviceStableID returns a stable 12-char hex ID derived from hardware fingerprints.
// It collects the non-empty values of uuid_hash, cpu_hash, disk_hash, sorts them, and
// SHA256-hashes their "|"-joined string. The result never changes unless hardware changes.
func GetDeviceStableID() string {
	fingerprintMu.Lock()
	cached := hasCached
	fingerprintMu.Unlock()

	if !cached {
		// Wait up to 1 second for background precomputation to finish (takes ~5ms normally)
		for i := 0; i < 100; i++ {
			time.Sleep(10 * time.Millisecond)
			fingerprintMu.Lock()
			cached = hasCached
			fingerprintMu.Unlock()
			if cached {
				break
			}
		}
	}

	uuid, cpu, disk := GetDeviceFingerprintHashes()
	if uuid == "" && cpu == "" && disk == "" && !cached {
		uuid = GetBoardUUID()
		cpu = GetCPUSerial()
		disk = GetSystemDiskSerial()
	}

	// Collect non-empty fingerprint values and sort for determinism
	parts := []string{}
	if uuid != "" {
		parts = append(parts, uuid)
	}
	if cpu != "" {
		parts = append(parts, cpu)
	}
	if disk != "" {
		parts = append(parts, disk)
	}
	if len(parts) == 0 {
		return ""
	}

	// Sort for determinism (order doesn't matter, only content)
	for i := 0; i < len(parts)-1; i++ {
		for j := i + 1; j < len(parts); j++ {
			if parts[i] > parts[j] {
				parts[i], parts[j] = parts[j], parts[i]
			}
		}
	}

	joined := strings.Join(parts, "|")
	sum := sha256.Sum256([]byte(joined))
	return hex.EncodeToString(sum[:])[:12]
}
