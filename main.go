package main

import (
	"net/http"
	"os"

	"eqt/cmd"
	"eqt/pkg/server"
)

func init() {
	// 工程不走任何代理，只有直连
	_ = os.Unsetenv("http_proxy")
	_ = os.Unsetenv("https_proxy")
	_ = os.Unsetenv("all_proxy")
	_ = os.Unsetenv("HTTP_PROXY")
	_ = os.Unsetenv("HTTPS_PROXY")
	_ = os.Unsetenv("ALL_PROXY")
	if t, ok := http.DefaultTransport.(*http.Transport); ok {
		t.Proxy = nil
	}
}

func main() {
	// 启动时在后台开始预计算硬件指纹并默默校验本地证书，完全非阻塞，防窗口闪烁
	server.PrecomputeDeviceFingerprints()

	if err := cmd.Execute(); err != nil {
		os.Exit(1)
	}
}
