package cmd

import (
	"net/http"
	"testing"
	"time"

	"eqt/pkg/config"
	"eqt/pkg/crypto/e2ee"
	"eqt/pkg/logger"
	"eqt/pkg/server"
)

func TestSetupCLIEncryption(t *testing.T) {
	log := logger.New(true)
	cfg := &config.Config{
		Interface: "lo",
		Port:      0,
		Bind:      "127.0.0.1",
		KeepAlive: true,
	}

	// 1. When EnableE2EE is false
	srv1, err := server.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer srv1.Shutdown()

	cfgDisabled := *cfg
	cfgDisabled.EnableE2EE = false
	SetupCLIEncryption(srv1, &cfgDisabled, log, "send")
	if srv1.GetE2EEDerivedKeys() != nil {
		t.Fatal("expected E2EE not to be enabled on server when EnableE2EE is false")
	}

	// 2. When DRM is online (MockDRMServer)
	mockDRM := e2ee.NewMockDRMServer()
	defer mockDRM.Close()
	t.Setenv("EQT_DRM_URL", mockDRM.URL())

	srv2, err := server.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer srv2.Shutdown()

	cfgEnabled := *cfg
	cfgEnabled.EnableE2EE = true
	SetupCLIEncryption(srv2, &cfgEnabled, log, "send")
	if srv2.GetE2EEDerivedKeys() == nil {
		t.Fatal("expected E2EE derived keys to be active on server when DRM is online")
	}

	// 3. When DRM is offline -> fast degradation within probe timeout
	mockDRM.SetHealthy(false, http.StatusServiceUnavailable)

	srv3, err := server.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer srv3.Shutdown()

	start := time.Now()
	SetupCLIEncryption(srv3, &cfgEnabled, log, "receive")
	elapsed := time.Since(start)
	if elapsed > 2*time.Second {
		t.Fatalf("expected fast probe degradation, but took %v", elapsed)
	}
	if srv3.GetE2EEDerivedKeys() != nil {
		t.Fatal("expected E2EE to be inactive on server when DRM is offline")
	}
}
