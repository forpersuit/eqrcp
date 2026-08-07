//go:build eqtdev

package server

// defaultLicenseServer 在 eqtdev 构建下覆盖为测试 Worker。
// 对接方式:wails dev/build 带 -tags eqtdev(见 docs/deploy/gui-environment.md)。
// ⚠️ 占位符:搭建测试环境(文档 P1 步骤)后,把 <subdomain> 换成实际 workers.dev 子域。
var defaultLicenseServer = "https://eqt-drm-api-test.leeyelon.workers.dev"

// eqtdev 构建下覆盖验证公钥为测试专用密钥对(测试 worker 的 ED25519_PRIVATE_KEY
// = hex seed 2cf5baa8...,对应公钥 ce07f0...)。release 构建不带 tag 恒用生产公钥,
// 测试激活码只能被测试构建验证,漏配方向永远安全。
var defaultPublicKeyHex = "ce07f02c21cb898bf9d84c9af843dc23e830937f939d8b0a042df7210f74fe58"
var defaultUpdatePublicKeyHex = "ce07f02c21cb898bf9d84c9af843dc23e830937f939d8b0a042df7210f74fe58"
