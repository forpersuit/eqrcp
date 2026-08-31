package e2ee

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func TestMockDRMServerLifecycle(t *testing.T) {
	mock := NewMockDRMServer()
	defer mock.Close()

	// 1. Health check
	resp, err := http.Get(mock.URL() + "/api/v1/e2ee/session/health")
	if err != nil {
		t.Fatalf("Health check failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Health status = %d; want 200", resp.StatusCode)
	}
	resp.Body.Close()

	// 2. Create session
	createReq := map[string]any{
		"license_key": "lic_active_123456",
		"device_id":   "dev_pc_test",
		"mode":        "share",
		"max_claims":  2,
	}
	reqBody, _ := json.Marshal(createReq)
	resp, err = http.Post(mock.URL()+"/api/v1/e2ee/session/create", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		t.Fatalf("Create session request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Create status = %d; want 200", resp.StatusCode)
	}
	var createRes struct {
		OK         bool   `json:"ok"`
		SessionID  string `json:"session_id"`
		CloseToken string `json:"close_token"`
	}
	json.NewDecoder(resp.Body).Decode(&createRes)
	resp.Body.Close()

	if !createRes.OK || createRes.SessionID == "" || createRes.CloseToken == "" {
		t.Fatalf("Invalid create response: %+v", createRes)
	}

	// 3. Claim 1
	claimReq := map[string]any{"session_id": createRes.SessionID}
	claimBody, _ := json.Marshal(claimReq)
	resp, err = http.Post(mock.URL()+"/api/v1/e2ee/session/claim", "application/json", bytes.NewReader(claimBody))
	if err != nil {
		t.Fatalf("Claim 1 failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Claim 1 status = %d; want 200", resp.StatusCode)
	}
	var claimRes struct {
		OK           bool   `json:"ok"`
		MasterKeyB64 string `json:"master_key_b64"`
		ClaimsLeft   int    `json:"claims_left"`
	}
	json.NewDecoder(resp.Body).Decode(&claimRes)
	resp.Body.Close()

	if !claimRes.OK || claimRes.MasterKeyB64 == "" || claimRes.ClaimsLeft != 1 {
		t.Fatalf("Invalid claim 1 response: %+v", claimRes)
	}

	// 4. Claim 2 (Quota = 2)
	resp, err = http.Post(mock.URL()+"/api/v1/e2ee/session/claim", "application/json", bytes.NewReader(claimBody))
	if err != nil {
		t.Fatalf("Claim 2 failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Claim 2 status = %d; want 200", resp.StatusCode)
	}
	resp.Body.Close()

	// 5. Claim 3 (Exceeded)
	resp, err = http.Post(mock.URL()+"/api/v1/e2ee/session/claim", "application/json", bytes.NewReader(claimBody))
	if err != nil {
		t.Fatalf("Claim 3 failed: %v", err)
	}
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("Claim 3 status = %d; want 403", resp.StatusCode)
	}
	resp.Body.Close()

	// 6. Close session
	closeReq := map[string]any{
		"session_id":  createRes.SessionID,
		"close_token": createRes.CloseToken,
	}
	closeBody, _ := json.Marshal(closeReq)
	resp, err = http.Post(mock.URL()+"/api/v1/e2ee/session/close", "application/json", bytes.NewReader(closeBody))
	if err != nil {
		t.Fatalf("Close failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Close status = %d; want 200", resp.StatusCode)
	}
	resp.Body.Close()
}
