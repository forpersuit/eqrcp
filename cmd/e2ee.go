package cmd

import (
	"crypto/rand"
	"fmt"
	"time"

	"eqt/pkg/config"
	"eqt/pkg/crypto/e2ee"
	"eqt/pkg/logger"
	"eqt/pkg/server"
)

const cliDRMProbeTimeout = 800 * time.Millisecond

// SetupCLIEncryption configures E2EE on srv for CLI commands (send/receive).
func SetupCLIEncryption(srv *server.Server, cfg *config.Config, log logger.Logger, mode string) {
	if !cfg.EnableE2EE {
		log.Print("🔓 [明文模式] 端到端加密已禁用")
		return
	}

	if !e2ee.CheckDRMHealthWithTimeout("", cliDRMProbeTimeout) {
		log.Print("⚠️  [E2EE 降级] 无法连接 DRM 密钥分发服务，已自动降级为局域网明文传输模式")
		return
	}

	masterKey, err := e2ee.GenerateMasterKey()
	if err != nil {
		log.Print(fmt.Sprintf("⚠️  [E2EE 错误] 生成加密主密钥失败: %v，已降级为明文传输", err))
		return
	}

	randSuffix := make([]byte, 4)
	_, _ = rand.Read(randSuffix)
	sessionID := fmt.Sprintf("cli-%s-%d-%x", mode, time.Now().Unix(), randSuffix)

	if err := srv.EnableE2EE(masterKey, sessionID); err != nil {
		log.Print(fmt.Sprintf("⚠️  [E2EE 错误] 启用 E2EE 失败: %v，已降级为明文传输", err))
		return
	}

	log.Print("🔒 [E2EE] 端到端加密已启用 (XChaCha20-Poly1305 分块流式传输)")
}
