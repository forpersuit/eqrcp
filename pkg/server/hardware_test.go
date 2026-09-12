package server

import (
	"regexp"
	"testing"
	"time"
)

func TestGetDeviceNodeID(t *testing.T) {
	ResetCachedNodeIDForTest()

	// 1. Basic deterministic generation
	nodeID := GetDeviceNodeID()
	if len(nodeID) != 12 {
		t.Fatalf("expected nodeID length 12, got %d (%s)", len(nodeID), nodeID)
	}

	// 2. Format validation: must be 12 lowercase hexadecimal chars
	match, err := regexp.MatchString("^[0-9a-f]{12}$", nodeID)
	if err != nil || !match {
		t.Fatalf("nodeID must match ^[0-9a-f]{12}$, got %s", nodeID)
	}

	// 3. Idempotency validation: consecutive calls must return identical nodeID
	nodeID2 := GetDeviceNodeID()
	if nodeID != nodeID2 {
		t.Fatalf("expected idempotent nodeID, got %s vs %s", nodeID, nodeID2)
	}

	// 4. Test with overridden mock fingerprints
	testFingerprintOverride = true
	testBoardUUID = "uuid-hash-sample"
	testCPUSerial = "cpu-hash-sample"
	testDiskSerial = "disk-hash-sample"
	ResetCachedNodeIDForTest()

	mockNodeID := GetDeviceNodeID()
	if len(mockNodeID) != 12 {
		t.Fatalf("expected mock nodeID length 12, got %d", len(mockNodeID))
	}
	matchMock, _ := regexp.MatchString("^[0-9a-f]{12}$", mockNodeID)
	if !matchMock {
		t.Fatalf("mockNodeID must match ^[0-9a-f]{12}$, got %s", mockNodeID)
	}

	// 5. Test with all-empty fingerprints: must return empty string, NEVER derive constant 71546855d627
	testFingerprintOverride = true
	testBoardUUID = ""
	testCPUSerial = ""
	testDiskSerial = ""
	ResetCachedNodeIDForTest()

	emptyNodeID := GetDeviceNodeID()
	if emptyNodeID != "" {
		t.Fatalf("expected empty nodeID for all-empty fingerprints, got %q (must not derive 71546855d627 or authID)", emptyNodeID)
	}

	// 6. Test that empty nodeID was NOT cached: subsequent fingerprint acquisition succeeds immediately
	testBoardUUID = "board-recovered"
	testCPUSerial = "cpu-recovered"
	testDiskSerial = "disk-recovered"
	recoveredNodeID := GetDeviceNodeID()
	if len(recoveredNodeID) != 12 {
		t.Fatalf("expected recovered nodeID length 12 without explicit cache reset, got %q", recoveredNodeID)
	}

	// 7. Test InvalidateCachedNodeID and InvalidateFingerprintCache
	InvalidateFingerprintCache()
	fingerprintMu.Lock()
	if hasCached || cachedUUID != "" || cachedCPU != "" || cachedDisk != "" {
		fingerprintMu.Unlock()
		t.Fatalf("expected InvalidateFingerprintCache to clear all cached fingerprints and hasCached")
	}
	fingerprintMu.Unlock()

	invalidatedNodeID := GetDeviceNodeID()
	if invalidatedNodeID != recoveredNodeID {
		t.Fatalf("expected recomputed nodeID %q to match %q", invalidatedNodeID, recoveredNodeID)
	}

	// Cleanup test override
	testFingerprintOverride = false
	testBoardUUID = ""
	testCPUSerial = ""
	testDiskSerial = ""
	ResetNodeSaltForTest()
}

func TestHardwareThrottleCooldown(t *testing.T) {
	testFingerprintOverride = false
	testBoardUUID = ""
	testCPUSerial = ""
	testDiskSerial = ""

	// Ensure clean state complying with production invariants (hasCached=false => empty cached hashes)
	InvalidateFingerprintCache()

	fingerprintMu.Lock()
	hasCached = false
	precomputeStarted = false
	cachedUUID = ""
	cachedCPU = ""
	cachedDisk = ""
	lastFingerprintProbeTime = time.Now()
	fingerprintMu.Unlock()

	start := time.Now()
	uuid, cpu, disk := GetDeviceFingerprintHashes()
	elapsed := time.Since(start)

	// In production, during cooldown window after an empty probe, it skips expensive re-probing
	// and consistently returns empty triplet in microseconds (< 200ms), preventing subsystem hammer.
	if uuid != "" || cpu != "" || disk != "" {
		t.Fatalf("expected cooldown throttled return of empty hashes, got %q, %q, %q", uuid, cpu, disk)
	}
	if elapsed > 200*time.Millisecond {
		t.Fatalf("expected cooldown return to be instantaneous (<200ms), took %v", elapsed)
	}

	// Cleanup
	InvalidateFingerprintCache()
}

func TestRotateDeviceNodeIdentity(t *testing.T) {
	ResetNodeSaltForTest()
	testFingerprintOverride = true
	testBoardUUID = "fixed-board-uuid"
	testCPUSerial = "fixed-cpu-serial"
	testDiskSerial = "fixed-disk-serial"
	ResetCachedNodeIDForTest()

	origNodeID := GetDeviceNodeID()
	if len(origNodeID) != 12 {
		t.Fatalf("expected initial node ID length 12, got %q", origNodeID)
	}

	newNodeID, err := RotateDeviceNodeIdentity()
	if err != nil {
		t.Fatalf("RotateDeviceNodeIdentity failed: %v", err)
	}
	if len(newNodeID) != 12 {
		t.Fatalf("expected new rotated node ID length 12, got %q", newNodeID)
	}
	if newNodeID == origNodeID {
		t.Fatalf("rotated node ID %q must differ from original %q", newNodeID, origNodeID)
	}

	// Verify persistence & cache consistency
	readAgain := GetDeviceNodeID()
	if readAgain != newNodeID {
		t.Fatalf("subsequent GetDeviceNodeID returned %q, expected %q", readAgain, newNodeID)
	}

	// Verify subsequent rotation produces yet another distinct node ID
	thirdNodeID, err := RotateDeviceNodeIdentity()
	if err != nil {
		t.Fatalf("second RotateDeviceNodeIdentity failed: %v", err)
	}
	if thirdNodeID == newNodeID || thirdNodeID == origNodeID {
		t.Fatalf("third node ID %q collided with prior IDs", thirdNodeID)
	}

	// Cleanup
	testFingerprintOverride = false
	testBoardUUID = ""
	testCPUSerial = ""
	testDiskSerial = ""
	ResetNodeSaltForTest()
}
