//go:build eqtdev

package config

// isTestBuild 在 eqtdev 构建下覆盖为 true,用于测试环境物理隔离。
var isTestBuild = true
