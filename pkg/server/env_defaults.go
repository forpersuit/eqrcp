//go:build !eqtdev

package server

// defaultLicenseServer 是 DRM API 的默认地址。
// 安全不变式:代码默认值恒为生产;测试环境只能通过以下显式机制进入——
//  1. 运行时环境变量 EQT_LICENSE_SERVER(见 getLicenseServer)
//  2. 构建期 -tags eqtdev(见 env_defaults_dev.go,覆盖本变量)
//
// release 构建不带 eqtdev tag 即为生产,漏配方向永远安全。
var defaultLicenseServer = "https://lic.eqt.net.im"

// isTestBuild 标记当前构建是否为测试(eqtdev)构建。
// 生产构建(不带 tag)恒为 false;eqtdev 构建在 env_defaults_dev.go 覆盖为 true。
// 供 GUI 前端区分测试/生产(如购买按钮打开测试站 pricing)。
var isTestBuild = false

// defaultPublicKeyHex / defaultUpdatePublicKeyHex 是 Ed25519 验证公钥,
// 与 Cloudflare Workers 私钥对应(激活证书签名、更新包签名验证)。
// 生产恒用生产公钥;eqtdev 构建在 env_defaults_dev.go 覆盖为测试专用公钥,
// 因此测试激活码/测试更新包只能被测试构建验证,release 恒验证生产。
var defaultPublicKeyHex = "08443678fe8bd16e3bc306db8a08b6ea1dcf3e8edeb413f655e106374bed43ac"
var defaultUpdatePublicKeyHex = "08443678fe8bd16e3bc306db8a08b6ea1dcf3e8edeb413f655e106374bed43ac"
