//go:build eqtdev

package server

// defaultLicenseServer 在 eqtdev 构建下覆盖为测试 Worker。
// 对接方式:wails dev/build 带 -tags eqtdev(见 docs/deploy/gui-environment.md)。
// ⚠️ 占位符:搭建测试环境(文档 P1 步骤)后,把 <subdomain> 换成实际 workers.dev 子域。
var defaultLicenseServer = "https://eqt-drm-api-test.<subdomain>.workers.dev"
