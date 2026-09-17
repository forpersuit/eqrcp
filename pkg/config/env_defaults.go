//go:build !eqtdev

package config

// isTestBuild 标记当前构建是否为测试(eqtdev)构建。
// 生产构建(不带 tag)恒为 false,漏配方向永远安全。
var isTestBuild = false
