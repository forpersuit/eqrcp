//go:build eqtdev

package crash

// defaultCrashServer 在 eqtdev 构建下覆盖为专属测试域名 lic-test.eqt.net.im 的崩溃上报端点。
var defaultCrashServer = "https://lic-test.eqt.net.im/api/v1/crash-report"
