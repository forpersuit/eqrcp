package server

import (
	"regexp"
	"testing"
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

	// Cleanup test override
	testFingerprintOverride = false
	testBoardUUID = ""
	testCPUSerial = ""
	testDiskSerial = ""
	ResetCachedNodeIDForTest()
}
