//go:build !eqtdev

package crash

// defaultCrashServer 是崩溃上报端点的默认地址。
// 安全不变式:代码默认值恒为生产;测试环境只能通过以下显式机制进入——
//  1. 运行时环境变量 EQT_CRASH_SERVER(见 getCrashServer)
//  2. 构建期 -tags eqtdev(见 env_defaults_dev.go,覆盖本变量)
//
// release 构建不带 eqtdev tag 即为生产,漏配方向永远安全。
var defaultCrashServer = "https://lic.eqt.net.im/api/v1/crash-report"
