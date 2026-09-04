package main

import (
	"os"

	"eqt/cmd"
	"eqt/pkg/config"
	"eqt/pkg/server"
)

func init() {
	if config.IsBlockProxyEnabled() {
		config.ApplyProxyPolicy(true)
	}
}

func main() {
	// 启动时在后台开始预计算硬件指纹并默默校验本地证书，完全非阻塞，防窗口闪烁
	server.PrecomputeDeviceFingerprints()

	if err := cmd.Execute(); err != nil {
		os.Exit(1)
	}
}
