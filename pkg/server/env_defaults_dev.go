//go:build eqtdev

package server

// defaultLicenseServer 在 eqtdev 构建下覆盖为专属测试域名 lic-test.eqt.net.im。
// 享受 Cloudflare CDN 稳定加速，彻底避免 workers.dev 的网络连接超时。
var defaultLicenseServer = "https://lic-test.eqt.net.im"

// isTestBuild 在 eqtdev 构建下为 true,用于 GUI 前端区分测试/生产
// (如购买按钮打开测试站 pricing)。release 构建不带 tag 恒为 false。
var isTestBuild = true

// eqtdev 构建下覆盖验证公钥为测试专用密钥对(测试 worker 的 ED25519_PRIVATE_KEY
// = hex seed 2cf5baa8...,对应公钥 ce07f0...)。release 构建不带 tag 恒用生产公钥,
// 测试激活码只能被测试构建验证,漏配方向永远安全。
var defaultPublicKeyHex = "ce07f02c21cb898bf9d84c9af843dc23e830937f939d8b0a042df7210f74fe58"
var defaultUpdatePublicKeyHex = "ce07f02c21cb898bf9d84c9af843dc23e830937f939d8b0a042df7210f74fe58"
